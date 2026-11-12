import { create } from 'zustand';

// Open state of the "Saved responses" window: which collection (or folder)
// it lists — the ids include every folder under it — and which entry to
// select first. Opened from a collection's menu or the "Saved" toast.
interface SavedResponsesUIState {
  open: boolean;
  title: string;
  collectionIds: string[];
  focusId?: string;
  /** Set when opened from a request: only that request's saved responses. */
  requestId?: string;
  show: (title: string, collectionIds: string[], focusId?: string, requestId?: string) => void;
  close: () => void;
}

export const useSavedResponsesUI = create<SavedResponsesUIState>((set) => ({
  open: false,
  title: '',
  collectionIds: [],
  show: (title, collectionIds, focusId, requestId) => set({ open: true, title, collectionIds, focusId, requestId }),
  close: () => set({ open: false, focusId: undefined, requestId: undefined }),
}));
