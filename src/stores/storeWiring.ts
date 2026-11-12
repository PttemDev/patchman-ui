import { useWorkspaceStore } from './workspaceStore';
import { useCollectionStore } from './collectionStore';
import { useEnvironmentStore } from './environmentStore';

// Cross-store wiring lives here to keep the individual stores free of
// circular imports. Imported once from main.tsx so the subscription attaches
// as soon as the app boots.

// When the active workspace changes, any workspace-scoped store has to
// refetch — otherwise the user sees the previous workspace's data. A
// component-level useEffect subscription works for the mounted case, but
// this module-level subscription is authoritative: it fires whether or not
// the consumer component is currently rendered.
let lastActive: string | null = useWorkspaceStore.getState().activeWorkspaceId;
useWorkspaceStore.subscribe((state) => {
  const next = state.activeWorkspaceId;
  if (next !== lastActive) {
    lastActive = next;
    useCollectionStore.getState().fetchCollections();
    useEnvironmentStore.getState().fetchEnvironments();
  }
});
