import axios, { type InternalAxiosRequestConfig } from 'axios';
import { getLocalApiUrl, isDesktop } from '@/lib/platform';
import { clientId } from '@/lib/clientId';
import { getRemoteBaseUrl } from '@/stores/remoteStore';
import { getAppVersion } from '@/lib/version';
import type {
  ClusterOverview,
  K8sPodMetricsResult,
  K8sPodMetricsHistoryResult,
  Collection,
  CollectionCollaborator,
  CookieItem,
  Defect,
  Environment,
  HistoryItem,
  MockServer,
  MockRoute,
  RedisElementRef,
  Requirement,
  SavedRequest,
  SharedStep,
  TestCase,
  TestCaseFolder,
  TestExecutionResult,
  TestPlan,
  TestRun,
  User,
  WebAuditReport,
} from '@/types';


/**
 * Mock servers live on the BE under `/mock/<prefix>/...`. In local dev that
 * goes through Vite's proxy (`/mock` → BE). In prod the FE host doesn't
 * route `/mock`, so falling back to `${origin}/mock/...` would land on the
 * SPA fallback and return index.html. Derive the mock base URL the same way
 * we derive the API base URL — strip a trailing `/api` so the result points
 * at the BE root, then we append `/mock/<prefix>`.
 *
 * Always resolves to an absolute URL: when getRemoteBaseUrl() is relative
 * (dev: "/api"), the result would be the relative "/mock". That's correct
 * for in-app fetches but useless for "Copy URL" / "Open" actions. We
 * prepend `window.location.origin` in that case so the user always gets a
 * URL they can paste into another tool.
 */
export function getRemoteMockBaseUrl(): string {
  const base = getRemoteBaseUrl().replace(/\/api\/?$/, '') + '/mock';
  if (typeof window !== 'undefined' && base.startsWith('/')) {
    return window.location.origin + base;
  }
  return base;
}

/**
 * Absolute URL of the MCP Streamable-HTTP endpoint, suitable for pasting
 * into an external MCP client's config (Claude Desktop, Cursor, VS Code).
 *
 * Must be derived from getRemoteBaseUrl() — NOT `window.location.origin` —
 * because in the Tauri desktop build the FE is served from
 * `tauri://localhost` while the BE lives on a remote host, and in local
 * dev with VITE_API_URL set to a remote BE the Vite origin would route
 * to the wrong server too. The mock-URL helper above has the same
 * shape; we keep both for clarity since the trailing path differs.
 */
export function getRemoteMcpUrl(): string {
  const base = getRemoteBaseUrl().replace(/\/api\/?$/, '') + '/api/mcp';
  if (typeof window !== 'undefined' && base.startsWith('/')) {
    return window.location.origin + base;
  }
  return base;
}

/**
 * Execution pin — an opt-in per-request override for callers that want to
 * route a specific call to a specific BE regardless of the current mode.
 * Used by proxyAPI.send and the test/load-test execute APIs so a
 * desktop-synced user can run a request locally while their data stays on
 * the remote. See authStore.executionTarget and pickExecutionPin().
 */
export type ExecutionPin = 'local' | 'remote';

declare module 'axios' {
  interface AxiosRequestConfig {
    _executionPin?: ExecutionPin;
  }
  interface InternalAxiosRequestConfig {
    _executionPin?: ExecutionPin;
  }
}

/**
 * True when the current session reads/writes the embedded BE rather than the
 * remote prod/test BE. Two ways to land here:
 *   1. mode=local              → no account, embedded BE is the only store
 *   2. synced + data_source=local → user-toggled "browse my embedded data"
 * Both cases share the same routing: embedded BE + LocalUserAuth (or no auth
 * for /public endpoints), no JWT.
 */
function readsEmbedded(): boolean {
  if (!isDesktop()) return false;
  if (localStorage.getItem('patchman_mode') === 'local') return true;
  return localStorage.getItem('patchman_data_source') === 'local';
}

/**
 * Public: does the active session read/write the embedded on-device backend
 * (desktop local — SQLite on this machine) rather than the remote team server?
 * Used to label where data such as whiteboards physically lives.
 */
export function isEmbeddedBackend(): boolean {
  return readsEmbedded();
}

/**
 * Resolve the axios baseURL for the current request.
 *
 * - readsEmbedded() → embedded Go BE (http://127.0.0.1:PORT/api).
 *   Embedded BE uses LocalUserAuth, so we don't attach an Authorization header.
 * - Everything else → remote BE (VITE_API_URL or `/api`).
 *
 * Computed per-request so mode/dataSource toggles take effect without restarting.
 */
function resolveBaseURL(): string {
  if (readsEmbedded()) {
    const local = getLocalApiUrl();
    if (local) return `${local}/api`;
  }
  return getRemoteBaseUrl();
}

// The effective API base the default `api` instance targets right now (embedded
// on desktop-local, remote when synced). Exposed so the whiteboard collab WS
// connects to the SAME backend the board data lives on.
export function getActiveBaseUrl(): string {
  return resolveBaseURL();
}

/**
 * Returns an ExecutionPin when the current session has a user-visible
 * "execution target" choice that should override the default routing, or
 * undefined when the default (follow mode) is correct.
 *
 * Only meaningful when the FE is reading from remote — when data already
 * lives on the embedded BE (web-local, desktop-local, or desktop-synced with
 * dataSource=local) the execution pin is redundant.
 */
export function pickExecutionPin(): ExecutionPin | undefined {
  if (!isDesktop()) return undefined;
  if (readsEmbedded()) return undefined;
  return localStorage.getItem('patchman_execution_target') === 'local' ? 'local' : undefined;
}

const api = axios.create({
  baseURL: getRemoteBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  // Report the client app version on every request (admin dashboard uses the
  // last value seen per user for upgrade tracking). Set first so it rides
  // along regardless of which baseURL/auth branch returns below.
  config.headers['X-Client-Version'] = getAppVersion();
  // Execution pin overrides both baseURL and auth header. Used by the
  // "Execution target" selector (desktop-synced only): the data calls keep
  // going to remote, but proxy/send and test/load-test execution can be
  // pinned locally to the embedded BE.
  if (config._executionPin === 'local') {
    const local = getLocalApiUrl();
    if (local) {
      config.baseURL = `${local}/api`;
      // Embedded BE uses LocalUserAuth — no JWT needed (and would error
      // against the LocalUserAuth middleware).
      if (config.headers?.Authorization) delete config.headers.Authorization;
      return config;
    }
    // Fall through to default if embedded URL unavailable.
  } else if (config._executionPin === 'remote') {
    config.baseURL = getRemoteBaseUrl();
    const token = localStorage.getItem('patchman_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  }

  // Default: follow mode.
  config.baseURL = resolveBaseURL();
  const hitsEmbedded = config.baseURL !== getRemoteBaseUrl();
  if (!hitsEmbedded) {
    const token = localStorage.getItem('patchman_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Admin "Manage as user" mode — when an admin has selected a target
    // user, every CRUD call goes out with this header so the BE swaps
    // the effective userID. Cleared by exiting impersonation mode.
    const actAs = localStorage.getItem('patchman_act_as_user');
    if (actAs) {
      config.headers['X-Act-As-User'] = actAs;
    }
  }
  // Stamp every request with this tab's client id. The BE echoes it on
  // the realtime event so the originating tab can suppress its own
  // self-mutation refresh (the mutation's promise chain already calls
  // refreshLists locally). Other tabs/users see the event with a
  // different originClientId and refresh normally.
  config.headers['X-Client-Id'] = clientId;
  return config;
});

// Sliding session: the BE re-issues a fresh JWT in the X-Refreshed-Token
// header once the current one is past its half-life. Swap it into storage so
// an actively-used session never expires, and notify the auth store so its
// in-memory copy (read by the SSE/WebSocket connections in liveSync) rolls
// forward too — otherwise those would keep sending the original token until
// it finally expired and then 401 → forced logout, the very bug we're fixing.
function applyRefreshedToken(headers: unknown): void {
  if (!headers || typeof headers !== 'object') return;
  const h = headers as Record<string, unknown>;
  const fresh = h['x-refreshed-token'];
  if (typeof fresh !== 'string' || fresh === '') return;
  if (localStorage.getItem('patchman_token') === fresh) return;
  localStorage.setItem('patchman_token', fresh);
  window.dispatchEvent(new CustomEvent('patchman:token-refreshed', { detail: fresh }));
}

api.interceptors.response.use(
  (response) => {
    applyRefreshedToken(response.headers);
    // Backend wraps all responses in {"data": ...}, unwrap automatically
    if (response.data && typeof response.data === 'object' && 'data' in response.data && Object.keys(response.data).length === 1) {
      response.data = response.data.data;
    }
    return response;
  },
  (error) => {
    // A refreshed token can ride on a non-2xx response too (the BE sets the
    // header before the handler runs), so honour it here as well.
    applyRefreshedToken(error.response?.headers);
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      const isLocalMode = localStorage.getItem('patchman_mode') === 'local';
      const fromEmbedded = readsEmbedded();
      // Don't redirect on login/register — let the component handle the error.
      // Don't redirect when we're reading the embedded BE — a stray 401 there
      // means LocalUserAuth header was missing or proxied weirdly, not that
      // the remote token is invalid. Treat it as a transient local error.
      if (!isLocalMode && !fromEmbedded && !url.includes('/auth/login') && !url.includes('/auth/register')) {
        localStorage.removeItem('patchman_token');
        localStorage.removeItem('patchman_user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Auth
// Login/register always hit the remote BE — the embedded BE has no user
// accounts (it uses LocalUserAuth middleware), so a desktop-local user
// clicking "Sign in to sync" would otherwise POST credentials at the
// embedded BE and fail. Pinning to remote keeps the call routed correctly
// regardless of current mode.
export const authAPI = {
  login: (email: string, password: string) =>
    api.post<{ token: string; user: User }>(
      '/auth/login',
      { email, password },
      { _executionPin: 'remote' },
    ),
  register: (name: string, email: string, password: string) =>
    api.post<{ token: string; user: User }>(
      '/auth/register',
      { name, email, password },
      { _executionPin: 'remote' },
    ),
  me: () => api.get<User>('/auth/me', { _executionPin: 'remote' }),
};

// MCP personal access tokens. These authenticate external MCP clients
// (Claude, MCP Inspector) against the /api/mcp endpoint. Like auth, they
// are tied to the user account and always live on the remote BE, so we
// pin to remote regardless of the current data-source mode.
export interface MCPToken {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt?: string | null;
  createdAt: string;
  // Enabled tool groups (comma-separated group keys from the BE, e.g.
  // "db,http"). `null` means ALL groups (the default), `""` means none. See
  // scopesToGroups() in MCPSection for the parse.
  scopes?: string | null;
}
// Which backend a token operation targets. Remote tokens live on the hosted BE
// (like auth); the local/"app" bridge token lives on the embedded desktop BE.
export type McpPin = 'remote' | 'local';
export const mcpTokensAPI = {
  list: (pin: McpPin = 'remote') => api.get<MCPToken[]>('/mcp/tokens', { _executionPin: pin }),
  // The raw token is returned exactly once, on create.
  create: (name: string, pin: McpPin = 'remote') =>
    api.post<{ token: string; id: string; name: string; prefix: string }>(
      '/mcp/tokens',
      { name },
      { _executionPin: pin },
    ),
  // Set which tool groups a token may use. `null` grants all groups, `[]`
  // disables every tool, a list restricts to those groups.
  updateScopes: (id: string, scopes: string[] | null, pin: McpPin = 'remote') =>
    api.patch<MCPToken>(`/mcp/tokens/${id}`, { scopes }, { _executionPin: pin }),
  revoke: (id: string, pin: McpPin = 'remote') => api.delete(`/mcp/tokens/${id}`, { _executionPin: pin }),
};

// Local (this-device) MCP bridge info — DESKTOP / EMBEDDED ONLY. The embedded
// Go BE writes a discovery file on startup and copies a small stdio bridge
// binary (`patchman-mcp`) to a stable path; this endpoint reports that
// absolute path plus whether the embedded server is currently running, so the
// settings UI can hand the user a ready-to-paste Claude Desktop stdio config.
//
// Pinned to the LOCAL embedded BE (never remote): the endpoint only exists on
// the embedded backend. On a plain web build getLocalApiUrl() is null, the pin
// falls through to remote, and the request 404s — callers MUST gate on
// isDesktop() and treat any failure as "not available" (hide the Local card).
export interface MCPLocalInfo {
  // Absolute path to the stdio bridge binary (e.g. ~/.patchman/bin/patchman-mcp),
  // resolved by the BE — never a `~`-relative path (Claude Desktop won't expand it).
  bridgePath: string;
  // True when the embedded server is up and the discovery file is fresh.
  running: boolean;
  // Optional richer fields the embedded BE may also return (RFC §7.3). Not
  // required by this UI; used only if present.
  url?: string;
  discoveryPath?: string;
  claudeConfigPath?: string;
  serverName?: string;
}
export const mcpAPI = {
  local: () => api.get<MCPLocalInfo>('/mcp/local', { _executionPin: 'local' }),
};

// Collections
export const collectionsAPI = {
  list: (workspaceId?: string) =>
    api.get<Collection[]>('/collections', workspaceId ? { params: { workspaceId } } : undefined),
  // Discovery query for the Public sidebar accordion. Bypasses the
  // workspace filter since public collections cross workspace boundaries
  // by definition.
  listPublic: () => api.get<Collection[]>('/collections', { params: { scope: 'public' } }),
  create: (data: Partial<Collection>) => api.post<Collection>('/collections', data),
  update: (id: string, data: Partial<Collection>) =>
    api.put<Collection>(`/collections/${id}`, data),
  delete: (id: string) => api.delete(`/collections/${id}`),
};

// Requests
export const requestsAPI = {
  list: (collectionId: string) => api.get(`/collections/${collectionId}/requests`),
  create: (data: Record<string, unknown>) =>
    api.post('/requests', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put(`/requests/${id}`, data),
  delete: (id: string) => api.delete(`/requests/${id}`),
};

// Proxy - send request through backend
//
// Endpoint selection subtlety: /api/public/proxy/send has no auth middleware
// and therefore no userID — the handler skips history writes. /api/proxy/send
// runs auth middleware (JWTAuth on remote, LocalUserAuth on embedded), so
// history IS written.
//
// - mode=local without a pin → /public so anonymous web-local users can still send.
// - pin=local (desktop-synced executing locally) → /proxy so the embedded BE
//   writes + forwards history upstream via the --forward-target path.
function proxyEndpoint(path: '/proxy/send' | '/cors-proxy', pin?: ExecutionPin): string {
  if (pin === 'local') return path;
  return localStorage.getItem('patchman_mode') === 'local' ? `/public${path}` : path;
}

export const proxyAPI = {
  send: (
    data: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: { type: string; content: string; formFields?: Array<{ key: string; value: string; type: string; enabled: boolean; fileName?: string; fileType?: string }> };
      params: Record<string, string>;
    },
    signal?: AbortSignal,
  ) => {
    const pin = pickExecutionPin();
    return api.post(proxyEndpoint('/proxy/send', pin), data, { _executionPin: pin, signal });
  },
  corsProxy: (
    data: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string;
    },
    signal?: AbortSignal,
  ) => {
    const pin = pickExecutionPin();
    return api.post(proxyEndpoint('/cors-proxy', pin), data, { _executionPin: pin, signal });
  },
};

// Environments
export const environmentsAPI = {
  list: (workspaceId?: string) =>
    api.get<Environment[]>('/environments', workspaceId ? { params: { workspaceId } } : undefined),
  create: (data: Partial<Environment>) => api.post<Environment>('/environments', data),
  update: (id: string, data: Partial<Environment>) =>
    api.put<Environment>(`/environments/${id}`, data),
  delete: (id: string) => api.delete(`/environments/${id}`),
  // Activate is per-user per-workspace now. Pass the workspace the
  // user is currently viewing so the BE pins activation against the
  // right scope (a global env activated while in workspace A becomes
  // the active env for A, not "global").
  activate: (id: string, workspaceId?: string) =>
    api.put(
      `/environments/${id}/activate${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`,
    ),
  import: (data: Record<string, unknown>) => api.post<Environment>('/environments/import', data),
  export: (id: string) => api.get(`/environments/${id}/export`),
  // Bulk multi-format export — body picks the format (patchman /
  // postman / dotenv) + secrets policy. Returns JSON for json formats,
  // text/plain for single-env dotenv, application/zip for multi-env
  // dotenv. Use responseType:'blob' so the browser passes the raw
  // bytes through to the download path.
  bulkExport: (input: {
    ids?: string[];
    workspaceId?: string;
    format: 'patchman' | 'postman' | 'dotenv';
    includeSecrets: boolean;
    enabledOnly: boolean;
  }) =>
    api.post('/environments/export', input, {
      _executionPin: 'remote',
      responseType: 'blob',
    }),
  revealSecret: (id: string, key: string) =>
    api.get<{ key: string; value: string; secret: boolean }>(
      `/environments/${id}/variables/${encodeURIComponent(key)}/reveal`,
      { _executionPin: 'remote' },
    ),
};

// Environment legacy share-code endpoints were removed in 1.16. Env
// sharing now runs exclusively through environmentSharingAPI
// (visibility + Editors / Viewers grants). Existing collaborator rows
// were migrated to public-grants at boot — see
// migrateEnvironmentSharesToPublicGrants on the BE. The deprecation
// page at /join/env/:token tells anyone with an old link to ask the
// owner to re-share via the new dialog.

// History
// `scope` pins the call to a specific backend via `_executionPin` — same
// mechanism as `/db-query/history` — so the History panel can read (and
// clear) the local sidecar and the remote server independently. Omitting it
// follows the current session's default routing.
export const savedResponsesAPI = {
  list: (collectionIds: string[], requestId?: string) =>
    api.get('/saved-responses', { params: { collections: collectionIds.join(','), ...(requestId ? { request: requestId } : {}) } }),
  get: (id: string) => api.get(`/saved-responses/${id}`),
  create: (data: unknown) => api.post('/saved-responses', data),
  rename: (id: string, name: string) => api.patch(`/saved-responses/${id}`, { name }),
  delete: (id: string) => api.delete(`/saved-responses/${id}`),
};

export const historyAPI = {
  list: (page = 1, limit = 50, scope?: ExecutionPin) =>
    api.get<HistoryItem[]>('/history', {
      params: { page, limit },
      ...(scope ? { _executionPin: scope } : {}),
    }),
  clear: (scope?: ExecutionPin) =>
    api.delete('/history', scope ? { _executionPin: scope } : undefined),
};

// Mock Servers
export const mockAPI = {
  listServers: () => api.get<MockServer[]>('/mock-servers'),
  createServer: (data: Partial<MockServer>) =>
    api.post<MockServer>('/mock-servers', data),
  updateServer: (id: string, data: Partial<MockServer>) =>
    api.put<MockServer>(`/mock-servers/${id}`, data),
  deleteServer: (id: string) => api.delete(`/mock-servers/${id}`),
  listRoutes: (serverId: string) =>
    api.get<MockRoute[]>(`/mock-servers/${serverId}/routes`),
  createRoute: (serverId: string, data: Partial<MockRoute>) =>
    api.post<MockRoute>(`/mock-servers/${serverId}/routes`, data),
  updateRoute: (_serverId: string, routeId: string, data: Partial<MockRoute>) =>
    api.put<MockRoute>(`/mock-routes/${routeId}`, data),
  deleteRoute: (_serverId: string, routeId: string) =>
    api.delete(`/mock-routes/${routeId}`),
};

// QA - Test Cases
// Backend stores tags as comma-separated string and steps as JSON string.
// Frontend uses string[] and TestStep[]. Convert at the API boundary.
function serializeTestCase(data: Partial<TestCase>): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...data };
  if (Array.isArray(data.tags)) {
    payload.tags = data.tags.join(',');
  }
  if (Array.isArray(data.steps)) {
    payload.steps = JSON.stringify(data.steps);
  }
  return payload;
}

function parseTestCase(raw: Record<string, unknown>): TestCase {
  const tc = raw as Record<string, unknown>;
  return {
    ...raw,
    tags: typeof tc.tags === 'string'
      ? (tc.tags ? tc.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [])
      : (tc.tags || []),
    steps: typeof tc.steps === 'string'
      ? (tc.steps ? JSON.parse(tc.steps) : [])
      : (tc.steps || []),
  } as TestCase;
}

export const testCasesAPI = {
  list: () =>
    api.get<TestCase[]>('/test-cases').then((res) => {
      res.data = (Array.isArray(res.data) ? res.data : []).map((tc) => parseTestCase(tc as unknown as Record<string, unknown>));
      return res;
    }),
  create: (data: Partial<TestCase>) =>
    api.post<TestCase>('/test-cases', serializeTestCase(data)).then((res) => {
      res.data = parseTestCase(res.data as unknown as Record<string, unknown>);
      return res;
    }),
  update: (id: string, data: Partial<TestCase>) =>
    api.put<TestCase>(`/test-cases/${id}`, serializeTestCase(data)).then((res) => {
      res.data = parseTestCase(res.data as unknown as Record<string, unknown>);
      return res;
    }),
  delete: (id: string) => api.delete(`/test-cases/${id}`),
  execute: (id: string, data?: { environmentId?: string }) => {
    const pin = pickExecutionPin();
    return api.post<TestExecutionResult>(`/test-cases/${id}/execute`, data || {}, { _executionPin: pin });
  },
  // File a case in a folder (null = root). Not a content edit: no version snapshot.
  move: (id: string, folderId: string | null) =>
    api.put<TestCase>(`/test-cases/${id}/move`, { folderId }).then((res) => {
      res.data = parseTestCase(res.data as unknown as Record<string, unknown>);
      return res;
    }),
};

// One case of a folder "Run all" (plan-run shape + the case's folder).
export interface FolderRunCaseResult {
  testCaseId: string;
  title: string;
  folderId: string;
  status: string;
  duration: number;
  result?: TestExecutionResult;
}

export interface FolderRunResponse {
  testRun: TestRun;
  folder: { id: string; name: string };
  testCases: FolderRunCaseResult[];
  skipped: Array<{ testCaseId: string; title: string; folderId: string }>;
  overallStatus: 'passed' | 'failed' | 'cancelled';
  totalDuration: number;
  summary: { total: number; passed: number; failed: number; skipped: number };
}

// QA - Test-case folders
export const testFoldersAPI = {
  list: () => api.get<TestCaseFolder[]>('/test-folders'),
  create: (data: { name: string; parentId?: string | null; id?: string }) =>
    api.post<TestCaseFolder>('/test-folders', data),
  rename: (id: string, name: string) => api.put<TestCaseFolder>(`/test-folders/${id}`, { name }),
  // A non-empty folder is refused (409) unless moveToParent moves its cases
  // and subfolders up to its parent first.
  delete: (id: string, moveToParent = false) =>
    api.delete(`/test-folders/${id}`, { params: moveToParent ? { moveToParent: 'true' } : {} }),
  // "Run all" — same execution pin as test-case / plan runs.
  execute: (id: string, data?: { environmentId?: string; recursive?: boolean }) => {
    const pin = pickExecutionPin();
    return api.post<FolderRunResponse>(`/test-folders/${id}/execute`, data || {}, { _executionPin: pin });
  },
};

// QA - Test Plans
export const testPlansAPI = {
  list: () => api.get<TestPlan[]>('/test-plans'),
  create: (data: Partial<TestPlan>) => api.post<TestPlan>('/test-plans', data),
  update: (id: string, data: Partial<TestPlan>) =>
    api.put<TestPlan>(`/test-plans/${id}`, data),
  delete: (id: string) => api.delete(`/test-plans/${id}`),
  execute: (id: string, data?: { environmentId?: string }) => {
    const pin = pickExecutionPin();
    return api.post(`/test-plans/${id}/execute`, data || {}, { _executionPin: pin });
  },
};

// QA - Test Runs
export const testRunsAPI = {
  list: () => api.get<TestRun[]>('/test-runs'),
  create: (data: Partial<TestRun>) => api.post<TestRun>('/test-runs', data),
  get: (id: string) => api.get<TestRun>(`/test-runs/${id}`),
  delete: (id: string) => api.delete(`/test-runs/${id}`),
};

// Collection Export
export const collectionShareAPI = {
  export: (id: string) => api.get(`/collections/${id}/export`),
};

// Collection Sync
export const collectionSyncAPI = {
  refresh: (id: string) => api.post(`/collections/${id}/sync?mode=refresh`),
  fromURL: (id: string, url: string) => api.post(`/collections/${id}/sync?mode=url`, { url }),
  // sourceUrl: optional. When the FE resolved a docs page to a JSON
  // spec before sending, pass the original URL so the BE stamps it on
  // the collection — the next Update dialog open pre-fills from it.
  fromJSON: (id: string, spec: string, sourceUrl?: string) => api.post(`/collections/${id}/sync?mode=json${sourceUrl ? `&sourceUrl=${encodeURIComponent(sourceUrl)}` : ''}`, spec, {
    headers: { 'Content-Type': 'application/json' },
    transformRequest: [(data: string) => data],
  }),
  fromPostman: (id: string, data: unknown, sourceUrl?: string) => api.post(`/collections/${id}/sync?mode=postman${sourceUrl ? `&sourceUrl=${encodeURIComponent(sourceUrl)}` : ''}`, data),
};

// Collection Collaboration
export const collectionCollabAPI = {
  createShare: (collectionId: string) => api.post<{ shareToken: string }>(`/collections/${collectionId}/share`),
  revokeShare: (collectionId: string) => api.delete(`/collections/${collectionId}/share`),
  join: (shareToken: string) => api.post<{ collection: Collection; message: string }>('/collections/join', { shareToken }),
  listCollaborators: (collectionId: string) => api.get<{ collaborators: CollectionCollaborator[]; shareToken: string }>(`/collections/${collectionId}/collaborators`),
  removeCollaborator: (collectionId: string, userId: string) => api.delete(`/collections/${collectionId}/collaborators/${userId}`),
  leave: (collectionId: string) => api.delete(`/collections/${collectionId}/leave`),
};

// Workspaces — owner controls metadata + team binding; team members
// see the workspace in their selector but cannot mutate it.
export const workspacesAPI = {
  list: () => api.get('/workspaces'),
  create: (data: { name: string; description?: string; type?: string }) => api.post('/workspaces', data),
  get: (id: string) => api.get(`/workspaces/${id}`),
  update: (id: string, data: { name?: string; description?: string }) => api.put(`/workspaces/${id}`, data),
  delete: (id: string) => api.delete(`/workspaces/${id}`),
  // Bind / unbind to a team. Send `teamId: null` to unbind back to
  // a personal workspace. Owner-only — the BE rejects with 404 if
  // the caller is not the owner.
  setTeam: (id: string, teamId: string | null) =>
    api.patch(`/workspaces/${id}/team`, { teamId }),
};

// Teams — asset-free user groups referenced from public-grant rows on
// collections + environments. See TEAMS_AND_PUBLIC_SHARING_RFC.md.
export const teamsAPI = {
  list: () => api.get('/teams'),
  create: (data: { name: string; description?: string }) => api.post('/teams', data),
  get: (id: string) => api.get(`/teams/${id}`),
  update: (id: string, data: { name?: string; description?: string }) => api.patch(`/teams/${id}`, data),
  delete: (id: string) => api.delete(`/teams/${id}`),
  listMembers: (id: string) => api.get(`/teams/${id}/members`),
  addMember: (id: string, data: { email: string; role?: 'admin' | 'member' }) => api.post(`/teams/${id}/members`, data),
  updateMemberRole: (id: string, userId: string, data: { role: 'admin' | 'member' }) =>
    api.patch(`/teams/${id}/members/${userId}`, data),
  removeMember: (id: string, userId: string) => api.delete(`/teams/${id}/members/${userId}`),
};

// Collection / Environment public-sharing surface — visibility toggle
// plus the editors/viewers grant lists. See the RFC for the dual-list
// semantics.
export const collectionSharingAPI = {
  setVisibility: (id: string, visibility: 'public' | 'private') =>
    api.patch(`/collections/${id}/visibility`, { visibility }),
  listGrants: (id: string) => api.get(`/collections/${id}/grants`),
  addGrant: (
    id: string,
    data: { role: 'editor' | 'viewer'; subjectKind: 'user' | 'team' | 'everyone'; subjectId?: string },
  ) => api.post(`/collections/${id}/grants`, data),
  deleteGrant: (id: string, grantId: string) => api.delete(`/collections/${id}/grants/${grantId}`),
};

// DB Query Tool — see DB_QUERY_TOOL_RFC.md. Connection management
// (encrypted creds), the execute endpoint (with cancel + row cap),
// grants, saved queries and history all live under this surface.
// DBScope routes every DB-related call to the right BE:
//   'local'  → embedded Go BE in the Tauri sidecar (localhost only).
//              Required when the user wants to query an actual local DB
//              like docker postgres on 127.0.0.1:5432 — the prod BE
//              can't reach the user's loopback.
//   'remote' → the team's hosted BE. Connection metadata lives there
//              and the BE has line-of-sight to the prod/staging DBs.
// `undefined` follows the user's default mode (synced ⇒ remote;
// local-mode ⇒ local).
export type DBScope = 'local' | 'remote';

function dbCfg(scope: DBScope | undefined, extra?: Record<string, unknown>) {
  if (!scope) return extra;
  return { ...(extra ?? {}), _executionPin: scope };
}

// Connection "Test" buttons must never spin forever. The shared axios instance
// sets no timeout (queries / clone can run for minutes), so each test call
// caps itself. The BE already bounds a DB test at ~8s; this is the client-side
// safety net for when the request to the BE itself stalls (e.g. an unreachable
// remote backend or a blackholed host), which otherwise hangs with no timeout.
const CONN_TEST_TIMEOUT_MS = 15000;
const testCfg = (scope: DBScope | undefined) => dbCfg(scope, { timeout: CONN_TEST_TIMEOUT_MS });

export const dbConnectionAPI = {
  list: (scope?: DBScope) => api.get('/db-connections', dbCfg(scope)),
  create: (data: {
    id?: string; // FE-supplied UUID — same id sent to both BEs for dual-write dedup
    name: string;
    kind: 'postgres' | 'cockroachdb' | 'yugabytedb' | 'redshift' | 'mysql' | 'mariadb' | 'tidb' | 'sqlserver' | 'mongo';
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    options?: Record<string, unknown>;
    workspaceId?: string;
    connectionString?: string;
    // Per-connection read-write master switch. Omitted/false = read-only.
    allowWrite?: boolean;
    // Duplicate: fill a blank password (and, with copyConnectionString, a
    // blank DSN) from this existing connection's stored secret, BE-side.
    copySecretsFrom?: string;
    copyConnectionString?: boolean;
  }, scope?: DBScope) => api.post('/db-connections', data, dbCfg(scope)),
  get: (id: string, scope?: DBScope) => api.get(`/db-connections/${id}`, dbCfg(scope)),
  update: (id: string, data: Record<string, unknown>, scope?: DBScope) =>
    api.patch(`/db-connections/${id}`, data, dbCfg(scope)),
  delete: (id: string, scope?: DBScope) => api.delete(`/db-connections/${id}`, dbCfg(scope)),
  test: (id: string | null, data?: Record<string, unknown>, scope?: DBScope) =>
    id
      ? api.post(`/db-connections/${id}/test`, undefined, testCfg(scope))
      : api.post('/db-connections/test', data, testCfg(scope)),
  revealPassword: (id: string, scope?: DBScope) =>
    api.post(`/db-connections/${id}/reveal-password`, undefined, dbCfg(scope)),
  schema: (id: string, scope?: DBScope) =>
    api.get(`/db-connections/${id}/schema`, dbCfg(scope)),
  refreshSchema: (id: string, scope?: DBScope) =>
    api.post(`/db-connections/${id}/refresh-schema`, undefined, dbCfg(scope)),
  // Grants
  listGrants: (id: string, scope?: DBScope) =>
    api.get(`/db-connections/${id}/grants`, dbCfg(scope)),
  addGrant: (id: string, data: { subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' }, scope?: DBScope) =>
    api.post(`/db-connections/${id}/grants`, data, dbCfg(scope)),
  deleteGrant: (id: string, grantId: string, scope?: DBScope) =>
    api.delete(`/db-connections/${id}/grants/${grantId}`, dbCfg(scope)),
};

export const dbQueryAPI = {
  execute: (data: {
    connectionId: string;
    query: string;
    limit?: number;
    offset?: number;
    queryId?: string;
  }, signal?: AbortSignal, scope?: DBScope) =>
    api.post('/db-query/execute', data, { signal, ...(scope ? { _executionPin: scope } : {}) }),
  cancel: (queryId: string, scope?: DBScope) =>
    api.post('/db-query/cancel', { queryId }, dbCfg(scope)),
  history: (params?: { connectionId?: string }, scope?: DBScope) =>
    api.get('/db-query/history', { params, ...(scope ? { _executionPin: scope } : {}) }),
};

// ── LLM providers + streaming chat ───────────────────────────────────
// Mirrors dbConnectionAPI: an FE-supplied UUID dual-written to the chosen
// backend(s), a secret (API key) encrypted server-side and never returned, and
// `_executionPin` scope routing. Chat is proxied + streamed by the BE so the key
// never reaches the browser.

export type LLMKind = 'openai' | 'anthropic';

export interface LLMProvider {
  id: string;
  userId?: string;
  name: string;
  kind: LLMKind;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  primaryScope?: DBScope;
  // FE-derived by the store when merging the dual-write results:
  scope?: DBScope;
  availableScopes?: DBScope[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LLMProviderInput {
  id?: string;
  name: string;
  kind: LLMKind;
  baseUrl: string;
  model?: string;
  // Omit `apiKey` on update to KEEP the stored key; send '' to clear it.
  apiKey?: string;
  primaryScope?: DBScope;
}

export const llmProviderAPI = {
  list: (scope?: DBScope) => api.get('/llm-providers', dbCfg(scope)),
  create: (data: LLMProviderInput, scope?: DBScope) => api.post('/llm-providers', data, dbCfg(scope)),
  get: (id: string, scope?: DBScope) => api.get(`/llm-providers/${id}`, dbCfg(scope)),
  update: (id: string, data: Partial<LLMProviderInput>, scope?: DBScope) =>
    api.patch(`/llm-providers/${id}`, data, dbCfg(scope)),
  delete: (id: string, scope?: DBScope) => api.delete(`/llm-providers/${id}`, dbCfg(scope)),
  test: (id: string | null, data?: Partial<LLMProviderInput>, scope?: DBScope) =>
    id
      ? api.post(`/llm-providers/${id}/test`, undefined, testCfg(scope))
      : api.post('/llm-providers/test', data, testCfg(scope)),
  revealApiKey: (id: string, scope?: DBScope) =>
    api.post(`/llm-providers/${id}/reveal-api-key`, undefined, dbCfg(scope)),
};

// AI-drawn diagram from the user's LIVE data: a server-side ReAct loop over a
// read-only slice of the user's MCP tools returns Mermaid. Non-streaming (the
// loop runs tool calls), so it can take a few seconds. Pinned by scope to the
// backend where the provider + data connections live.
export const llmDiagramAPI = {
  generate: (data: { providerId: string; model?: string; prompt: string }, scope?: DBScope) =>
    // The ReAct loop can run several completions + tool calls — allow up to 3min
    // (the BE caps itself at the same), overriding the axios default timeout.
    api.post('/llm/diagram', data, dbCfg(scope, { timeout: 180_000 })),
};

export interface LLMChatMessage { role: 'user' | 'assistant' | 'system'; content: string }

export interface LLMChatRequest {
  providerId: string;
  model?: string;
  system?: string;
  messages: LLMChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMStreamHandlers {
  onOpen?: (info: { model?: string; kind?: string }) => void;
  onToken: (text: string) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
  /** Remote scope only: the backend answered fine but its ingress buffered the
   * whole body into one chunk — i.e. real token-by-token streaming didn't work. */
  onBuffered?: () => void;
  signal?: AbortSignal;
}

const LLM_BUFFERED_PREFIX = 'patchman_llm_stream_buffered:';

/** Whether a prior remote chat on the current remote backend was detected as
 * buffered (so the UI can warn up-front). Local scope always streams. */
export function remoteStreamBuffered(): boolean {
  try {
    return localStorage.getItem(LLM_BUFFERED_PREFIX + getRemoteBaseUrl()) === '1';
  } catch {
    return false;
  }
}

function parseLLMFrame(frame: string): { event: string; data: string } {
  let event = '';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(line.startsWith('data: ') ? 6 : 5);
  }
  return { event, data };
}

// streamLLMChat POSTs to the BE proxy and reads the normalized SSE frames
// (event: open|token|error|done). Auth follows the streaming-fetch idiom used
// by k8s/logs: local pin → embedded BE (no token); remote → token as a query
// param (the Tauri shell can't set an Authorization header cross-origin).
export async function streamLLMChat(
  req: LLMChatRequest,
  scope: DBScope | undefined,
  h: LLMStreamHandlers,
): Promise<void> {
  const useLocal = scope === 'local' && isDesktop();
  let base: string;
  if (useLocal) {
    const local = getLocalApiUrl();
    base = local ? `${local}/api` : getRemoteBaseUrl();
  } else {
    base = getRemoteBaseUrl().startsWith('/') && typeof window !== 'undefined'
      ? window.location.origin + getRemoteBaseUrl()
      : getRemoteBaseUrl();
  }
  let url = `${base}/llm/chat`;
  if (!useLocal) {
    const token = localStorage.getItem('patchman_token');
    if (token) url += `?token=${encodeURIComponent(token)}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: h.signal,
  });

  // Pre-stream errors are JSON (e.g. the 502 carrying "provider 401: ...").
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.body ? `${j.error}: ${j.body}` : (j.error || msg);
    } catch { /* non-JSON body */ }
    h.onError?.(msg);
    return;
  }
  // A 200 that isn't SSE (an ingress error/HTML page) must not be parsed as frames.
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    let msg = 'The backend returned a non-streaming response.';
    try { const txt = await res.text(); if (txt.trim()) msg = txt.slice(0, 500); } catch { /* ignore */ }
    h.onError?.(msg);
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let tokenFrames = 0; // total token frames seen
  let tokenReads = 0;  // distinct reader.read() calls that delivered ≥1 token
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let sawToken = false;
    buf = (buf + dec.decode(value, { stream: true })).replace(/\r\n/g, '\n');
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const { event, data } = parseLLMFrame(frame);
      if (!event) continue;
      if (event === 'open') {
        try { h.onOpen?.(JSON.parse(data || '{}')); } catch { /* ignore */ }
      } else if (event === 'token') {
        try {
          const t = JSON.parse(data).text as string;
          if (t) { h.onToken(t); tokenFrames++; sawToken = true; }
        } catch { /* ignore */ }
      } else if (event === 'error') {
        let m = 'stream error';
        try { m = JSON.parse(data).message || m; } catch { /* ignore */ }
        h.onError?.(m);
      }
      // 'done' is handled after the loop when the stream closes.
    }
    if (sawToken) tokenReads += 1;
  }

  // Remote buffering detection: a whole answer of real size that arrived in a
  // SINGLE read never actually streamed — the ingress buffered it. The token
  // floor rules out a legitimately tiny reply. Local pin never buffers.
  if (!useLocal) {
    try {
      if (tokenReads === 1 && tokenFrames >= 8) {
        localStorage.setItem(LLM_BUFFERED_PREFIX + getRemoteBaseUrl(), '1');
        h.onBuffered?.();
      } else if (tokenReads > 1) {
        localStorage.removeItem(LLM_BUFFERED_PREFIX + getRemoteBaseUrl());
      }
    } catch { /* storage unavailable */ }
  }
  h.onDone?.();
}

export const dbSavedQueryAPI = {
  list: (connectionId?: string, scope?: DBScope) =>
    api.get('/saved-db-queries', {
      params: connectionId ? { connectionId } : undefined,
      ...(scope ? { _executionPin: scope } : {}),
    }),
  create: (data: {
    connectionId: string;
    name: string;
    queryText: string;
    workspaceId?: string;
    folder?: string;
    tags?: string;
  }, scope?: DBScope) => api.post('/saved-db-queries', data, dbCfg(scope)),
  update: (id: string, data: {
    name?: string;
    queryText?: string;
    sortOrder?: number;
    folder?: string;
    tags?: string;
  }, scope?: DBScope) => api.patch(`/saved-db-queries/${id}`, data, dbCfg(scope)),
  delete: (id: string, scope?: DBScope) =>
    api.delete(`/saved-db-queries/${id}`, dbCfg(scope)),
};

// Kafka tool — see KAFKA_S3_AND_DBQUERY_FIXES_RFC.md §A. Same DBScope
// dual-write routing as the DB tool (SASL creds encrypted, per-BE pin).
export const kafkaConnectionAPI = {
  list: (scope?: DBScope) => api.get('/kafka-connections', dbCfg(scope)),
  create: (data: Record<string, unknown>, scope?: DBScope) =>
    api.post('/kafka-connections', data, dbCfg(scope)),
  get: (id: string, scope?: DBScope) => api.get(`/kafka-connections/${id}`, dbCfg(scope)),
  update: (id: string, data: Record<string, unknown>, scope?: DBScope) =>
    api.patch(`/kafka-connections/${id}`, data, dbCfg(scope)),
  delete: (id: string, scope?: DBScope) => api.delete(`/kafka-connections/${id}`, dbCfg(scope)),
  test: (id: string | null, data?: Record<string, unknown>, scope?: DBScope) =>
    id
      ? api.post(`/kafka-connections/${id}/test`, undefined, testCfg(scope))
      : api.post('/kafka-connections/test', data, testCfg(scope)),
  revealSecret: (id: string, scope?: DBScope) =>
    api.post(`/kafka-connections/${id}/reveal-secret`, undefined, dbCfg(scope)),
  listGrants: (id: string, scope?: DBScope) => api.get(`/kafka-connections/${id}/grants`, dbCfg(scope)),
  addGrant: (id: string, data: { subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' }, scope?: DBScope) =>
    api.post(`/kafka-connections/${id}/grants`, data, dbCfg(scope)),
  deleteGrant: (id: string, grantId: string, scope?: DBScope) =>
    api.delete(`/kafka-connections/${id}/grants/${grantId}`, dbCfg(scope)),
};

export const kafkaAPI = {
  topics: (id: string, scope?: DBScope) => api.get(`/kafka/${id}/topics`, dbCfg(scope)),
  // Enriched topic list for the Topics tab (partitions, RF, ≈message count,
  // health flags) — costs two extra offset RPCs, so the dropdown keeps
  // using `topics`. `topicDetail` is the per-topic expand (partitions +
  // watermarks + config).
  topicsOverview: (id: string, scope?: DBScope) => api.get(`/kafka/${id}/topic-overview`, dbCfg(scope)),
  topicDetail: (id: string, topic: string, scope?: DBScope) =>
    api.get(`/kafka/${id}/topics/${encodeURIComponent(topic)}/detail`, dbCfg(scope)),
  topicConfig: (id: string, topic: string, scope?: DBScope) =>
    api.get(`/kafka/${id}/topics/${encodeURIComponent(topic)}/config`, dbCfg(scope)),
  alterTopicConfig: (id: string, topic: string, config: Record<string, string>, scope?: DBScope) =>
    api.patch(`/kafka/${id}/topics/${encodeURIComponent(topic)}/config`, { config }, dbCfg(scope)),
  createTopic: (id: string, data: { name: string; partitions: number; replicationFactor: number; config?: Record<string, string> }, scope?: DBScope) =>
    api.post(`/kafka/${id}/topics`, data, dbCfg(scope)),
  addPartitions: (id: string, topic: string, total: number, scope?: DBScope) =>
    api.post(`/kafka/${id}/topics/${encodeURIComponent(topic)}/partitions`, { total }, dbCfg(scope)),
  deleteTopic: (id: string, topic: string, scope?: DBScope) =>
    api.delete(`/kafka/${id}/topics/${encodeURIComponent(topic)}`, dbCfg(scope)),
  brokers: (id: string, scope?: DBScope) => api.get(`/kafka/${id}/brokers`, dbCfg(scope)),
  groups: (id: string, scope?: DBScope) => api.get(`/kafka/${id}/groups`, dbCfg(scope)),
  groupDetail: (id: string, group: string, scope?: DBScope) =>
    api.get(`/kafka/${id}/groups/${encodeURIComponent(group)}`, dbCfg(scope)),
  // Consumer-group lag dashboard. `lag` = cluster summary (optional topic
  // filter); `groupLag` = full per-member / per-partition detail for one group.
  lag: (id: string, topic?: string, scope?: DBScope) =>
    api.get(`/kafka/${id}/lag`, dbCfg(scope, topic ? { params: { topic } } : undefined)),
  groupLag: (id: string, group: string, scope?: DBScope) =>
    api.get(`/kafka/${id}/groups/${encodeURIComponent(group)}/lag`, dbCfg(scope)),
  consume: (id: string, data: { topic: string; mode: string; n: number; partition: number; offset?: number; timestampMs?: number }, scope?: DBScope) =>
    api.post(`/kafka/${id}/consume`, data, dbCfg(scope)),
  produce: (id: string, data: { topic: string; partition: number; key: string; value: string; headers?: { key: string; value: string }[] }, scope?: DBScope) =>
    api.post(`/kafka/${id}/produce`, data, dbCfg(scope)),
};

// S3 / object-storage tool — see RFC §B.
export const s3ConnectionAPI = {
  list: (scope?: DBScope) => api.get('/s3-connections', dbCfg(scope)),
  create: (data: Record<string, unknown>, scope?: DBScope) =>
    api.post('/s3-connections', data, dbCfg(scope)),
  get: (id: string, scope?: DBScope) => api.get(`/s3-connections/${id}`, dbCfg(scope)),
  update: (id: string, data: Record<string, unknown>, scope?: DBScope) =>
    api.patch(`/s3-connections/${id}`, data, dbCfg(scope)),
  delete: (id: string, scope?: DBScope) => api.delete(`/s3-connections/${id}`, dbCfg(scope)),
  test: (id: string | null, data?: Record<string, unknown>, scope?: DBScope) =>
    id
      ? api.post(`/s3-connections/${id}/test`, undefined, testCfg(scope))
      : api.post('/s3-connections/test', data, testCfg(scope)),
  revealSecret: (id: string, scope?: DBScope) =>
    api.post(`/s3-connections/${id}/reveal-secret`, undefined, dbCfg(scope)),
  listGrants: (id: string, scope?: DBScope) => api.get(`/s3-connections/${id}/grants`, dbCfg(scope)),
  addGrant: (id: string, data: { subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' }, scope?: DBScope) =>
    api.post(`/s3-connections/${id}/grants`, data, dbCfg(scope)),
  deleteGrant: (id: string, grantId: string, scope?: DBScope) =>
    api.delete(`/s3-connections/${id}/grants/${grantId}`, dbCfg(scope)),
};

export const s3API = {
  buckets: (id: string, scope?: DBScope) => api.get(`/s3/${id}/buckets`, dbCfg(scope)),
  listObjects: (id: string, params: { bucket: string; prefix?: string; token?: string; max?: number }, scope?: DBScope) =>
    api.get(`/s3/${id}/objects`, { params, ...(scope ? { _executionPin: scope } : {}) }),
  objectMeta: (id: string, params: { bucket: string; key: string }, scope?: DBScope) =>
    api.get(`/s3/${id}/object/meta`, { params, ...(scope ? { _executionPin: scope } : {}) }),
  // getObjectUrl builds the raw streaming URL for preview/download (the
  // caller appends it to an <a>/fetch). For preview use a Range param.
  getObject: (id: string, params: { bucket: string; key: string; range?: string; download?: '1' }, scope?: DBScope) =>
    api.get(`/s3/${id}/object`, { params, responseType: 'blob', ...(scope ? { _executionPin: scope } : {}) }),
  putObject: (id: string, params: { bucket: string; key: string }, file: File, scope?: DBScope) => {
    const form = new FormData();
    form.append('file', file);
    return api.post(`/s3/${id}/object`, form, {
      params,
      headers: { 'Content-Type': 'multipart/form-data' },
      ...(scope ? { _executionPin: scope } : {}),
    });
  },
  copyObject: (id: string, data: { srcBucket: string; srcKey: string; dstBucket: string; dstKey: string; move?: boolean }, scope?: DBScope) =>
    api.post(`/s3/${id}/object/copy`, data, dbCfg(scope)),
  deleteObject: (id: string, params: { bucket: string; key: string }, scope?: DBScope) =>
    api.delete(`/s3/${id}/object`, { params, ...(scope ? { _executionPin: scope } : {}) }),
  createFolder: (id: string, data: { bucket: string; prefix: string }, scope?: DBScope) =>
    api.post(`/s3/${id}/folder`, data, dbCfg(scope)),
  presign: (id: string, data: { bucket: string; key: string; method: 'GET' | 'PUT'; ttlSec?: number }, scope?: DBScope) =>
    api.post(`/s3/${id}/presign`, data, dbCfg(scope)),
};

// Redis tool — see redis-impl-spec. Same DBScope dual-write routing as the
// DB / Kafka / S3 tools (data-node + sentinel passwords encrypted, per-BE
// pin). Paths + payload field names are the BE wire contract.
export const redisConnectionAPI = {
  list: (scope?: DBScope) => api.get('/redis-connections', dbCfg(scope)),
  create: (data: Record<string, unknown>, scope?: DBScope) =>
    api.post('/redis-connections', data, dbCfg(scope)),
  get: (id: string, scope?: DBScope) => api.get(`/redis-connections/${id}`, dbCfg(scope)),
  update: (id: string, data: Record<string, unknown>, scope?: DBScope) =>
    api.patch(`/redis-connections/${id}`, data, dbCfg(scope)),
  delete: (id: string, scope?: DBScope) => api.delete(`/redis-connections/${id}`, dbCfg(scope)),
  test: (id: string | null, data?: Record<string, unknown>, scope?: DBScope) =>
    id
      ? api.post(`/redis-connections/${id}/test`, undefined, testCfg(scope))
      : api.post('/redis-connections/test', data, testCfg(scope)),
  // which: 'password' | 'sentinelPassword' — owner-only reveal.
  revealSecret: (id: string, which: 'password' | 'sentinelPassword', scope?: DBScope) =>
    api.post(`/redis-connections/${id}/reveal-secret`, { which }, dbCfg(scope)),
  listGrants: (id: string, scope?: DBScope) => api.get(`/redis-connections/${id}/grants`, dbCfg(scope)),
  addGrant: (id: string, data: { subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' }, scope?: DBScope) =>
    api.post(`/redis-connections/${id}/grants`, data, dbCfg(scope)),
  deleteGrant: (id: string, grantId: string, scope?: DBScope) =>
    api.delete(`/redis-connections/${id}/grants/${grantId}`, dbCfg(scope)),
};

export const redisAPI = {
  // count = matching keys wanted per page (the BE keeps SCANning, within a
  // time budget, until that many match); smart=1 turns plain text into a
  // contains match (order → *order*) while explicit globs pass through.
  scanKeys: (id: string, params: { db?: number; match?: string; cursor?: number; count?: number; smart?: 0 | 1 }, scope?: DBScope) =>
    api.get(`/redis/${id}/keys`, { params, ...(scope ? { _executionPin: scope } : {}) }),
  keyMeta: (id: string, params: { db?: number; key: string }, scope?: DBScope) =>
    api.get(`/redis/${id}/key/meta`, { params, ...(scope ? { _executionPin: scope } : {}) }),
  getValue: (id: string, params: { db?: number; key: string; start?: number; stop?: number; cursor?: number }, scope?: DBScope) =>
    api.get(`/redis/${id}/key`, { params, ...(scope ? { _executionPin: scope } : {}) }),
  runCommand: (id: string, data: { db?: number; args: string[]; allowWrite?: boolean }, scope?: DBScope) =>
    api.post(`/redis/${id}/command`, data, dbCfg(scope)),
  pubsubPeek: (id: string, data: { channels?: string[]; pattern?: string; n: number }, scope?: DBScope) =>
    api.post(`/redis/${id}/pubsub/peek`, data, dbCfg(scope)),
  deleteKey: (id: string, params: { db?: number; key: string }, scope?: DBScope) =>
    api.delete(`/redis/${id}/key`, { params, ...(scope ? { _executionPin: scope } : {}) }),
  setTTL: (id: string, data: { db?: number; key: string; ttlSec: number }, scope?: DBScope) =>
    api.post(`/redis/${id}/key/expire`, data, dbCfg(scope)),
  // Write-gated (write grant + read-write switch). 409 = nothing removed
  // (element gone / list changed under the view). keyExists=false when the
  // removed element was the last one (Redis deletes empty collections).
  removeElement: (id: string, data: { db?: number; key: string } & RedisElementRef, scope?: DBScope) =>
    api.post(`/redis/${id}/key/element/remove`, data, dbCfg(scope)),
};

// Elasticsearch tool — see es-impl-spec. Same DBScope dual-write routing as
// the DB / Kafka / S3 / Redis tools (basic password / API key / bearer token
// encrypted, per-BE pin). Paths + payload field names are the BE wire
// contract. The BE is a thin authenticated HTTP forwarder.
export const esConnectionAPI = {
  list: (scope?: DBScope) => api.get('/es-connections', dbCfg(scope)),
  create: (data: Record<string, unknown>, scope?: DBScope) =>
    api.post('/es-connections', data, dbCfg(scope)),
  get: (id: string, scope?: DBScope) => api.get(`/es-connections/${id}`, dbCfg(scope)),
  update: (id: string, data: Record<string, unknown>, scope?: DBScope) =>
    api.patch(`/es-connections/${id}`, data, dbCfg(scope)),
  delete: (id: string, scope?: DBScope) => api.delete(`/es-connections/${id}`, dbCfg(scope)),
  test: (id: string | null, data?: Record<string, unknown>, scope?: DBScope) =>
    id
      ? api.post(`/es-connections/${id}/test`, undefined, testCfg(scope))
      : api.post('/es-connections/test', data, testCfg(scope)),
  // which: 'password' | 'apiKey' | 'bearer' | 'cookie' — owner-only reveal.
  revealSecret: (id: string, which: 'password' | 'apiKey' | 'bearer' | 'cookie', scope?: DBScope) =>
    api.post(`/es-connections/${id}/reveal-secret`, { which }, dbCfg(scope)),
  listGrants: (id: string, scope?: DBScope) => api.get(`/es-connections/${id}/grants`, dbCfg(scope)),
  addGrant: (id: string, data: { subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' }, scope?: DBScope) =>
    api.post(`/es-connections/${id}/grants`, data, dbCfg(scope)),
  deleteGrant: (id: string, grantId: string, scope?: DBScope) =>
    api.delete(`/es-connections/${id}/grants/${grantId}`, dbCfg(scope)),
};

// Grafana (Dashboards rail) — connections mirror esConnectionAPI; the data
// routes render dashboards natively from Grafana's HTTP API.
export const grafanaConnectionAPI = {
  list: (scope?: DBScope) => api.get('/grafana-connections', dbCfg(scope)),
  create: (data: Record<string, unknown>, scope?: DBScope) =>
    api.post('/grafana-connections', data, dbCfg(scope)),
  get: (id: string, scope?: DBScope) => api.get(`/grafana-connections/${id}`, dbCfg(scope)),
  update: (id: string, data: Record<string, unknown>, scope?: DBScope) =>
    api.patch(`/grafana-connections/${id}`, data, dbCfg(scope)),
  delete: (id: string, scope?: DBScope) => api.delete(`/grafana-connections/${id}`, dbCfg(scope)),
  test: (id: string | null, data?: Record<string, unknown>, scope?: DBScope) =>
    id
      ? api.post(`/grafana-connections/${id}/test`, undefined, dbCfg(scope, { timeout: 25000 }))
      : api.post('/grafana-connections/test', data, dbCfg(scope, { timeout: 25000 })),
  revealSecret: (id: string, which: 'token' | 'password' | 'session', scope?: DBScope) =>
    api.post(`/grafana-connections/${id}/reveal-secret`, { which }, dbCfg(scope)),
  listGrants: (id: string, scope?: DBScope) => api.get(`/grafana-connections/${id}/grants`, dbCfg(scope)),
  addGrant: (id: string, data: { subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' }, scope?: DBScope) =>
    api.post(`/grafana-connections/${id}/grants`, data, dbCfg(scope)),
  deleteGrant: (id: string, grantId: string, scope?: DBScope) =>
    api.delete(`/grafana-connections/${id}/grants/${grantId}`, dbCfg(scope)),
};

export const rabbitConnectionAPI = {
  list: (scope?: DBScope) => api.get('/rabbit-connections', dbCfg(scope)),
  create: (data: Record<string, unknown>, scope?: DBScope) =>
    api.post('/rabbit-connections', data, dbCfg(scope)),
  get: (id: string, scope?: DBScope) => api.get(`/rabbit-connections/${id}`, dbCfg(scope)),
  update: (id: string, data: Record<string, unknown>, scope?: DBScope) =>
    api.patch(`/rabbit-connections/${id}`, data, dbCfg(scope)),
  delete: (id: string, scope?: DBScope) => api.delete(`/rabbit-connections/${id}`, dbCfg(scope)),
  test: (id: string | null, data?: Record<string, unknown>, scope?: DBScope) =>
    id
      ? api.post(`/rabbit-connections/${id}/test`, undefined, dbCfg(scope, { timeout: 30000 }))
      : api.post('/rabbit-connections/test', data, dbCfg(scope, { timeout: 30000 })),
  revealSecret: (id: string, scope?: DBScope) =>
    api.post(`/rabbit-connections/${id}/reveal-secret`, {}, dbCfg(scope)),
  listGrants: (id: string, scope?: DBScope) => api.get(`/rabbit-connections/${id}/grants`, dbCfg(scope)),
  addGrant: (id: string, data: { subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' }, scope?: DBScope) =>
    api.post(`/rabbit-connections/${id}/grants`, data, dbCfg(scope)),
  deleteGrant: (id: string, grantId: string, scope?: DBScope) =>
    api.delete(`/rabbit-connections/${id}/grants/${grantId}`, dbCfg(scope)),
};

export const graylogConnectionAPI = {
  list: (scope?: DBScope) => api.get('/graylog-connections', dbCfg(scope)),
  create: (data: Record<string, unknown>, scope?: DBScope) =>
    api.post('/graylog-connections', data, dbCfg(scope)),
  get: (id: string, scope?: DBScope) => api.get(`/graylog-connections/${id}`, dbCfg(scope)),
  update: (id: string, data: Record<string, unknown>, scope?: DBScope) =>
    api.patch(`/graylog-connections/${id}`, data, dbCfg(scope)),
  delete: (id: string, scope?: DBScope) => api.delete(`/graylog-connections/${id}`, dbCfg(scope)),
  /** A saved connection may carry on-screen overrides (draft) so the edit dialog tests what it shows. */
  test: (id: string | null, data?: Record<string, unknown>, scope?: DBScope) =>
    id
      ? api.post(`/graylog-connections/${id}/test`, data, dbCfg(scope, { timeout: 30000 }))
      : api.post('/graylog-connections/test', data, dbCfg(scope, { timeout: 30000 })),
  revealSecret: (id: string, scope?: DBScope) =>
    api.post(`/graylog-connections/${id}/reveal-secret`, {}, dbCfg(scope)),
  listGrants: (id: string, scope?: DBScope) => api.get(`/graylog-connections/${id}/grants`, dbCfg(scope)),
  addGrant: (id: string, data: { subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' }, scope?: DBScope) =>
    api.post(`/graylog-connections/${id}/grants`, data, dbCfg(scope)),
  deleteGrant: (id: string, grantId: string, scope?: DBScope) =>
    api.delete(`/graylog-connections/${id}/grants/${grantId}`, dbCfg(scope)),
};

export interface GraylogSearchParams {
  query: string;
  range: import('@/types').GraylogRange;
  streams?: string[];
  limit?: number;
  offset?: number;
  sort?: 'asc' | 'desc';
  noHistogram?: boolean;
}

export const graylogAPI = {
  streams: (id: string, scope?: DBScope) => api.get(`/graylog/${id}/streams`, dbCfg(scope)),
  search: (id: string, params: GraylogSearchParams, scope?: DBScope) =>
    api.post(`/graylog/${id}/search`, params, dbCfg(scope, { timeout: 70000 })),
  views: (id: string, query?: string, scope?: DBScope) =>
    api.get(`/graylog/${id}/views`, dbCfg(scope, query ? { params: { query } } : undefined)),
};

export const observabilityConnectionAPI = {
  providers: (scope?: DBScope) => api.get('/observability-providers', dbCfg(scope)),
  list: (scope?: DBScope) => api.get('/observability-connections', dbCfg(scope)),
  create: (data: Record<string, unknown>, scope?: DBScope) =>
    api.post('/observability-connections', data, dbCfg(scope)),
  update: (id: string, data: Record<string, unknown>, scope?: DBScope) =>
    api.patch(`/observability-connections/${id}`, data, dbCfg(scope)),
  delete: (id: string, scope?: DBScope) => api.delete(`/observability-connections/${id}`, dbCfg(scope)),
  test: (id: string | null, data?: Record<string, unknown>, scope?: DBScope) =>
    id
      ? api.post(`/observability-connections/${id}/test`, undefined, dbCfg(scope, { timeout: 30000 }))
      : api.post('/observability-connections/test', data, dbCfg(scope, { timeout: 30000 })),
  scopes: (id: string, scope?: DBScope) => api.get(`/observability-connections/${id}/scopes`, dbCfg(scope, { timeout: 25000 })),
  revealSecret: (id: string, which: 'password' | 'token' | 'apiKey' | 'appKey' | 'session', scope?: DBScope) =>
    api.post(`/observability-connections/${id}/reveal-secret`, { which }, dbCfg(scope)),
  listGrants: (id: string, scope?: DBScope) => api.get(`/observability-connections/${id}/grants`, dbCfg(scope)),
  addGrant: (id: string, data: { subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' }, scope?: DBScope) =>
    api.post(`/observability-connections/${id}/grants`, data, dbCfg(scope)),
  deleteGrant: (id: string, grantId: string, scope?: DBScope) =>
    api.delete(`/observability-connections/${id}/grants/${grantId}`, dbCfg(scope)),
};

/** Sources of one service map: a K8s connection and/or observability
 *  connections (`apm` entries are id or id@scope). */
export interface ServiceMapParams {
  k8s?: string;
  context?: string;
  namespaces?: string[];
  clusterProm?: boolean;
  apm?: string[];
  range?: string;
  fresh?: boolean;
}

export const serviceMapAPI = {
  get: (p: ServiceMapParams, scope?: DBScope) =>
    api.get('/service-map', dbCfg(scope, {
      timeout: 60000,
      params: {
        ...(p.k8s ? { k8s: p.k8s } : {}),
        ...(p.context ? { context: p.context } : {}),
        ...(p.namespaces?.length ? { namespaces: p.namespaces.join(',') } : {}),
        ...(p.clusterProm ? { clusterProm: '1' } : {}),
        ...(p.apm?.length ? { apm: p.apm.join(',') } : {}),
        range: p.range || '15m',
        ...(p.fresh ? { fresh: '1' } : {}),
      },
    })),
};

/** List knobs of the RabbitMQ queue / exchange / connection lists. */
export interface RabbitListParams {
  vhost?: string; page?: number; pageSize?: number; name?: string; regex?: boolean; sort?: string; reverse?: boolean;
}

function rabbitListQuery(p: RabbitListParams = {}): Record<string, string> {
  const q: Record<string, string> = {};
  if (p.vhost) q.vhost = p.vhost;
  if (p.page) q.page = String(p.page);
  if (p.pageSize) q.pageSize = String(p.pageSize);
  if (p.name) { q.name = p.name; if (p.regex) q.regex = '1'; }
  if (p.sort) { q.sort = p.sort; if (p.reverse) q.reverse = '1'; }
  return q;
}

// RabbitMQ broker operations. vhost / names travel as query params or in the
// body (a path segment would lose the default vhost's "%2F").
export const rabbitAPI = {
  overview: (id: string, scope?: DBScope) => api.get(`/rabbit/${id}/overview`, dbCfg(scope)),
  queues: (id: string, p: RabbitListParams, scope?: DBScope) =>
    api.get(`/rabbit/${id}/queues`, dbCfg(scope, { params: rabbitListQuery(p) })),
  queue: (id: string, vhost: string, name: string, scope?: DBScope) =>
    api.get(`/rabbit/${id}/queue`, dbCfg(scope, { params: { vhost, name } })),
  exchanges: (id: string, p: RabbitListParams, scope?: DBScope) =>
    api.get(`/rabbit/${id}/exchanges`, dbCfg(scope, { params: rabbitListQuery(p) })),
  exchange: (id: string, vhost: string, name: string, scope?: DBScope) =>
    api.get(`/rabbit/${id}/exchange`, dbCfg(scope, { params: { vhost, name } })),
  topology: (id: string, vhost: string, scope?: DBScope) =>
    api.get(`/rabbit/${id}/topology`, dbCfg(scope, { params: { vhost } })),
  connections: (id: string, p: RabbitListParams, scope?: DBScope) =>
    api.get(`/rabbit/${id}/connections`, dbCfg(scope, { params: rabbitListQuery(p) })),
  channels: (id: string, p: RabbitListParams, scope?: DBScope) =>
    api.get(`/rabbit/${id}/channels`, dbCfg(scope, { params: rabbitListQuery(p) })),
  consumers: (id: string, vhost: string, scope?: DBScope) =>
    api.get(`/rabbit/${id}/consumers`, dbCfg(scope, { params: vhost ? { vhost } : undefined })),
  getMessages: (id: string, data: { vhost: string; queue: string; count: number; remove?: boolean; truncate?: number }, scope?: DBScope) =>
    api.post(`/rabbit/${id}/messages/get`, data, dbCfg(scope, { timeout: 60000 })),
  streamRead: (id: string, data: { vhost: string; queue: string; offset: string; count: number }, scope?: DBScope) =>
    api.post(`/rabbit/${id}/messages/stream`, data, dbCfg(scope, { timeout: 30000 })),
  publish: (id: string, data: {
    vhost: string; exchange: string; routingKey: string; payload: string; payloadEncoding?: 'string' | 'base64';
    properties?: Record<string, unknown>;
  }, scope?: DBScope) => api.post(`/rabbit/${id}/publish`, data, dbCfg(scope)),
  purge: (id: string, vhost: string, queue: string, scope?: DBScope) =>
    api.post(`/rabbit/${id}/purge`, { vhost, queue }, dbCfg(scope)),
  move: (id: string, data: {
    vhost: string; source: string; target: 'queue' | 'exchange' | 'origin';
    targetQueue?: string; targetExchange?: string; targetRoutingKey?: string; count: number;
  }, scope?: DBScope) => api.post(`/rabbit/${id}/move`, data, dbCfg(scope, { timeout: 310000 })),
  createQueue: (id: string, data: { vhost: string; name: string; durable: boolean; autoDelete: boolean; arguments: Record<string, unknown> }, scope?: DBScope) =>
    api.post(`/rabbit/${id}/queue`, data, dbCfg(scope)),
  deleteQueue: (id: string, vhost: string, name: string, opts: { ifEmpty?: boolean; ifUnused?: boolean } = {}, scope?: DBScope) =>
    api.delete(`/rabbit/${id}/queue`, dbCfg(scope, { params: { vhost, name, ...(opts.ifEmpty ? { ifEmpty: '1' } : {}), ...(opts.ifUnused ? { ifUnused: '1' } : {}) } })),
  createExchange: (id: string, data: { vhost: string; name: string; type: string; durable: boolean; autoDelete: boolean; internal: boolean; arguments: Record<string, unknown> }, scope?: DBScope) =>
    api.post(`/rabbit/${id}/exchange`, data, dbCfg(scope)),
  deleteExchange: (id: string, vhost: string, name: string, scope?: DBScope) =>
    api.delete(`/rabbit/${id}/exchange`, dbCfg(scope, { params: { vhost, name } })),
  bind: (id: string, data: { vhost: string; source: string; destination: string; destinationType: 'queue' | 'exchange'; routingKey: string; arguments?: Record<string, unknown> }, scope?: DBScope) =>
    api.post(`/rabbit/${id}/bindings`, data, dbCfg(scope)),
  unbind: (id: string, data: { vhost: string; source: string; destination: string; destinationType: 'queue' | 'exchange'; routingKey: string; propertiesKey?: string }, scope?: DBScope) =>
    api.post(`/rabbit/${id}/bindings/delete`, data, dbCfg(scope)),
  closeConnection: (id: string, name: string, reason: string, scope?: DBScope) =>
    api.post(`/rabbit/${id}/connections/close`, { name, reason }, dbCfg(scope)),
  /** Absolute SSE URL of a live exchange tail (same routing rules as the K8s watch). */
  tailUrl: (id: string, params: { vhost: string; exchange: string; routingKey: string; arguments?: string }, scope?: DBScope): string => {
    const useLocal = scope === 'local' && isDesktop();
    let base: string;
    if (useLocal) {
      const local = getLocalApiUrl();
      base = local ? `${local}/api` : getRemoteBaseUrl();
    } else {
      base = getRemoteBaseUrl().startsWith('/') && typeof window !== 'undefined'
        ? window.location.origin + getRemoteBaseUrl()
        : getRemoteBaseUrl();
    }
    const qs = new URLSearchParams({ vhost: params.vhost, exchange: params.exchange, routingKey: params.routingKey });
    if (params.arguments) qs.set('arguments', params.arguments);
    if (!useLocal) {
      const token = localStorage.getItem('patchman_token');
      if (token) qs.set('token', token);
    }
    return `${base}/rabbit/${id}/tail?${qs.toString()}`;
  },
};

export const grafanaAPI = {
  info: (id: string, scope?: DBScope) => api.get(`/grafana/${id}/info`, dbCfg(scope)),
  search: (id: string, query: string, scope?: DBScope) =>
    api.get(`/grafana/${id}/search`, dbCfg(scope, { params: query ? { query } : undefined })),
  dashboard: (id: string, uid: string, scope?: DBScope) =>
    api.get(`/grafana/${id}/dashboards/${encodeURIComponent(uid)}`, dbCfg(scope)),
  variables: (
    id: string,
    data: { templating: unknown[]; selected: Record<string, { values: string[] }>; from: string; to: string },
    scope?: DBScope,
    signal?: AbortSignal,
  ) => api.post(`/grafana/${id}/variables`, data, dbCfg(scope, { signal })),
  query: (
    id: string,
    data: {
      from: string; to: string; targets: unknown[]; panelDatasource?: unknown;
      vars?: Record<string, unknown>; maxDataPoints?: number; minInterval?: string;
      /** 'explore' for ad-hoc queries (audited); omitted for panel queries. */
      source?: 'explore';
    },
    scope?: DBScope,
    signal?: AbortSignal,
  ) => api.post(`/grafana/${id}/query`, data, dbCfg(scope, { signal })),
  resource: (id: string, dsUid: string, path: string, params: Record<string, string> = {}, scope?: DBScope) =>
    api.get(`/grafana/${id}/ds/${encodeURIComponent(dsUid)}/resource`, dbCfg(scope, { params: { path, ...params } })),
  /** Public (shared-by-link) dashboard: no sign-in, no variables. */
  publicDashboard: (id: string, token: string, scope?: DBScope) =>
    api.get(`/grafana/${id}/public/${encodeURIComponent(token)}`, dbCfg(scope)),
  publicPanelQuery: (
    id: string, token: string, panelId: number,
    data: { from: string; to: string; maxDataPoints?: number },
    scope?: DBScope, signal?: AbortSignal,
  ) => api.post(`/grafana/${id}/public/${encodeURIComponent(token)}/panels/${panelId}/query`, data, dbCfg(scope, { signal })),
};

// Excalidraw whiteboards. Plain `api` instance (no scope pin) — whiteboards live
// on the active backend (remote when synced, embedded on desktop-local), which
// resolveBaseURL() already picks. list() omits the scene body; get() returns it.
// Hands the signed-in user's cloud session to the embedded (desktop) backend so
// its whiteboard MCP tools can act on the hosted account as the user (see
// WHITEBOARD_UNIFIED_LOCAL_RFC.md). Pinned to 'local' (the interceptor drops the
// Authorization header there — the cloud token travels in the BODY, not a
// header). Desktop-only; embedded-only route (404 elsewhere, harmless).
export const cloudSessionAPI = {
  set: (baseUrl: string, token: string) =>
    api.post('/cloud-session', { baseUrl, token }, { _executionPin: 'local' }),
  clear: () => api.delete('/cloud-session', { _executionPin: 'local' }),
};

export const whiteboardAPI = {
  // `scope` pins the read to a specific backend via _executionPin: pass 'local'
  // to list/read the on-device (embedded) boards even while signed in to the
  // cloud — used by the sidebar's "On this device" section.
  list: (scope?: DBScope) => api.get('/whiteboards', dbCfg(scope)),
  get: (id: string, scope?: DBScope) => api.get(`/whiteboards/${id}`, dbCfg(scope)),
  create: (data: { id?: string; name: string; scene?: string; parentId?: string | null; type?: 'whiteboard' | 'folder'; sortOrder?: number }) =>
    api.post('/whiteboards', data),
  update: (id: string, data: { name?: string; scene?: string; parentId?: string | null; sortOrder?: number }) =>
    api.patch(`/whiteboards/${id}`, data),
  delete: (id: string) => api.delete(`/whiteboards/${id}`),
  listShared: () => api.get('/whiteboards/shared'),
  // Atomically fetch + clear diagrams queued for this board by the MCP
  // draw_on_whiteboard tool. The canvas renders each onto the scene.
  drainDiagrams: (id: string) => api.post(`/whiteboards/${id}/diagrams/drain`),
  // Import boards into the signed-in cloud account (used to move an on-device
  // board to the cloud). Reuses /sync/initial-push, which forces the authed
  // user + private visibility + re-roots any parent it can't verify. Always
  // targets the remote backend.
  importToCloud: (boards: Array<Record<string, unknown>>) =>
    api.post('/sync/initial-push', {
      collections: [], requests: [], environments: [], cookies: [],
      testCases: [], testPlans: [], defects: [], requirements: [],
      sharedSteps: [], mockServers: [], mockRoutes: [],
      whiteboards: boards,
    }, { _executionPin: 'remote' }),
};

// Whiteboard sharing — mirrors collectionSharingAPI (visibility + grants) and
// adds no-account public links. `role` on a link is 'viewer' (read-only) or
// 'editor' (anonymous read-write). Shares the PublicSharingPanel grant surface.
export const whiteboardSharingAPI = {
  setVisibility: (id: string, visibility: 'public' | 'private') =>
    api.patch(`/whiteboards/${id}/visibility`, { visibility }),
  listGrants: (id: string) => api.get(`/whiteboards/${id}/grants`),
  addGrant: (id: string, g: { role: 'editor' | 'viewer'; subjectKind: 'user' | 'team' | 'everyone'; subjectId?: string }) =>
    api.post(`/whiteboards/${id}/grants`, g),
  deleteGrant: (id: string, grantId: string) => api.delete(`/whiteboards/${id}/grants/${grantId}`),
  listLinks: (id: string) => api.get(`/whiteboards/${id}/links`),
  createLink: (id: string, role: 'viewer' | 'editor') => api.post(`/whiteboards/${id}/links`, { role }),
  revokeLink: (id: string, linkId: string) => api.delete(`/whiteboards/${id}/links/${linkId}`),
};

// Notes knowledge base — markdown pages/folders, history, images, search.
export const notesAPI = {
  list: () => api.get('/notes'),
  listShared: () => api.get('/notes/shared'),
  get: (id: string) => api.get(`/notes/${id}`),
  create: (data: { id?: string; parentId?: string | null; type?: 'page' | 'folder' | 'card'; title: string; body?: string; icon?: string; sortOrder?: number; summary?: string; memory?: boolean }) =>
    api.post('/notes', data),
  // title/body edits must carry baseVersion (409 + `current` when stale).
  update: (id: string, data: { title?: string; body?: string; baseVersion?: number; icon?: string; parentId?: string | null; sortOrder?: number; summary?: string; stale?: boolean; memory?: boolean }) =>
    api.patch(`/notes/${id}`, data),
  remove: (id: string) => api.delete(`/notes/${id}`),
  revisions: (id: string) => api.get(`/notes/${id}/revisions`),
  revision: (id: string, revId: string) => api.get(`/notes/${id}/revisions/${revId}`),
  restore: (id: string, revId: string) => api.post(`/notes/${id}/revisions/${revId}/restore`),
  backlinks: (id: string) => api.get(`/notes/${id}/backlinks`),
  // Claude Memory: typed links, memory folders + settings, suggestions.
  links: (id: string) => api.get(`/notes/${id}/links`),
  addLink: (id: string, dst: string, type: string) => api.post(`/notes/${id}/links`, { dst, type }),
  deleteLink: (id: string, dst: string, type: string) => api.delete(`/notes/${id}/links`, { params: { dst, type } }),
  linksByUri: (uri: string) => api.get('/notes/links/by-uri', { params: { uri } }),
  memory: () => api.get('/notes/memory'),
  memoryGraph: (root?: string) => api.get('/notes/memory/graph', { params: root ? { root } : {} }),
  updateMemorySettings: (s: { teamFolderId?: string; llmProviderId?: string; llmModel?: string }) => api.put('/notes/memory/settings', s),
  suggestions: (folderId?: string) => api.get('/notes/suggestions', { params: folderId ? { folderId } : {} }),
  acceptSuggestion: (id: string, overrides?: { title?: string; summary?: string; body?: string }) =>
    api.post(`/notes/suggestions/${id}/accept`, overrides ?? {}),
  rejectSuggestion: (id: string) => api.post(`/notes/suggestions/${id}/reject`),
  search: (q: string, limit?: number) => api.get('/notes/search', { params: { q, limit } }),
  uploadAttachment: (id: string, file: File | Blob, fileName = 'image.png') => {
    const form = new FormData();
    form.append('file', file, fileName);
    return api.post(`/notes/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  attachment: (attId: string) => api.get(`/notes/attachments/${attId}`, { responseType: 'blob' }),
};

export const noteSharingAPI = {
  setVisibility: (id: string, visibility: 'public' | 'private') => api.patch(`/notes/${id}/visibility`, { visibility }),
  listGrants: (id: string) => api.get(`/notes/${id}/grants`),
  addGrant: (id: string, g: { role: 'editor' | 'viewer'; subjectKind: 'user' | 'team' | 'everyone'; subjectId?: string }) =>
    api.post(`/notes/${id}/grants`, g),
  deleteGrant: (id: string, grantId: string) => api.delete(`/notes/${id}/grants/${grantId}`),
};

// Anonymous (no-account) whiteboard access by link token. Hits the unauthed
// /api/public/whiteboards/:token routes; get returns { scene, role }, update
// works only for an editor link.
export const whiteboardPublicAPI = {
  get: (token: string) => api.get(`/public/whiteboards/${token}`),
  update: (token: string, scene: string) => api.patch(`/public/whiteboards/${token}`, { scene }),
  // A folder link's `get` returns the folder tree (`type: 'folder'`, `items`);
  // its boards are opened and saved by id under the same token.
  getBoard: (token: string, boardId: string) => api.get(`/public/whiteboards/${token}/boards/${boardId}`),
  updateBoard: (token: string, boardId: string, scene: string) =>
    api.patch(`/public/whiteboards/${token}/boards/${boardId}`, { scene }),
};

export const esAPI = {
  cluster: (id: string, scope?: DBScope) => api.get(`/es/${id}/cluster`, dbCfg(scope)),
  indices: (id: string, scope?: DBScope) => api.get(`/es/${id}/indices`, dbCfg(scope)),
  aliases: (id: string, scope?: DBScope) => api.get(`/es/${id}/aliases`, dbCfg(scope)),
  mapping: (id: string, index: string, scope?: DBScope) =>
    api.get(`/es/${id}/mapping`, { params: { index }, ...(scope ? { _executionPin: scope } : {}) }),
  request: (
    id: string,
    data: { method: string; path: string; body?: unknown; allowWrite?: boolean },
    scope?: DBScope,
  ) => api.post(`/es/${id}/request`, data, dbCfg(scope)),
};

// Kubernetes tool — see k8s-v1-impl-spec. Connection CRUD dual-writes with
// the same DBScope routing as the other tools (the whole kubeconfig YAML is
// AES-GCM encrypted per-BE; ciphertext is never dual-written). Live cluster
// reads are single-routed to a reachable BE via dbCfg(scope). Paths + payload
// field names are the BE wire contract. v1 is READ ONLY.
export const k8sConnectionAPI = {
  list: (scope?: DBScope) => api.get('/k8s-connections', dbCfg(scope)),
  create: (data: Record<string, unknown>, scope?: DBScope) =>
    api.post('/k8s-connections', data, dbCfg(scope)),
  get: (id: string, scope?: DBScope) => api.get(`/k8s-connections/${id}`, dbCfg(scope)),
  update: (id: string, data: Record<string, unknown>, scope?: DBScope) =>
    api.patch(`/k8s-connections/${id}`, data, dbCfg(scope)),
  delete: (id: string, scope?: DBScope) => api.delete(`/k8s-connections/${id}`, dbCfg(scope)),
  test: (id: string | null, data?: Record<string, unknown>, scope?: DBScope) =>
    id
      ? api.post(`/k8s-connections/${id}/test`, undefined, testCfg(scope))
      : api.post('/k8s-connections/test', data, testCfg(scope)),
  // owner-only reveal of the stored kubeconfig ({} -> {kubeconfig}).
  revealSecret: (id: string, scope?: DBScope) =>
    api.post(`/k8s-connections/${id}/reveal-secret`, {}, dbCfg(scope)),
  listGrants: (id: string, scope?: DBScope) => api.get(`/k8s-connections/${id}/grants`, dbCfg(scope)),
  addGrant: (id: string, data: { subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' }, scope?: DBScope) =>
    api.post(`/k8s-connections/${id}/grants`, data, dbCfg(scope)),
  deleteGrant: (id: string, grantId: string, scope?: DBScope) =>
    api.delete(`/k8s-connections/${id}/grants/${grantId}`, dbCfg(scope)),
};

// v2 write/exec DTOs — mirror the BE k8sclient types.go additions.
export interface K8sAccessCheck {
  verb: string;
  group?: string;
  resource: string;
  namespace?: string;
  name?: string;
}
export interface K8sApplyResult {
  applied: unknown;
  diff: string;
  conflicts: string[];
  dryRun: boolean;
}
// K8s v3 port-forward record — mirrors the BE activeForward JSON. `address` is
// always "127.0.0.1:<localPort>" (localPort is the actual bound port, resolved
// after an auto-assign when the request left it 0).
export interface K8sPortForward {
  id: string;
  namespace: string;
  name: string;
  targetPort: number;
  localPort: number;
  address: string;
}

// aiShellAPI drives the in-app "Claude Code" terminal — a PTY running the
// locally-installed `claude` CLI, bridged over a WebSocket. Desktop (embedded)
// only; the status probe lets the UI render the right state before connecting.
export const aiShellAPI = {
  status: (scope?: DBScope) =>
    api.get<{ available: boolean; desktop: boolean }>('/ai/claude-status', { ...(scope ? { _executionPin: scope } : {}) }),
  // Absolute WebSocket URL to the local embedded BE (http→ws), no token — the
  // embedded BE trusts localhost, exactly like the K8s local-shell bridge.
  shellUrl: (): { url: string } => {
    const local = getLocalApiUrl();
    const base = local ? `${local}/api` : getRemoteBaseUrl();
    const wsBase = base.replace(/^http/i, 'ws');
    return { url: `${wsBase}/ai/claude-shell` };
  },
};

export const k8sAPI = {
  // contexts is a read that parses the stored kubeconfig — no cluster call.
  contexts: (id: string, scope?: DBScope) => api.get(`/k8s/${id}/contexts`, dbCfg(scope)),
  version: (id: string, context: string, scope?: DBScope) =>
    api.get(`/k8s/${id}/version`, { params: { context }, ...(scope ? { _executionPin: scope } : {}) }),
  // Cluster Overview (Lens-style dashboard) — one aggregate snapshot for the
  // selected context (node/pod/workload/networking counts + event totals +
  // optional metrics-server CPU/mem). Returns ClusterOverview (axios unwraps
  // the outer { data }).
  overview: (id: string, params: { context: string }, scope?: DBScope) =>
    api.get<ClusterOverview>(`/k8s/${id}/overview`, { params, ...(scope ? { _executionPin: scope } : {}) }),
  // Live pod CPU/memory usage from metrics-server (kubectl-top style). Namespaced
  // when namespace is set, cluster-wide otherwise. Returns K8sPodMetricsResult;
  // { available:false, reason } when metrics-server isn't installed/ready.
  podMetrics: (id: string, params: { context: string; namespace?: string }, scope?: DBScope) =>
    api.get<K8sPodMetricsResult>(`/k8s/${id}/pod-metrics`, { params, ...(scope ? { _executionPin: scope } : {}) }),
  // Historical per-pod CPU/memory from an in-cluster Prometheus (via the
  // kube-apiserver service-proxy). { available:false } ⇒ no Prometheus found,
  // caller falls back to the live podMetrics snapshot. range ∈ 15m|1h|6h|24h.
  podMetricsHistory: (
    id: string,
    params: { context: string; namespace: string; pod: string; range: string },
    scope?: DBScope,
  ) =>
    api.get<K8sPodMetricsHistoryResult>(`/k8s/${id}/pod-metrics-history`, { params, ...(scope ? { _executionPin: scope } : {}) }),
  resources: (id: string, params: { context: string; namespace?: string; kind: string }, scope?: DBScope) =>
    api.get(`/k8s/${id}/resources`, { params, ...(scope ? { _executionPin: scope } : {}) }),
  resource: (id: string, params: { context: string; namespace?: string; kind: string; name: string }, scope?: DBScope) =>
    api.get(`/k8s/${id}/resource`, { params, ...(scope ? { _executionPin: scope } : {}) }),
  // A workload's matched pods + rollout revisions (Deployment ReplicaSets /
  // StatefulSet+DaemonSet ControllerRevisions) for its detail drawer.
  related: (id: string, params: { context: string; namespace?: string; kind: string; name: string }, scope?: DBScope) =>
    api.get(`/k8s/${id}/related`, { params, ...(scope ? { _executionPin: scope } : {}) }),
  // logsUrl builds the absolute SSE stream URL the streaming-fetch reader
  // consumes (pod logs). Routed by scope the same way axios resolves its
  // baseURL: local pin hits the embedded BE (LocalUserAuth, no token);
  // otherwise the remote BE with the token as a query param (EventSource /
  // fetch can't set an Authorization header cross-origin in the Tauri shell).
  logsUrl: (
    id: string,
    // tailLines 'all' = the whole log (BE-capped) for downloads; previous = the
    // last terminated container instance (kubectl logs -p); sinceTime (the
    // newest RFC3339Nano line timestamp seen) resumes a dropped follow stream.
    params: { context: string; namespace?: string; pod: string; container?: string; follow?: boolean; tailLines?: number | 'all'; timestamps?: boolean; previous?: boolean; sinceTime?: string },
    scope?: DBScope,
  ): { url: string; scope?: DBScope } => {
    const useLocal = scope === 'local' && isDesktop();
    let base: string;
    if (useLocal) {
      const local = getLocalApiUrl();
      base = local ? `${local}/api` : getRemoteBaseUrl();
    } else {
      base = getRemoteBaseUrl().startsWith('/') && typeof window !== 'undefined'
        ? window.location.origin + getRemoteBaseUrl()
        : getRemoteBaseUrl();
    }
    const qs = new URLSearchParams();
    qs.set('context', params.context);
    if (params.namespace) qs.set('namespace', params.namespace);
    qs.set('pod', params.pod);
    if (params.container) qs.set('container', params.container);
    if (params.follow) qs.set('follow', '1');
    if (params.tailLines != null) qs.set('tailLines', String(params.tailLines));
    if (params.timestamps) qs.set('timestamps', '1');
    if (params.previous) qs.set('previous', '1');
    if (params.sinceTime) qs.set('sinceTime', params.sinceTime);
    if (!useLocal) {
      const token = localStorage.getItem('patchman_token');
      if (token) qs.set('token', token);
    }
    return { url: `${base}/k8s/${id}/logs?${qs.toString()}`, scope };
  },

  // watchUrl builds the absolute SSE stream URL the streaming-fetch reader
  // consumes for a live resource WATCH (one watch per selected
  // connection+context+namespace+kind). Scope routing + token-as-query-param
  // are identical to logsUrl: local pin hits the embedded BE (LocalUserAuth,
  // no token); otherwise the remote BE with the token as a query param (fetch
  // can't set an Authorization header cross-origin in the Tauri shell). The BE
  // emits `event: <sync|added|modified|deleted|reconnect>` frames — `sync`
  // carries `{ resourceVersion, rows: ResourceRow[] }`, the add/mod/del frames
  // each carry a single normalized ResourceRow.
  watchUrl: (
    id: string,
    params: { context: string; namespace?: string; kind: string },
    scope?: DBScope,
  ): { url: string; scope?: DBScope } => {
    const useLocal = scope === 'local' && isDesktop();
    let base: string;
    if (useLocal) {
      const local = getLocalApiUrl();
      base = local ? `${local}/api` : getRemoteBaseUrl();
    } else {
      base = getRemoteBaseUrl().startsWith('/') && typeof window !== 'undefined'
        ? window.location.origin + getRemoteBaseUrl()
        : getRemoteBaseUrl();
    }
    const qs = new URLSearchParams();
    qs.set('context', params.context);
    if (params.namespace) qs.set('namespace', params.namespace);
    qs.set('kind', params.kind);
    if (!useLocal) {
      const token = localStorage.getItem('patchman_token');
      if (token) qs.set('token', token);
    }
    return { url: `${base}/k8s/${id}/watch?${qs.toString()}`, scope };
  },

  // execUrl builds the absolute WebSocket URL for the interactive pod-exec
  // bridge (v2). It mirrors logsUrl's scope routing exactly, then swaps the
  // http(s) scheme for ws(s): `http://…`→`ws://…`, `https://…`→`wss://…`
  // (the leading-"http"→"ws" replace turns the trailing "s" of "https" into
  // the "s" of "wss"). The base is always absolute (see logsUrl), so the ws
  // URL is too — a bare WebSocket can't resolve a relative path. Auth rides
  // as a `token` query param for the same reason logs does: the WebSocket
  // handshake can't set an Authorization header in the Tauri shell. The
  // embedded BE (local scope) uses LocalUserAuth, so no token there.
  execUrl: (
    id: string,
    params: { context: string; namespace?: string; pod: string; container?: string; tty?: boolean; command?: string[] },
    scope?: DBScope,
  ): { url: string; scope?: DBScope } => {
    const useLocal = scope === 'local' && isDesktop();
    let base: string;
    if (useLocal) {
      const local = getLocalApiUrl();
      base = local ? `${local}/api` : getRemoteBaseUrl();
    } else {
      base = getRemoteBaseUrl().startsWith('/') && typeof window !== 'undefined'
        ? window.location.origin + getRemoteBaseUrl()
        : getRemoteBaseUrl();
    }
    const wsBase = base.replace(/^http/i, 'ws');
    const qs = new URLSearchParams();
    qs.set('context', params.context);
    if (params.namespace) qs.set('namespace', params.namespace);
    qs.set('pod', params.pod);
    if (params.container) qs.set('container', params.container);
    if (params.tty) qs.set('tty', '1');
    for (const c of params.command ?? []) qs.append('command', c);
    if (!useLocal) {
      const token = localStorage.getItem('patchman_token');
      if (token) qs.set('token', token);
    }
    return { url: `${wsBase}/k8s/${id}/exec?${qs.toString()}`, scope };
  },

  // localShellUrl builds the WebSocket URL for the K8s v3 local-kubeconfig
  // terminal: a login shell on the USER'S OWN machine with KUBECONFIG pointed
  // at this connection+context. Unlike execUrl this is LOCAL SCOPE ONLY — the
  // BE handler 403s unless it runs embedded, so we always route to the
  // embedded BE (and the caller only offers this on desktop-local
  // connections). Same ws(s) scheme swap + framing as execUrl; no pod /
  // container / command — just the context. The embedded BE uses
  // LocalUserAuth, so no token query param is needed.
  localShellUrl: (
    id: string,
    params: { context: string },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept so callers can pass a scope like the other URL builders
    _scope?: DBScope,
  ): { url: string; scope: DBScope } => {
    const local = getLocalApiUrl();
    const base = local ? `${local}/api` : getRemoteBaseUrl();
    const wsBase = base.replace(/^http/i, 'ws');
    const qs = new URLSearchParams();
    qs.set('context', params.context);
    return { url: `${wsBase}/k8s/${id}/local-shell?${qs.toString()}`, scope: 'local' };
  },

  // ── v2 write ops (all require the write grant BE-side) ────────────────
  // Server-Side Apply. dryRun:true returns the field-level diff + any
  // ownership conflicts without mutating; dryRun:false commits; force:true
  // steals conflicting fields (gate it behind the type-to-confirm).
  apply: (
    id: string,
    data: { context: string; yaml: string; dryRun?: boolean; force?: boolean },
    scope?: DBScope,
  ) => api.post<K8sApplyResult>(`/k8s/${id}/apply`, data, dbCfg(scope)),
  scale: (
    id: string,
    data: { context: string; kind: string; namespace?: string; name: string; replicas: number },
    scope?: DBScope,
  ) => api.post(`/k8s/${id}/scale`, data, dbCfg(scope)),
  // stamp is an FE-supplied ISO timestamp (scripts/BE can't call time.Now()
  // deterministically) written to the restartedAt pod-template annotation.
  rolloutRestart: (
    id: string,
    data: { context: string; kind: string; namespace?: string; name: string; stamp: string },
    scope?: DBScope,
  ) => api.post(`/k8s/${id}/rollout-restart`, data, dbCfg(scope)),
  // DELETE with a body — the target is identified by kind/ns/name, not path.
  deleteResource: (
    id: string,
    data: { context: string; kind: string; namespace?: string; name: string },
    scope?: DBScope,
  ) => api.delete(`/k8s/${id}/resource`, dbCfg(scope, { data })),
  cordon: (
    id: string,
    data: { context: string; node: string; on: boolean },
    scope?: DBScope,
  ) => api.post(`/k8s/${id}/cordon`, data, dbCfg(scope)),
  drain: (
    id: string,
    data: { context: string; node: string },
    scope?: DBScope,
  ) => api.post<{ evicted: string[] }>(`/k8s/${id}/drain`, data, dbCfg(scope)),
  // stamp suffixes the manually-created Job name.
  cronjobTrigger: (
    id: string,
    data: { context: string; namespace?: string; name: string; stamp: string },
    scope?: DBScope,
  ) => api.post(`/k8s/${id}/cronjob/trigger`, data, dbCfg(scope)),
  // RBAC preflight — a read used to gate the write UI. Returns one bool per
  // check, positionally aligned with the input.
  canI: (
    id: string,
    data: { context: string; checks: K8sAccessCheck[] },
    scope?: DBScope,
  ) => api.post<{ results: boolean[] }>(`/k8s/${id}/can-i`, data, dbCfg(scope)),

  // ── K8s v3 port-forward (local-BE only) ──────────────────────────────
  // Opens a listener on the user's OWN machine forwarding localhost:<localPort>
  // to a pod/service port. The BE handler 403s unless it runs embedded, so the
  // caller only offers this on desktop-local connections (scope='local').
  // Stateful — a forward runs until stopped or the embedded BE restarts.
  portForward: {
    // start → { id, localPort, targetPort, namespace, name, address }.
    // localPort omitted/blank ⇒ BE auto-assigns and returns the actual port.
    start: (
      id: string,
      data: { context: string; namespace?: string; kind: 'pod' | 'service'; name: string; targetPort: number; localPort?: number },
      scope?: DBScope,
    ) => api.post<K8sPortForward>(`/k8s/${id}/port-forward`, data, dbCfg(scope)),
    // list → active forwards for this connection on the embedded BE.
    list: (id: string, scope?: DBScope) =>
      api.get<K8sPortForward[]>(`/k8s/${id}/port-forwards`, dbCfg(scope)),
    // stop → tear down one forward by its id (owner-checked BE-side).
    stop: (id: string, pfId: string, scope?: DBScope) =>
      api.delete(`/k8s/${id}/port-forward/${pfId}`, dbCfg(scope)),
  },
};

export const environmentSharingAPI = {
  setVisibility: (id: string, visibility: 'public' | 'private') =>
    api.patch(`/environments/${id}/visibility`, { visibility }),
  listGrants: (id: string) => api.get(`/environments/${id}/grants`),
  addGrant: (
    id: string,
    data: { role: 'editor' | 'viewer'; subjectKind: 'user' | 'team' | 'everyone'; subjectId?: string },
  ) => api.post(`/environments/${id}/grants`, data),
  deleteGrant: (id: string, grantId: string) => api.delete(`/environments/${id}/grants/${grantId}`),
};

// Users
export const usersAPI = {
  search: (q: string) => api.get('/users/search', { params: { q } }),
};

// Defects (Bug Tracking)
export const defectsAPI = {
  list: (params?: Record<string, string>) => api.get('/defects', { params }),
  create: (data: Partial<Defect>) => api.post('/defects', data),
  get: (id: string) => api.get(`/defects/${id}`),
  update: (id: string, data: Partial<Defect>) => api.put(`/defects/${id}`, data),
  delete: (id: string) => api.delete(`/defects/${id}`),
};

// Comments
export const commentsAPI = {
  list: (targetType: string, targetId: string) => api.get('/comments', { params: { targetType, targetId } }),
  create: (data: { targetType: string; targetId: string; content: string; parentId?: string }) => api.post('/comments', data),
  update: (id: string, content: string) => api.put(`/comments/${id}`, { content }),
  delete: (id: string) => api.delete(`/comments/${id}`),
};

// Audit & Activity
export const auditAPI = {
  logs: (params?: Record<string, string>) => api.get('/audit-logs', { params }),
  activity: (params?: Record<string, string>) => api.get('/activity-feed', { params }),
};

// Collection Runner
export const runnerAPI = {
  run: (data: { collectionId: string; environmentId?: string; delay?: number; iterations?: number }) => api.post('/runner/run', data),
  dataDriven: (data: { collectionId: string; environmentId?: string; data: Record<string, string>[]; delay?: number }) => api.post('/runner/data-driven', data),
};

// Cookies
export const cookiesAPI = {
  list: (domain?: string) => api.get('/cookies', { params: domain ? { domain } : {} }),
  set: (data: Partial<CookieItem>) => api.post('/cookies', data),
  delete: (id: string) => api.delete(`/cookies/${id}`),
  clear: (domain?: string) => api.delete('/cookies', { params: domain ? { domain } : {} }),
};

// Script Execution
export const scriptAPI = {
  execute: (data: { script: string; type: 'pre-request' | 'test'; context: Record<string, unknown> }) => api.post('/script/execute', data),
};

// Shared Steps
export const sharedStepsAPI = {
  list: () => api.get('/shared-steps'),
  create: (data: { title: string; steps: Array<{ stepNo: number; action: string; expected: string }> }) => api.post('/shared-steps', data),
  get: (id: string) => api.get(`/shared-steps/${id}`),
  update: (id: string, data: Partial<SharedStep>) => api.put(`/shared-steps/${id}`, data),
  delete: (id: string) => api.delete(`/shared-steps/${id}`),
};

// Test Case Versions
export const testCaseVersionsAPI = {
  list: (testCaseId: string) => api.get(`/test-cases/${testCaseId}/versions`),
  get: (testCaseId: string, versionId: string) => api.get(`/test-cases/${testCaseId}/versions/${versionId}`),
  restore: (testCaseId: string, versionId: string) => api.post(`/test-cases/${testCaseId}/versions/${versionId}/restore`),
};

// Requirements & Traceability
export const requirementsAPI = {
  list: (params?: Record<string, string>) => api.get('/requirements', { params }),
  create: (data: Partial<Requirement>) => api.post('/requirements', data),
  get: (id: string) => api.get(`/requirements/${id}`),
  update: (id: string, data: Partial<Requirement>) => api.put(`/requirements/${id}`, data),
  delete: (id: string) => api.delete(`/requirements/${id}`),
  linkTestCase: (id: string, testCaseId: string) => api.post(`/requirements/${id}/test-cases`, { testCaseId }),
  unlinkTestCase: (id: string, testCaseId: string) => api.delete(`/requirements/${id}/test-cases/${testCaseId}`),
  traceability: () => api.get('/requirements/traceability'),
};

// Global Search
export const searchAPI = {
  search: (q: string, type?: string) => api.get('/search', { params: { q, type } }),
};

// JUnit Import
export const junitAPI = {
  import: (formData: FormData, testPlanId?: string) => api.post('/import/junit', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    params: testPlanId ? { testPlanId } : {},
  }),
  list: (testPlanId?: string) => api.get('/import/junit', { params: testPlanId ? { testPlanId } : {} }),
  get: (id: string) => api.get(`/import/junit/${id}`),
  delete: (id: string) => api.delete(`/import/junit/${id}`),
};

// WebSocket
export const wsAPI = {
  connect: (data: { url: string; headers?: Record<string, string>; protocols?: string[] }) => api.post('/ws/connect', data),
  send: (connectionId: string, data: { message: string; type?: string }) => api.post(`/ws/send/${connectionId}`, data),
  disconnect: (connectionId: string) => api.post(`/ws/disconnect/${connectionId}`),
  history: (connectionId: string) => api.get(`/ws/history/${connectionId}`),
};

// Load Testing
export const loadTestAPI = {
  create: (data: { name: string; description?: string; config: unknown }) => api.post('/load-tests', data),
  list: () => api.get('/load-tests'),
  get: (id: string) => api.get(`/load-tests/${id}`),
  cancel: (id: string) => api.post(`/load-tests/${id}/cancel`),
  delete: (id: string) => api.delete(`/load-tests/${id}`),
};

// Resolve a user-supplied docs URL (Scalar / Swagger UI / Redoc / direct
// JSON) to the underlying OpenAPI spec. Done BE-side because most docs
// servers don't allow cross-origin reads and we want path-probing in one
// place. The FE's URL-import flow runs this first, then feeds the spec
// into the existing parser.
export const importAPI = {
  resolveSpec: (url: string) =>
    api.post<{ spec: string; resolvedUrl: string; source: string }>(
      '/import/resolve-spec',
      { url },
      { _executionPin: 'remote' },
    ),
  // Bulk Swagger import — POST the raw spec JSON to the BE which
  // creates the root collection, tag-based folders, and every request
  // in a single transaction. Saves ~200 round-trips on a real-world
  // spec (one POST instead of one per row). The optional sourceUrl
  // is what the user typed in the URL field; we record it on the
  // collection so the Update dialog can pre-fill on next open.
  importSwaggerJSON: (specJson: string, opts: { sourceUrl?: string; workspaceId?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.sourceUrl) params.set('sourceUrl', opts.sourceUrl);
    if (opts.workspaceId) params.set('workspaceId', opts.workspaceId);
    const qs = params.toString();
    return api.post<{ collection: Collection; requests: SavedRequest[]; count: number }>(
      `/import/swagger${qs ? `?${qs}` : ''}`,
      specJson,
      { _executionPin: 'remote', headers: { 'Content-Type': 'application/json' }, transformRequest: [(d) => d] },
    );
  },
  // WSDL import — the BE parses the WSDL (stdlib encoding/xml) and creates a
  // collection with one SOAP request per operation. Pass raw WSDL `content`
  // (paste/file) OR a `url` (BE fetches it, bypassing the OpenAPI resolver).
  importWSDL: (opts: { content?: string; url?: string; workspaceId?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.url) params.set('url', opts.url);
    if (opts.workspaceId) params.set('workspaceId', opts.workspaceId);
    const qs = params.toString();
    return api.post<{ collection: Collection; requests: SavedRequest[]; count: number }>(
      `/import/wsdl${qs ? `?${qs}` : ''}`,
      opts.content ?? '',
      { _executionPin: 'remote', headers: { 'Content-Type': 'application/xml' }, transformRequest: [(d) => d] },
    );
  },
};

// SSO sign-in (third-party identity → PatchMan account, find-or-create).
export const ssoAPI = {
  start: (provider: 'gitlab', surface: 'web' | 'desktop', origin?: string) =>
    api.post<{ authUrl: string; state: string }>(
      '/auth/sso/start',
      { provider, surface, origin },
      { _executionPin: 'remote' },
    ),
  callback: (code: string, state: string) =>
    api.post<{ token: string; user: User; new: boolean; merged: boolean }>(
      '/auth/sso/callback',
      { code, state },
      { _executionPin: 'remote' },
    ),
};

// Admin endpoints (gated by user.role === 'admin' on the BE).
export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  createdAt: string;
  hasGitlab: boolean;
  mcpTokenCount: number;
  // Latest of app open / login, audited API writes, sent requests, MCP use.
  // Per-user counts moved to adminAPI.userUsage (fetched on row expand).
  lastActivityAt?: string;
  lastLoginAt?: string;
  lastSeenAt?: string;
  lastSeenVersion?: string;
}

// GET /admin/users/:id/usage — metadata only (counts, timestamps, names).
export interface AdminToolUsage {
  tool: string;
  items: number; // things the user owns in the tool
  actions: number; // audit-log rows (API writes / POST ops, UI + MCP)
  operations: number; // the tool's own ledger (queries, consumes, sends)
  lastUsedAt?: string;
}

export interface AdminUserUsage {
  userId: string;
  lastActivityAt?: string;
  lastLoginAt?: string;
  lastSeenAt?: string;
  lastSeenVersion?: string;
  hasGitlab: boolean;
  counts: {
    collections: number;
    requests: number;
    mockServers: number;
    mockRoutes: number;
    environments: number;
    history: number;
    notes: number;
    cards: number;
    whiteboards: number;
    testCases: number;
    workspaces: number;
    teams: number;
    mcpTokens: number;
  };
  tools: AdminToolUsage[]; // newest lastUsedAt first
  mcpClients: { id: string; name: string; clientName?: string; createdAt?: string; lastUsedAt?: string }[];
  agents: { agent: string; cards: number; lastAt?: string }[]; // agent '' = written by hand
  generatedAt: string;
}

export interface AdminStats {
  userCount: number;
  collectionCount: number;
  requestCount: number;
  mockServerCount: number;
  mockRouteCount: number;
  workspaceCount: number;
  historyCount: number;
  testCaseCount: number;
  gitIntegrationCount: number;
  newUsers7d: number;
  newUsers30d: number;
}

export const adminAPI = {
  listUsers: () => api.get<AdminUserRow[]>('/admin/users', { _executionPin: 'remote' }),
  userUsage: (id: string) =>
    api.get<AdminUserUsage>(`/admin/users/${encodeURIComponent(id)}/usage`, { _executionPin: 'remote' }),
  setRole: (id: string, role: 'user' | 'admin') =>
    api.put(`/admin/users/${id}/role`, { role }, { _executionPin: 'remote' }),
  resetPassword: (id: string, password: string) =>
    api.put(`/admin/users/${id}/password`, { password }, { _executionPin: 'remote' }),
  stats: () => api.get<AdminStats>('/admin/stats', { _executionPin: 'remote' }),
  // Transfer a collection (and every nested folder/request) to another
  // user. Either `newOwnerId` or `newOwnerEmail` must be set — the BE
  // accepts either, see admin.go::ReassignCollection.
  reassignCollection: (
    collectionId: string,
    data: { newOwnerId?: string; newOwnerEmail?: string },
  ) => api.put(`/admin/collections/${collectionId}/owner`, data, { _executionPin: 'remote' }),
};

// Crash-report → Slack admin surface. The toggles control which FE error
// sources are forwarded to the configured webhook; the test endpoint
// fires a synthetic message so the admin can validate the integration.
export interface ErrorReportingConfig {
  boundaryEnabled: boolean;
  rejectionEnabled: boolean;
  windowEnabled: boolean;
  // True when the BE has SLACK_ERROR_WEBHOOK_URL set. False ⇒ toggles
  // are functionally no-ops and the admin UI should surface that.
  slackConfigured: boolean;
}

export interface ErrorReportingTestResponse {
  ok: boolean;
  status?: number;
  error?: string;
}

export const errorReportingAdminAPI = {
  getConfig: () =>
    api.get<ErrorReportingConfig>('/admin/error-reporting/config', { _executionPin: 'remote' }),
  patchConfig: (patch: Partial<Omit<ErrorReportingConfig, 'slackConfigured'>>) =>
    api.patch<ErrorReportingConfig>('/admin/error-reporting/config', patch, { _executionPin: 'remote' }),
  test: () =>
    api.post<ErrorReportingTestResponse>('/admin/error-reporting/test', {}, { _executionPin: 'remote' }),
};

// User-facing crash report ingest. Always POSTs to the remote BE — the
// embedded BE has no Slack webhook configured anyway, and routing it
// remote keeps a single source of truth for crash data.
export interface CrashReportPayload {
  source: 'boundary' | 'rejection' | 'window' | 'manual';
  message: string;
  stack?: string;
  componentStack?: string;
  appName?: string;
  appVersion?: string;
  buildEnv?: string;
  buildCommit?: string;
  platform?: 'web' | 'desktop';
  osInfo?: string;
  route?: string;
  tabName?: string;
  workspaceId?: string;
  workspaceName?: string;
}

export const errorReportAPI = {
  send: (payload: CrashReportPayload) =>
    api.post('/errors/report', payload, { _executionPin: 'remote' }),
};

// GitLab integration — OAuth account linking + (later) typed git operations.
// All endpoints live on the *remote* BE: tokens are stored server-side per
// user, and the embedded local BE has no notion of cross-user identity.
export interface GitLabIntegrationStatus {
  gitlabUserId: number;
  gitlabUsername: string;
  gitlabName: string;
  gitlabAvatar: string;
  linkedAt: string;
  scopes: string;
}

export interface GitLabImportResult {
  collection: Collection;
  count: number;
  binding: {
    collectionId: string;
    provider: string;
    baseUrl: string;
    projectId: string;
    filePath: string;
    branch: string;
    lastSeenCommitSha: string;
    lastSeenBlobSha: string;
  } | null;
  bindingErr?: string;
}

export const gitIntegrationAPI = {
  status: () =>
    api.get<GitLabIntegrationStatus | null>('/integrations/gitlab', {
      _executionPin: 'remote',
    }),
  start: (surface: 'web' | 'desktop') =>
    api.post<{ authUrl: string; state: string }>(
      '/integrations/gitlab/oauth/start',
      { surface },
      { _executionPin: 'remote' },
    ),
  callback: (code: string, state: string) =>
    api.post<GitLabIntegrationStatus>(
      '/integrations/gitlab/oauth/callback',
      { code, state },
      { _executionPin: 'remote' },
    ),
  disconnect: () =>
    api.delete('/integrations/gitlab', { _executionPin: 'remote' }),
  import: (input: { url?: string; projectId?: string; branch?: string; filePath?: string }) =>
    api.post<GitLabImportResult>('/integrations/gitlab/import', input, {
      _executionPin: 'remote',
    }),
  binding: (collectionId: string) =>
    api.get<GitLabBinding | null>(
      `/integrations/gitlab/collections/${collectionId}/binding`,
      { _executionPin: 'remote' },
    ),
  refresh: (collectionId: string) =>
    api.post<{ count: number; binding: GitLabBinding }>(
      `/integrations/gitlab/collections/${collectionId}/refresh`,
      undefined,
      { _executionPin: 'remote' },
    ),
  push: (collectionId: string, input: GitLabPushInput) =>
    api.post<GitLabPushResult>(
      `/integrations/gitlab/collections/${collectionId}/push`,
      input,
      { _executionPin: 'remote' },
    ),
};

export interface GitLabPushInput {
  dryRun?: boolean;
  commitMessage?: string;
  mrTitle?: string;
  mrDescription?: string;
  targetBranch?: string;
  directCommit?: boolean;
}

export interface GitLabPushResult {
  dryRun: boolean;
  noChanges?: boolean;
  originalJs?: string;
  patchedJs?: string;
  diff?: string;
  branchName?: string;
  commitId?: string;
  mrUrl?: string;
}

export interface GitLabBinding {
  collectionId: string;
  provider: string;
  baseUrl: string;
  projectId: string;
  filePath: string;
  branch: string;
  lastSeenCommitSha: string;
  lastSeenBlobSha: string;
  createdAt: string;
  updatedAt: string;
}

// Git Tools v1 — see GIT_V1_CONTRACT.md. Connection CRUD dual-writes with the
// same DBScope routing as the DB / Kafka / S3 / Redis / ES / K8s tools (the
// PAT/token is AES-GCM encrypted per-BE; ciphertext is never dual-written).
// Two data-plane surfaces:
//   • remote reads authenticate as the CALLER's linked GitLab account, whose
//     token lives on the remote BE — so they pin 'remote'.
//   • local working-tree ops run git on the user's OWN machine — so they pin
//     'local' (the embedded BE 403s these unless it runs embedded; the UI
//     only offers them on desktop).
// Paths + payload field names are the BE wire contract. NOTE the divergences
// from the k8s API that the contract (§2) mandates: revealSecret is a GET on
// /secret; deleteGrant carries {subjectKind,subjectId} in the BODY (composite
// key, no grantId path segment); the remote list route is `merge_requests`
// (underscore) while the method is `mergeRequests`. There is no `pull`.
// Remote reads of an OAuth connection authenticate as the caller's linked
// GitLab account, whose token lives on the remote BE — they pin 'remote'. A PAT
// connection carries its own token on every BE that holds it, so its reads go
// to the connection's own BE (on desktop usually this machine, which may be the
// only one that reaches that GitLab). gitConnectionStore registers the lookup.
let gitReadScope: (connectionId: string) => DBScope | undefined = () => undefined;
export function setGitReadScopeResolver(fn: (connectionId: string) => DBScope | undefined) {
  gitReadScope = fn;
}
function gitReadCfg(id: string, params?: unknown) {
  return { params, _executionPin: gitReadScope(id) ?? 'remote' };
}

export const gitAPI = {
  // ── connection CRUD + grants (dual-write friendly, optional scope) ──
  list: (scope?: DBScope) => api.get('/git/connections', dbCfg(scope)),
  create: (data: Record<string, unknown>, scope?: DBScope) =>
    api.post('/git/connections', data, dbCfg(scope)),
  get: (id: string, scope?: DBScope) => api.get(`/git/connections/${id}`, dbCfg(scope)),
  update: (id: string, data: Record<string, unknown>, scope?: DBScope) =>
    api.patch(`/git/connections/${id}`, data, dbCfg(scope)),
  delete: (id: string, scope?: DBScope) => api.delete(`/git/connections/${id}`, dbCfg(scope)),
  // Tests what the dialog shows: a saved connection takes the on-screen values
  // as overrides (its stored token never goes to a changed address); an unsaved
  // one uses the pre-save route.
  test: (id: string | null, scope?: DBScope, draft?: Record<string, unknown>) =>
    id
      ? api.post(`/git/connections/${id}/test`, draft, testCfg(scope))
      : api.post('/git/connections/test', draft, testCfg(scope)),
  // owner-only reveal of the stored PAT/token — GET, audited BE-side.
  revealSecret: (id: string, scope?: DBScope) =>
    api.get(`/git/connections/${id}/secret`, dbCfg(scope)),
  grants: (id: string, scope?: DBScope) => api.get(`/git/connections/${id}/grants`, dbCfg(scope)),
  addGrant: (
    id: string,
    data: { subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' },
    scope?: DBScope,
  ) => api.post(`/git/connections/${id}/grants`, data, dbCfg(scope)),
  // DELETE-with-body: the composite key {subjectKind,subjectId} identifies the
  // grant (there is no grantId), so it rides in the request body.
  deleteGrant: (
    id: string,
    data: { subjectKind: 'user' | 'team'; subjectId: string },
    scope?: DBScope,
  ) => api.delete(`/git/connections/${id}/grants`, dbCfg(scope, { data })),

  // ── remote-read (pin 'remote' for OAuth; a PAT connection's own BE — gitReadCfg) ──
  repos: (id: string, params?: { search?: string }) =>
    api.get(`/git/connections/${id}/repos`, gitReadCfg(id, params)),
  branches: (id: string, params: { project: string }) =>
    api.get(`/git/connections/${id}/branches`, gitReadCfg(id, params)),
  commits: (id: string, params: { project: string; ref?: string; page?: number }) =>
    api.get(`/git/connections/${id}/commits`, gitReadCfg(id, params)),
  commit: (id: string, params: { project: string; sha: string }) =>
    api.get(`/git/connections/${id}/commit`, gitReadCfg(id, params)),
  tree: (id: string, params: { project: string; ref?: string; path?: string }) =>
    api.get(`/git/connections/${id}/tree`, gitReadCfg(id, params)),
  file: (id: string, params: { project: string; ref?: string; path: string }) =>
    api.get(`/git/connections/${id}/file`, gitReadCfg(id, params)),
  compare: (id: string, params: { project: string; from: string; to: string }) =>
    api.get(`/git/connections/${id}/compare`, gitReadCfg(id, params)),
  contributors: (id: string, params: { project: string }) =>
    api.get(`/git/connections/${id}/contributors`, gitReadCfg(id, params)),
  mergeRequests: (id: string, params: { project: string; state?: string }) =>
    api.get(`/git/connections/${id}/merge_requests`, gitReadCfg(id, params)),

  // ── CI/CD (reads need read_api; variables a write grant; writes the api scope) ──
  pipelines: (id: string, params: { project: string; ref?: string; status?: string; source?: string; page?: number }) =>
    api.get(`/git/connections/${id}/pipelines`, gitReadCfg(id, params)),
  pipeline: (id: string, params: { project: string; pipeline: number }) =>
    api.get(`/git/connections/${id}/pipeline`, gitReadCfg(id, params)),
  jobLog: (id: string, params: { project: string; job: number; lines?: number }) =>
    api.get(`/git/connections/${id}/job_log`, gitReadCfg(id, params)),
  pipelineSchedules: (id: string, params: { project: string }) =>
    api.get(`/git/connections/${id}/pipeline_schedules`, gitReadCfg(id, params)),
  ciVariables: (id: string, params: { project: string }) =>
    api.get(`/git/connections/${id}/ci_variables`, gitReadCfg(id, params)),
  // One value on request (audited); masked ones too, hidden ones never.
  ciVariable: (id: string, params: { project: string; key: string; scope?: string; group?: string }) =>
    api.get(`/git/connections/${id}/ci_variable`, gitReadCfg(id, params)),
  runPipeline: (id: string, project: string, ref: string, variables: { key: string; value: string }[]) =>
    api.post(`/git/connections/${id}/pipeline_run`, { ref, variables }, gitReadCfg(id, { project })),
  retryPipeline: (id: string, project: string, pipeline: number) =>
    api.post(`/git/connections/${id}/pipeline_retry`, null, gitReadCfg(id, { project, pipeline })),
  cancelPipeline: (id: string, project: string, pipeline: number) =>
    api.post(`/git/connections/${id}/pipeline_cancel`, null, gitReadCfg(id, { project, pipeline })),
  playJob: (id: string, project: string, job: number) =>
    api.post(`/git/connections/${id}/job_play`, null, gitReadCfg(id, { project, job })),
  retryJob: (id: string, project: string, job: number) =>
    api.post(`/git/connections/${id}/job_retry`, null, gitReadCfg(id, { project, job })),
  playSchedule: (id: string, project: string, schedule: number) =>
    api.post(`/git/connections/${id}/schedule_play`, null, gitReadCfg(id, { project, schedule })),

  // ── local working-tree ops (pin 'local' — embedded BE only) ──
  // clone (and push) can run for MINUTES on a real repo. The internal axios
  // instance sets NO `timeout`, so its default is 0 = no client-side timeout;
  // a large blobless clone therefore won't abort mid-flight and no per-call
  // override is needed (adding one would REGRESS by capping it). See §5.
  clone: (id: string, body: Record<string, unknown>) =>
    api.post(`/git/connections/${id}/clone`, body, { _executionPin: 'local' }),
  listRepos: () => api.get('/git/repos', { _executionPin: 'local' }),
  status: (repoId: string) => api.get(`/git/repos/${repoId}/status`, { _executionPin: 'local' }),
  log: (repoId: string, params?: { ref?: string; limit?: number }) =>
    api.get(`/git/repos/${repoId}/log`, { params, _executionPin: 'local' }),
  localBranches: (repoId: string) =>
    api.get(`/git/repos/${repoId}/branches`, { _executionPin: 'local' }),
  localDiff: (repoId: string, params: { path: string; staged?: boolean }) =>
    api.get(`/git/repos/${repoId}/diff`, { params, _executionPin: 'local' }),
  stage: (repoId: string, body: { path: string; patch?: string }) =>
    api.post(`/git/repos/${repoId}/stage`, body, { _executionPin: 'local' }),
  unstage: (repoId: string, body: { path: string; patch?: string }) =>
    api.post(`/git/repos/${repoId}/unstage`, body, { _executionPin: 'local' }),
  // Named localCommit (not `commit`) so it doesn't collide with the remote
  // commit-detail read above in this same object literal.
  localCommit: (repoId: string, body: { message: string; amend?: boolean }) =>
    api.post(`/git/repos/${repoId}/commit`, body, { _executionPin: 'local' }),
  push: (repoId: string, body: Record<string, unknown>) =>
    api.post(`/git/repos/${repoId}/push`, body, { _executionPin: 'local' }),
  pull: (repoId: string, body: Record<string, unknown>) =>
    api.post(`/git/repos/${repoId}/pull`, body, { _executionPin: 'local' }),
  localFile: (repoId: string, params: { path: string; ref?: string }) =>
    api.get(`/git/repos/${repoId}/file`, { params, _executionPin: 'local' }),
  // Write an edited working-tree file (in-app editor / conflict resolver).
  writeFile: (repoId: string, body: { path: string; content: string }) =>
    api.post(`/git/repos/${repoId}/file`, body, { _executionPin: 'local' }),
  // Absolute clone path for "Show in Finder"/reveal-in-file-manager.
  localPath: (repoId: string) =>
    api.get(`/git/repos/${repoId}/local-path`, { _executionPin: 'local' }),

  // ── token mint (pin 'remote', JWT) — a fresh short-lived GitLab access
  // token the FE passes into the local clone/push bodies. See §2d. ──
  mintToken: () =>
    api.get<{ token: string; expiresAt: string }>('/integrations/gitlab/token', {
      _executionPin: 'remote',
    }),
};

// DNS Toolkit (Dev Tools) — stateless resolver on the BE, speaking real DNS via
// github.com/miekg/dns. No pin: the route registers unconditionally on both the
// embedded + remote BEs, so default follow-mode routing is correct. Response
// shape mirrors the BE handler:
// { name, resolver, results: [{ type, records, error?, durationMs }] }.
//
// A record is now an object (not a bare string): value + ttl, plus type-specific
// structured fields. CAA is the one asymmetry — `value` holds the CAA content
// while `flag`/`tag` are structured (rendered as `flag tag "value"`); every
// other type puts its full presentation string in `value`.
export interface DnsRecord {
  value: string;
  ttl: number;
  // MX
  preference?: number;
  // SRV
  priority?: number;
  weight?: number;
  port?: number;
  // SRV + MX target host
  target?: string;
  // CAA
  flag?: number;
  tag?: string;
  // SOA
  mname?: string;
  rname?: string;
  serial?: number;
  refresh?: number;
  retry?: number;
  expire?: number;
  minttl?: number;
}
export interface DnsTypeResult {
  type: string;
  records: DnsRecord[];
  error?: string;
  durationMs: number;
}
export interface DnsLookupResponse {
  name: string;
  resolver: string;
  results: DnsTypeResult[];
}
// DNS + Web Audit are network utilities that should run from the user's OWN
// machine: pin them to the LOCAL embedded backend on desktop so they work
// without VPN and without a login. The routes are on both BEs, but default
// follow-mode routing sends a synced user's calls to the remote team server —
// which needs the VPN (and a JWT), so a lookup fails the moment the VPN drops
// and never works for a not-logged-in standalone user. `_executionPin: 'local'`
// falls back to remote on web (no sidecar) or if the embedded URL is unknown.
const devtoolsCfg = () => (isDesktop() ? { _executionPin: 'local' as const } : undefined);

export const dnsAPI = {
  lookup: (body: { name: string; types: string[]; server?: string }) =>
    api.post<DnsLookupResponse>('/devtools/dns', body, devtoolsCfg()),
};

// Web Audit (Dev Tools) — browser-less SEO + web-quality checker. Pinned local
// on desktop (see devtoolsCfg above). The interceptor unwraps the outer
// { data } once → res.data == WebAuditReport.
export const webAuditAPI = {
  run: (body: { url: string; followRedirects?: boolean }) =>
    api.post<WebAuditReport>('/devtools/web-audit', body, devtoolsCfg()),
};

export default api;

