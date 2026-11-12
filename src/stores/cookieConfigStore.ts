import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// cookieConfigStore holds client-side cookie-handling preferences that
// persist across sessions and apply globally (so every tab — including
// newly opened ones — inherits the user's last choice). Today it's just
// "auto-save response cookies to the jar" so users who don't want to click
// Save on every response can opt in once.
interface CookieConfigState {
  // When true, Set-Cookie cookies parsed from a response are written to the
  // cookie jar automatically after each request (no manual Save step).
  autoSave: boolean;
  setAutoSave: (v: boolean) => void;
}

export const useCookieConfigStore = create<CookieConfigState>()(
  persist(
    (set) => ({
      autoSave: false,
      setAutoSave: (v) => set({ autoSave: v }),
    }),
    { name: 'patchman-cookie-config' },
  ),
);
