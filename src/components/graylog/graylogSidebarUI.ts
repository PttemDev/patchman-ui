import { createSidebarDialogStore } from '@/stores/sidebarDialogStore';
import type { GraylogConnection } from '@/types';

// Add/edit dialog state of the Graylog connections, shared by the Graylog
// list and the Dashboards rail header.
export const useGraylogSidebarUI = createSidebarDialogStore<GraylogConnection>();
