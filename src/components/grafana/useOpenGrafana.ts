import { useRequestStore } from '@/stores/requestStore';

/** Open a Grafana dashboard (or Explore) in a main-pane tab, reusing an
 *  already open tab for the same connection + dashboard. */
export function openGrafanaTab(opts: {
  connId: string;
  view: 'dashboard' | 'explore';
  uid?: string;
  /** Public dashboard access token (opens through the public API). */
  publicToken?: string;
  title: string;
  /** Variable selection / range to open with (panel links carry them). */
  vars?: Record<string, string[]>;
  range?: { from: string; to: string };
  datasource?: string;
  query?: string;
}) {
  const rs = useRequestStore.getState();
  const existing = rs.tabs.find((t) =>
    t.type === 'grafana' && t.grafanaConnectionId === opts.connId &&
    (opts.view === 'explore'
      ? t.grafanaView === 'explore' && !opts.query
      : (t.grafanaView ?? 'dashboard') === 'dashboard' && t.grafanaDashboardUid === opts.uid && t.grafanaPublicToken === opts.publicToken),
  );
  if (existing) {
    if (opts.vars || opts.range) {
      rs.updateTab(existing.id, {
        ...(opts.vars ? { grafanaVars: { ...(existing.grafanaVars ?? {}), ...opts.vars } } : {}),
        ...(opts.range ? { grafanaRange: opts.range } : {}),
      });
    }
    rs.setActiveTab(existing.id);
    return;
  }
  rs.addTab({
    type: 'grafana',
    name: opts.title,
    method: 'GET',
    url: '',
    grafanaConnectionId: opts.connId,
    grafanaView: opts.view,
    grafanaDashboardUid: opts.uid,
    grafanaPublicToken: opts.publicToken,
    grafanaVars: opts.vars,
    grafanaRange: opts.range,
    grafanaExplore: opts.view === 'explore' ? { datasource: opts.datasource, query: opts.query } : undefined,
  }, true);
}

/** Absolute Grafana URL for a path ("/d/uid?..."), honouring a sub path. */
export function grafanaLink(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (/^https?:\/\//.test(path)) return path;
  return base + (path.startsWith('/') ? path : `/${path}`);
}
