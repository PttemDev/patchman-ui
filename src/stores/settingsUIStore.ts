import { create } from 'zustand';

export type SettingsSection = 'appearance' | 'language' | 'remote' | 'proxy' | 'integrations' | 'mcp' | 'data' | 'keymap' | 'about' | 'changelog' | 'updates';

interface SettingsUIState {
  open: boolean;
  section: SettingsSection;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setSection: (section: SettingsSection) => void;
}

export const useSettingsUIStore = create<SettingsUIState>((set) => ({
  open: false,
  // Shortcuts opens by default (and sits at the top of the settings nav).
  section: 'keymap',
  openSettings: (section) => set({ open: true, section: section ?? 'keymap' }),
  closeSettings: () => set({ open: false }),
  setSection: (section) => set({ section }),
}));
