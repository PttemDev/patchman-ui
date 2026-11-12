import { create } from 'zustand';
import { notesAPI } from '@/services/api';
import type { MemoryFolder, MemorySettings, NoteSuggestion } from '@/types';

// Claude Memory: the caller's memory folders (personal + team / shared ones,
// with their scope), their memory settings and the open suggestions Claude
// filed for them. Refreshed on note events (a suggestion filed or decided is
// a `note.suggestion` event) — see useMemoryLive.
interface MemoryState {
  folders: MemoryFolder[];
  settings: MemorySettings;
  suggestions: NoteSuggestion[];
  loaded: boolean;
  fetch: () => Promise<void>;
  fetchSuggestions: () => Promise<void>;
  refresh: () => Promise<void>;
  saveSettings: (s: Partial<MemorySettings>) => Promise<void>;
  accept: (id: string, overrides?: { title?: string; summary?: string; body?: string }) => Promise<void>;
  reject: (id: string) => Promise<void>;
}

const emptySettings: MemorySettings = { teamFolderId: '', llmProviderId: '', llmModel: '' };

export const useMemoryStore = create<MemoryState>((set, get) => ({
  folders: [],
  settings: emptySettings,
  suggestions: [],
  loaded: false,

  fetch: async () => {
    try {
      const res = await notesAPI.memory();
      const d = res.data as { folders: MemoryFolder[]; settings: MemorySettings };
      set({ folders: d.folders ?? [], settings: { ...emptySettings, ...d.settings }, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  fetchSuggestions: async () => {
    try {
      const res = await notesAPI.suggestions();
      set({ suggestions: (res.data as NoteSuggestion[]) ?? [] });
    } catch {
      /* keep the last list */
    }
  },

  refresh: async () => {
    await Promise.all([get().fetch(), get().fetchSuggestions()]);
  },

  saveSettings: async (s) => {
    const res = await notesAPI.updateMemorySettings(s);
    set({ settings: { ...emptySettings, ...(res.data as MemorySettings) } });
    void get().fetch();
  },

  accept: async (id, overrides) => {
    await notesAPI.acceptSuggestion(id, overrides);
    set({ suggestions: get().suggestions.filter((s) => s.id !== id) });
  },

  reject: async (id) => {
    await notesAPI.rejectSuggestion(id);
    set({ suggestions: get().suggestions.filter((s) => s.id !== id) });
  },
}));

let refreshTimer: number | undefined;

/** Refetch memory folders + suggestions after note events (debounced). */
export function scheduleMemoryRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => { void useMemoryStore.getState().refresh(); }, 500);
}

/** Folder scope as a short label: "" (personal), "Backend", "Ali", "everyone". */
export function scopeKey(s?: MemoryFolder['scope']): 'personal' | 'team' | 'shared' | 'everyone' {
  return s?.kind ?? 'personal';
}
