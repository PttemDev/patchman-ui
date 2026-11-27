import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Which QA space the CR + QA Hub shows (CR_QA_RFC O5): null = your personal
// items, else a team workspace's shared ones. services/api.ts adds it to
// every QA request as ?workspaceId=.
interface QAScopeState {
  workspaceId: string | null;
  setWorkspaceId: (id: string | null) => void;
}

export const useQAScopeStore = create<QAScopeState>()(
  persist(
    (set) => ({
      workspaceId: null,
      setWorkspaceId: (workspaceId) => set({ workspaceId }),
    }),
    { name: 'patchman.qa.scope.v1' },
  ),
);

const QA_PATH = /^\/?(test-cases|test-folders|test-plans|test-runs|defects|requirements|shared-steps|load-tests|qa\/(?:links|radar|inbox|settings|reviews|review-queue|mr-tests|schedules|channels|reports))(\/|$|\?)/;

/** The workspace to send with a QA request, or null. */
export function qaScopeFor(url: string | undefined): string | null {
  if (!url || !QA_PATH.test(url)) return null;
  return useQAScopeStore.getState().workspaceId;
}
