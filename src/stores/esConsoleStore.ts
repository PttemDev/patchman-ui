import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Elasticsearch console memory, kept on this device (localStorage) — no
// account or backend needed:
//   • drafts: the last console text per connection, so closing the tab and
//     reopening that connection brings the queries back;
//   • saved:  named queries per connection the user chose to keep.
// Mirrors the DB tool's local saved queries (dbLocalSavedQueriesStore).

export interface ESSavedQuery {
  id: string;
  connectionId: string;
  name: string;
  queryText: string;
  createdAt: string;
  updatedAt: string;
}

interface ESConsoleState {
  drafts: Record<string, { text: string; updatedAt: string }>;
  saved: ESSavedQuery[];
  setDraft: (connectionId: string, text: string) => void;
  addSaved: (connectionId: string, name: string, queryText: string) => ESSavedQuery;
  updateSaved: (id: string, patch: Partial<Pick<ESSavedQuery, 'name' | 'queryText'>>) => void;
  removeSaved: (id: string) => void;
}

export const useESConsoleStore = create<ESConsoleState>()(
  persist(
    (set, get) => ({
      drafts: {},
      saved: [],
      setDraft: (connectionId, text) => {
        if (get().drafts[connectionId]?.text === text) return;
        set((s) => ({ drafts: { ...s.drafts, [connectionId]: { text, updatedAt: new Date().toISOString() } } }));
      },
      addSaved: (connectionId, name, queryText) => {
        const now = new Date().toISOString();
        const row: ESSavedQuery = { id: crypto.randomUUID(), connectionId, name, queryText, createdAt: now, updatedAt: now };
        set((s) => ({ saved: [row, ...s.saved] }));
        return row;
      },
      updateSaved: (id, patch) => set((s) => ({
        saved: s.saved.map((q) => (q.id === id ? { ...q, ...patch, updatedAt: new Date().toISOString() } : q)),
      })),
      removeSaved: (id) => set((s) => ({ saved: s.saved.filter((q) => q.id !== id) })),
    }),
    { name: 'patchman-es-console' },
  ),
);
