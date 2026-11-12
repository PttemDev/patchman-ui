import { create } from 'zustand';
import type { Environment } from '@/types';
import { getRepo } from '@/data';
import { useWorkspaceStore, resolveWorkspaceFilter } from '@/stores/workspaceStore';

interface EnvironmentState {
  environments: Environment[];
  activeEnvironment: Environment | null;
  isLoading: boolean;
  error: string | null;
  fetchEnvironments: () => Promise<void>;
  createEnvironment: (data: Partial<Environment>) => Promise<void>;
  updateEnvironment: (id: string, data: Partial<Environment>) => Promise<void>;
  deleteEnvironment: (id: string) => Promise<void>;
  activateEnvironment: (id: string | null) => Promise<void>;
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  environments: [],
  activeEnvironment: null,
  isLoading: false,
  error: null,

  fetchEnvironments: async () => {
    set({ isLoading: true, error: null });
    try {
      // Scope to the active workspace in both modes — LocalRepo and HttpRepo
      // both return envs pinned to this workspace plus globally-scoped envs
      // (workspaceId empty).
      const workspaceId = resolveWorkspaceFilter(useWorkspaceStore.getState().activeWorkspaceId);
      const environments = await getRepo().environments.list(workspaceId);
      const active = environments.find((e) => e.isActive) || null;
      set({ environments, activeEnvironment: active, isLoading: false });
    } catch {
      set({ error: 'Failed to fetch environments', isLoading: false });
    }
  },

  createEnvironment: async (data: Partial<Environment>) => {
    try {
      await getRepo().environments.create(data);
      await get().fetchEnvironments();
    } catch {
      set({ error: 'Failed to create environment' });
    }
  },

  updateEnvironment: async (id: string, data: Partial<Environment>) => {
    try {
      await getRepo().environments.update(id, data);
      await get().fetchEnvironments();
    } catch {
      set({ error: 'Failed to update environment' });
    }
  },

  deleteEnvironment: async (id: string) => {
    try {
      await getRepo().environments.remove(id);
      await get().fetchEnvironments();
    } catch (err) {
      set({ error: 'Failed to delete environment' });
      // Re-throw so callers can surface a user-facing toast — silent
      // failure was hiding the BE error and made delete look like a
      // no-op until the next list refresh.
      throw err;
    }
  },

  activateEnvironment: async (id: string | null) => {
    if (!id) {
      set({ activeEnvironment: null });
      return;
    }
    try {
      // Pin activation against the workspace the user is currently
      // viewing — not the env's own scope. A global env activated
      // from inside Workspace A becomes the active env for A; the
      // BE's per-user activation table reads the same key on List.
      const workspaceId = resolveWorkspaceFilter(useWorkspaceStore.getState().activeWorkspaceId);
      await getRepo().environments.activate(id, workspaceId);
      await get().fetchEnvironments();
    } catch {
      set({ error: 'Failed to activate environment' });
    }
  },
}));
