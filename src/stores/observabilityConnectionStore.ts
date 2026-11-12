import { create } from 'zustand';
import { observabilityConnectionAPI } from '@/services/api';
import { availableDBScopes } from '@/stores/dbConnectionStore';
import type { DBScope } from '@/services/api';
import type { ObservabilityConnection } from '@/types';

// observabilityConnectionStore mirrors grafanaConnectionStore: reachable
// APM / observability connections (own + delegated) merged by id across
// every BE scope. A 'session' connection lives on ONE backend, so it is
// never dual-written — see ObservabilityConnectionDialog.

interface ObservabilityConnectionState {
  connections: ObservabilityConnection[];
  loading: boolean;
  loaded: boolean;
  fetchConnections: () => Promise<void>;
  upsertLocal: (conn: ObservabilityConnection) => void;
  removeLocal: (id: string) => void;
}

export function scopeForObservability(connections: ObservabilityConnection[], id: string): DBScope {
  const conn = connections.find((c) => c.id === id);
  if (conn?.beScope) return conn.beScope;
  return availableDBScopes().includes('remote') ? 'remote' : 'local';
}

/** Readable message from an axios error raised by the observability routes. */
export function observabilityError(e: unknown): { message: string; code?: string } {
  const err = e as { response?: { data?: { error?: string; code?: string } }; message?: string };
  return { message: err.response?.data?.error || err.message || 'Request failed', code: err.response?.data?.code };
}

export const useObservabilityConnectionStore = create<ObservabilityConnectionState>((set) => ({
  connections: [],
  loading: false,
  loaded: false,

  fetchConnections: async () => {
    set({ loading: true });
    const scopes = availableDBScopes();
    const results = await Promise.allSettled(
      scopes.map((scope) =>
        observabilityConnectionAPI.list(scope).then((res) => ({ scope, rows: (res.data as ObservabilityConnection[]) ?? [] })),
      ),
    );
    const byId = new Map<string, ObservabilityConnection>();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const row of r.value.rows) {
        const existing = byId.get(row.id);
        if (existing) {
          existing.availableScopes = [...new Set([...(existing.availableScopes ?? []), r.value.scope])];
          if (row.primaryScope && !existing.primaryScope) existing.primaryScope = row.primaryScope;
          if (row.shared) existing.beScope = r.value.scope;
        } else {
          byId.set(row.id, { ...row, beScope: r.value.scope, availableScopes: [r.value.scope] });
        }
      }
    }
    const merged = [...byId.values()].map((c) => {
      if (c.shared) return c;
      const avail = c.availableScopes ?? [];
      if (c.primaryScope === 'local' && avail.includes('local')) return { ...c, beScope: 'local' as const };
      if (c.primaryScope === 'remote' && avail.includes('remote')) return { ...c, beScope: 'remote' as const };
      return { ...c, beScope: avail.includes('remote') ? ('remote' as const) : ('local' as const) };
    });
    set({ connections: merged, loading: false, loaded: true });
  },

  upsertLocal: (conn) =>
    set((s) => {
      const idx = s.connections.findIndex((c) => c.id === conn.id);
      return {
        connections: idx >= 0 ? s.connections.map((c, i) => (i === idx ? { ...c, ...conn } : c)) : [conn, ...s.connections],
      };
    }),

  removeLocal: (id) => set((s) => ({ connections: s.connections.filter((c) => c.id !== id) })),
}));
