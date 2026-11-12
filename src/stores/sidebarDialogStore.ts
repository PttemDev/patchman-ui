import { create } from 'zustand';

// Shared add/edit-dialog state for a connection sidebar, so the dialog can be
// opened from BOTH the lifted header actions (the "+" that now lives in the
// panel header next to the title) and each connection row's Edit menu in the
// body. The dialog itself is still rendered once in the body. One store per
// panel — created via this factory to avoid repeating the boilerplate.
//
// `template` is the "Duplicate" flow: the add dialog opens prefilled from an
// existing item (editing stays null — saving creates a new one).
export interface SidebarDialogUI<T> {
  dialogOpen: boolean;
  editing: T | null;
  template: T | null;
  openAdd: () => void;
  openEdit: (item: T) => void;
  openCopy: (item: T) => void;
  setDialogOpen: (open: boolean) => void;
}

export function createSidebarDialogStore<T>() {
  return create<SidebarDialogUI<T>>((set) => ({
    dialogOpen: false,
    editing: null,
    template: null,
    openAdd: () => set({ editing: null, template: null, dialogOpen: true }),
    openEdit: (item) => set({ editing: item, template: null, dialogOpen: true }),
    openCopy: (item) => set({ editing: null, template: item, dialogOpen: true }),
    setDialogOpen: (open) => set((s) => ({
      dialogOpen: open,
      editing: open ? s.editing : null,
      template: open ? s.template : null,
    })),
  }));
}
