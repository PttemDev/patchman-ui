import { create } from 'zustand';
import { redisConnectionAPI } from '@/services/api';
import { availableDBScopes, dualWrite, type DualWriteResult } from '@/stores/dbConnectionStore';
import type { DBScope } from '@/services/api';
import type { RedisConnection } from '@/types';

// redisConnectionStore mirrors kafkaConnectionStore: the reachable Redis
// connections (own + delegated), merged by id across every BE scope. It
// reuses the DB store's scope helpers (availableDBScopes / dualWrite) —
// scope resolution is an app-wide concern, not DB-specific. See
// redis-impl-spec.

interface RedisConnectionState {
  connections: RedisConnection[];
  loading: boolean;
  loaded: boolean;
  fetchConnections: () => Promise<void>;
  upsertLocal: (conn: RedisConnection) => void;
  removeLocal: (id: string) => void;
  /** Flip the read-write switch on every backend the connection lives on;
   *  optimistic, reverted when every backend refused. */
  setAllowWrite: (id: string, allowWrite: boolean) => Promise<DualWriteResult<RedisConnection>[]>;
}

export function scopeForRedis(connections: RedisConnection[], id: string): DBScope {
  const conn = connections.find((c) => c.id === id);
  if (conn?.scope) return conn.scope;
  const scopes = availableDBScopes();
  return scopes.includes('remote') ? 'remote' : 'local';
}

export const useRedisConnectionStore = create<RedisConnectionState>((set, get) => ({
  connections: [],
  loading: false,
  loaded: false,

  fetchConnections: async () => {
    set({ loading: true });
    const scopes = availableDBScopes();
    const results = await Promise.allSettled(
      scopes.map((scope) =>
        redisConnectionAPI.list(scope).then((res) => ({
          scope,
          rows: (res.data as RedisConnection[]) ?? [],
        })),
      ),
    );
    const byId = new Map<string, RedisConnection>();
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
    set((s) => ({ connections: s.connections.filter((c) => c.id !== id) })),

  setAllowWrite: async (id, allowWrite) => {
    const conn = get().connections.find((c) => c.id === id);
    if (!conn) return [];
    const writeScopes: DBScope[] = conn.availableScopes && conn.availableScopes.length > 0
      ? (conn.availableScopes as DBScope[])
      : [conn.scope ?? 'remote'];
    set((s) => ({ connections: s.connections.map((c) => (c.id === id ? { ...c, allowWrite } : c)) }));
    const results = await dualWrite(
      (scope) => redisConnectionAPI.update(id, { allowWrite }, scope).then((r) => r.data as RedisConnection),
      writeScopes,
    );
    if (!results.some((r) => r.ok)) {
      set((s) => ({ connections: s.connections.map((c) => (c.id === id ? { ...c, allowWrite: !allowWrite } : c)) }));
    }
    return results;
  },
}));
