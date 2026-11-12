import { create } from 'zustand';
import { dbConnectionAPI, type DBScope } from '@/services/api';
import { isDesktop } from '@/lib/platform';
import type { DBConnection, DBSchema } from '@/types';

// dbConnectionStore is the FE-side cache of the user's reachable
// connections (own + delegated) plus per-connection schema snapshots.
//
// Dual-write model: a logical connection lives on EVERY reachable BE.
// At create time the FE generates the UUID and POSTs to all available
// scopes in parallel. Update / delete fan-out the same way. The merge
// step in `fetchConnections` collapses the two rows by id so the
// sidebar shows one entry, with `availableScopes` tracking which BE
// copies actually exist. The toolbar Local/Remote toggle then flips
// the executing BE per query.
//
// See the connection dual-write convention: every
// CRUD caller must honor.

interface DBConnectionState {
  connections: DBConnection[];
  loading: boolean;
  schemas: Record<string, DBSchema>;
  fetchConnections: () => Promise<void>;
  upsertLocal: (conn: DBConnection) => void;
  removeLocal: (id: string) => void;
  loadSchema: (id: string, force?: boolean) => Promise<DBSchema | null>;
  /** Flip the per-connection read-write master switch and dual-write it to
   *  every backend the connection lives on. Optimistic: updates the local
   *  cache immediately, rolls back if EVERY backend rejected. Returns the
   *  per-scope results so the caller can surface a partial-write toast. */
  setAllowWrite: (id: string, allowWrite: boolean) => Promise<DualWriteResult<DBConnection>[]>;
}

function readsEmbedded(): boolean {
  if (!isDesktop()) return false;
  if (localStorage.getItem('patchman_mode') === 'local') return true;
  return localStorage.getItem('patchman_data_source') === 'local';
}

export function availableDBScopes(): DBScope[] {
  if (!isDesktop()) return ['remote'];
  if (readsEmbedded()) return ['local'];
  return ['local', 'remote'];
}

export function scopeForConnection(connections: DBConnection[], id: string): DBScope {
  const conn = connections.find((c) => c.id === id);
  if (conn?.scope) return conn.scope;
  const scopes = availableDBScopes();
  return scopes.includes('remote') ? 'remote' : 'local';
}

// dualWriteScopes returns the scope list a CRUD operation should fan
// out to. Always honors `availableDBScopes()` so an offline BE doesn't
// block the user — partial writes are reported via the per-scope
// result of `dualWrite`.
export function dualWriteScopes(): DBScope[] {
  return availableDBScopes();
}

export interface DualWriteResult<T> {
  scope: DBScope;
  ok: boolean;
  value?: T;
  error?: unknown;
}

// dualWrite calls `fn` once per reachable scope in parallel. Caller
// inspects the result array to surface partial failures.
export async function dualWrite<T>(
  fn: (scope: DBScope) => Promise<T>,
  scopes: DBScope[] = dualWriteScopes(),
): Promise<DualWriteResult<T>[]> {
  return Promise.all(
    scopes.map(async (scope): Promise<DualWriteResult<T>> => {
      try {
        const value = await fn(scope);
        return { scope, ok: true, value };
      } catch (error) {
        return { scope, ok: false, error };
      }
    }),
  );
}

// describePartialWrite turns a dual-write result set into a user-facing
// toast when not every backend accepted the write. It distinguishes a
// genuine failure (red) from the benign "that backend is on an older
// version that doesn't have this feature yet" case — a 404 on every failed
// scope — which is expected during a rollout (e.g. a newer tool shipped in
// the desktop app before the hosted BE deployed it). Returns null when all
// target scopes succeeded.
export function describePartialWrite<T>(
  results: DualWriteResult<T>[],
  writeScopes: DBScope[],
  verb: string,
): { title: string; description: string; variant: 'default' | 'destructive' } | null {
  const okScopes = results.filter((r) => r.ok).map((r) => r.scope);
  if (okScopes.length >= writeScopes.length) return null;
  const missed = writeScopes.filter((s) => !okScopes.includes(s));
  const failed = results.filter((r) => !r.ok);
  const all404 = failed.length > 0 && failed.every(
    (r) => (r.error as { response?: { status?: number } } | undefined)?.response?.status === 404,
  );
  if (all404) {
    return {
      title: 'Saved — other backend not updated yet',
      description: `${verb} on ${okScopes.join(' + ')}. The ${missed.join(' + ')} backend is on an older version without this feature yet; it'll sync once that side is updated.`,
      variant: 'default',
    };
  }
  return {
    title: 'Partial save',
    description: `${verb} on ${okScopes.join(' + ')}; failed on ${missed.join(' + ')}. Edit + Save again to retry.`,
    variant: 'destructive',
  };
}

export const useDBConnectionStore = create<DBConnectionState>((set, get) => ({
  connections: [],
  loading: false,
  schemas: {},

  fetchConnections: async () => {
    set({ loading: true });
    const scopes = availableDBScopes();
    const results = await Promise.allSettled(
      scopes.map((scope) =>
        dbConnectionAPI.list(scope).then((res) => ({
          scope,
          rows: (res.data as DBConnection[]) ?? [],
        })),
      ),
    );

    // Merge by id. Each BE returns its own copy of the same logical
    // connection (same primary key) — collapse and union `availableScopes`.
    //
    // Primary scope resolution: prefer the BE-stored `primaryScope`
    // (user choice persisted via dual-write). For legacy rows that
    // predate the column ('') fall back to 'remote' when remote is
    // reachable, otherwise stick with whatever scope is available.
    // Shared rows still prefer remote because grants live there.
    const byId = new Map<string, DBConnection>();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const row of r.value.rows) {
        const existing = byId.get(row.id);
        if (existing) {
          const set = new Set([...(existing.availableScopes ?? []), r.value.scope]);
          existing.availableScopes = [...set];
          // Adopt the row that carries an explicit primaryScope — both
          // BEs should agree, but if only one was written through the
          // new path we trust whichever side has the field set.
          if (row.primaryScope && !existing.primaryScope) {
            existing.primaryScope = row.primaryScope;
          }
          if (row.shared) existing.scope = r.value.scope;
        } else {
          byId.set(row.id, {
            ...row,
            scope: r.value.scope,
            availableScopes: [r.value.scope],
          });
        }
      }
    }
    // Apply primaryScope → scope after the union so we know the full
    // `availableScopes` set before defaulting.
    const merged = [...byId.values()].map((c) => {
      if (c.shared) return c; // remote wins for shared, already handled
      const avail = c.availableScopes ?? [];
      if (c.primaryScope === 'local' && avail.includes('local')) {
        return { ...c, scope: 'local' as const };
      }
      if (c.primaryScope === 'remote' && avail.includes('remote')) {
        return { ...c, scope: 'remote' as const };
      }
      // Legacy / unknown primaryScope: default to remote when reachable,
      // matching the dialog hint ("Use for prod / staging behind VPN").
      if (avail.includes('remote')) return { ...c, scope: 'remote' as const };
      return { ...c, scope: 'local' as const };
    });
    set({ connections: merged, loading: false });
  },

  upsertLocal: (conn) => {
    set((s) => {
      const idx = s.connections.findIndex((c) => c.id === conn.id);
      const next = idx >= 0
        ? s.connections.map((c, i) => (i === idx ? { ...c, ...conn } : c))
        : [conn, ...s.connections];
      return { connections: next };
    });
  },

  removeLocal: (id) => {
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      schemas: Object.fromEntries(Object.entries(s.schemas).filter(([k]) => k !== id)),
    }));
  },

  setAllowWrite: async (id, allowWrite) => {
    const conn = get().connections.find((c) => c.id === id);
    if (!conn) return [];
    // Fan out to every backend the connection currently lives on, mirroring
    // the connection-edit dual-write (dual-write convention).
    const writeScopes: DBScope[] = conn.availableScopes && conn.availableScopes.length > 0
      ? (conn.availableScopes as DBScope[])
      : [conn.scope ?? 'remote'];
    // Optimistic local flip so the badge + menu reflect the change at once.
    set((s) => ({
      connections: s.connections.map((c) => (c.id === id ? { ...c, allowWrite } : c)),
    }));
    const results = await dualWrite(
      (scope) => dbConnectionAPI.update(id, { allowWrite }, scope).then((r) => r.data as DBConnection),
      writeScopes,
    );
    const okScopes = results.filter((r) => r.ok).map((r) => r.scope);
    if (okScopes.length === 0) {
      // Every backend refused — revert the optimistic flip so the UI never
      // claims read-write while the executing BE still enforces read-only.
      set((s) => ({
        connections: s.connections.map((c) => (c.id === id ? { ...c, allowWrite: !allowWrite } : c)),
      }));
    }
    return results;
  },

  loadSchema: async (id, force) => {
    const cached = get().schemas[id];
    if (cached && !force) return cached;
    // Pick the primary scope's schema — both BEs introspect to the
    // same metadata anyway, but the row may only exist on one of them
    // for a partial-write degraded connection.
    const conn = get().connections.find((c) => c.id === id);
    const scope: DBScope =
      conn?.scope ?? (conn?.availableScopes?.[0] ?? scopeForConnection(get().connections, id));
    try {
      const res = force
        ? await dbConnectionAPI.refreshSchema(id, scope)
        : await dbConnectionAPI.schema(id, scope);
      const schema = res.data as DBSchema;
      set((s) => ({ schemas: { ...s.schemas, [id]: schema } }));
      return schema;
    } catch {
      return null;
    }
  },
}));
