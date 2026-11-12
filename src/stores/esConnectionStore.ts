import { create } from 'zustand';
import { esConnectionAPI, esAPI } from '@/services/api';
import { availableDBScopes } from '@/stores/dbConnectionStore';
import type { DBScope } from '@/services/api';
import type { ESConnection, Field } from '@/types';

// esConnectionStore mirrors redisConnectionStore: the reachable ES
// connections (own + delegated), merged by id across every BE scope. It
// reuses the DB store's scope helpers (availableDBScopes / dualWrite) —
// scope resolution is an app-wide concern, not DB-specific. See
// es-impl-spec.
//
// On top of the connection cache it holds a per-connection index mapping
// cache (`mappings[connId][index] = Field[]`) that the Kibana-console Monaco
// completion provider reads for live field autocomplete — the same pattern as
// dbConnectionStore.schemas feeding monacoDBCompletion.

interface ESConnectionState {
  connections: ESConnection[];
  loading: boolean;
  loaded: boolean;
  /** connId → index/alias → flattened field list. */
  mappings: Record<string, Record<string, Field[]>>;
  fetchConnections: () => Promise<void>;
  upsertLocal: (conn: ESConnection) => void;
  removeLocal: (id: string) => void;
  loadMapping: (connId: string, index: string, scope?: DBScope) => Promise<Field[] | null>;
}

export function scopeForEs(connections: ESConnection[], id: string): DBScope {
  const conn = connections.find((c) => c.id === id);
  if (conn?.scope) return conn.scope;
  const scopes = availableDBScopes();
  return scopes.includes('remote') ? 'remote' : 'local';
}

export const useESConnectionStore = create<ESConnectionState>((set, get) => ({
  connections: [],
  loading: false,
  loaded: false,
  mappings: {},

  fetchConnections: async () => {
    set({ loading: true });
    const scopes = availableDBScopes();
    const results = await Promise.allSettled(
      scopes.map((scope) =>
        esConnectionAPI.list(scope).then((res) => ({
          scope,
          rows: (res.data as ESConnection[]) ?? [],
        })),
      ),
    );
    const byId = new Map<string, ESConnection>();
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
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      mappings: Object.fromEntries(Object.entries(s.mappings).filter(([k]) => k !== id)),
    })),

  loadMapping: async (connId, index, scope) => {
    if (!index) return null;
    const cached = get().mappings[connId]?.[index];
    if (cached) return cached;
    const useScope: DBScope = scope ?? scopeForEs(get().connections, connId);
    try {
      const res = await esAPI.mapping(connId, index, useScope);
      const fields = (res.data as Field[]) ?? [];
      set((s) => ({
        mappings: {
          ...s.mappings,
          [connId]: { ...(s.mappings[connId] ?? {}), [index]: fields },
        },
      }));
      return fields;
    } catch {
      return null;
    }
  },
}));
