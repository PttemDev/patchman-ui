import { createSidebarDialogStore } from '@/stores/sidebarDialogStore';
import type { RabbitConnection } from '@/types';

// Add/edit dialog state of the RabbitMQ connections, shared by the RabbitMQ
// list and the Messaging rail header.
export const useRabbitConnectionSidebarUI = createSidebarDialogStore<RabbitConnection>();
