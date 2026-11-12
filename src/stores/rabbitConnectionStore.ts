import { create } from 'zustand';
import { rabbitConnectionAPI } from '@/services/api';
import { availableDBScopes } from '@/stores/dbConnectionStore';
import type { DBScope } from '@/services/api';
import type { RabbitConnection } from '@/types';

// rabbitConnectionStore mirrors grafanaConnectionStore: reachable RabbitMQ
// connections (own + delegated) merged by id across every BE scope.
// Credentials are stateless (user/password), so connections are
// dual-written to every scope like Kafka / Elasticsearch.

interface RabbitConnectionState {
  connections: RabbitConnection[];
  loading: boolean;
  loaded: boolean;
  fetchConnections: () => Promise<void>;
  upsertLocal: (conn: RabbitConnection) => void;
  removeLocal: (id: string) => void;
}

export function scopeForRabbit(connections: RabbitConnection[], id: string): DBScope {
  const conn = connections.find((c) => c.id === id);
  if (conn?.scope) return conn.scope;
  const scopes = availableDBScopes();
  return scopes.includes('remote') ? 'remote' : 'local';
}

/** Readable message + code from an axios error raised by the RabbitMQ routes. */
export function rabbitError(e: unknown): { message: string; code?: string } {
  const err = e as { response?: { data?: { error?: string; code?: string } }; message?: string };
  return {
    message: err.response?.data?.error || err.message || 'Request failed',
    code: err.response?.data?.code,
  };
}

/** Owner and write grants may change the broker; read grants may not. */
export function canWriteRabbit(conn?: RabbitConnection): boolean {
  return !!conn && conn.grantRole !== 'read';
}

export const useRabbitConnectionStore = create<RabbitConnectionState>((set) => ({
  connections: [],
  loading: false,
  loaded: false,

  fetchConnections: async () => {
    set({ loading: true });
    const scopes = availableDBScopes();
    const results = await Promise.allSettled(
      scopes.map((scope) =>
        rabbitConnectionAPI.list(scope).then((res) => ({ scope, rows: (res.data as RabbitConnection[]) ?? [] })),
      ),
    );
    const byId = new Map<string, RabbitConnection>();
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
      return {
        connections: idx >= 0 ? s.connections.map((c, i) => (i === idx ? { ...c, ...conn } : c)) : [conn, ...s.connections],
      };
    }),

  removeLocal: (id) => set((s) => ({ connections: s.connections.filter((c) => c.id !== id) })),
}));
