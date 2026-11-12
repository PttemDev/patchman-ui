import { useCollectionStore } from '@/stores/collectionStore';
import { useRequestStore } from '@/stores/requestStore';
import type { Collection, SavedResponseDetail, Tab } from '@/types';

// Helpers shared by "Save response" and the Saved responses window.

export interface FlatCollection {
  id: string;
  name: string;
  /** "API / Orders / Payments". */
  path: string;
  depth: number;
}

/** Every collection and folder the user can see, depth-first. */
export function flattenCollections(): FlatCollection[] {
  const { collections, publicCollections } = useCollectionStore.getState();
  const seen = new Set<string>();
  const out: FlatCollection[] = [];
  const walk = (list: Collection[] | undefined, prefix: string, depth: number) => {
    for (const c of list ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const path = prefix ? `${prefix} / ${c.name}` : c.name;
      out.push({ id: c.id, name: c.name, path, depth });
      walk(c.children, path, depth + 1);
    }
  };
  walk(collections, '', 0);
  walk(publicCollections, '', 0);
  return out;
}

function findIn(list: Collection[] | undefined, pred: (c: Collection) => boolean): Collection | undefined {
  for (const c of list ?? []) {
    if (pred(c)) return c;
    const hit = findIn(c.children, pred);
    if (hit) return hit;
  }
  return undefined;
}

/** The collection / folder that holds a saved request. */
export function collectionOfRequest(requestId?: string): string | undefined {
  if (!requestId) return undefined;
  const { collections, publicCollections } = useCollectionStore.getState();
  const has = (c: Collection) => (c.requests ?? []).some((r) => r.id === requestId);
  return findIn(collections, has)?.id ?? findIn(publicCollections, has)?.id;
}

/** A collection id plus the ids of every folder below it. */
export function collectionWithDescendants(collection: Collection): string[] {
  const out: string[] = [];
  const walk = (c: Collection) => {
    out.push(c.id);
    (c.children ?? []).forEach(walk);
  };
  walk(collection);
  return out;
}

/** Open a saved request in a new tab with every saved parameter. */
export function openSavedRequest(d: SavedResponseDetail, send = false) {
  const r = d.request;
  const rs = useRequestStore.getState();
  const tab: Partial<Tab> = {
    type: 'api',
    name: r.name || d.name,
    method: r.method || d.method,
    url: r.url ?? d.url,
    protocol: r.protocol,
    headers: r.headers ?? [],
    params: r.params ?? [],
    pathParams: r.pathParams,
    body: r.body,
    auth: r.auth,
    preRequestScript: r.preRequestScript ?? '',
    testScript: r.testScript ?? '',
    sendMode: r.sendMode,
    corsBypass: r.corsBypass,
    response: null,
    loading: false,
    originRequestId: d.requestId,
  };
  rs.addTab(tab, true);
  if (send) {
    const id = useRequestStore.getState().activeTabId;
    if (id) void useRequestStore.getState().sendRequest(id);
  }
}

export function statusTone(code: number): string {
  if (code >= 500) return 'bg-red-500/15 text-red-700 dark:text-red-300';
  if (code >= 400) return 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  if (code >= 300) return 'bg-sky-500/15 text-sky-700 dark:text-sky-300';
  if (code >= 200) return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
  return 'bg-muted text-muted-foreground';
}

export const METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-600 dark:text-emerald-400',
  POST: 'text-amber-600 dark:text-amber-400',
  PUT: 'text-sky-600 dark:text-sky-400',
  PATCH: 'text-violet-600 dark:text-violet-400',
  DELETE: 'text-red-600 dark:text-red-400',
  HEAD: 'text-teal-600 dark:text-teal-400',
  OPTIONS: 'text-pink-600 dark:text-pink-400',
};

export function humanBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`;
}
