import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Workspace } from '@/types';
import { getRepo, isLocalMode } from '@/data';

// Sentinel for the "No Workspace" bucket — collections/envs with no
// workspace_id (legacy rows or ones created intentionally unbound). Kept in
// sync with the BE's collection.WorkspaceNone constant.
export const WORKSPACE_NONE = '__none__';

// Sentinel for the "All Workspaces" view — every collection / env the
// user can see across every workspace + the orphan bucket. Implemented
// FE-side: when this is the active id, callers omit `workspaceId` from
// the API request so the BE returns the unfiltered visibility set.
export const WORKSPACE_ALL = '__all__';

/**
 * Maps the active workspace id into the `workspaceId` query value sent
 * to the BE list/create endpoints. WORKSPACE_ALL → undefined (no
 * filter); WORKSPACE_NONE stays as-is (BE matches NULL/empty rows);
 * UUIDs pass through. Returns undefined for null / empty too so callers
 * don't need a separate null-guard.
 */
export function resolveWorkspaceFilter(id: string | null | undefined): string | undefined {
  if (!id || id === WORKSPACE_ALL) return undefined;
  return id;
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  isLoading: boolean;
  error: string | null;
  fetchWorkspaces: () => Promise<void>;
  setActiveWorkspace: (id: string | null) => void;
  createWorkspace: (data: { name: string; description?: string; type?: 'personal' | 'team' }) => Promise<Workspace | null>;
  updateWorkspace: (id: string, patch: { name?: string; description?: string }) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
}

// The activeWorkspaceId survives reloads so users land in the same workspace
// they left; the workspace list itself is fetched fresh on each session so
// membership changes (invites / removals) propagate immediately.
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      activeWorkspaceId: null,
      isLoading: false,
      error: null,

      fetchWorkspaces: async () => {
        set({ isLoading: true, error: null });
        try {
          let workspaces = await getRepo().workspaces.list();
          // Local mode needs a bootstrap workspace so the selector isn't empty
          // on first boot. Synced mode gets one from BE; local doesn't, so we
          // seed a "Personal" workspace here.
          if (isLocalMode() && workspaces.length === 0) {
            const created = await getRepo().workspaces.create({
              name: 'Personal',
              description: 'Default local workspace',
              type: 'personal',
            });
            workspaces = [created];
          }
          // If the persisted activeWorkspaceId no longer resolves (workspace
          // deleted, user removed, or fresh login) fall back to the first
          // workspace. WORKSPACE_NONE is a virtual bucket, so it counts as
          // valid.
          const current = get().activeWorkspaceId;
          const stillValid =
            current === WORKSPACE_NONE ||
            current === WORKSPACE_ALL ||
            (current && workspaces.some((w) => w.id === current));
          const activeWorkspaceId = stillValid ? current : (workspaces[0]?.id ?? null);
          set({ workspaces, activeWorkspaceId, isLoading: false });
        } catch {
          set({ error: 'Failed to fetch workspaces', isLoading: false });
        }
      },

      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

      createWorkspace: async (data) => {
        try {
          const workspace = await getRepo().workspaces.create(data);
          await get().fetchWorkspaces();
          set({ activeWorkspaceId: workspace.id });
          return workspace;
        } catch {
          set({ error: 'Failed to create workspace' });
          return null;
        }
      },

      updateWorkspace: async (id, patch) => {
        try {
          await getRepo().workspaces.update(id, patch);
          await get().fetchWorkspaces();
        } catch {
          set({ error: 'Failed to update workspace' });
        }
      },

      deleteWorkspace: async (id) => {
        try {
          await getRepo().workspaces.remove(id);
          await get().fetchWorkspaces();
        } catch {
          set({ error: 'Failed to delete workspace' });
        }
      },
    }),
    {
      name: 'patchman-active-workspace',
      partialize: (s) => ({ activeWorkspaceId: s.activeWorkspaceId }),
    },
  ),
);
