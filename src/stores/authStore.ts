import { create } from 'zustand';
import type { User } from '@/types';
import { authAPI, cloudSessionAPI } from '@/services/api';
import { getRemoteBaseUrl } from '@/stores/remoteStore';
import { getLocalApiUrl, isDesktop } from '@/lib/platform';
import {
  initialPush,
  initialPushFromEmbedded,
  planFirstSync,
  planFirstSyncFromEmbedded,
  applyFirstSync,
  previewOf,
  flushOutbox,
  type FirstSyncPlan,
  type FirstSyncPreview,
  type FirstSyncResult,
  type InitialPushResult,
  type SyncDirection,
} from '@/data/sync/SyncEngine';

export type AuthMode = 'local' | 'synced';

// Push (or clear) the cloud session on the embedded desktop backend so its
// whiteboard MCP tools act on the user's cloud account. Desktop-only, best-
// effort (the embedded BE may be momentarily unreachable — a failure just means
// the AI keeps acting on the on-device store until the next sync). Never throws.
function syncCloudSessionToEmbedded(token: string | null): void {
  if (!isDesktop()) return;
  // No embedded URL means the 'local' pin would fall through to remote (api.ts),
  // POSTing the cloud token to the hosted BE on a route that doesn't exist there.
  // Bail: there's no embedded whiteboard MCP to hand the session to anyway.
  if (!getLocalApiUrl()) return;
  void (async () => {
    try {
      if (token) await cloudSessionAPI.set(getRemoteBaseUrl(), token);
      else await cloudSessionAPI.clear();
    } catch { /* embedded BE unreachable — retried on next login/refresh */ }
  })();
}

/**
 * Where transient actions (send request, run test, start load test) execute.
 * Only meaningful on desktop-synced — web users and local-mode users don't
 * have a choice. Persistent data (collections, test cases, envs) follows
 * `dataSource`; this only flips the execution source.
 */
export type ExecutionTarget = 'local' | 'remote';

/**
 * Where persistent reads/writes go (collections, test cases, envs).
 *
 * `mode` and `dataSource` are decoupled on purpose so a synced user can
 * temporarily browse their embedded SQLite without logging out:
 * - mode=local         → dataSource is forced 'local' (no token, can't read remote)
 * - mode=synced        → dataSource defaults 'remote', toggleable to 'local' on desktop
 *
 * Used to be a single `mode` flag, which made "I'm logged in but where's my
 * data" hard to debug — every consumer had to know that `mode === 'local'`
 * meant both "no account" AND "read embedded BE", which is two unrelated
 * questions glued together.
 */
export type DataSource = 'local' | 'remote';

interface AuthState {
  user: User | null;
  token: string | null;
  mode: AuthMode;
  dataSource: DataSource;
  executionTarget: ExecutionTarget;
  isAuthenticated: boolean;
  isLoading: boolean;
  lastSyncPushResult: InitialPushResult | null;
  lastFirstSyncResult: FirstSyncResult | null;
  lastSyncError: string | null;
  pendingFirstSync: { plan: FirstSyncPlan; preview: FirstSyncPreview } | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  // Used by the SSO callback path: the BE has already validated the
  // OAuth code and minted a JWT, so we just need to install the result
  // into the store + localStorage. Avoids duplicating the post-login
  // mode/exec-target plumbing.
  setUserAndToken: (user: User, token: string) => void;
  logout: () => void;
  loadUser: () => Promise<void>;
  enterLocalMode: () => void;
  setExecutionTarget: (target: ExecutionTarget) => void;
  setDataSource: (source: DataSource) => void;
  confirmFirstSync: (direction?: SyncDirection) => Promise<void>;
  cancelFirstSync: () => void;
  // Recompute and re-show the local↔remote merge preview on demand. Used by
  // Settings → Data so a user who dismissed the dialog right after login can
  // get back to it without a full re-login.
  showFirstSyncPreview: () => Promise<void>;
}

const MODE_KEY = 'patchman_mode';
const DATA_SOURCE_KEY = 'patchman_data_source';
const EXECUTION_TARGET_KEY = 'patchman_execution_target';
const LOCAL_USER_ID_KEY = 'patchman_local_user_id';

function getOrCreateLocalUserId(): string {
  let id = localStorage.getItem(LOCAL_USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(LOCAL_USER_ID_KEY, id);
  }
  return id;
}

function localUser(): User {
  return { id: getOrCreateLocalUserId(), email: '', name: 'Local User' };
}

function initialExecutionTarget(): ExecutionTarget {
  const stored = localStorage.getItem(EXECUTION_TARGET_KEY);
  return stored === 'local' ? 'local' : 'remote';
}

// Resolve the persisted dataSource for a given auth mode. Local-mode users
// can never read from remote (no token), so we ignore any stale flag.
function initialDataSource(mode: AuthMode): DataSource {
  if (mode === 'local') return 'local';
  const stored = localStorage.getItem(DATA_SOURCE_KEY);
  return stored === 'local' ? 'local' : 'remote';
}

function initialState(): Pick<AuthState, 'user' | 'token' | 'mode' | 'dataSource' | 'executionTarget' | 'isAuthenticated' | 'isLoading' | 'lastSyncPushResult' | 'lastFirstSyncResult' | 'lastSyncError' | 'pendingFirstSync'> {
  const token = localStorage.getItem('patchman_token');
  const storedMode = localStorage.getItem(MODE_KEY) as AuthMode | null;
  const executionTarget = initialExecutionTarget();
  const base = { executionTarget, lastSyncPushResult: null, lastFirstSyncResult: null, lastSyncError: null, pendingFirstSync: null };
  if (token) {
    return { user: null, token, mode: 'synced', dataSource: initialDataSource('synced'), isAuthenticated: true, isLoading: false, ...base };
  }
  if (storedMode === 'local') {
    return { user: localUser(), token: null, mode: 'local', dataSource: 'local', isAuthenticated: true, isLoading: false, ...base };
  }
  return { user: null, token: null, mode: 'synced', dataSource: initialDataSource('synced'), isAuthenticated: false, isLoading: false, ...base };
}

export const useAuthStore = create<AuthState>((set) => ({
  ...initialState(),

  setUserAndToken: (user, token) => {
    localStorage.setItem('patchman_token', token);
    localStorage.setItem('patchman_user', JSON.stringify(user));
    localStorage.removeItem(MODE_KEY);
    localStorage.removeItem(DATA_SOURCE_KEY);
    set({ user, token, mode: 'synced', dataSource: 'remote', isAuthenticated: true });
    syncCloudSessionToEmbedded(token);
  },

  login: async (email: string, password: string) => {
    const wasLocal = localStorage.getItem(MODE_KEY) === 'local';
    const response = await authAPI.login(email, password);
    const { token, user } = response.data;
    localStorage.setItem('patchman_token', token);
    localStorage.setItem('patchman_user', JSON.stringify(user));
    localStorage.removeItem(MODE_KEY);
    localStorage.removeItem(DATA_SOURCE_KEY);
    set({ user, token, mode: 'synced', dataSource: 'remote', isAuthenticated: true });
    syncCloudSessionToEmbedded(token);

    // If the user was in local mode and is now logging into an existing
    // account, compute a merge plan and stash it for the preview dialog.
    // Don't throw — login succeeded; surface any plan failure via
    // lastSyncError so the UI can decide what to show.
    //
    // Desktop-local needs a separate planner because its "local" source is
    // the embedded BE's SQLite, not IndexedDB — but both variants feed into
    // the same preview dialog via the discriminated FirstSyncPlan union.
    if (wasLocal) {
      try {
        const plan = isDesktop()
          ? await planFirstSyncFromEmbedded(user.id)
          : await planFirstSync(user.id);
        set({ pendingFirstSync: { plan, preview: previewOf(plan) }, lastSyncError: null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to plan local data merge';
        set({ lastSyncError: msg });
      }
    }

    // Fire-and-forget: retry any queued writes that failed while offline.
    void flushOutbox().catch(() => { /* ignored */ });
  },

  confirmFirstSync: async (direction: SyncDirection = 'both') => {
    // Executed when the user clicks "Proceed" in the merge preview dialog.
    const pending = useAuthStore.getState().pendingFirstSync;
    if (!pending) return;
    try {
      const result = await applyFirstSync(pending.plan, direction);
      set({ lastFirstSyncResult: result, lastSyncError: null, pendingFirstSync: null });
      // Whiteboards aren't in a store that re-fetches on mode change, so nudge
      // any mounted whiteboard sidebar to reload — otherwise a just-pushed board
      // wouldn't appear until a manual refresh. Window event avoids an import
      // cycle (authStore ↔ whiteboardStore).
      try { window.dispatchEvent(new Event('patchman:sync-applied')); } catch { /* SSR/no-DOM */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to apply merge';
      set({ lastSyncError: msg, pendingFirstSync: null });
    }
  },

  cancelFirstSync: () => {
    // User opted out of the merge. Leave Dexie untouched — they stay in
    // synced mode but keep local data around. They can trigger a sync later.
    set({ pendingFirstSync: null });
  },

  register: async (name: string, email: string, password: string) => {
    const wasLocal = localStorage.getItem(MODE_KEY) === 'local';
    const response = await authAPI.register(name, email, password);
    const { token, user } = response.data;
    localStorage.setItem('patchman_token', token);
    localStorage.setItem('patchman_user', JSON.stringify(user));
    localStorage.removeItem(MODE_KEY);
    localStorage.removeItem(DATA_SOURCE_KEY);
    set({ user, token, mode: 'synced', dataSource: 'remote', isAuthenticated: true });
    syncCloudSessionToEmbedded(token);

    // If the user was in local mode, push their pre-registration state to the
    // server so nothing is lost. Source depends on the platform: desktop reads
    // the embedded BE's SQLite over HTTP, web reads IndexedDB. Errors surface
    // via lastSyncError — we don't throw because the account is already created.
    if (wasLocal) {
      try {
        const result = isDesktop()
          ? await initialPushFromEmbedded()
          : await initialPush();
        set({ lastSyncPushResult: result, lastSyncError: null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to sync local data';
        set({ lastSyncError: msg });
      }
    }

    void flushOutbox().catch(() => { /* ignored */ });
  },

  logout: () => {
    localStorage.removeItem('patchman_token');
    localStorage.removeItem('patchman_user');
    localStorage.removeItem(MODE_KEY);
    localStorage.removeItem(DATA_SOURCE_KEY);
    set({ user: null, token: null, mode: 'synced', dataSource: 'remote', isAuthenticated: false });
    syncCloudSessionToEmbedded(null);
  },

  enterLocalMode: () => {
    localStorage.setItem(MODE_KEY, 'local');
    localStorage.removeItem('patchman_token');
    localStorage.removeItem('patchman_user');
    localStorage.removeItem(DATA_SOURCE_KEY);
    set({ user: localUser(), token: null, mode: 'local', dataSource: 'local', isAuthenticated: true, isLoading: false });
    syncCloudSessionToEmbedded(null);
  },

  setExecutionTarget: (target: ExecutionTarget) => {
    localStorage.setItem(EXECUTION_TARGET_KEY, target);
    set({ executionTarget: target });
  },

  // Flip the data store the FE reads/writes from. Constrained: a local-mode
  // user can't flip to 'remote' (no token to authenticate against the remote
  // BE), so we silently no-op rather than producing a 401 storm.
  setDataSource: (source: DataSource) => {
    const { mode } = useAuthStore.getState();
    if (mode === 'local' && source === 'remote') return;
    if (source === 'remote') {
      localStorage.removeItem(DATA_SOURCE_KEY);
    } else {
      localStorage.setItem(DATA_SOURCE_KEY, 'local');
    }
    set({ dataSource: source });
  },

  showFirstSyncPreview: async () => {
    const { user, mode } = useAuthStore.getState();
    if (!user || mode !== 'synced') {
      set({ lastSyncError: 'Sign in first to compare local and remote data.' });
      return;
    }
    try {
      const plan = isDesktop()
        ? await planFirstSyncFromEmbedded(user.id)
        : await planFirstSync(user.id);
      set({ pendingFirstSync: { plan, preview: previewOf(plan) }, lastSyncError: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to plan local data merge';
      set({ lastSyncError: msg });
    }
  },

  loadUser: async () => {
    const token = localStorage.getItem('patchman_token');
    const storedMode = localStorage.getItem(MODE_KEY) as AuthMode | null;
    if (!token) {
      if (storedMode === 'local') {
        set({ user: localUser(), mode: 'local', dataSource: 'local', isAuthenticated: true, isLoading: false });
      } else {
        set({ isAuthenticated: false, isLoading: false });
      }
      return;
    }
    set({ isLoading: true });
    try {
      const response = await authAPI.me();
      set({ user: response.data, mode: 'synced', dataSource: initialDataSource('synced'), isAuthenticated: true, isLoading: false });
      syncCloudSessionToEmbedded(token);
      void flushOutbox().catch(() => { /* ignored */ });
    } catch {
      localStorage.removeItem('patchman_token');
      localStorage.removeItem('patchman_user');
      if (storedMode === 'local') {
        set({ user: localUser(), token: null, mode: 'local', dataSource: 'local', isAuthenticated: true, isLoading: false });
      } else {
        set({ user: null, token: null, mode: 'synced', dataSource: 'remote', isAuthenticated: false, isLoading: false });
      }
    }
  },
}));

// Sliding-session refresh: api.ts persists the rolled-forward token to
// localStorage and fires this event. Mirror it into the store so the
// in-memory `token` (read by liveSync's SSE URL and any other consumer)
// never lags behind and lets an already-valid session appear expired.
if (typeof window !== 'undefined') {
  window.addEventListener('patchman:token-refreshed', (e) => {
    const fresh = (e as CustomEvent<string>).detail;
    if (typeof fresh !== 'string' || fresh === '') return;
    const { token, mode } = useAuthStore.getState();
    // Only relevant to a synced session; ignore in local mode.
    if (mode === 'local') return;
    if (token === fresh) return;
    useAuthStore.setState({ token: fresh });
    // Keep the embedded BE's cloud session token fresh too (whiteboard MCP
    // tools use it) — otherwise it would expire while the app stays open.
    syncCloudSessionToEmbedded(fresh);
  });
}
