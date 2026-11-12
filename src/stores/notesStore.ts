import { create } from 'zustand';
import { notesAPI } from '@/services/api';
import { useRequestStore } from '@/stores/requestStore';
import type { NoteMeta } from '@/types';

// Notes sidebar store: list METADATA for the caller's own tree and the trees
// shared with them (bodies load per tab via notesAPI.get). Mirrors
// whiteboardStore; structure changes go through moveNode.
interface NotesState {
  notes: NoteMeta[];
  shared: NoteMeta[];
  loading: boolean;
  loaded: boolean;
  fetchNotes: () => Promise<void>;
  fetchShared: () => Promise<void>;
  refreshAll: () => Promise<void>;
  createNote: (input: { title: string; parentId?: string | null; type?: 'page' | 'folder'; body?: string }) => Promise<NoteMeta>;
  renameNote: (id: string, title: string) => Promise<void>;
  removeNote: (id: string) => Promise<void>;
  // Patch a row locally after the editor saved (title/version/updatedAt).
  patchLocal: (id: string, patch: Partial<NoteMeta>) => void;
  moveNode: (draggedId: string, newParentId: string | null, orderedSiblingIds: string[]) => Promise<void>;
}

function findMeta(id: string): NoteMeta | undefined {
  const s = useNotesStore.getState();
  return s.notes.find((n) => n.id === id) ?? s.shared.find((n) => n.id === id);
}

// Keep an open tab's title in step with the note's.
function syncTabTitle(id: string, title: string) {
  const rs = useRequestStore.getState();
  const tab = rs.tabs.find((t) => t.type === 'note' && t.noteId === id);
  if (tab && tab.name !== title) rs.updateTab(tab.id, { name: title });
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  shared: [],
  loading: false,
  loaded: false,

  fetchNotes: async () => {
    set({ loading: true });
    try {
      const res = await notesAPI.list();
      set({ notes: (res.data as NoteMeta[]) ?? [], loaded: true });
    } catch {
      set({ loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  fetchShared: async () => {
    try {
      const res = await notesAPI.listShared();
      set({ shared: (res.data as NoteMeta[]) ?? [] });
    } catch {
      set({ shared: [] });
    }
  },

  refreshAll: async () => {
    await Promise.all([get().fetchNotes(), get().fetchShared()]);
  },

  createNote: async ({ title, parentId = null, type = 'page', body }) => {
    const res = await notesAPI.create({ title, parentId, type, body });
    const note = res.data as NoteMeta;
    // A page created inside a shared tree belongs to that tree's owner, so it
    // lands in the shared list; refresh that one rather than guessing.
    const parent = parentId ? findMeta(parentId) : undefined;
    if (parent?.shared) {
      await get().fetchShared();
    } else {
      set((s) => ({ notes: [...s.notes, { ...note, parentId: note.parentId ?? null }] }));
    }
    return note;
  },

  renameNote: async (id, title) => {
    const meta = findMeta(id);
    if (!meta) return;
    try {
      const res = await notesAPI.update(id, { title, baseVersion: meta.version });
      const saved = res.data as NoteMeta;
      get().patchLocal(id, { title: saved.title, version: saved.version, updatedAt: saved.updatedAt });
      // An open tab of this note must adopt the new version, or its next
      // autosave would conflict with this very rename. (Same client → no
      // realtime echo.) Only the title changed, so adopting is safe even with
      // unsaved body edits.
      window.dispatchEvent(new CustomEvent('patchman:note-renamed', { detail: { noteId: id, title: saved.title, version: saved.version } }));
    } catch {
      // Stale version or read-only: reload so the tree shows the truth.
      await get().refreshAll();
    }
  },

  removeNote: async (id) => {
    await notesAPI.remove(id);
    // Drop the node and its subtree from both lists.
    const drop = (list: NoteMeta[]) => {
      const gone = new Set([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of list) {
          if (n.parentId && gone.has(n.parentId) && !gone.has(n.id)) {
            gone.add(n.id);
            grew = true;
          }
        }
      }
      return list.filter((n) => !gone.has(n.id));
    };
    set((s) => ({ notes: drop(s.notes), shared: drop(s.shared) }));
  },

  patchLocal: (id, patch) => {
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      shared: s.shared.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }));
    if (patch.title) syncTabTitle(id, patch.title);
  },

  moveNode: async (draggedId, newParentId, orderedSiblingIds) => {
    const before = get().notes;
    const order = new Map(orderedSiblingIds.map((id, i) => [id, i]));
    set({
      notes: before.map((n) => {
        if (n.id === draggedId) return { ...n, parentId: newParentId, sortOrder: order.get(n.id) ?? n.sortOrder };
        if (order.has(n.id)) return { ...n, sortOrder: order.get(n.id)! };
        return n;
      }),
    });
    try {
      const moved = before.find((n) => n.id === draggedId);
      if ((moved?.parentId ?? null) !== newParentId) {
        await notesAPI.update(draggedId, { parentId: newParentId ?? '', sortOrder: order.get(draggedId) });
      }
      await Promise.all(
        orderedSiblingIds
          .filter((id) => {
            const prev = before.find((n) => n.id === id);
            return prev && (id !== draggedId || (prev.parentId ?? null) === newParentId) && prev.sortOrder !== order.get(id);
          })
          .map((id) => notesAPI.update(id, { sortOrder: order.get(id) })),
      );
    } catch {
      await get().fetchNotes();
    }
  },
}));
