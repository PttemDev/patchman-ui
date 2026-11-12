import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Per-fingerprint column preferences: which to hide, ordering, pinned
// columns (frozen left), per-column widths. The fingerprint is the
// sorted list of column names so similar queries against the same
// table share prefs.
export interface ColumnPrefs {
  hidden: string[];
  order: string[];
  pinned: string[];
  widths: Record<string, number>;
}

interface ColumnPrefsState {
  prefs: Record<string, ColumnPrefs>;
  get: (fingerprint: string) => ColumnPrefs;
  setOrder: (fp: string, order: string[]) => void;
  setHidden: (fp: string, hidden: string[]) => void;
  togglePinned: (fp: string, col: string) => void;
  setWidth: (fp: string, col: string, width: number) => void;
  reset: (fp: string) => void;
}

const empty: ColumnPrefs = { hidden: [], order: [], pinned: [], widths: {} };

export const useDBColumnPrefsStore = create<ColumnPrefsState>()(
  persist(
    (set, get) => ({
      prefs: {},
      get: (fp) => get().prefs[fp] ?? empty,
      setOrder: (fp, order) => set((s) => ({
        prefs: { ...s.prefs, [fp]: { ...(s.prefs[fp] ?? empty), order } },
      })),
      setHidden: (fp, hidden) => set((s) => ({
        prefs: { ...s.prefs, [fp]: { ...(s.prefs[fp] ?? empty), hidden } },
      })),
      togglePinned: (fp, col) => set((s) => {
        const cur = s.prefs[fp] ?? empty;
        const exists = cur.pinned.includes(col);
        const pinned = exists ? cur.pinned.filter((c) => c !== col) : [...cur.pinned, col];
        return { prefs: { ...s.prefs, [fp]: { ...cur, pinned } } };
      }),
      setWidth: (fp, col, width) => set((s) => {
        const cur = s.prefs[fp] ?? empty;
        return {
          prefs: { ...s.prefs, [fp]: { ...cur, widths: { ...cur.widths, [col]: width } } },
        };
      }),
      reset: (fp) => set((s) => {
        const next = { ...s.prefs };
        delete next[fp];
        return { prefs: next };
      }),
    }),
    { name: 'patchman-db-column-prefs' },
  ),
);

export function columnFingerprint(columnNames: string[]): string {
  return [...columnNames].sort().join('|');
}
