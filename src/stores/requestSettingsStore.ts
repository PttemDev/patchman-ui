import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Client-local request settings. These are NOT synced to the backend or across
// devices — each app instance keeps its own copy (persisted to localStorage),
// so a value set here stays in effect for this device/session only.
interface RequestSettingsState {
  // Upstream request timeout in seconds, applied to every Send. The BE bounds
  // the upstream request at this value and cancels it when it fires — so a
  // long-running endpoint (e.g. a 10-minute job) can be waited on by raising
  // it, and the default keeps short requests from hanging. Default 30s.
  timeoutSeconds: number;
  setTimeoutSeconds: (n: number) => void;
  reset: () => void;
}

export const DEFAULT_REQUEST_TIMEOUT = 30;

export const useRequestSettingsStore = create<RequestSettingsState>()(
  persist(
    (set) => ({
      timeoutSeconds: DEFAULT_REQUEST_TIMEOUT,
      setTimeoutSeconds: (n) =>
        set({
          timeoutSeconds:
            Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 86400) : DEFAULT_REQUEST_TIMEOUT,
        }),
      reset: () => set({ timeoutSeconds: DEFAULT_REQUEST_TIMEOUT }),
    }),
    { name: 'patchman-request-settings' },
  ),
);
