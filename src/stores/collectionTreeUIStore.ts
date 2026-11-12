// Tree-wide expansion state for the Collections sidebar. Lifted out of
// CollectionNode's local useState so other code (drag-and-drop, command
// palette navigation, search-jump) can imperatively expand a target
// without dragging the React tree along with it.

import { create } from 'zustand';

interface CollectionTreeUIState {
  expanded: Record<string, boolean>;
  isExpanded: (id: string) => boolean;
  toggle: (id: string) => void;
  setExpanded: (id: string, value: boolean) => void;
  expandAncestors: (ids: string[]) => void;
}

export const useCollectionTreeUIStore = create<CollectionTreeUIState>((set, get) => ({
  expanded: {},
  isExpanded: (id) => !!get().expanded[id],
  toggle: (id) =>
    set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),
  setExpanded: (id, value) =>
    set((s) => {
      if (!!s.expanded[id] === value) return s;
      return { expanded: { ...s.expanded, [id]: value } };
    }),
  expandAncestors: (ids) =>
    set((s) => {
      const next = { ...s.expanded };
      for (const id of ids) next[id] = true;
      return { expanded: next };
    }),
}));
