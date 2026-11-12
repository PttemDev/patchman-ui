import { create } from 'zustand';
import { dbSavedQueryAPI, type DBScope } from '@/services/api';
import type { SavedDBQuery } from '@/types';

// Remote saved queries cache. Keyed by connection_id so multiple
// connections can be open without trampling each other. Every call
// carries a scope so a connection living on the embedded BE stays
// queried locally (the prod BE never sees those rows).

interface DBRemoteSavedQueriesState {
  byConn: Record<string, SavedDBQuery[]>;
  loading: Record<string, boolean>;
  load: (connectionId: string, scope?: DBScope, opts?: { force?: boolean }) => Promise<void>;
  add: (
    payload: { connectionId: string; name: string; queryText: string; folder?: string; tags?: string },
    scope?: DBScope,
  ) => Promise<SavedDBQuery | null>;
  remove: (connectionId: string, id: string, scope?: DBScope) => Promise<void>;
  refreshExpanded: (entries: Array<{ id: string; scope?: DBScope }>) => Promise<void>;
}

export const useDBRemoteSavedQueriesStore = create<DBRemoteSavedQueriesState>((set, get) => ({
  byConn: {},
  loading: {},

  load: async (connectionId, scope, opts) => {
    const cached = get().byConn[connectionId];
    if (cached && !opts?.force) return;
    set((s) => ({ loading: { ...s.loading, [connectionId]: true } }));
    try {
      const res = await dbSavedQueryAPI.list(connectionId, scope);
      const rows = (res.data as SavedDBQuery[]) ?? [];
      set((s) => ({
        byConn: { ...s.byConn, [connectionId]: rows },
        loading: { ...s.loading, [connectionId]: false },
      }));
    } catch {
      set((s) => ({
        byConn: { ...s.byConn, [connectionId]: [] },
        loading: { ...s.loading, [connectionId]: false },
      }));
    }
  },

  add: async (payload, scope) => {
    try {
      const res = await dbSavedQueryAPI.create(payload, scope);
      const row = res.data as SavedDBQuery;
      set((s) => ({
        byConn: {
          ...s.byConn,
          [payload.connectionId]: [row, ...(s.byConn[payload.connectionId] ?? [])],
        },
      }));
      return row;
    } catch {
      return null;
    }
  },

  remove: async (connectionId, id, scope) => {
    try {
      await dbSavedQueryAPI.delete(id, scope);
    } catch { /* ignore */ }
    set((s) => ({
      byConn: {
        ...s.byConn,
        [connectionId]: (s.byConn[connectionId] ?? []).filter((q) => q.id !== id),
      },
    }));
  },

  refreshExpanded: async (entries) => {
    await Promise.all(entries.map((e) => get().load(e.id, e.scope, { force: true })));
  },
}));
