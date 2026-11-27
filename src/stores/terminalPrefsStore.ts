import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Terminal preferences (Settings → Terminal). Per device, like the editor prefs.
// cursorColor null = follow the active theme's foreground.
export type CursorStyle = 'block' | 'bar' | 'underline';
export type TerminalColorScheme =
  | 'app' | 'dracula' | 'oneDark' | 'nord' | 'solarizedDark' | 'solarizedLight' | 'githubLight';
export type TerminalOpenIn = 'sidebar' | 'tab';
export const TERMINAL_FONT_MIN = 10;
export const TERMINAL_FONT_MAX = 18;

interface TerminalPrefsState {
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  cursorColor: string | null;
  fontSize: number;
  colorScheme: TerminalColorScheme;
  /** where a session's terminal is shown: under the sidebar list, or in a main-area tab */
  openIn: TerminalOpenIn;
  /** the History / Commands panel on the right of a terminal tab */
  sidePanelOpen: boolean;
  sidePanelWidth: number;
  setCursorStyle: (s: CursorStyle) => void;
  setCursorBlink: (b: boolean) => void;
  setCursorColor: (c: string | null) => void;
  setFontSize: (n: number) => void;
  setColorScheme: (c: TerminalColorScheme) => void;
  setOpenIn: (o: TerminalOpenIn) => void;
  setSidePanelOpen: (o: boolean) => void;
  setSidePanelWidth: (w: number) => void;
}

export const SIDE_PANEL_MIN = 260;
export const SIDE_PANEL_MAX = 640;

export const useTerminalPrefsStore = create<TerminalPrefsState>()(
  persist(
    (set) => ({
      cursorStyle: 'block',
      cursorBlink: true,
      cursorColor: null,
      fontSize: 12,
      colorScheme: 'app',
      openIn: 'sidebar',
      sidePanelOpen: false,
      sidePanelWidth: 340,
      setCursorStyle: (cursorStyle) => set({ cursorStyle }),
      setCursorBlink: (cursorBlink) => set({ cursorBlink }),
      setCursorColor: (cursorColor) => set({ cursorColor }),
      setFontSize: (n) => set({ fontSize: Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, Math.round(n))) }),
      setColorScheme: (colorScheme) => set({ colorScheme }),
      setOpenIn: (openIn) => set({ openIn }),
      setSidePanelOpen: (sidePanelOpen) => set({ sidePanelOpen }),
      setSidePanelWidth: (w) => set({ sidePanelWidth: Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, Math.round(w))) }),
    }),
    { name: 'patchman.terminal.v1' },
  ),
);
