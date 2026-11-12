import { create } from 'zustand';
import { gitAPI, setGitReadScopeResolver } from '@/services/api';
import {
  availableDBScopes,
  dualWrite,
  describePartialWrite,
} from '@/stores/dbConnectionStore';
import type { DBScope } from '@/services/api';
import type { GitConnection } from '@/types';

// gitConnectionStore mirrors k8sConnectionStore: the reachable Git
// connections (own + delegated), merged by id across every BE scope. It
// reuses the DB store's scope helpers (availableDBScopes / dualWrite /
// describePartialWrite) — scope resolution is an app-wide concern, not
// DB-specific. Connection CRUD is dual-written (control plane); remote
// reads and local working-tree ops single-route via the pinned gitAPI
// methods. See GIT_V1_CONTRACT.md §5.

// A user-facing partial-write descriptor (or null when every target scope
// accepted the write). The store stays UI-free — it returns this to the
// caller, which decides whether to toast. Mirrors describePartialWrite.
type PartialWrite = ReturnType<typeof describePartialWrite>;

export interface GitCrudResult {
  connection: GitConnection;
  partial: PartialWrite;
}

interface GitConnectionState {
  connections: GitConnection[];
  loading: boolean;
  loaded: boolean;
  fetchConnections: () => Promise<void>;
  upsertLocal: (conn: GitConnection) => void;
  removeLocal: (id: string) => void;
  // Dual-write CRUD — FE-minted UUID fans out to every reachable BE so both
  // rows share the id. `scope` is the user-chosen primary backend.
  createConnection: (payload: Record<string, unknown>, scope: DBScope) => Promise<GitCrudResult>;
  updateConnection: (
    editing: GitConnection,
    payload: Record<string, unknown>,
    scope: DBScope,
  ) => Promise<GitCrudResult>;
  deleteConnection: (conn: GitConnection) => Promise<PartialWrite>;
  // Grants single-route to the connection's resolved scope (like the k8s
  // share dialog) — they are control-plane rows on that BE.
  addGrant: (
    id: string,
    data: { subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' },
    scope?: DBScope,
  ) => Promise<void>;
  removeGrant: (
    id: string,
    data: { subjectKind: 'user' | 'team'; subjectId: string },
    scope?: DBScope,
  ) => Promise<void>;
}

export function scopeForGit(connections: GitConnection[], id: string): DBScope {
  const conn = connections.find((c) => c.id === id);
  if (conn?.scope) return conn.scope;
  const scopes = availableDBScopes();
  return scopes.includes('remote') ? 'remote' : 'local';
}

// The scopes a mutation on `conn` should fan out to: prefer the union of BEs
// that actually carry a copy (availableScopes), falling back to its resolved
// scope for a legacy single-BE row.
function writeScopesFor(conn: Pick<GitConnection, 'availableScopes' | 'scope'>, fallback: DBScope): DBScope[] {
  return conn.availableScopes && conn.availableScopes.length > 0
    ? (conn.availableScopes as DBScope[])
    : [conn.scope ?? fallback];
}

export const useGitConnectionStore = create<GitConnectionState>((set, get) => ({
  connections: [],
  loading: false,
  loaded: false,

  fetchConnections: async () => {
    set({ loading: true });
    const scopes = availableDBScopes();
    const results = await Promise.allSettled(
      scopes.map((scope) =>
        gitAPI.list(scope).then((res) => ({
          scope,
          rows: (res.data as GitConnection[]) ?? [],
        })),
      ),
    );
    // Merge by id — each BE returns its own copy of the same logical
    // connection (same primary key). Collapse and union `availableScopes`.
    const byId = new Map<string, GitConnection>();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const row of r.value.rows) {
        const existing = byId.get(row.id);
        if (existing) {
          const merged = new Set([...(existing.availableScopes ?? []), r.value.scope]);
          existing.availableScopes = [...merged];
          if (row.primaryScope && !existing.primaryScope) existing.primaryScope = row.primaryScope;
          if (row.shared) existing.scope = r.value.scope;
        } else {
          byId.set(row.id, { ...row, scope: r.value.scope, availableScopes: [r.value.scope] });
        }
      }
    }
    // Apply primaryScope → scope after the union so the full availableScopes
    // set is known before defaulting. Shared rows prefer remote (grants live
    // there); legacy rows default to remote when reachable.
    const merged = [...byId.values()].map((c) => {
      if (c.shared) return c;
      const avail = c.availableScopes ?? [];
      if (c.primaryScope === 'local' && avail.includes('local')) return { ...c, scope: 'local' as const };
      if (c.primaryScope === 'remote' && avail.includes('remote')) return { ...c, scope: 'remote' as const };
      if (avail.includes('remote')) return { ...c, scope: 'remote' as const };
      return { ...c, scope: 'local' as const };
    });
    set({ connections: merged, loading: false, loaded: true });
  },

  upsertLocal: (conn) =>
    set((s) => {
      const idx = s.connections.findIndex((c) => c.id === conn.id);
      const next = idx >= 0
        ? s.connections.map((c, i) => (i === idx ? { ...c, ...conn } : c))
        : [conn, ...s.connections];
      return { connections: next };
    }),

  removeLocal: (id) =>
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
    })),

  createConnection: async (payload, scope) => {
    const writeScopes = availableDBScopes();
    const id = crypto.randomUUID();
    const creates = await dualWrite(
      (s) => gitAPI.create({ id, ...payload }, s).then((r) => r.data as GitConnection),
      writeScopes,
    );
    const okScopes = creates.filter((r) => r.ok).map((r) => r.scope);
    if (okScopes.length === 0) {
      throw creates.find((r) => !r.ok)?.error ?? new Error('Create failed on every backend');
    }
    const partial = describePartialWrite(creates, writeScopes, 'Saved');
    const first = creates.find((r) => r.ok)!.value!;
    const saved: GitConnection = { ...first, scope, primaryScope: scope, availableScopes: okScopes };
    get().upsertLocal(saved);
    return { connection: saved, partial };
  },

  updateConnection: async (editing, payload, scope) => {
    const writeScopes = writeScopesFor(editing, scope);
    const updates = await dualWrite(
      (s) => gitAPI.update(editing.id, payload, s).then((r) => r.data as GitConnection),
      writeScopes,
    );
    const okScopes = updates.filter((r) => r.ok).map((r) => r.scope);
    if (okScopes.length === 0) {
      throw updates.find((r) => !r.ok)?.error ?? new Error('Update failed on every backend');
    }
    const partial = describePartialWrite(updates, writeScopes, 'Updated');
    const first = updates.find((r) => r.ok)!.value!;
    const saved: GitConnection = { ...first, scope, primaryScope: scope, availableScopes: okScopes };
    get().upsertLocal(saved);
    return { connection: saved, partial };
  },

  deleteConnection: async (conn) => {
    const writeScopes = writeScopesFor(conn, conn.scope ?? 'remote');
    const dels = await dualWrite((s) => gitAPI.delete(conn.id, s), writeScopes);
    // Best-effort local removal — a row that failed to delete on one BE is
    // surfaced via the returned partial descriptor; the caller can retry.
    get().removeLocal(conn.id);
    return describePartialWrite(dels, writeScopes, 'Deleted');
  },

  addGrant: async (id, data, scope) => {
    const s = scope ?? scopeForGit(get().connections, id);
    await gitAPI.addGrant(id, data, s);
  },

  removeGrant: async (id, data, scope) => {
    const s = scope ?? scopeForGit(get().connections, id);
    await gitAPI.deleteGrant(id, data, s);
  },
}));

// PAT connections read GitLab from their own BE (see gitReadCfg in api.ts).
setGitReadScopeResolver((id) => {
  const conns = useGitConnectionStore.getState().connections;
  const conn = conns.find((c) => c.id === id);
  return conn && conn.authKind === 'pat' ? scopeForGit(conns, id) : undefined;
});

/** Token for a local clone / pull / push. A PAT connection's own token is
 *  applied by the BE, so nothing is minted (no remote BE or linked GitLab
 *  account needed); otherwise a short-lived token of the caller's linked
 *  GitLab account. */
export async function gitOpsToken(connectionId: string | undefined): Promise<string> {
  const conn = connectionId ? useGitConnectionStore.getState().connections.find((c) => c.id === connectionId) : undefined;
  if (conn?.authKind === 'pat') return '';
  const res = await gitAPI.mintToken();
  return res.data.token;
}

