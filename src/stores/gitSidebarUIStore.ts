import { create } from 'zustand';
import type { GitConnection } from '@/types';

// Shared UI state for the Git sidebar's add/edit dialog, so the connection
// dialog can be opened from BOTH the lifted header actions (the "+" that now
// lives in the panel header, next to the title) and each connection row's Edit
// menu in the body. The dialog itself is still rendered once in the body.
interface GitSidebarUIState {
  dialogOpen: boolean;
  editing: GitConnection | null;
  openAdd: () => void;
  openEdit: (conn: GitConnection) => void;
  setDialogOpen: (open: boolean) => void;
}

export const useGitSidebarUI = create<GitSidebarUIState>((set) => ({
  dialogOpen: false,
  editing: null,
  openAdd: () => set({ editing: null, dialogOpen: true }),
  openEdit: (conn) => set({ editing: conn, dialogOpen: true }),
  setDialogOpen: (open) => set((s) => ({ dialogOpen: open, editing: open ? s.editing : null })),
}));
