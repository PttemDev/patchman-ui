import { createSidebarDialogStore } from '@/stores/sidebarDialogStore';
import type { KafkaConnection } from '@/types';

// Add/edit dialog state of the Kafka connections, shared by the Kafka list
// and the Messaging rail header (its "+" menu opens it too).
export const useKafkaConnectionSidebarUI = createSidebarDialogStore<KafkaConnection>();
