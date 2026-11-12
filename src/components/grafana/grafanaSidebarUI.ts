import { createSidebarDialogStore } from '@/stores/sidebarDialogStore';
import type { GrafanaConnection } from '@/types';

// Add / edit dialog state of the Grafana group, shared with the Dashboards
// rail header so its "+" opens the same dialog.
export const useGrafanaSidebarUI = createSidebarDialogStore<GrafanaConnection>();
