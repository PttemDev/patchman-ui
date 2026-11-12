import { create } from 'zustand';

/**
 * Transient (non-persisted) UI state for the Paste History overlay.
 *
 * Kept separate from `pasteHistoryStore` because it holds a live DOM
 * reference (the input the chord was fired from) and a caret range, none of
 * which should ever be serialized to localStorage.
 */
interface PasteHistoryUiState {
  open: boolean;
  /** The text-insertable element focused when the chord fired. */
  target: HTMLElement | null;
  selStart: number | null;
  selEnd: number | null;
  openWith: (target: HTMLElement, selStart: number | null, selEnd: number | null) => void;
  close: () => void;
}

export const usePasteHistoryUiStore = create<PasteHistoryUiState>((set) => ({
  open: false,
  target: null,
  selStart: null,
  selEnd: null,
  openWith: (target, selStart, selEnd) =>
    set({ open: true, target, selStart, selEnd }),
  close: () => set({ open: false, target: null, selStart: null, selEnd: null }),
}));
