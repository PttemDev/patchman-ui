import { useRequestStore } from '@/stores/requestStore';
import type { GraylogRange, Tab } from '@/types';

// Shared helpers for the Graylog views: error text and the tab openers.

export function graylogErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export const DEFAULT_RANGE: GraylogRange = { type: 'relative', range: 900 };

function open(match: (t: Tab) => boolean, tab: Partial<Tab>, update?: Partial<Tab>) {
  const rs = useRequestStore.getState();
  const existing = rs.tabs.find(match);
  if (existing) {
    if (update) rs.updateTab(existing.id, update);
    rs.setActiveTab(existing.id);
    return;
  }
  rs.addTab({ type: 'graylog', method: 'GET', url: '', ...tab } as Tab, true);
}

/** The search tab of a connection (one per connection); streams / query narrow it. */
export function openGraylogSearch(connId: string, name: string, opts: { streams?: string[]; query?: string } = {}) {
  const update: Partial<Tab> = {};
  if (opts.streams) update.graylogStreams = opts.streams;
  if (opts.query !== undefined) update.graylogQuery = opts.query;
  open(
    (t) => t.type === 'graylog' && t.graylogConnectionId === connId && (t.graylogView ?? 'search') === 'search',
    { name, graylogConnectionId: connId, graylogView: 'search', graylogQuery: opts.query ?? '', graylogRange: DEFAULT_RANGE, graylogStreams: opts.streams ?? [] },
    Object.keys(update).length ? update : undefined,
  );
}

/** Dashboards & saved searches of a connection. */
export function openGraylogDashboards(connId: string, name: string) {
  open(
    (t) => t.type === 'graylog' && t.graylogConnectionId === connId && t.graylogView === 'dashboards',
    { name, graylogConnectionId: connId, graylogView: 'dashboards' },
  );
}
