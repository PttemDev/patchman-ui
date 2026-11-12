import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { indexedDBStorage } from '@/lib/indexeddb-storage';
import type { Tab, KeyValue, ResponseData, FormField } from '@/types';
import { proxyAPI, scriptAPI } from '@/services/api';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useProxyConfigStore } from '@/stores/proxyConfigStore';
import { useRequestSettingsStore } from '@/stores/requestSettingsStore';
import { isLocalMode, usesIndexedDB, getRepo } from '@/data';
import { buildCookieHeaderForUrl, parseSetCookie, splitSetCookie, emitCookiesChanged } from '@/lib/cookieJar';
import { useCookieConfigStore } from '@/stores/cookieConfigStore';

// ── Detached-window mode (see DETACH_TAB_RFC §0) ────────────────────
// A "detach tab" window boots the same bundle with `?detached=<tabId>` in
// its URL. In that window this store runs in single-tab STANDALONE mode: it
// owns exactly one tab and persists under its OWN key so it never races the
// main window's `patchman-request-store` (exactly one writer per key). The
// main window runs the normal multi-tab store plus a PERSISTED loan ledger
// of tabs currently on loan to detached windows.
const DETACHED_TAB_ID: string | null =
  typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('detached')
    : null;
export const IS_STANDALONE_TAB = !!DETACHED_TAB_ID;
const STORE_KEY = DETACHED_TAB_ID
  ? `patchman-detached-${DETACHED_TAB_ID}`
  : 'patchman-request-store';

export type DetachStatus = 'DETACHING' | 'DETACHED';

/** One entry in the main window's loan ledger — a tab that has been handed
 *  off to (or is mid-handoff to) a detached window. */
export interface DetachLoan {
  tabId: string;
  label: string;
  /** Full serialized tab captured at detach time — the fallback used to
   *  reclaim the tab if the detached window crashes without flushing a
   *  return (the crash path in RFC §2). */
  snapshot: Tab;
  status: DetachStatus;
  /** Monotonic per-loan counter; dedups duplicate return deliveries. */
  epoch: number;
}

/** Generate a random hex string of the given byte length */
function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compute HMAC-SHA256 and return the result as a base64 string */
async function hmacSha256Base64(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

const DEFAULT_COMMON_HEADERS: Array<{ key: string; value: string; enabled: boolean; description?: string; isDefault?: boolean }> = [
  { key: 'Accept', value: 'application/json', enabled: false, description: 'Common header', isDefault: true },
  { key: 'Content-Type', value: 'application/json', enabled: false, description: 'Common header', isDefault: true },
  { key: 'Cache-Control', value: 'no-cache', enabled: false, description: 'Common header', isDefault: true },
  { key: 'User-Agent', value: 'PatchMan/1.0', enabled: false, description: 'Common header', isDefault: true },
  { key: 'Accept-Encoding', value: 'gzip, deflate, br', enabled: false, description: 'Common header', isDefault: true },
];

/**
 * One-time migration: if a prior version wrote tab drafts to localStorage under
 * 'patchman-request-store', read them once on IDB miss and drop the localStorage
 * copy. After the first successful migration, IDB is the sole source.
 */
const requestStoreStorage: StateStorage = {
  getItem: async (name) => {
    const fromIDB = await indexedDBStorage.getItem(name);
    if (fromIDB != null) return fromIDB;
    try {
      const legacy = localStorage.getItem(name);
      if (legacy) {
        await indexedDBStorage.setItem(name, legacy);
        localStorage.removeItem(name);
        return legacy;
      }
    } catch {
      // ignore
    }
    return null;
  },
  setItem: (name, value) => indexedDBStorage.setItem(name, value),
  removeItem: (name) => indexedDBStorage.removeItem(name),
};

function createEmptyTab(): Tab {
  return {
    id: crypto.randomUUID(),
    // Empty by design: the tab title falls back to a translated
    // t('tab.newRequest') at display time (RequestPanel/StandaloneTab/…),
    // so an unnamed tab follows the UI language instead of freezing the
    // English literal into stored data.
    name: '',
    method: 'GET',
    url: '',
    protocol: 'https://',
    sendMode: 'proxy',
    headers: [...DEFAULT_COMMON_HEADERS.map(h => ({ ...h })), { key: '', value: '', enabled: true }],
    params: [{ key: '', value: '', enabled: true }],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    preRequestScript: '',
    testScript: '',
    response: null,
    loading: false,
    consoleOutput: [],
  };
}

/** Backfill a tab (from persistence, a cross-window handoff, or a crash
 *  snapshot) against the default shape so a consumer doing
 *  `tab.headers.filter(...)` can't crash on a malformed or older payload. */
function sanitizeTab(t: Tab): Tab {
  const defaults = createEmptyTab();
  return {
    ...defaults,
    ...t,
    headers: Array.isArray(t.headers) ? t.headers : defaults.headers,
    params: Array.isArray(t.params) ? t.params : defaults.params,
    pathParams: Array.isArray(t.pathParams) ? t.pathParams : defaults.pathParams,
    body: t.body && typeof t.body === 'object' ? t.body : defaults.body,
    auth: t.auth && typeof t.auth === 'object' ? t.auth : defaults.auth,
  };
}

/** Nearest tab id to `idx` that is NOT in `detachedIds` (searching outward,
 *  right first). Used to move focus off a tab being detached so the strip
 *  never leaves a detached (placeholder) tab "active". '' when none. */
function nearestLiveTabId(tabs: Tab[], idx: number, detachedIds: Set<string>): string {
  for (let d = 1; d < tabs.length; d++) {
    const right = tabs[idx + d];
    if (right && !detachedIds.has(right.id)) return right.id;
    const left = tabs[idx - d];
    if (left && !detachedIds.has(left.id)) return left.id;
  }
  return tabs.find((t) => !detachedIds.has(t.id))?.id ?? '';
}

// AbortControllers for in-flight requests, keyed by tabId. Lives outside the
// Zustand store because they're not serializable and shouldn't be persisted.
const requestControllers = new Map<string, AbortController>();

interface RequestState {
  tabs: Tab[];
  activeTabId: string;
  _hydrated: boolean;
  /** Loan ledger: tabs currently on loan to detached windows. Persisted so a
   *  main-window reload restores the "Detached ↗" placeholders and can run a
   *  rollcall reconcile. Always empty in a standalone (detached) window. */
  detached: DetachLoan[];
  addTab: (tab?: Partial<Tab>, forceNew?: boolean) => void;
  removeTab: (id: string) => void;
  cloneTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  closeAllTabs: () => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  sendRequest: (tabId: string) => Promise<void>;
  cancelRequest: (tabId: string) => void;
  // ── Detach protocol (main-window side) ────────────────────────────
  /** Phase 1: record a DETACHING loan but KEEP the tab (so an open failure
   *  can be reverted). Returns the serialized snapshot to hand off, or null
   *  if the tab is missing / already on loan. */
  beginDetach: (id: string) => Tab | null;
  /** Phase 2 (after the child pulled its handoff): remove the tab from the
   *  live strip and flip the loan to DETACHED. Never respawns an empty tab —
   *  the placeholder covers the slot. */
  commitDetach: (id: string) => void;
  /** Open failed → drop the loan, leaving the tab untouched. */
  cancelDetach: (id: string) => void;
  /** Return path: re-dock a tab (from the child's flush or a crash snapshot),
   *  focus it, and clear its loan. Idempotent per tab id. */
  reclaimTab: (tab: Tab) => void;
  // ── Standalone (detached-window) side ─────────────────────────────
  /** Install the single owned tab received over the detach channel. */
  hydrateStandalone: (tab: Tab) => void;
}

const defaultTab = createEmptyTab();

export const useRequestStore = create<RequestState>()(
  persist(
    (set, get) => ({
      // A standalone window starts EMPTY and renders nothing until it either
      // pulls its handoff over the channel or rehydrates its own persist key.
      tabs: IS_STANDALONE_TAB ? [] : [defaultTab],
      activeTabId: IS_STANDALONE_TAB ? '' : defaultTab.id,
      _hydrated: false,
      detached: [],

      addTab: (tabOverrides?: Partial<Tab>, forceNew?: boolean) => {
        // If opening an existing request, check if it's already in a tab (unless forceNew).
        // Refresh that tab's request-data fields from the incoming payload so an
        // updated collection entry shows its latest state instead of the stale
        // version captured when the tab was first opened. Preserve the tab's
        // transient/runtime fields (id, response, loading, console, send mode).
        if (!forceNew && tabOverrides?.requestId) {
          const existing = get().tabs.find(t => t.requestId === tabOverrides.requestId);
          if (existing) {
            const cleaned = Object.fromEntries(
              Object.entries(tabOverrides).filter(([, v]) => v !== undefined),
            ) as Partial<Tab>;
            set((state) => ({
              tabs: state.tabs.map((t) =>
                t.id === existing.id
                  ? {
                      ...t,
                      ...cleaned,
                      id: t.id,
                      response: t.response,
                      loading: t.loading,
                      consoleOutput: t.consoleOutput,
                      sendMode: t.sendMode,
                      corsBypass: t.corsBypass,
                    }
                  : t,
              ),
              activeTabId: existing.id,
            }));
            return;
          }
        }
        // Strip `undefined` values from the overrides before merging — object
        // spread propagates explicit `undefined`s, which would clobber the
        // defaults from createEmptyTab() and produce a tab with e.g.
        // `headers: undefined`. Anything later doing `tab.headers.filter(...)`
        // would crash with "undefined is not an object".
        const cleanedOverrides = tabOverrides
          ? Object.fromEntries(Object.entries(tabOverrides).filter(([, v]) => v !== undefined))
          : {};
        const base = createEmptyTab();
        const newTab: Tab = { ...base, ...cleanedOverrides };
        // Guard against overrides carrying a *non-array* headers/params/pathParams
        // (e.g. a collection or curl import with headers as an object) — the
        // undefined-strip above misses those, and any consumer doing
        // `tab.headers.filter(...)` would crash on it.
        if (!Array.isArray(newTab.headers)) newTab.headers = base.headers;
        if (!Array.isArray(newTab.params)) newTab.params = base.params;
        if (!Array.isArray(newTab.pathParams)) newTab.pathParams = base.pathParams;
        // When forceNew, strip requestId so multiple tabs can exist for same request
        if (forceNew) {
          delete newTab.requestId;
        }
        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: newTab.id,
        }));
      },

      removeTab: (id: string) => {
        const inFlight = requestControllers.get(id);
        if (inFlight) {
          inFlight.abort();
          requestControllers.delete(id);
        }
        set((state) => {
          const newTabs = state.tabs.filter((t) => t.id !== id);
          if (newTabs.length === 0) {
            // A standalone window has no tab strip — never respawn a fresh
            // tab there; just go empty (the window is about to close).
            if (IS_STANDALONE_TAB) return { tabs: [], activeTabId: '' };
            const newTab = createEmptyTab();
            return { tabs: [newTab], activeTabId: newTab.id };
          }
          const newActiveId =
            state.activeTabId === id
              ? newTabs[Math.min(state.tabs.findIndex((t) => t.id === id), newTabs.length - 1)]?.id ?? newTabs[0].id
              : state.activeTabId;
          return { tabs: newTabs, activeTabId: newActiveId };
        });
      },

      cloneTab: (id: string) => {
        set((state) => {
          const idx = state.tabs.findIndex((t) => t.id === id);
          if (idx === -1) return state;
          const source = state.tabs[idx];
          // Deep clone the request-relevant fields; reset transient state
          // (response, loading, console, requestId) so the clone is an
          // independent draft rather than a second tab pointing at the
          // same saved request.
          // Coerce nested arrays to safe defaults: an in-memory tab can
          // get into a bad shape if a network response or import path
          // assigned a non-array, and this clone would otherwise
          // propagate the corruption to the new tab.
          const safeHeaders = Array.isArray(source.headers) ? source.headers : [];
          const safeParams = Array.isArray(source.params) ? source.params : [];
          const safePathParams = Array.isArray(source.pathParams) ? source.pathParams : undefined;
          const cloned: Tab = {
            ...source,
            id: crypto.randomUUID(),
            requestId: undefined,
            name: source.name ? `${source.name} (copy)` : '',
            response: null,
            loading: false,
            consoleOutput: [],
            headers: safeHeaders.map((h) => ({ ...h })),
            params: safeParams.map((p) => ({ ...p })),
            pathParams: safePathParams ? safePathParams.map((p) => ({ ...p })) : undefined,
            body: source.body && typeof source.body === 'object' ? { ...source.body } : { type: 'none', content: '' },
            auth: source.auth && typeof source.auth === 'object' ? { ...source.auth } : { type: 'none' },
          };
          const newTabs = [...state.tabs];
          newTabs.splice(idx + 1, 0, cloned);
          return { tabs: newTabs, activeTabId: cloned.id };
        });
      },

      closeOtherTabs: (id: string) => {
        set((state) => {
          const keep = state.tabs.find((t) => t.id === id);
          if (!keep) return state;
          // Keep the target tab AND any tabs on loan to detached windows —
          // dropping the latter would orphan their windows + ledger entries.
          const detachedIds = new Set(state.detached.map((l) => l.tabId));
          return {
            tabs: state.tabs.filter((t) => t.id === id || detachedIds.has(t.id)),
            activeTabId: id,
          };
        });
      },

      closeTabsToRight: (id: string) => {
        set((state) => {
          const idx = state.tabs.findIndex((t) => t.id === id);
          if (idx === -1) return state;
          const detachedIds = new Set(state.detached.map((l) => l.tabId));
          // Keep everything up to `id`, plus any detached tabs to the right.
          const newTabs = state.tabs.filter((t, i) => i <= idx || detachedIds.has(t.id));
          const activeStillThere = newTabs.some((t) => t.id === state.activeTabId);
          return {
            tabs: newTabs,
            activeTabId: activeStillThere ? state.activeTabId : id,
          };
        });
      },

      closeAllTabs: () => {
        set((state) => {
          // Preserve detached tabs (their windows stay open); add one fresh
          // live tab so the strip isn't left with only placeholders.
          const detachedIds = new Set(state.detached.map((l) => l.tabId));
          const kept = state.tabs.filter((t) => detachedIds.has(t.id));
          const fresh = createEmptyTab();
          return { tabs: [...kept, fresh], activeTabId: fresh.id };
        });
      },

      reorderTabs: (fromIndex: number, toIndex: number) => {
        set((state) => {
          const { tabs } = state;
          if (
            fromIndex === toIndex ||
            fromIndex < 0 ||
            toIndex < 0 ||
            fromIndex >= tabs.length ||
            toIndex >= tabs.length
          ) {
            return state;
          }
          const next = tabs.slice();
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          return { tabs: next };
        });
      },

      setActiveTab: (id: string) => {
        // A detached tab renders as a non-interactive placeholder — never let
        // it become the active tab (clicking its chip focuses its window
        // instead). Guards Alt+number / programmatic activation too.
        if (get().detached.some((l) => l.tabId === id)) return;
        set({ activeTabId: id });
      },

      updateTab: (id: string, updates: Partial<Tab>) => {
        // Same defensive filter as addTab: an explicit `undefined` in the
        // overrides would clobber the default array via object spread and
        // crash any later `.filter`/`.map`. Drop them.
        const clean = Object.fromEntries(
          Object.entries(updates).filter(([, v]) => v !== undefined),
        ) as Partial<Tab>;
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === id ? { ...t, ...clean } : t
          ),
        }));
      },

      beginDetach: (id: string) => {
        const state = get();
        const tab = state.tabs.find((t) => t.id === id);
        if (!tab) return null;
        // Already on loan (double-trigger) — refuse.
        if (state.detached.some((l) => l.tabId === id)) return null;
        // Snapshot without transient runtime state (mirrors the tabs
        // partialize) so the crash-reclaim payload stays lean + safe.
        const snapshot: Tab = {
          ...tab,
          response: null,
          loading: false,
          sentRequest: undefined,
          consoleOutput: [],
        };
        const loan: DetachLoan = {
          tabId: id,
          label: tab.name || tab.url || 'Detached tab',
          snapshot,
          status: 'DETACHING',
          epoch: 0,
        };
        // Approach (b): the tab STAYS in `tabs` at its slot and renders as a
        // greyed "Detached ↗" placeholder in place (no position jump). Move
        // focus off it immediately so the strip never shows a placeholder as
        // the active tab, and grey it from the first (DETACHING) phase so
        // there's no flicker at the DETACHING→DETACHED handoff.
        const detachedIds = new Set([...state.detached.map((l) => l.tabId), id]);
        let activeTabId = state.activeTabId;
        if (activeTabId === id) {
          activeTabId = nearestLiveTabId(state.tabs, state.tabs.findIndex((t) => t.id === id), detachedIds);
        }
        set({ detached: [...state.detached, loan], activeTabId });
        return snapshot;
      },

      commitDetach: (id: string) => {
        // Stop any in-flight request the loaned tab still owns.
        const inFlight = requestControllers.get(id);
        if (inFlight) {
          inFlight.abort();
          requestControllers.delete(id);
        }
        set((state) => {
          if (!state.detached.some((l) => l.tabId === id)) return state;
          // Keep the tab in `tabs` (it holds the frozen pre-detach snapshot and
          // renders as the in-place placeholder); the detached window owns the
          // live copy under its OWN persist key. Just flip the loan phase —
          // focus was already moved off this tab in beginDetach.
          return {
            detached: state.detached.map((l) =>
              l.tabId === id ? { ...l, status: 'DETACHED' as const } : l,
            ),
          };
        });
      },

      cancelDetach: (id: string) => {
        // Open failed → drop the loan; the tab was never removed, so it just
        // un-greys back into a normal live tab. Restore focus to it so a
        // blocked/failed detach feels like nothing happened.
        set((state) => {
          const stillThere = state.tabs.some((t) => t.id === id);
          return {
            detached: state.detached.filter((l) => l.tabId !== id),
            ...(stillThere ? { activeTabId: id } : {}),
          };
        });
      },

      reclaimTab: (tab: Tab) => {
        // Replace the frozen placeholder copy IN PLACE (same slot → no position
        // jump), then clear the loan + focus it. Falls back to append only if
        // the slot is somehow gone (e.g. a bulk-close removed it).
        set((state) => {
          const clean = sanitizeTab(tab);
          const exists = state.tabs.some((t) => t.id === tab.id);
          return {
            tabs: exists
              ? state.tabs.map((t) => (t.id === tab.id ? clean : t))
              : [...state.tabs, clean],
            activeTabId: tab.id,
            detached: state.detached.filter((l) => l.tabId !== tab.id),
          };
        });
      },

      hydrateStandalone: (tab: Tab) => {
        const clean = sanitizeTab(tab);
        set({ tabs: [clean], activeTabId: clean.id });
      },

      sendRequest: async (tabId: string) => {
        const state = get();
        const tab = state.tabs.find((t) => t.id === tabId);
        if (!tab) return;
        const local = isLocalMode();
        const proxyCfg = useProxyConfigStore.getState();
        const customProxyReady = local && proxyCfg.enabled && !!proxyCfg.endpoint.trim();

        // Abort any prior in-flight request on this tab before starting a new
        // one (defensive — the UI disables Send while loading, but a stale
        // controller from a prior aborted/errored run could otherwise leak).
        const prior = requestControllers.get(tabId);
        if (prior) prior.abort();
        const controller = new AbortController();
        requestControllers.set(tabId, controller);
        const signal = controller.signal;

        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId ? { ...t, loading: true, response: null, consoleOutput: [] } : t
          ),
        }));

        const startTime = performance.now();

        try {
          // Environment variable substitution
          const envState = useEnvironmentStore.getState();
          const activeEnv = envState.activeEnvironment;

          function replaceEnvVars(text: string): string {
            if (!activeEnv) return text;
            return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
              const envVar = activeEnv.variables.find(v => v.key === varName && v.enabled);
              return envVar ? envVar.value : match;
            });
          }

          // Pre-flight env-var check: scan every place a {{var}} can hide
          // and bail before we hand a half-substituted URL to the BE
          // (which would 502 with a useless "invalid host" parse error).
          const referencedVars = new Set<string>();
          const collect = (text: string | undefined) => {
            if (!text) return;
            const matches = text.matchAll(/\{\{(\w+)\}\}/g);
            for (const m of matches) referencedVars.add(m[1]);
          };
          collect(tab.url);
          tab.headers.forEach((h) => { if (h.enabled) { collect(h.key); collect(h.value); } });
          tab.params.forEach((p) => { if (p.enabled) { collect(p.key); collect(p.value); } });
          tab.pathParams?.forEach((p) => { if (p.enabled) { collect(p.value); } });
          collect(tab.body?.content);
          if (tab.auth.type !== 'none') {
            collect(tab.auth.token);
            collect(tab.auth.username);
            collect(tab.auth.password);
            collect(tab.auth.value);
            collect(tab.auth.key);
          }
          const known = new Set(
            activeEnv ? activeEnv.variables.filter((v) => v.enabled).map((v) => v.key) : [],
          );
          const missing = Array.from(referencedVars).filter((v) => !known.has(v));
          if (missing.length > 0) {
            const envLabel = activeEnv ? `the active environment "${activeEnv.name}"` : 'any environment';
            const list = missing.map((v) => `{{${v}}}`).join(', ');
            const msg = activeEnv
              ? `These variables are not defined in ${envLabel}: ${list}. Add them in Environments or pick a different environment.`
              : `These variables are referenced but no environment is active: ${list}. Pick an environment that defines them.`;
            const respData: ResponseData = {
              statusCode: 0,
              statusText: 'Missing environment variables',
              headers: {},
              body: msg,
              size: 0,
              duration: performance.now() - startTime,
              timing: { dns: 0, tcp: 0, tls: 0, ttfb: 0, total: 0 },
            };
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.id === tabId ? { ...t, loading: false, response: respData } : t,
              ),
            }));
            return;
          }

          // Persist script-side pm.environment.set() calls back to the active
          // environment so values survive across requests and sessions.
          async function persistEnvUpdates(updates: Record<string, string>) {
            if (!activeEnv || Object.keys(updates).length === 0) return;
            const existing = activeEnv.variables.slice();
            Object.entries(updates).forEach(([key, value]) => {
              const idx = existing.findIndex((v) => v.key === key);
              if (idx >= 0) {
                existing[idx] = { ...existing[idx], value };
              } else {
                existing.push({ key, value, enabled: true, secret: false });
              }
            });
            await useEnvironmentStore.getState().updateEnvironment(activeEnv.id, { variables: existing });
          }

          const headersObj: Record<string, string> = {};
          tab.headers.forEach((h: KeyValue) => {
            if (h.enabled && h.key) headersObj[replaceEnvVars(h.key)] = replaceEnvVars(h.value);
          });

          // Auth fields get the same {{var}} substitution as headers/params. The
          // pre-flight check above already counts them as referenced, so sending
          // them raw passed the check yet sent a literal `Bearer {{token}}`.
          const auth = {
            ...tab.auth,
            token: tab.auth.token && replaceEnvVars(tab.auth.token),
            username: tab.auth.username && replaceEnvVars(tab.auth.username),
            password: tab.auth.password && replaceEnvVars(tab.auth.password),
            key: tab.auth.key && replaceEnvVars(tab.auth.key),
            value: tab.auth.value && replaceEnvVars(tab.auth.value),
          };

          // Add auth headers
          if (auth.type === 'bearer' && auth.token) {
            headersObj['Authorization'] = `Bearer ${auth.token}`;
          } else if (auth.type === 'basic' && auth.username) {
            headersObj['Authorization'] = `Basic ${btoa(`${auth.username}:${auth.password || ''}`)}`;
          } else if (auth.type === 'apikey' && auth.key && auth.addTo === 'header') {
            headersObj[auth.key] = auth.value || '';
          } else if (auth.type === 'oauth2' && auth.oauth2AccessToken) {
            headersObj['Authorization'] = `Bearer ${auth.oauth2AccessToken}`;
          } else if (auth.type === 'digest' && auth.username) {
            // Digest URI will be finalized after fullUrl is built; set a placeholder
            // We mark digest for deferred header construction below
            headersObj['X-PatchMan-Auth'] = JSON.stringify({
              type: 'digest',
              username: auth.username,
              password: auth.password || '',
              realm: auth.digestRealm || '',
              nonce: auth.digestNonce || '',
              qop: auth.digestQop || 'auth',
              opaque: auth.digestOpaque || '',
            });
          } else if (auth.type === 'aws' && auth.awsAccessKey) {
            headersObj['X-Amz-Access-Key'] = auth.awsAccessKey;
            headersObj['X-Amz-Secret-Key'] = auth.awsSecretKey || '';
            headersObj['X-Amz-Region'] = auth.awsRegion || '';
            headersObj['X-Amz-Service'] = auth.awsService || '';
            if (auth.awsSessionToken) {
              headersObj['X-Amz-Security-Token'] = auth.awsSessionToken;
            }
          } else if (auth.type === 'ntlm' && auth.username) {
            const ntlmCredentials = `${auth.ntlmDomain ? auth.ntlmDomain + '\\' : ''}${auth.username}:${auth.password || ''}`;
            headersObj['Authorization'] = `NTLM ${btoa(ntlmCredentials)}`;
            headersObj['X-PatchMan-Auth'] = JSON.stringify({
              type: 'ntlm',
              username: auth.username,
              password: auth.password || '',
              domain: auth.ntlmDomain || '',
            });
          }

          const paramsObj: Record<string, string> = {};
          tab.params.forEach((p: KeyValue) => {
            if (p.enabled && p.key) paramsObj[replaceEnvVars(p.key)] = replaceEnvVars(p.value);
          });

          // Add API key to query if configured
          if (auth.type === 'apikey' && auth.key && auth.addTo === 'query') {
            paramsObj[auth.key] = auth.value || '';
          }

          let bodyContent = '';
          let formFields: FormField[] | undefined;
          // Whether a `form` body must go out as multipart/form-data. Set in
          // the form branch below; read by both send paths so a text-only
          // multipart form (curl -F) isn't downgraded to url-encoded (→ 415).
          let wantsMultipart = false;
          if (tab.body.type !== 'none' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(tab.method)) {
            bodyContent = replaceEnvVars(tab.body.content);
            if (tab.body.type === 'json' && !headersObj['Content-Type']) {
              headersObj['Content-Type'] = 'application/json';
            } else if (tab.body.type === 'xml' && !headersObj['Content-Type']) {
              headersObj['Content-Type'] = 'application/xml';
            } else if (tab.body.type === 'soap') {
              // SOAP: derive Content-Type + SOAPAction from the version, but
              // never override a header the user set explicitly (any case).
              const version = tab.body.soapVersion || '1.1';
              const action = (tab.body.soapAction || '').trim();
              const has = (name: string) =>
                Object.keys(headersObj).some((k) => k.toLowerCase() === name);
              if (!has('content-type')) {
                headersObj['Content-Type'] =
                  version === '1.2'
                    ? action
                      ? `application/soap+xml; charset=utf-8; action="${action}"`
                      : 'application/soap+xml; charset=utf-8'
                    : 'text/xml; charset=utf-8';
              }
              // SOAP 1.1 carries the action in a separate (quoted) header;
              // 1.2 folds it into the Content-Type action= param above.
              if (version === '1.1' && !has('soapaction')) {
                headersObj['SOAPAction'] = action ? `"${action}"` : '""';
              }
            } else if (tab.body.type === 'form') {
              // Parse structured form fields from JSON content
              try {
                const parsed = JSON.parse(tab.body.content);
                if (Array.isArray(parsed)) {
                  formFields = (parsed as FormField[]).map((f) => ({
                    ...f,
                    value: f.type === 'file' ? f.value : replaceEnvVars(f.value),
                    key: replaceEnvVars(f.key),
                  }));
                  const hasFiles = formFields.some((f) => f.type === 'file' && f.enabled);
                  // A file field always forces multipart; an explicit
                  // formEncoding='multipart' (curl -F) forces it for text-only
                  // forms too. Otherwise the form is url-encoded.
                  wantsMultipart = hasFiles || tab.body.formEncoding === 'multipart';
                  if (!hasFiles) {
                    // URL-encoded serialization. For a url-encoded form this IS
                    // the body + Content-Type. For a multipart text-only form it
                    // stays as a fallback for the raw-body send paths (cors-proxy,
                    // pre-request script context, sent-request display) — the
                    // primary proxy/direct paths below override it with real
                    // multipart, so no urlencoded Content-Type is set here.
                    bodyContent = formFields
                      .filter((f) => f.enabled && f.key)
                      .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`)
                      .join('&');
                    if (!wantsMultipart && !headersObj['Content-Type']) {
                      headersObj['Content-Type'] = 'application/x-www-form-urlencoded';
                    }
                  }
                  // For multipart forms with files, Content-Type (with boundary)
                  // is set by the backend proxy, or by the browser in direct mode.
                }
              } catch {
                // Legacy URL-encoded content, keep as-is
                if (!headersObj['Content-Type']) {
                  headersObj['Content-Type'] = 'application/x-www-form-urlencoded';
                }
              }
            }
          }

          // Build the full URL with protocol (apply env var substitution)
          let processedUrl = replaceEnvVars(tab.url);

          // Replace path parameters ({param}) in URL
          if (tab.pathParams && tab.pathParams.length > 0) {
            tab.pathParams.forEach((pp: KeyValue) => {
              if (pp.key && pp.value && pp.enabled) {
                processedUrl = processedUrl.replace(
                  new RegExp(`\\{${pp.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'),
                  replaceEnvVars(pp.value),
                );
              }
            });
          }

          const fullUrl = processedUrl.match(/^https?:\/\//) ? processedUrl : (tab.protocol || 'https://') + processedUrl;

          // Finalize Digest auth header now that fullUrl is available
          if (auth.type === 'digest' && auth.username) {
            let digestUri = '/';
            try { digestUri = new URL(fullUrl).pathname; } catch { /* keep default */ }
            headersObj['Authorization'] = `Digest username="${auth.username}", realm="${auth.digestRealm || ''}", nonce="${auth.digestNonce || ''}", uri="${digestUri}", qop=${auth.digestQop || 'auth'}, opaque="${auth.digestOpaque || ''}"`;
          }

          // Hawk auth - requires async crypto
          if (tab.auth.type === 'hawk' && tab.auth.hawkId && tab.auth.hawkKey) {
            try {
              const ts = Math.floor(Date.now() / 1000).toString();
              const nonce = randomHex(4);
              let hawkUri = '/';
              let hawkHost = '';
              let hawkPort = '';
              try {
                const parsed = new URL(fullUrl);
                hawkUri = parsed.pathname + parsed.search;
                hawkHost = parsed.hostname;
                hawkPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
              } catch { /* keep defaults */ }
              const normalized = `hawk.1.header\n${ts}\n${nonce}\n${tab.method.toUpperCase()}\n${hawkUri}\n${hawkHost}\n${hawkPort}\n\n\n`;
              const mac = await hmacSha256Base64(tab.auth.hawkKey, normalized);
              headersObj['Authorization'] = `Hawk id="${tab.auth.hawkId}", ts="${ts}", nonce="${nonce}", mac="${mac}"`;
            } catch {
              // If Hawk computation fails, pass credentials for backend to handle
              headersObj['X-PatchMan-Auth'] = JSON.stringify({
                type: 'hawk',
                id: tab.auth.hawkId,
                key: tab.auth.hawkKey,
                algorithm: tab.auth.hawkAlgorithm || 'sha256',
              });
            }
          }

          // Inject cookies from the jar. Skip only the plain direct browser
          // fetch path — "Cookie" is a forbidden request header there and the
          // browser drops it. Anything that routes through our backend (proxy
          // mode, direct+corsBypass, or an old tab without sendMode set) is
          // safe to inject. Also honor a user-set Cookie header.
          const isPlainDirect = tab.sendMode === 'direct' && !tab.corsBypass;
          const canInjectCookies = !isPlainDirect;
          const userSetCookie = Object.keys(headersObj).some((k) => k.toLowerCase() === 'cookie');
          if (canInjectCookies && !userSetCookie) {
            try {
              const cookieHeader = await buildCookieHeaderForUrl(fullUrl);
              if (cookieHeader) headersObj['Cookie'] = cookieHeader;
            } catch {
              // Failing to look up the jar should not block the request
            }
          }

          // Collect environment variables for script context
          const envVariables: Record<string, string> = {};
          if (activeEnv) {
            activeEnv.variables.forEach(v => {
              if (v.enabled) envVariables[v.key] = v.value;
            });
          }

          // Execute pre-request script (requires backend; skip in local mode)
          if (tab.preRequestScript && tab.preRequestScript.trim() && !local) {
            try {
              const preResult = await scriptAPI.execute({
                script: tab.preRequestScript,
                type: 'pre-request',
                context: {
                  method: tab.method,
                  url: fullUrl,
                  headers: { ...headersObj },
                  body: bodyContent,
                  envVars: envVariables,
                },
              });
              const preData = preResult.data as {
                updatedEnvVars?: Record<string, string>;
                updatedHeaders?: Record<string, string>;
                consoleOutput?: string[];
              };
              if (preData.updatedEnvVars) {
                Object.assign(envVariables, preData.updatedEnvVars);
                Object.entries(preData.updatedEnvVars).forEach(([key, val]) => {
                  const varRegex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
                  bodyContent = bodyContent.replace(varRegex, val);
                });
                await persistEnvUpdates(preData.updatedEnvVars);
              }
              if (preData.updatedHeaders) {
                Object.assign(headersObj, preData.updatedHeaders);
              }
              if (preData.consoleOutput && preData.consoleOutput.length > 0) {
                set((s) => ({
                  tabs: s.tabs.map((t) =>
                    t.id === tabId ? { ...t, consoleOutput: [...(t.consoleOutput || []), ...preData.consoleOutput!] } : t
                  ),
                }));
              }
            } catch {
              // Pre-request script errors should not prevent sending the request
            }
          } else if (tab.preRequestScript && tab.preRequestScript.trim() && local) {
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.id === tabId
                  ? {
                      ...t,
                      consoleOutput: [
                        ...(t.consoleOutput || []),
                        '[pre-request] Skipped: scripts require signing in.',
                      ],
                    }
                  : t,
              ),
            }));
          }

          // Save sent request details
          const sentRequest = {
            method: tab.method,
            url: fullUrl,
            headers: { ...headersObj },
            body: bodyContent,
            params: { ...paramsObj },
          };

          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.id === tabId ? { ...t, sentRequest } : t
            ),
          }));

          let respData: ResponseData;

          if (tab.sendMode === 'direct' && tab.corsBypass) {
            // Direct mode with CORS bypass - routes through lightweight backend proxy
            const queryString = new URLSearchParams(paramsObj).toString();
            const targetUrl = queryString ? `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}${queryString}` : fullUrl;

            const response = await proxyAPI.corsProxy({
              method: tab.method,
              url: targetUrl,
              headers: headersObj,
              body: bodyContent,
            }, signal);

            const endTime = performance.now();
            const duration = Math.round(endTime - startTime);
            const data = response.data;

            respData = {
              statusCode: data.statusCode || 0,
              statusText: data.statusText || 'Error',
              headers: data.headers || {},
              body: typeof data.body === 'string' ? data.body : JSON.stringify(data.body, null, 2),
              size: data.size || 0,
              duration: data.duration || duration,
              timing: { dns: 0, tcp: 0, tls: 0, ttfb: duration, total: duration },
              contentEncoding: data.contentEncoding || undefined,
              remoteAddr: data.remoteAddr || undefined,
            };
          } else if (tab.sendMode === 'direct') {
            // Direct browser fetch (may be blocked by CORS)
            const queryString = new URLSearchParams(paramsObj).toString();
            const fetchUrl = queryString ? `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}${queryString}` : fullUrl;

            const fetchOptions: RequestInit = {
              method: tab.method,
              headers: headersObj,
              signal,
            };

            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(tab.method)) {
              if (formFields && wantsMultipart) {
                // Build FormData for multipart forms in direct mode (file OR
                // text-only -F). The browser sets the boundary Content-Type.
                const fd = new FormData();
                for (const f of formFields) {
                  if (!f.enabled || !f.key) continue;
                  if (f.type === 'file' && f.value) {
                    const byteString = atob(f.value);
                    const ab = new Uint8Array(byteString.length);
                    for (let i = 0; i < byteString.length; i++) ab[i] = byteString.charCodeAt(i);
                    const blob = new Blob([ab], { type: f.fileType || 'application/octet-stream' });
                    fd.append(f.key, blob, f.fileName || 'file');
                  } else {
                    fd.append(f.key, f.value);
                  }
                }
                fetchOptions.body = fd;
                // Remove Content-Type so the browser sets multipart boundary automatically
                delete (fetchOptions.headers as Record<string, string>)['Content-Type'];
              } else if (bodyContent) {
                fetchOptions.body = bodyContent;
              }
            }

            const fetchResponse = await fetch(fetchUrl, fetchOptions);
            const endTime = performance.now();
            const duration = Math.round(endTime - startTime);

            const respBody = await fetchResponse.text();
            const respHeaders: Record<string, string> = {};
            fetchResponse.headers.forEach((value, key) => {
              respHeaders[key] = value;
            });

            respData = {
              statusCode: fetchResponse.status,
              statusText: fetchResponse.statusText,
              headers: respHeaders,
              body: respBody,
              size: new Blob([respBody]).size,
              duration,
              timing: { dns: 0, tcp: 0, tls: 0, ttfb: duration, total: duration },
            };
          } else {
            // Proxy mode (default)
            const proxyPayload = {
              method: tab.method,
              url: fullUrl,
              headers: headersObj,
              body: {
                type: tab.body.type,
                content: wantsMultipart ? '' : bodyContent,
                ...(formFields && wantsMultipart
                  ? { formFields: formFields.filter((f) => f.enabled), formEncoding: 'multipart' }
                  : {}),
              },
              params: paramsObj,
              // Per-device request timeout (seconds); the BE bounds + cancels
              // the upstream request at this. Default 30s.
              timeout: useRequestSettingsStore.getState().timeoutSeconds,
            };

            let responseData: {
              statusCode?: number;
              statusText?: string;
              headers?: Record<string, string>;
              body?: unknown;
              bodyBase64?: boolean;
              size?: number;
              duration?: number;
              timing?: ResponseData['timing'];
              contentEncoding?: string;
              remoteAddr?: string;
            };
            let responseStatus = 0;
            let responseStatusText = '';

            if (customProxyReady) {
              // Route through user-configured custom proxy
              const headers: Record<string, string> = { 'Content-Type': 'application/json' };
              if (proxyCfg.authHeaderName.trim()) {
                headers[proxyCfg.authHeaderName.trim()] = proxyCfg.authHeaderValue;
              }
              const customRes = await fetch(proxyCfg.endpoint.trim(), {
                method: 'POST',
                headers,
                body: JSON.stringify(proxyPayload),
                signal,
              });
              responseStatus = customRes.status;
              responseStatusText = customRes.statusText;
              if (!customRes.ok) {
                throw new Error(
                  `Custom proxy returned HTTP ${customRes.status} ${customRes.statusText}`,
                );
              }
              responseData = await customRes.json();
            } else {
              const response = await proxyAPI.send(proxyPayload, signal);
              responseData = response.data;
              responseStatus = response.status;
              responseStatusText = response.statusText;
            }

            const endTime = performance.now();
            const duration = Math.round(endTime - startTime);

            respData = {
              statusCode: responseData.statusCode || responseStatus,
              statusText: responseData.statusText || responseStatusText,
              headers: responseData.headers || {},
              bodyBase64: responseData.bodyBase64,
              body: typeof responseData.body === 'string'
                ? responseData.body
                : JSON.stringify(responseData.body, null, 2),
              size: responseData.size || new Blob([JSON.stringify(responseData)]).size,
              duration: responseData.duration || duration,
              timing: responseData.timing || {
                dns: 0,
                tcp: 0,
                tls: 0,
                ttfb: duration,
                total: duration,
              },
              contentEncoding: responseData.contentEncoding || undefined,
              remoteAddr: responseData.remoteAddr || undefined,
            };
          }

          // Parse Set-Cookie into ResponseCookie[] so the user can inspect
          // them on the response and save individually. Nothing is persisted
          // to the jar automatically — the save is an explicit user action.
          if (respData.headers) {
            const setCookieHeader = respData.headers['set-cookie'] || respData.headers['Set-Cookie'];
            if (setCookieHeader) {
              try {
                const rawList = splitSetCookie(setCookieHeader as string | string[]);
                const url = new URL(fullUrl);
                const parsed = parseSetCookie(rawList, url);
                if (parsed.length > 0) respData.responseCookies = parsed;
              } catch {
                // If parsing fails we simply don't surface the cookies panel
              }
            }
          }

          // Auto-save response cookies to the jar when the user opted in
          // (global, persisted preference — see cookieConfigStore). Off by
          // default; when on, users don't have to click Save per response.
          if (respData.responseCookies?.length && useCookieConfigStore.getState().autoSave) {
            try {
              await Promise.all(
                respData.responseCookies.map((c) =>
                  getRepo().cookies.set({
                    domain: c.domain,
                    name: c.name,
                    value: c.value,
                    path: c.path || '/',
                    secure: c.secure,
                    httpOnly: c.httpOnly,
                    expiresAt: c.expiresAt,
                  }),
                ),
              );
              emitCookiesChanged();
            } catch {
              // Non-fatal: the response still renders + cookies remain
              // manually savable from the Cookies tab.
            }
          }

          // Execute test script (requires a backend; desktop-local has one
          // via the embedded sidecar, so the skip only applies to web-local).
          let testLogs: string[] = [];
          if (tab.testScript && tab.testScript.trim() && usesIndexedDB()) {
            testLogs = ['[test] Skipped: scripts require signing in.'];
          } else if (tab.testScript && tab.testScript.trim()) {
            try {
              const testResult = await scriptAPI.execute({
                script: tab.testScript,
                type: 'test',
                context: {
                  method: sentRequest.method,
                  url: sentRequest.url,
                  headers: sentRequest.headers,
                  body: sentRequest.body,
                  statusCode: respData.statusCode,
                  responseBody: respData.body,
                  responseHeaders: respData.headers,
                  responseTime: respData.duration,
                  envVars: envVariables,
                },
              });
              const testData = testResult.data as {
                updatedEnvVars?: Record<string, string>;
                consoleOutput?: string[];
                testResults?: Array<{ name: string; passed: boolean; error?: string }>;
              };
              if (testData.consoleOutput) {
                testLogs = [...testLogs, ...testData.consoleOutput];
              }
              if (testData.testResults) {
                testData.testResults.forEach((tr) => {
                  testLogs.push(
                    tr.passed
                      ? `[test] ✓ ${tr.name}`
                      : `[test] ✗ ${tr.name}${tr.error ? ' — ' + tr.error : ''}`,
                  );
                });
              }
              if (testData.updatedEnvVars) {
                await persistEnvUpdates(testData.updatedEnvVars);
              }
            } catch {
              // Test script errors should not prevent the response from being displayed
            }
          }

          // Optimistically reflect the executed request in the History
          // panel for every mode — synced/desktop-local repo writes are
          // out-of-band (BE persists), web-local writes to IndexedDB.
          useHistoryStore.getState().appendLocal({
            method: tab.method,
            url: fullUrl,
            statusCode: respData.statusCode,
            duration: respData.duration,
          });

          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.id === tabId
                ? {
                    ...t,
                    loading: false,
                    response: respData,
                    consoleOutput: [...(t.consoleOutput || []), ...testLogs],
                  }
                : t
            ),
          }));
        } catch (error: unknown) {
          const endTime = performance.now();
          const duration = Math.round(endTime - startTime);

          let respData: ResponseData;

          // User-initiated cancellation: fetch throws DOMException(AbortError);
          // axios throws CanceledError (code ERR_CANCELED). Both map to a
          // friendly "Cancelled" response instead of a scary network error.
          const isAbort =
            (error instanceof DOMException && error.name === 'AbortError') ||
            signal.aborted ||
            (error && typeof error === 'object' && (
              (error as { name?: string }).name === 'CanceledError' ||
              (error as { code?: string }).code === 'ERR_CANCELED'
            ));

          if (isAbort) {
            respData = {
              statusCode: 0,
              statusText: 'Cancelled',
              headers: {},
              body: 'Request cancelled by user.',
              size: 0,
              duration,
              timing: { dns: 0, tcp: 0, tls: 0, ttfb: duration, total: duration },
            };
          } else if (error && typeof error === 'object' && 'response' in error) {
            const axiosError = error as { response: { status: number; statusText: string; headers: Record<string, string>; data: unknown } };
            respData = {
              statusCode: axiosError.response.status,
              statusText: axiosError.response.statusText,
              headers: axiosError.response.headers as Record<string, string>,
              body: typeof axiosError.response.data === 'string'
                ? axiosError.response.data
                : JSON.stringify(axiosError.response.data, null, 2),
              size: new Blob([JSON.stringify(axiosError.response.data)]).size,
              duration,
              timing: { dns: 0, tcp: 0, tls: 0, ttfb: duration, total: duration },
            };
          } else {
            const rawMessage = error instanceof Error ? error.message : 'Request failed';
            const isNetworkError = error instanceof TypeError || rawMessage === 'Load failed' || rawMessage === 'Failed to fetch';
            const tabNow = get().tabs.find((t) => t.id === tabId);
            const localNow = isLocalMode();
            let errorMessage = rawMessage;
            if (isNetworkError && tabNow?.sendMode === 'direct') {
              errorMessage = localNow
                ? `${rawMessage}\n\nCould not reach the target. The server may be offline, blocking CORS, or unreachable from the browser. You can also configure a custom proxy in settings to bypass CORS.`
                : `${rawMessage}\n\nThis is likely a CORS error. Try switching to Proxy mode (via backend) to bypass CORS restrictions.`;
            } else if (isNetworkError && tabNow?.sendMode === 'proxy' && localNow) {
              errorMessage = `${rawMessage}\n\nCould not reach your custom proxy. Check the endpoint URL and that it has CORS enabled for this origin.`;
            }
            respData = {
              statusCode: 0,
              statusText: isNetworkError ? 'Network Error' : 'Error',
              headers: {},
              body: errorMessage,
              size: 0,
              duration,
              timing: { dns: 0, tcp: 0, tls: 0, ttfb: duration, total: duration },
            };
          }

          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.id === tabId ? { ...t, loading: false, response: respData } : t
            ),
          }));
        } finally {
          // Only clear if still ours — if a newer sendRequest replaced it,
          // leave that newer controller alone.
          if (requestControllers.get(tabId) === controller) {
            requestControllers.delete(tabId);
          }
        }
      },

      cancelRequest: (tabId: string) => {
        const controller = requestControllers.get(tabId);
        if (!controller) return;
        controller.abort();
        requestControllers.delete(tabId);
      },
    }),
    {
      // In a detached window this is `patchman-detached-<tabId>` so the two
      // windows never write the same key (DETACH_TAB_RFC §0).
      name: STORE_KEY,
      storage: createJSONStorage(() => requestStoreStorage),
      partialize: (state) => ({
        tabs: state.tabs.map(tab => ({
          ...tab,
          // Don't persist transient state
          response: null,
          loading: false,
          sentRequest: undefined,
          consoleOutput: [],
        })),
        activeTabId: state.activeTabId,
        // Loan ledger — always [] in a standalone window, so this is a no-op
        // there and restores placeholders on a main-window reload.
        detached: state.detached,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state._hydrated = true;
          if (!Array.isArray(state.detached)) state.detached = [];
          // Sanitize every persisted tab against the default shape. A tab
          // imported by an older buggy build may have `headers: undefined`
          // (the cURL import path used to set this when no -H flags were
          // present) — leaving that on disk would crash any consumer doing
          // `tab.headers.filter(...)` on every reload, which used to lock
          // the whole UI. Backfill from createEmptyTab() so the data is at
          // least renderable.
          state.tabs = state.tabs.map(sanitizeTab);
          // A standalone window legitimately rehydrates to 0 tabs before its
          // handoff arrives — never respawn a fresh tab there, and never
          // touch activeTabId when there's nothing to point at.
          if (!IS_STANDALONE_TAB) {
            // Ensure at least one tab exists after rehydration
            if (state.tabs.length === 0) {
              const newTab = createEmptyTab();
              state.tabs = [newTab];
              state.activeTabId = newTab.id;
            }
          }
          // Ensure activeTabId points to a real tab (only when tabs exist)
          if (state.tabs.length > 0 && !state.tabs.find(t => t.id === state.activeTabId)) {
            state.activeTabId = state.tabs[0].id;
          }
        }
      },
    }
  )
);
