import { create } from 'zustand';
import { grafanaConnectionAPI, grafanaAPI } from '@/services/api';
import { availableDBScopes } from '@/stores/dbConnectionStore';
import type { DBScope } from '@/services/api';
import type { GrafanaConnection, GrafanaSearchHit, GrafanaServerInfo } from '@/types';

// grafanaConnectionStore mirrors esConnectionStore: reachable Grafana
// connections (own + delegated) merged by id across every BE scope, plus two
// per-connection caches — server info (version, datasources) and the folder /
// dashboard listing the sidebar tree renders.
//
// A 'session' connection lives on ONE backend (the session cookie rotates
// there), so it is never dual-written — see GrafanaConnectionDialog.

interface TreeCache {
  folders: GrafanaSearchHit[];
  dashboards: GrafanaSearchHit[];
  loadedAt: number;
  /** Search needs a login this connection doesn't have; only its public
   *  dashboard links are browsable. */
  publicOnly?: boolean;
}

interface GrafanaConnectionState {
  connections: GrafanaConnection[];
  loading: boolean;
  loaded: boolean;
  info: Record<string, GrafanaServerInfo | undefined>;
  trees: Record<string, TreeCache | undefined>;
  treeErrors: Record<string, string | undefined>;
  fetchConnections: () => Promise<void>;
  upsertLocal: (conn: GrafanaConnection) => void;
  removeLocal: (id: string) => void;
  loadInfo: (connId: string, force?: boolean) => Promise<GrafanaServerInfo | null>;
  loadTree: (connId: string, force?: boolean) => Promise<void>;
}

export function scopeForGrafana(connections: GrafanaConnection[], id: string): DBScope {
  const conn = connections.find((c) => c.id === id);
  if (conn?.scope) return conn.scope;
  const scopes = availableDBScopes();
  return scopes.includes('remote') ? 'remote' : 'local';
}

/** Readable message from an axios error raised by the Grafana routes. */
export function grafanaError(e: unknown): { message: string; code?: string } {
  const err = e as { response?: { data?: { error?: string; code?: string } }; message?: string };
  return {
    message: err.response?.data?.error || err.message || 'Request failed',
    code: err.response?.data?.code,
  };
}

export const useGrafanaConnectionStore = create<GrafanaConnectionState>((set, get) => ({
  connections: [],
  loading: false,
  loaded: false,
  info: {},
  trees: {},
  treeErrors: {},

  fetchConnections: async () => {
    set({ loading: true });
    const scopes = availableDBScopes();
    const results = await Promise.allSettled(
      scopes.map((scope) =>
        grafanaConnectionAPI.list(scope).then((res) => ({
          scope,
          rows: (res.data as GrafanaConnection[]) ?? [],
        })),
      ),
    );
    const byId = new Map<string, GrafanaConnection>();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const row of r.value.rows) {
        const existing = byId.get(row.id);
        if (existing) {
          existing.availableScopes = [...new Set([...(existing.availableScopes ?? []), r.value.scope])];
          if (row.primaryScope && !existing.primaryScope) existing.primaryScope = row.primaryScope;
          if (row.shared) existing.scope = r.value.scope;
        } else {
          byId.set(row.id, { ...row, scope: r.value.scope, availableScopes: [r.value.scope] });
        }
      }
    }
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
      // Credentials may have changed — drop caches for this connection.
      return {
        connections: next,
        info: { ...s.info, [conn.id]: undefined },
        trees: { ...s.trees, [conn.id]: undefined },
        treeErrors: { ...s.treeErrors, [conn.id]: undefined },
      };
    }),

  removeLocal: (id) =>
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      info: { ...s.info, [id]: undefined },
      trees: { ...s.trees, [id]: undefined },
    })),

  loadInfo: async (connId, force) => {
    const cached = get().info[connId];
    if (cached && !force) return cached;
    try {
      const res = await grafanaAPI.info(connId, scopeForGrafana(get().connections, connId));
      const info = res.data as GrafanaServerInfo;
      set((s) => ({ info: { ...s.info, [connId]: info } }));
      return info;
    } catch {
      return null;
    }
  },

  loadTree: async (connId, force) => {
    const cached = get().trees[connId];
    if (cached && !force && Date.now() - cached.loadedAt < 60_000) return;
    try {
      const res = await grafanaAPI.search(connId, '', scopeForGrafana(get().connections, connId));
      const data = res.data as { folders: GrafanaSearchHit[]; dashboards: GrafanaSearchHit[] };
      set((s) => ({
        trees: { ...s.trees, [connId]: { folders: data.folders ?? [], dashboards: data.dashboards ?? [], loadedAt: Date.now() } },
        treeErrors: { ...s.treeErrors, [connId]: undefined },
      }));
    } catch (e) {
      const conn = get().connections.find((c) => c.id === connId);
      const status = (e as { response?: { status?: number } }).response?.status;
      const err = grafanaError(e);
      if (conn?.authKind === 'none' && conn.options?.publicDashboards?.length && (err.code === 'auth' || err.code === 'forbidden' || status === 401 || status === 403)) {
        set((s) => ({
          trees: { ...s.trees, [connId]: { folders: [], dashboards: [], loadedAt: Date.now(), publicOnly: true } },
          treeErrors: { ...s.treeErrors, [connId]: undefined },
        }));
        return;
      }
      set((s) => ({ treeErrors: { ...s.treeErrors, [connId]: err.message } }));
    }
  },
}));
