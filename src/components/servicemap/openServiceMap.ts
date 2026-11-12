import { useRequestStore } from '@/stores/requestStore';
import type { ObservabilityConnection, Tab } from '@/types';

export interface OpenServiceMapArgs {
  title: string;
  k8s?: string;
  context?: string;
  namespaces?: string[];
  apm?: string[];
  execScope?: 'local' | 'remote';
}

const same = (a?: string[], b?: string[]) => (a ?? []).slice().sort().join(',') === (b ?? []).slice().sort().join(',');

// Opens (or focuses) a service map tab for a set of sources. Kept free of
// the map's heavy chunk so sidebars can import it.
export function openServiceMap(a: OpenServiceMapArgs) {
  const rs = useRequestStore.getState();
  const existing = rs.tabs.find((t) => t.type === 'servicemap' && (t.smK8sConnectionId ?? '') === (a.k8s ?? '') &&
    (t.smK8sContext ?? '') === (a.context ?? '') && same(t.smApm, a.apm) && same(t.smNamespaces, a.namespaces));
  if (existing) {
    rs.setActiveTab(existing.id);
    return;
  }
  const tab: Partial<Tab> = {
    type: 'servicemap',
    name: a.title,
    method: 'GET',
    url: '',
    smK8sConnectionId: a.k8s,
    smK8sContext: a.context,
    smNamespaces: a.namespaces ?? [],
    smApm: a.apm ?? [],
    smRange: '15m',
    smRefresh: '30',
    smView: 'map',
    ...(a.execScope ? { smExecScope: a.execScope } : {}),
  };
  rs.addTab(tab, true);
}

/** Opens the live service map for one observability connection. */
export function openConnectionMap(conn: ObservabilityConnection) {
  openServiceMap({ title: conn.name, apm: [conn.scope ? `${conn.id}@${conn.scope}` : conn.id], execScope: conn.beScope });
}
