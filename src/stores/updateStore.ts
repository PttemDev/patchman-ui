import { create } from 'zustand';
import { checkForUpdate, type UpdateInfo } from '@/lib/updater';

interface UpdateState {
  /** True when the desktop updater reports a newer version is available. */
  available: boolean;
  info: UpdateInfo | null;
  lastChecked: number | null;
  checking: boolean;
  check: () => Promise<void>;
}

// Tracks whether a desktop app update is available so the Settings icon + the
// Updates section can badge it. Populated by useUpdateChecker (hourly + on
// focus) so people who never quit the app still notice new versions — the
// updater otherwise only runs when the Updates panel is opened manually.
// No-op on web (checkForUpdate returns null there), so `available` stays false.
export const useUpdateStore = create<UpdateState>((set, get) => ({
  available: false,
  info: null,
  lastChecked: null,
  checking: false,
  check: async () => {
    if (get().checking) return;
    set({ checking: true });
    try {
      const handle = await checkForUpdate(); // null on web / when up to date
      set({ available: !!handle, info: handle?.info ?? null, lastChecked: Date.now() });
    } catch {
      // Transient updater/network errors shouldn't clear a known-available
      // flag or surface anywhere — just record that we tried.
      set({ lastChecked: Date.now() });
    } finally {
      set({ checking: false });
    }
  },
}));
