import { create } from 'zustand';
import type { Collection, SavedRequest } from '@/types';
import { getRepo } from '@/data';
import { useWorkspaceStore, resolveWorkspaceFilter } from '@/stores/workspaceStore';

interface CollectionState {
  collections: Collection[];
  // Public-scope collections — populated separately via fetchPublicCollections
  // and rendered under the Public sidebar accordion. Includes the user's
  // own public collections (so a public-toggled own collection shows up
  // in both Private + Public sections) plus public collections shared
  // with the user via team/everyone grants.
  publicCollections: Collection[];
  isLoading: boolean;
  isLoadingPublic: boolean;
  error: string | null;
  // When the active-workspace fetch returns 0 collections, we silently
  // re-query without a workspace filter and stash the total here. The empty
  // state in CollectionTree uses it to surface "0 here · N elsewhere" so a
  // user with Pivot selected but data in personal isn't left staring at a
  // misleading "No collections yet" panel.
  elsewhereCount: number;
  fetchCollections: () => Promise<void>;
  fetchPublicCollections: () => Promise<void>;
  /** Refresh both Private and Public lists in parallel. Mutations call
   *  this so an edit made via the Public node's RequestItem (or any
   *  other path) is reflected in both accordion sections without
   *  waiting for a page reload. */
  refreshLists: () => Promise<void>;
  createCollection: (data: Partial<Collection>) => Promise<void>;
  updateCollection: (id: string, data: Partial<Collection>) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  createRequest: (collectionId: string, data: Partial<SavedRequest>) => Promise<void>;
  updateRequest: (id: string, data: Partial<SavedRequest>) => Promise<void>;
  deleteRequest: (id: string) => Promise<void>;
  reorderCollections: (draggedId: string, targetId: string, position: 'above' | 'below') => Promise<void>;
  reorderRequests: (draggedId: string, targetId: string, collectionId: string, position: 'above' | 'below') => Promise<void>;
  // Cross-parent moves. The "into" variants append the row at the end of
  // the target parent's children; the "before/after" variants insert
  // relative to a sibling. Both variants update the moved row's parent
  // pointer (`collectionId` for requests, `parentId` for folders) and
  // re-stamp sortOrder on every affected sibling.
  moveRequest: (
    draggedId: string,
    targetParentId: string,
    opts?: { beforeRequestId?: string; afterRequestId?: string },
  ) => Promise<void>;
  moveCollection: (
    draggedId: string,
    targetParentId: string | null,
    opts?: { beforeCollectionId?: string; afterCollectionId?: string },
  ) => Promise<void>;
}

export const useCollectionStore = create<CollectionState>((set, get) => ({
  collections: [],
  publicCollections: [],
  isLoading: false,
  isLoadingPublic: false,
  error: null,
  elsewhereCount: 0,

  fetchCollections: async () => {
    const isInitialLoad = get().collections.length === 0;
    if (isInitialLoad) {
      set({ isLoading: true, error: null });
    }
    try {
      // Scope to the active workspace — works in both synced and local modes
      // now that LocalRepo filters by workspaceId too.
      const workspaceId = resolveWorkspaceFilter(useWorkspaceStore.getState().activeWorkspaceId);
      const collections = await getRepo().collections.list(workspaceId);

      // If the active workspace turned up empty AND a workspace was actually
      // selected, fire a second unfiltered fetch to learn whether the user
      // has data living elsewhere. The empty state uses this count to offer
      // a "switch workspace" escape hatch instead of just saying "No
      // collections yet" — which previously made it look like the remote
      // store was empty when really it was the workspace filter doing it.
      let elsewhereCount = 0;
      if (collections.length === 0 && workspaceId) {
        try {
          const all = await getRepo().collections.list();
          elsewhereCount = all.length;
        } catch {
          // Best-effort; an error here just means the empty state stays
          // generic, which is no worse than today.
        }
      }

      set({ collections, isLoading: false, elsewhereCount });
    } catch {
      set({ error: 'Failed to fetch collections', isLoading: false });
    }
  },

  fetchPublicCollections: async () => {
    set({ isLoadingPublic: true });
    try {
      const repo = getRepo().collections;
      if (typeof repo.listPublic === 'function') {
        const publicCollections = await repo.listPublic();
        set({ publicCollections, isLoadingPublic: false });
      } else {
        // Web-local IndexedDB has no concept of "public" — the section
        // stays empty rather than throwing.
        set({ publicCollections: [], isLoadingPublic: false });
      }
    } catch {
      set({ publicCollections: [], isLoadingPublic: false });
    }
  },

  refreshLists: async () => {
    await Promise.all([get().fetchCollections(), get().fetchPublicCollections()]);
  },

  createCollection: async (data: Partial<Collection>) => {
    try {
      // Stamp the active workspace onto new root collections so they show up
      // in the current workspace view without a full round-trip. Child
      // collections inherit from their parent on the BE, so we only set this
      // for root-level creates.
      const workspaceId = resolveWorkspaceFilter(useWorkspaceStore.getState().activeWorkspaceId);
      const payload: Partial<Collection> = workspaceId && !data.parentId
        ? { ...data, workspaceId }
        : data;
      await getRepo().collections.create(payload);
      await get().refreshLists();
    } catch {
      set({ error: 'Failed to create collection' });
    }
  },

  updateCollection: async (id: string, data: Partial<Collection>) => {
    try {
      await getRepo().collections.update(id, data);
      await get().refreshLists();
    } catch {
      set({ error: 'Failed to update collection' });
    }
  },

  deleteCollection: async (id: string) => {
    try {
      await getRepo().collections.remove(id);
      await get().refreshLists();
    } catch {
      set({ error: 'Failed to delete collection' });
    }
  },

  createRequest: async (collectionId: string, data: Partial<SavedRequest>) => {
    try {
      await getRepo().requests.create({ ...data, collectionId });
      await get().refreshLists();
    } catch {
      set({ error: 'Failed to create request' });
    }
  },

  updateRequest: async (id: string, data: Partial<SavedRequest>) => {
    try {
      await getRepo().requests.update(id, data);
      await get().refreshLists();
    } catch {
      set({ error: 'Failed to update request' });
    }
  },

  deleteRequest: async (id: string) => {
    try {
      await getRepo().requests.remove(id);
      await get().refreshLists();
    } catch {
      set({ error: 'Failed to delete request' });
    }
  },

  reorderCollections: async (draggedId: string, targetId: string, position: 'above' | 'below') => {
    const findNode = (list: Collection[], id: string): Collection | undefined => {
      for (const c of list) {
        if (c.id === id) return c;
        if (c.children) {
          const found = findNode(c.children, id);
          if (found) return found;
        }
      }
      return undefined;
    };

    const cols = get().collections;
    const dragged = findNode(cols, draggedId);
    const target = findNode(cols, targetId);
    if (!dragged || !target) return;
    // Only reorder within the same parent — cross-parent moves need a
    // different code path (move, not reorder) that isn't supported yet.
    if ((dragged.parentId ?? null) !== (target.parentId ?? null)) return;

    const parentId = dragged.parentId ?? null;
    const getSiblings = (list: Collection[]): Collection[] => {
      if (!parentId) return list;
      for (const c of list) {
        if (c.id === parentId) return c.children || [];
        if (c.children) {
          const found = getSiblings(c.children);
          if (found.length) return found;
        }
      }
      return [];
    };
    const siblings = getSiblings(cols);

    const ordered = siblings.filter(c => c.id !== draggedId);
    const targetIndex = ordered.findIndex(c => c.id === targetId);
    const insertAt = position === 'above' ? targetIndex : targetIndex + 1;
    ordered.splice(insertAt, 0, dragged);
    const reordered = ordered.map((c, i) => ({ ...c, sortOrder: i }));

    // Rebuild the tree immutably with the reordered siblings spliced back
    // into place. Top-level lives at the root; nested lives on parent.children.
    const rebuild = (list: Collection[]): Collection[] =>
      list.map(c => {
        if (c.id === parentId) return { ...c, children: reordered };
        if (c.children) return { ...c, children: rebuild(c.children) };
        return c;
      });
    const nextCollections = !parentId ? reordered : rebuild(cols);

    // Optimistic update: without this, dnd-kit releases the drag transform
    // and the item snaps back to its original slot until the backend round-
    // trip completes and fetchCollections fires — the visible "revert and
    // jump" flicker the user reported.
    set({ collections: nextCollections });

    const originalIdx = new Map(siblings.map((s, i) => [s.id, i] as const));
    try {
      const repo = getRepo();
      await Promise.all(reordered.map((col, i) =>
        originalIdx.get(col.id) !== i ? repo.collections.update(col.id, { sortOrder: i }) : Promise.resolve()
      ));
    } catch {
      set({ error: 'Failed to reorder collections' });
      // Reconcile with server state on failure so the UI reflects truth.
      await get().refreshLists();
    }
  },

  reorderRequests: async (draggedId: string, targetId: string, collectionId: string, position: 'above' | 'below') => {
    const findCollection = (cols: Collection[]): Collection | undefined => {
      for (const col of cols) {
        if (col.id === collectionId) return col;
        if (col.children) {
          const found = findCollection(col.children);
          if (found) return found;
        }
      }
      return undefined;
    };

    const cols = get().collections;
    const parentCol = findCollection(cols);
    if (!parentCol?.requests) return;

    const requests = parentCol.requests;
    const ordered = requests.filter(r => r.id !== draggedId);
    const targetIndex = ordered.findIndex(r => r.id === targetId);
    if (targetIndex === -1) return;
    const insertAt = position === 'above' ? targetIndex : targetIndex + 1;
    const dragged = requests.find(r => r.id === draggedId);
    if (!dragged) return;
    ordered.splice(insertAt, 0, dragged);
    const reordered = ordered.map((r, i) => ({ ...r, sortOrder: i }));

    const rebuild = (list: Collection[]): Collection[] =>
      list.map(c => {
        if (c.id === collectionId) return { ...c, requests: reordered };
        if (c.children) return { ...c, children: rebuild(c.children) };
        return c;
      });

    // Optimistic update — same rationale as reorderCollections.
    set({ collections: rebuild(cols) });

    const originalIdx = new Map(requests.map((r, i) => [r.id, i] as const));
    try {
      const repo = getRepo();
      await Promise.all(reordered.map((req, i) =>
        originalIdx.get(req.id) !== i ? repo.requests.update(req.id, { sortOrder: i }) : Promise.resolve()
      ));
    } catch {
      set({ error: 'Failed to reorder requests' });
      await get().refreshLists();
    }
  },

  moveRequest: async (draggedId, targetParentId, opts) => {
    const repo = getRepo();
    try {
      // Move the request itself first so it shows up under the new parent.
      await repo.requests.update(draggedId, {
        collectionId: targetParentId,
        sortOrder: 0,
      });
      // Then re-stamp sortOrder across the target parent's children. We
      // pull a fresh tree to avoid recomputing from a stale store snapshot
      // (the just-moved row may not be in the cached state yet).
      await get().refreshLists();
      const next = get().collections;
      const findColAnywhere = (list: Collection[]): Collection | undefined => {
        for (const c of list) {
          if (c.id === targetParentId) return c;
          if (c.children) {
            const f = findColAnywhere(c.children);
            if (f) return f;
          }
        }
        return undefined;
      };
      const target = findColAnywhere(next);
      const siblings = (target?.requests ?? []).slice();
      // Remove the dragged item from wherever it currently is in the list,
      // then splice it back in at the requested position.
      const without = siblings.filter((r) => r.id !== draggedId);
      const dragged = siblings.find((r) => r.id === draggedId);
      if (!dragged) return;
      let insertAt = without.length;
      if (opts?.beforeRequestId) {
        const i = without.findIndex((r) => r.id === opts.beforeRequestId);
        if (i >= 0) insertAt = i;
      } else if (opts?.afterRequestId) {
        const i = without.findIndex((r) => r.id === opts.afterRequestId);
        if (i >= 0) insertAt = i + 1;
      }
      const reordered = [...without.slice(0, insertAt), dragged, ...without.slice(insertAt)];
      await Promise.all(
        reordered.map((r, i) =>
          (r.sortOrder ?? -1) !== i
            ? repo.requests.update(r.id, { sortOrder: i })
            : Promise.resolve(),
        ),
      );
      await get().refreshLists();
    } catch {
      set({ error: 'Failed to move request' });
      await get().refreshLists();
    }
  },

  moveCollection: async (draggedId, targetParentId, opts) => {
    const repo = getRepo();
    try {
      // "" sentinel == clear parent (move to root). null also signals root,
      // but the BE API takes string. Translate explicitly.
      const parentForApi = targetParentId === null ? '' : targetParentId;
      await repo.collections.update(draggedId, {
        parentId: parentForApi,
        sortOrder: 0,
      });
      await get().refreshLists();
      const next = get().collections;
      // Pull the new sibling list. `null` parent == top level.
      const siblings: Collection[] = (() => {
        if (targetParentId === null) {
          return next;
        }
        const find = (list: Collection[]): Collection | undefined => {
          for (const c of list) {
            if (c.id === targetParentId) return c;
            if (c.children) {
              const f = find(c.children);
              if (f) return f;
            }
          }
          return undefined;
        };
        return find(next)?.children ?? [];
      })();
      const without = siblings.filter((c) => c.id !== draggedId);
      const dragged = siblings.find((c) => c.id === draggedId);
      if (!dragged) return;
      let insertAt = without.length;
      if (opts?.beforeCollectionId) {
        const i = without.findIndex((c) => c.id === opts.beforeCollectionId);
        if (i >= 0) insertAt = i;
      } else if (opts?.afterCollectionId) {
        const i = without.findIndex((c) => c.id === opts.afterCollectionId);
        if (i >= 0) insertAt = i + 1;
      }
      const reordered = [...without.slice(0, insertAt), dragged, ...without.slice(insertAt)];
      await Promise.all(
        reordered.map((c, i) =>
          (c.sortOrder ?? -1) !== i
            ? repo.collections.update(c.id, { sortOrder: i })
            : Promise.resolve(),
        ),
      );
      await get().refreshLists();
    } catch {
      set({ error: 'Failed to move collection' });
      await get().refreshLists();
    }
  },
}));
