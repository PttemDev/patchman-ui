import { create } from 'zustand';
import type { HistoryItem } from '@/types';
import { getRepo, isLocalMode, usesIndexedDB } from '@/data';
import { localRepo } from '@/data/local/LocalRepo';
import { historyAPI } from '@/services/api';
import { isDesktop, getLocalApiUrl } from '@/lib/platform';
import { useAuthStore } from '@/stores/authStore';

export type HistoryScope = 'local' | 'remote';

interface HistoryScopeState {
  items: HistoryItem[];
  isLoading: boolean;
  error: string | null;
}

interface HistoryState {
  // Split history by source so users see BOTH backends explicitly instead
  // of just whichever one the current session's getRepo() happens to hit.
  local: HistoryScopeState;
  remote: HistoryScopeState;
  // Derived convenience view (dedup of local+remote) kept for the two
  // consumers that want "all my recent requests" regardless of source:
  // UrlBar's URL autocomplete and GlobalSearch. Recomputed on every list
  // mutation so those callers never need to know about the split.
  items: HistoryItem[];
  fetchScope: (scope: HistoryScope) => Promise<void>;
  fetchHistory: () => Promise<void>;
  clearHistory: (scope: HistoryScope) => Promise<void>;
  appendLocal: (item: Omit<HistoryItem, 'id' | 'createdAt'>) => Promise<void>;
}

/**
 * Local history is available when there's a real local source we can reach:
 *   - web-local  → IndexedDB (LocalRepo)
 *   - desktop    → embedded sidecar BE, but ONLY once it has reported its
 *                  port. Without that, an `_executionPin: 'local'` call
 *                  silently falls through to the REMOTE BE (see the api.ts
 *                  interceptor), which would render remote rows under the
 *                  "Local" label and — worse — let a "clear local" delete
 *                  the user's remote history. So gate on getLocalApiUrl().
 *   - web-synced → no local source at all.
 */
export function localHistoryAvailable(): boolean {
  if (usesIndexedDB()) return true;
  if (isDesktop()) return !!getLocalApiUrl();
  return false;
}

/**
 * Remote history needs a server session — a synced mode with a JWT. Local
 * mode has no token, and a logged-out session is `mode: 'synced'` but
 * tokenless, so guard on both to avoid firing an unauthenticated
 * `_executionPin: 'remote'` request.
 */
export function remoteHistoryAvailable(): boolean {
  const { mode, token } = useAuthStore.getState();
  return mode === 'synced' && !!token;
}

function scopeKey(i: HistoryItem): string {
  return `${i.method}|${i.url}|${i.statusCode}`;
}

function combine(localItems: HistoryItem[], remoteItems: HistoryItem[]): HistoryItem[] {
  const seen = new Set<string>();
  const out: HistoryItem[] = [];
  for (const it of [...localItems, ...remoteItems]) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

// historyAPI returns either a bare array or a `{ items }` envelope depending
// on the backend; HttpRepo normalized this, and we bypass it for the pinned
// calls, so replicate the unwrap here.
function unwrapHistory(data: unknown): HistoryItem[] {
  if (Array.isArray(data)) return data as HistoryItem[];
  const obj = data as { items?: HistoryItem[] } | null;
  return obj?.items || [];
}

const emptyScope = (): HistoryScopeState => ({ items: [], isLoading: false, error: null });

export const useHistoryStore = create<HistoryState>((set, get) => ({
  local: emptyScope(),
  remote: emptyScope(),
  items: [],

  fetchScope: async (scope) => {
    const available = scope === 'local' ? localHistoryAvailable() : remoteHistoryAvailable();
    if (!available) {
      // Reset so a stale list from a previous session (e.g. before logout →
      // local mode) doesn't leak into the tab count or the combined view.
      set((s) => {
        const na: HistoryScopeState = {
          items: [],
          isLoading: false,
          error: scope === 'local' && isDesktop() ? 'Embedded backend not reachable.' : null,
        };
        const local = scope === 'local' ? na : s.local;
        const remote = scope === 'remote' ? na : s.remote;
        return { local, remote, items: combine(local.items, remote.items) };
      });
      return;
    }

    set((s) => {
      const loading = { ...s[scope], isLoading: true, error: null };
      return scope === 'local' ? { local: loading } : { remote: loading };
    });

    try {
      let fetched: HistoryItem[];
      if (scope === 'local') {
        fetched = usesIndexedDB()
          ? await localRepo.history.list()
          : unwrapHistory((await historyAPI.list(1, 50, 'local')).data);
      } else {
        fetched = unwrapHistory((await historyAPI.list(1, 50, 'remote')).data);
      }

      set((s) => {
        // Preserve the optimistic 60s-orphan merge, applied within this
        // scope's own list so a just-sent row survives until the backend
        // write propagates back; dedupe on method|url|statusCode so the
        // persisted version absorbs the optimistic one.
        const cur = s[scope].items;
        const fetchedKeys = new Set(fetched.map(scopeKey));
        const cutoff = Date.now() - 60_000;
        const orphans = cur.filter((i) => {
          const t = new Date(i.createdAt).getTime();
          return t > cutoff && !fetchedKeys.has(scopeKey(i));
        });
        const merged: HistoryScopeState = { items: [...orphans, ...fetched], isLoading: false, error: null };
        const local = scope === 'local' ? merged : s.local;
        const remote = scope === 'remote' ? merged : s.remote;
        return { local, remote, items: combine(local.items, remote.items) };
      });
    } catch {
      set((s) => {
        const errored = { ...s[scope], isLoading: false, error: 'Failed to fetch history' };
        return scope === 'local' ? { local: errored } : { remote: errored };
      });
    }
  },

  fetchHistory: async () => {
    await Promise.all([get().fetchScope('local'), get().fetchScope('remote')]);
  },

  clearHistory: async (scope) => {
    try {
      if (scope === 'local') {
        if (usesIndexedDB()) {
          await localRepo.history.clear();
        } else if (isDesktop() && getLocalApiUrl()) {
          // Guard on the sidecar URL: without it the pinned call falls
          // through to remote and would wipe the user's REMOTE history.
          await historyAPI.clear('local');
        } else {
          return;
        }
      } else {
        if (!remoteHistoryAvailable()) return;
        await historyAPI.clear('remote');
      }
      set((s) => {
        const cleared = emptyScope();
        const local = scope === 'local' ? cleared : s.local;
        const remote = scope === 'remote' ? cleared : s.remote;
        return { local, remote, items: combine(local.items, remote.items) };
      });
    } catch {
      set((s) => {
        const errored = { ...s[scope], error: 'Failed to clear history' };
        return scope === 'local' ? { local: errored } : { remote: errored };
      });
    }
  },

  appendLocal: async (item) => {
    // Optimistically prepend to whichever list this send belongs to: local
    // mode → local list, synced → remote list. Repo writes are async and,
    // for synced/desktop, happen out-of-band on the BE, so reflect the row
    // immediately regardless.
    const scope: HistoryScope = isLocalMode() ? 'local' : 'remote';
    const full: HistoryItem = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...item,
    };
    set((s) => {
      const next: HistoryScopeState = { ...s[scope], items: [full, ...s[scope].items] };
      const local = scope === 'local' ? next : s.local;
      const remote = scope === 'remote' ? next : s.remote;
      return { local, remote, items: combine(local.items, remote.items) };
    });
    try {
      await getRepo().history.append(full);
    } catch {
      // History append failures should not break the request flow.
    }
  },
}));
