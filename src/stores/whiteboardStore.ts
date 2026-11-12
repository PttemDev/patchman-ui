import { create } from 'zustand';
import { whiteboardAPI } from '@/services/api';
import { useRequestStore } from '@/stores/requestStore';
import { useAuthStore } from '@/stores/authStore';
import { isDesktop } from '@/lib/platform';
import type { Whiteboard } from '@/types';

// Whiteboard file-list store. Holds list METADATA only (scene omitted — the
// canvas fetches the full scene via whiteboardAPI.get when a board opens and
// autosaves back through saveScene). Mirrors the connection stores: fetch on
// mount, optimistic-ish list mutations after the server confirms. Boards + folders
// form a self-referential tree (parentId/type/sortOrder), like collections; the
// sidebar builds the tree and drag-drop persists moves via moveNode.
interface WhiteboardState {
  boards: Whiteboard[];
  sharedBoards: Whiteboard[]; // shared WITH me (read via /whiteboards/shared)
  // On-device (embedded backend) boards, surfaced while SIGNED IN on desktop so
  // boards made offline or by the local MCP aren't invisible behind the cloud
  // list. Empty in local mode (there the main list already IS the device store)
  // and on web.
  deviceBoards: Whiteboard[];
  loading: boolean;
  loaded: boolean;
  fetchBoards: () => Promise<void>;
  fetchShared: () => Promise<void>;
  fetchDeviceBoards: () => Promise<void>;
  // Copy one on-device board (with its scene) into the signed-in cloud account,
  // then drop it from the device list. Parent that can't be verified on the
  // cloud is re-rooted to top level by the BE.
  moveDeviceBoardToCloud: (id: string) => Promise<void>;
  createBoard: (name: string, parentId?: string | null) => Promise<Whiteboard>;
  createFolder: (name: string, parentId?: string | null) => Promise<Whiteboard>;
  renameBoard: (id: string, name: string) => Promise<void>;
  removeBoard: (id: string) => Promise<void>;
  saveScene: (id: string, scene: string) => Promise<void>;
  // Reflect a visibility flip locally (the share dialog does the server write).
  setVisibilityLocal: (id: string, visibility: 'private' | 'public') => void;
  // Reparent + reorder in one move. `orderedSiblingIds` is the full, final order
  // of the target parent's children (including the dragged id). The store stamps
  // sortOrder = index for each and sets the dragged node's parentId.
  moveNode: (draggedId: string, newParentId: string | null, orderedSiblingIds: string[]) => Promise<void>;
}

// The axios response interceptor already unwraps the backend's single-key
// { data: ... } envelope, so response.data IS the payload here.
function envelope<T>(res: { data: T }): T {
  return res.data;
}

// Next sort index at the end of a parent's sibling list (append newest last).
function nextSortOrder(boards: Whiteboard[], parentId: string | null): number {
  let max = -1;
  for (const b of boards) {
    if ((b.parentId ?? null) === parentId && (b.sortOrder ?? 0) > max) max = b.sortOrder ?? 0;
  }
  return max + 1;
}

export const useWhiteboardStore = create<WhiteboardState>((set, get) => ({
  boards: [],
  sharedBoards: [],
  deviceBoards: [],
  loading: false,
  loaded: false,

  fetchBoards: async () => {
    set({ loading: true });
    try {
      const res = await whiteboardAPI.list();
      set({ boards: envelope<Whiteboard[]>(res) ?? [], loaded: true });
    } catch {
      set({ loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  fetchShared: async () => {
    try {
      const res = await whiteboardAPI.listShared();
      set({ sharedBoards: envelope<Whiteboard[]>(res) ?? [] });
    } catch {
      set({ sharedBoards: [] });
    }
  },

  fetchDeviceBoards: async () => {
    // Only when signed in on desktop: the embedded store is a separate backend
    // from the cloud list. In local mode the main list already IS the device
    // boards, and web has no embedded backend — so show nothing there.
    if (!isDesktop() || useAuthStore.getState().mode === 'local') {
      set({ deviceBoards: [] });
      return;
    }
    try {
      const res = await whiteboardAPI.list('local');
      set({ deviceBoards: envelope<Whiteboard[]>(res) ?? [] });
    } catch {
      set({ deviceBoards: [] });
    }
  },

  moveDeviceBoardToCloud: async (id: string) => {
    // COPY (not delete) the board + its scene into the cloud account. The
    // on-device original stays as an offline backup; the sidebar hides any
    // device board whose id already exists in the cloud list, so it stops
    // showing in "On this device" once the cloud copy lands. Same id on both
    // sides = the BE's OnConflict-DoNothing keeps this idempotent on re-click.
    const res = await whiteboardAPI.get(id, 'local');
    const full = envelope<Whiteboard & { scene?: string }>(res);
    const imp = await whiteboardAPI.importToCloud([{
      id: full.id,
      name: full.name,
      parentId: full.parentId ?? null,
      type: full.type ?? 'whiteboard',
      sortOrder: full.sortOrder ?? 0,
      scene: full.scene ?? '{}',
    }]);
    // Old-BE guard: a hosted backend without whiteboard import silently drops
    // the field (interceptor already unwrapped {data:…}, so imp.data IS the
    // result). Undefined = it didn't land — surface it instead of a false OK.
    const result = (imp.data ?? {}) as { whiteboards?: number };
    if (result.whiteboards === undefined) {
      throw new Error('server does not support whiteboard import yet');
    }
    await get().fetchBoards();
  },

  createBoard: async (name: string, parentId: string | null = null) => {
    const res = await whiteboardAPI.create({ name, parentId, type: 'whiteboard', sortOrder: nextSortOrder(get().boards, parentId) });
    const board = envelope<Whiteboard>(res);
    set((s) => ({ boards: [...s.boards, board] }));
    return board;
  },

  createFolder: async (name: string, parentId: string | null = null) => {
    const res = await whiteboardAPI.create({ name, parentId, type: 'folder', sortOrder: nextSortOrder(get().boards, parentId) });
    const folder = envelope<Whiteboard>(res);
    set((s) => ({ boards: [...s.boards, folder] }));
    return folder;
  },

  renameBoard: async (id: string, name: string) => {
    // A shared viewer has no write access; a 403 here shouldn't crash the tab
    // rename flow — just leave the name unchanged.
    try {
      await whiteboardAPI.update(id, { name });
    } catch {
      return;
    }
    set((s) => ({ boards: s.boards.map((b) => (b.id === id ? { ...b, name } : b)) }));
    // Keep an open tab's title in sync with the board name (and vice-versa —
    // the tab-rename path calls renameBoard, so this is the single sync point).
    const rs = useRequestStore.getState();
    const tab = rs.tabs.find((t) => t.type === 'excalidraw' && t.whiteboardId === id);
    if (tab && tab.name !== name) rs.updateTab(tab.id, { name });
  },

  removeBoard: async (id: string) => {
    await whiteboardAPI.delete(id);
    // Drop the node AND any descendants locally (the BE deletes the subtree).
    set((s) => {
      const removed = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const b of s.boards) {
          if (b.parentId && removed.has(b.parentId) && !removed.has(b.id)) {
            removed.add(b.id);
            grew = true;
          }
        }
      }
      return { boards: s.boards.filter((b) => !removed.has(b.id)) };
    });
  },

  saveScene: async (id: string, scene: string) => {
    await whiteboardAPI.update(id, { scene });
    const now = new Date().toISOString();
    set((s) => ({ boards: s.boards.map((b) => (b.id === id ? { ...b, updatedAt: now } : b)) }));
  },

  setVisibilityLocal: (id: string, visibility: 'private' | 'public') => {
    set((s) => ({ boards: s.boards.map((b) => (b.id === id ? { ...b, visibility } : b)) }));
  },

  moveNode: async (draggedId: string, newParentId: string | null, orderedSiblingIds: string[]) => {
    const prev = get().boards;
    // Optimistic: apply new parent + sibling order locally.
    const orderIndex = new Map(orderedSiblingIds.map((sid, i) => [sid, i]));
    set({
      boards: prev.map((b) => {
        if (b.id === draggedId) return { ...b, parentId: newParentId, sortOrder: orderIndex.get(b.id) ?? b.sortOrder };
        if (orderIndex.has(b.id)) return { ...b, sortOrder: orderIndex.get(b.id)! };
        return b;
      }),
    });
    try {
      // Persist the dragged node's reparent + order, plus any sibling whose order
      // actually changed. One PATCH per changed row (no batch endpoint), like
      // collectionStore.reorderCollections.
      const writes: Promise<unknown>[] = [
        whiteboardAPI.update(draggedId, { parentId: newParentId, sortOrder: orderIndex.get(draggedId) ?? 0 }),
      ];
      for (const sid of orderedSiblingIds) {
        if (sid === draggedId) continue;
        const before = prev.find((b) => b.id === sid);
        const nextOrder = orderIndex.get(sid)!;
        if (before && (before.sortOrder ?? 0) !== nextOrder) {
          writes.push(whiteboardAPI.update(sid, { sortOrder: nextOrder }));
        }
      }
      await Promise.all(writes);
    } catch {
      // Reconcile from the server on any failure.
      await get().fetchBoards();
    }
  },
}));
