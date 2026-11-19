import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Code-editor preferences (Settings → Editor). Per device, like the keymap.
//   off            — save only with ⌘S / the Save button
//   afterDelay     — save 1s after typing stops
//   onFocusChange  — save when the editor loses focus, the file tab changes or
//                    the window is left (JetBrains-like; the default)
export type AutoSaveMode = 'off' | 'afterDelay' | 'onFocusChange';
export const AUTO_SAVE_DELAY_MS = 1000;

interface EditorPrefsState {
  autoSave: AutoSaveMode;
  setAutoSave: (m: AutoSaveMode) => void;
}

export const useEditorPrefsStore = create<EditorPrefsState>()(
  persist(
    (set) => ({
      autoSave: 'onFocusChange',
      setAutoSave: (autoSave) => set({ autoSave }),
    }),
    { name: 'patchman.editor.v1' },
  ),
);
