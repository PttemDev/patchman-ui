import { create } from 'zustand';
import { evaluateCompat, type CompatVerdict, type IncompatReason } from '@/lib/apiCompat';

// Remote backend manager. The app talks to ONE active remote backend for
// sign-in and shared data. Historically that URL was baked in via
// VITE_API_URL (→ REMOTE_BASE_URL); this store makes it user-configurable at
// runtime (add / remove / choose default) — an open-source enabler so people
// can point PatchMan at their own backend without a rebuild.
//
// Design: the BUILT-IN remote is virtual — it is NOT stored, it resolves
// import.meta.env.VITE_API_URL at read time, so a future build that changes
// that URL still reaches existing users. Only user-added remotes are
// persisted. The built-in can never be deleted, which guarantees there is
// always ≥1 remote available for login.
//
// Compatibility: backends may run different versions than the app. A backend is
// validated on add / connect / refresh (GET /api/config → is it a PatchMan
// backend, and is its contract version in our range — see lib/apiCompat) and
// the verdict is cached PER URL in `compatMap`. Keep-last is deliberate: a
// known-compatible backend that goes temporarily unreachable KEEPS its 'ok'
// verdict (the VPN-drop case), so only a fresh SUCCESSFUL check may flip it.
// The startup evaluation + promotion/notice logic lives in lib/backendGuard
// (it needs authStore, which this store must not import — see below).
//
// Kept free of app-store deps (zustand + localStorage + pure lib helpers):
// api.ts and liveSync.ts import getRemoteBaseUrl() from here, so importing
// authStore/etc. would make a cycle.

export interface Remote {
  id: string;
  label: string;
  url: string;
  builtin?: boolean;
}

/** Cached per-URL compatibility verdict. `unknown` = never successfully checked. */
export type RemoteCompat = CompatVerdict | 'unknown';

export interface CompatRecord {
  compat: RemoteCompat;
  apiVersion?: number;
  reason?: IncompatReason;
  checkedAt: number;
}

export const BUILTIN_REMOTE_ID = 'default';
const STORAGE_KEY = 'patchman_remotes';

/** The baked-in backend URL, resolved fresh (never frozen into storage). */
export function builtinRemoteUrl(): string {
  return (import.meta.env.VITE_API_URL as string | undefined) || '/api';
}

/** Trim a trailing slash but leave a bare relative "/api" intact. */
function trimTrailingSlash(u: string): string {
  return u.length > 1 ? u.replace(/\/+$/, '') : u;
}

/** The built-in remote's URL, normalized like user URLs so it compares equal
 * for dedupe and keys `compatMap` consistently. */
export function builtinUrlNormalized(): string {
  return trimTrailingSlash(builtinRemoteUrl());
}

/**
 * Resolve a backend URL to an absolute one for PROBING (version check /
 * refresh). Absolute URLs pass through. A relative built-in "/api" is reachable
 * only when the page is served from a real http(s) origin (a web build or the
 * dev server) — there we resolve it against window.location.origin so it can be
 * version-checked. Under a packaged tauri://localhost origin a relative URL
 * can't reach the backend, so it's left relative (callers treat that as
 * "unreachable / needs the connect gate"). Note axios still uses the raw
 * relative URL for same-origin API calls — this is only for the compat probe.
 */
export function resolveBackendUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const origin = typeof window !== 'undefined' ? window.location?.origin || '' : '';
  if (/^https?:/i.test(origin)) return trimTrailingSlash(origin + (url.startsWith('/') ? url : '/' + url));
  return url;
}

/**
 * Validate + normalize a user-entered remote URL. Absolute http(s) only —
 * a relative "/api" is meaningless under tauri://localhost, so we reject it.
 * Returns the normalized URL or null when invalid.
 */
export function normalizeRemoteUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return trimTrailingSlash(s);
}

interface Persisted {
  remotes: Remote[]; // user-added only; the built-in is virtual
  activeId: string;
  compatMap: Record<string, CompatRecord>;
}

function load(): Persisted {
  const empty: Persisted = { remotes: [], activeId: BUILTIN_REMOTE_ID, compatMap: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      if (Array.isArray(p.remotes) && typeof p.activeId === 'string') {
        const remotes = p.remotes.filter(
          (r): r is Remote =>
            !!r && typeof r.id === 'string' && typeof r.url === 'string' && r.id !== BUILTIN_REMOTE_ID,
        );
        const activeId = p.activeId === BUILTIN_REMOTE_ID || remotes.some((r) => r.id === p.activeId)
          ? p.activeId
          : BUILTIN_REMOTE_ID;
        const compatMap = p.compatMap && typeof p.compatMap === 'object' ? (p.compatMap as Record<string, CompatRecord>) : {};
        return { remotes, activeId, compatMap };
      }
    }
  } catch {
    /* corrupt/absent → defaults */
  }
  return empty;
}

function persist(remotes: Remote[], activeId: string, compatMap: Record<string, CompatRecord>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ remotes, activeId, compatMap }));
  } catch {
    /* private mode / quota — in-memory state still works for this session */
  }
}

// A one-off notice about a backend the app auto-switched away from (it became
// incompatible), or a connect attempt it rejected. Shown as a dismissible
// banner; not persisted.
export type RemoteNotice =
  | { kind: 'switched'; fromLabel: string; toLabel: string }
  | { kind: 'incompatible'; label: string; reason: IncompatReason }
  | null;

interface CompatMeta {
  compat?: RemoteCompat;
  apiVersion?: number;
  reason?: IncompatReason;
}

export type AddResult = 'ok' | 'invalid' | 'duplicate' | 'not_patchman' | 'incompatible' | 'unreachable';

interface RemoteState {
  remotes: Remote[]; // user-added only (the built-in is virtual, added by the UI)
  activeId: string;
  compatMap: Record<string, CompatRecord>;
  /** True (desktop only) when the active backend is incompatible and NO known-
   * compatible remote exists → the connect gate blocks in "incompatible" mode. */
  blockedIncompatible: boolean;
  /** Transient banner about an auto-switch or a rejected connect attempt. */
  notice: RemoteNotice;

  /** Add a validated remote. Async: probes the backend, rejecting a URL that
   * isn't a reachable, compatible PatchMan backend. */
  addRemote: (label: string, url: string) => Promise<AddResult>;
  /** Remove a user remote. Refused for the built-in AND the currently-active
   * remote (switch away first). Keeps ≥1 remote and never yanks the backend
   * out from under the session. */
  removeRemote: (id: string) => void;
  setActive: (id: string) => void;
  /** Add if new, or return the id of the matching existing one (or the
   * built-in). Idempotent by URL — pressing a connect deep link twice does NOT
   * create a duplicate. Returns null on an invalid URL. Optionally records a
   * compatibility verdict for the URL. */
  upsertRemote: (label: string, url: string, meta?: CompatMeta) => string | null;
  /** Store a compatibility verdict for a URL (keep-last: only call with a
   * definitive verdict from a SUCCESSFUL check). */
  recordCompat: (url: string, rec: CompatRecord) => void;
  /** Re-check a backend's version now (Refresh button). Returns the verdict; an
   * unreachable backend leaves the cached verdict untouched (keep-last). */
  refreshRemote: (url: string) => Promise<CheckOutcome>;
  setBlockedIncompatible: (v: boolean) => void;
  setNotice: (n: RemoteNotice) => void;
}

const initial = load();

export const useRemoteStore = create<RemoteState>((set, get) => ({
  remotes: initial.remotes,
  activeId: initial.activeId,
  compatMap: initial.compatMap,
  blockedIncompatible: false,
  notice: null,

  addRemote: async (label, url) => {
    const normalized = normalizeRemoteUrl(url);
    if (!normalized) return 'invalid';
    const { remotes } = get();
    // Dedupe against the built-in AND every user remote (normalized), so a URL
    // already present can't be added a second time.
    if (normalized === builtinUrlNormalized() || remotes.some((r) => r.url === normalized)) return 'duplicate';

    const outcome = await checkRemote(normalized);
    if (outcome.verdict === 'unreachable') return 'unreachable';
    if (outcome.verdict === 'not_patchman') return 'not_patchman';
    if (outcome.verdict === 'incompatible') {
      // Remember the verdict (so a later "first compatible" scan skips it) but
      // don't add an unusable backend.
      get().recordCompat(normalized, { compat: 'incompatible', apiVersion: outcome.cfg.apiVersion, reason: outcome.reason, checkedAt: Date.now() });
      return 'incompatible';
    }
    // ok — cache the discovered tenant config too so login shows the right values.
    cacheServerConfig(normalized, outcome.cfg);
    const id = crypto.randomUUID();
    const next = [...remotes, { id, label: label.trim() || outcome.cfg.name || '', url: normalized }];
    const compatMap = { ...get().compatMap, [normalized]: { compat: 'ok' as RemoteCompat, apiVersion: outcome.cfg.apiVersion, checkedAt: Date.now() } };
    persist(next, get().activeId, compatMap);
    set({ remotes: next, compatMap });
    return 'ok';
  },

  removeRemote: (id) => {
    const { remotes, activeId } = get();
    if (id === BUILTIN_REMOTE_ID || id === activeId) return;
    const next = remotes.filter((r) => r.id !== id);
    persist(next, activeId, get().compatMap);
    set({ remotes: next });
  },

  setActive: (id) => {
    const exists = id === BUILTIN_REMOTE_ID || get().remotes.some((r) => r.id === id);
    const activeId = exists ? id : BUILTIN_REMOTE_ID;
    persist(get().remotes, activeId, get().compatMap);
    // Switching backends clears any block tied to the old active remote.
    set({ activeId, blockedIncompatible: false });
  },

  upsertRemote: (label, url, meta) => {
    const normalized = normalizeRemoteUrl(url);
    if (!normalized) return null;
    if (meta?.compat) get().recordCompat(normalized, { compat: meta.compat, apiVersion: meta.apiVersion, reason: meta.reason, checkedAt: Date.now() });
    if (normalized === builtinUrlNormalized()) return BUILTIN_REMOTE_ID;
    const { remotes } = get();
    const existing = remotes.find((r) => r.url === normalized);
    if (existing) return existing.id; // idempotent — no duplicate
    const id = crypto.randomUUID();
    const next = [...remotes, { id, label: label.trim(), url: normalized }];
    persist(next, get().activeId, get().compatMap);
    set({ remotes: next });
    return id;
  },

  recordCompat: (url, rec) => {
    const compatMap = { ...get().compatMap, [url]: rec };
    persist(get().remotes, get().activeId, compatMap);
    set({ compatMap });
  },

  refreshRemote: async (url) => {
    const outcome = await checkRemote(url);
    if (outcome.verdict === 'unreachable') return outcome; // keep-last: don't touch the record
    if (outcome.verdict === 'not_patchman') return outcome; // a known remote briefly answering wrong — don't downgrade
    get().recordCompat(url, {
      compat: outcome.verdict,
      apiVersion: outcome.cfg.apiVersion,
      reason: outcome.verdict === 'incompatible' ? outcome.reason : undefined,
      checkedAt: Date.now(),
    });
    if (outcome.verdict === 'ok') cacheServerConfig(url, outcome.cfg);
    return outcome;
  },

  setBlockedIncompatible: (v) => set({ blockedIncompatible: v }),
  setNotice: (n) => set({ notice: n }),
}));

/** Read a URL's cached compatibility verdict (non-reactive). */
export function compatOf(url: string): CompatRecord | undefined {
  return useRemoteStore.getState().compatMap[url];
}

export interface RemoteConfig {
  service?: string;
  apiVersion?: number;
  minAppVersion?: string;
  name?: string;
  version?: string;
  gitlabHostname?: string;
  emailDomainPlaceholder?: string;
  /** FE web host the backend advertises, for building shareable public links
   *  that must open in a browser (not the desktop shell). */
  webOrigin?: string;
}

/**
 * Fetch a backend's public discovery doc (GET <baseUrl>/config). Best-effort:
 * returns null on any failure/timeout. Uses a raw fetch (NOT the axios
 * instance, whose baseURL is the CURRENT backend, not the one being probed).
 * Tolerates both a bare `{…}` body and the app's `{data:{…}}` envelope.
 */
export async function fetchRemoteConfig(baseUrl: string, timeoutMs = 6000): Promise<RemoteConfig | null> {
  const url = `${baseUrl.replace(/\/+$/, '')}/config`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || typeof body !== 'object') return null;
    const c = 'data' in body && body.data && typeof body.data === 'object' ? body.data : body;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
    return {
      service: str(c.service),
      apiVersion: num(c.apiVersion),
      minAppVersion: str(c.minAppVersion),
      name: str(c.name),
      version: str(c.version),
      gitlabHostname: str(c.gitlabHostname),
      emailDomainPlaceholder: str(c.emailDomainPlaceholder),
      webOrigin: str(c.webOrigin),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type CheckOutcome =
  | { verdict: 'ok'; cfg: RemoteConfig }
  | { verdict: 'incompatible'; cfg: RemoteConfig; reason: IncompatReason }
  | { verdict: 'not_patchman'; cfg: RemoteConfig }
  | { verdict: 'unreachable' };

/**
 * Probe a backend and decide whether it is a reachable, compatible PatchMan
 * backend. The single gate used by add / connect / deep-link / refresh /
 * startup. `not_patchman` is what refuses a URL like https://google.com/api
 * that answers but isn't ours (no `service:"patchman"` marker).
 */
export async function checkRemote(url: string, timeoutMs = 6000): Promise<CheckOutcome> {
  const cfg = await fetchRemoteConfig(url, timeoutMs);
  if (!cfg) return { verdict: 'unreachable' };
  const { verdict, reason } = evaluateCompat(cfg);
  if (verdict === 'ok') return { verdict: 'ok', cfg };
  if (verdict === 'not_patchman') return { verdict: 'not_patchman', cfg };
  return { verdict: 'incompatible', cfg, reason };
}

// --- Cached server (tenant) config -------------------------------------
// Tenant values (GitLab hostname, email-domain placeholder, app name) are
// discovered from the ACTIVE backend and cached so the client keeps working
// with the last value when the backend is unreachable (e.g. the API is behind
// a VPN that later drops) — see tenant.ts.

const SERVER_CONFIG_KEY = 'patchman_server_config';

interface CachedServerConfig extends RemoteConfig {
  backend?: string; // the getRemoteBaseUrl() this was fetched for
}

export function getCachedServerConfig(): CachedServerConfig {
  try {
    const raw = localStorage.getItem(SERVER_CONFIG_KEY);
    if (raw) {
      const j = JSON.parse(raw);
      if (j && typeof j === 'object') return j as CachedServerConfig;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** Persist the discovered config for `backend`. Called only on a successful
 * fetch, so a failure leaves the previous value intact (keep-last). */
export function cacheServerConfig(backend: string, cfg: RemoteConfig): void {
  try {
    localStorage.setItem(SERVER_CONFIG_KEY, JSON.stringify({ backend, ...cfg }));
  } catch {
    /* private mode / quota — in-memory fallbacks still apply */
  }
}

/**
 * The active remote's base URL, read without React (api.ts / liveSync.ts call
 * this per-request). Resolves the built-in's env URL at read time.
 */
export function getRemoteBaseUrl(): string {
  const { remotes, activeId } = useRemoteStore.getState();
  if (activeId === BUILTIN_REMOTE_ID) return builtinUrlNormalized();
  const r = remotes.find((x) => x.id === activeId);
  return r ? r.url : builtinUrlNormalized();
}

/** The active remote's URL + a display label, without React. */
export function activeRemoteInfo(): { id: string; url: string; label: string } {
  const { remotes, activeId } = useRemoteStore.getState();
  if (activeId === BUILTIN_REMOTE_ID) return { id: BUILTIN_REMOTE_ID, url: builtinUrlNormalized(), label: 'PatchMan' };
  const r = remotes.find((x) => x.id === activeId);
  return r ? { id: r.id, url: r.url, label: r.label || r.url } : { id: BUILTIN_REMOTE_ID, url: builtinUrlNormalized(), label: 'PatchMan' };
}
