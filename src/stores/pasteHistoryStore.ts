import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Device-local "paste history".
 *
 * Persisted to **localStorage** on purpose: this is a per-device convenience
 * cache, not user data. It is NOT the IndexedDB request store and is never
 * synced to a backend.
 */
export interface PasteEntry {
  id: string;
  text: string;
  ts: number;
}

const MAX_ENTRIES = 100;
// Skip pastes larger than this so a single huge paste can't bloat (or blow
// out) the ~5-10MB localStorage quota.
const MAX_TEXT_LENGTH = 100_000;

interface PasteHistoryState {
  entries: PasteEntry[];
  /** Record a paste. No-ops on empty/whitespace, oversized, or duplicate-of-newest text. */
  add: (text: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const usePasteHistoryStore = create<PasteHistoryState>()(
  persist(
    (set) => ({
      entries: [],

      add: (text) =>
        set((state) => {
          // Ignore empty / whitespace-only pastes.
          if (!text || !text.trim()) return state;
          // Ignore pastes too large to safely persist.
          if (text.length > MAX_TEXT_LENGTH) return state;
          // Dedupe: skip if identical to the most-recent entry.
          if (state.entries[0]?.text === text) return state;

          const entry: PasteEntry = {
            id: crypto.randomUUID(),
            text,
            ts: Date.now(),
          };
          // Unshift newest-first, cap at MAX_ENTRIES (drops the oldest).
          return { entries: [entry, ...state.entries].slice(0, MAX_ENTRIES) };
        }),

      remove: (id) =>
        set((state) => ({ entries: state.entries.filter((e) => e.id !== id) })),

      clear: () => set({ entries: [] }),
    }),
    {
      name: 'patchman-paste-history',
      // Persist only the entries; actions are re-provided by the creator.
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);
