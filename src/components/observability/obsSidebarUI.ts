import { createSidebarDialogStore } from '@/stores/sidebarDialogStore';
import type { ObservabilityConnection } from '@/types';

// Add / edit / share dialog state for the Dashboards rail's observability
// group, so the header "+" and the row menus open the same dialogs.
export const useObservabilitySidebarUI = createSidebarDialogStore<ObservabilityConnection>();
