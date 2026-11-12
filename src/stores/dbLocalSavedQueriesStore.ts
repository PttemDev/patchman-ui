import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Local-only saved queries: lives in localStorage, scoped to this
// browser/desktop install. The matching remote variant goes through
// dbSavedQueryAPI. Both are surfaced together in the sidebar but the
// local list survives BE outages + works without a login session.

export interface LocalSavedQuery {
  id: string; // local-<uuid>
  connectionId: string;
  name: string;
  queryText: string;
  folder: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
}

interface LocalSavedQueriesState {
  queries: LocalSavedQuery[];
  add: (q: Omit<LocalSavedQuery, 'id' | 'createdAt' | 'updatedAt'>) => LocalSavedQuery;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<Omit<LocalSavedQuery, 'id'>>) => void;
  listByConnection: (connectionId: string) => LocalSavedQuery[];
}

export const useDBLocalSavedQueriesStore = create<LocalSavedQueriesState>()(
  persist(
    (set, get) => ({
      queries: [],
      add: (q) => {
        const now = new Date().toISOString();
        const row: LocalSavedQuery = {
          id: 'local-' + crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          ...q,
        };
        set((s) => ({ queries: [row, ...s.queries] }));
        return row;
      },
      remove: (id) => set((s) => ({ queries: s.queries.filter((q) => q.id !== id) })),
      update: (id, patch) => set((s) => ({
        queries: s.queries.map((q) =>
          q.id === id ? { ...q, ...patch, updatedAt: new Date().toISOString() } : q,
        ),
      })),
      listByConnection: (connectionId) =>
        get().queries.filter((q) => q.connectionId === connectionId),
    }),
    { name: 'patchman-db-local-saved-queries' },
  ),
);

export function isLocalQueryId(id: string): boolean {
  return id.startsWith('local-');
}
