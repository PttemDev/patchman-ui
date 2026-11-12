import axios from 'axios';
import { db, type LocalCollection, type LocalEnvironment, type LocalSavedRequest, type LocalCookie, type OutboxEntry } from '../db';
import api, { collectionsAPI, cookiesAPI, environmentsAPI, whiteboardAPI } from '@/services/api';
import { getLocalApiUrl } from '@/lib/platform';
import type { Collection, CookieItem, Environment, KeyValue, RequestAuth, RequestBody, SavedRequest } from '@/types';

export interface InitialPushResult {
  collections: number;
  requests: number;
  environments: number;
  cookies: number;
  testCases: number;
  testPlans: number;
  defects: number;
  requirements: number;
  sharedSteps: number;
  mockServers: number;
  mockRoutes: number;
  // undefined when the server predates whiteboard sync — the FE uses that to
  // warn "boards weren't pushed" instead of silently reporting success.
  whiteboards?: number;
  skipped: number;
}

/**
 * Serialize a LocalCollection for the BE. BE accepts the model shape directly
 * via /api/sync/initial-push — we only need to strip local-sync metadata and
 * coerce userId out (server will force it).
 */
function collectionToPayload(c: LocalCollection): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    type: c.type,
    parentId: c.parentId,
    baseUrl: c.baseUrl || '',
    sourceUrl: c.sourceUrl || '',
    sourceType: c.sourceType || '',
    sortOrder: c.sortOrder,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/**
 * BE stores request headers/params/body/auth as JSON strings. The FE keeps
 * them structured in Dexie — re-stringify on push.
 */
function requestToPayload(r: LocalSavedRequest): Record<string, unknown> {
  const strOr = (v: unknown): string =>
    typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
  return {
    id: r.id,
    collectionId: r.collectionId,
    name: r.name,
    method: r.method,
    url: r.url,
    headers: strOr(r.headers),
    params: strOr(r.params),
    body: strOr(r.body),
    auth: strOr(r.auth),
    preRequestScript: r.preRequestScript || '',
    testScript: r.testScript || '',
    sortOrder: r.sortOrder,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function environmentToPayload(e: LocalEnvironment): Record<string, unknown> {
  return {
    id: e.id,
    name: e.name,
    variables: typeof e.variables === 'string' ? e.variables : JSON.stringify(e.variables || []),
    isActive: e.isActive,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function cookieToPayload(ck: LocalCookie): Record<string, unknown> {
  return {
    id: ck.id,
    domain: ck.domain,
    name: ck.name,
    value: ck.value,
    path: ck.path || '/',
    secure: ck.secure ?? false,
    httpOnly: ck.httpOnly ?? false,
    sameSite: (ck as unknown as { sameSite?: string }).sameSite || '',
    expiresAt: ck.expiresAt || null,
    createdAt: ck.createdAt,
    updatedAt: ck.updatedAt,
  };
}

/**
 * Collect every local (non-deleted) entity from Dexie and POST it to the BE in
 * one transactional batch. The server forces UserID = the authed user, so the
 * caller must run this only after a successful register/login that issued a JWT.
 *
 * On success, every pushed entity's _dirty flag is cleared and _origin flipped
 * to 'server' so future mutations are correctly marked for re-sync.
 */
export async function initialPush(): Promise<InitialPushResult> {
  const [collections, requests, environments, cookies] = await Promise.all([
    db.collections.toArray(),
    db.requests.toArray(),
    db.environments.toArray(),
    db.cookies.toArray(),
  ]);

  const livingCollections = collections.filter((c) => !c._deleted);
  const livingRequests = requests.filter((r) => !r._deleted);
  const livingEnvs = environments.filter((e) => !e._deleted);

  const payload = {
    collections: livingCollections.map(collectionToPayload),
    requests: livingRequests.map(requestToPayload),
    environments: livingEnvs.map(environmentToPayload),
    cookies: cookies.map(cookieToPayload),
    // Future entities (testCases, testPlans, defects, requirements, sharedSteps,
    // mockServers, mockRoutes) are stubbed until Phase 3 wires them into Dexie.
    testCases: [],
    testPlans: [],
    defects: [],
    requirements: [],
    sharedSteps: [],
    mockServers: [],
    mockRoutes: [],
  };

  const response = await api.post('/sync/initial-push', payload);
  // The response interceptor unwraps the outer {data:…}, so response.data IS
  // the result object (reading .data.data would be undefined).
  const result = response.data as InitialPushResult;

  // Flip sync metadata so a later firstSync doesn't treat these as new again.
  await db.transaction('rw', db.collections, db.requests, db.environments, async () => {
    for (const c of livingCollections) {
      await db.collections.put({ ...c, _dirty: false, _origin: 'server' });
    }
    for (const r of livingRequests) {
      await db.requests.put({ ...r, _dirty: false, _origin: 'server' });
    }
    for (const e of livingEnvs) {
      await db.environments.put({ ...e, _dirty: false, _origin: 'server' });
    }
  });

  return result;
}

export interface FirstSyncResult {
  pushedCollections: number;
  pushedRequests: number;
  pushedEnvironments: number;
  pushedCookies: number;
  pulledCollections: number;
  pulledRequests: number;
  pulledEnvironments: number;
  pulledCookies: number;
  pushedWhiteboards: number;
  // false when whiteboards were queued to push but the server dropped them
  // (an older BE without whiteboard sync) — surfaced so the UI doesn't lie.
  whiteboardsPushSupported: boolean;
  renamed: number;
}

function parseJSONOr<T>(val: unknown, fallback: T): T {
  if (typeof val === 'string') {
    if (!val) return fallback;
    try {
      const parsed = JSON.parse(val);
      return (parsed ?? fallback) as T;
    } catch {
      return fallback;
    }
  }
  return (val as T) ?? fallback;
}

function flattenServerCollections(nested: Array<Collection & { shared?: boolean }>): {
  collections: Array<Collection & { userId?: string; createdAt?: string; updatedAt?: string }>;
  requests: SavedRequest[];
} {
  const collections: Array<Collection & { userId?: string; createdAt?: string; updatedAt?: string }> = [];
  const requests: SavedRequest[] = [];
  const walk = (list: Array<Collection & { shared?: boolean }>) => {
    for (const c of list) {
      if (c.shared) continue;
      const { children, requests: reqs, ...rest } = c as Collection & {
        children?: Collection[];
        requests?: SavedRequest[];
        shared?: boolean;
      };
      collections.push(rest as Collection & { userId?: string; createdAt?: string; updatedAt?: string });
      if (Array.isArray(reqs)) requests.push(...reqs);
      if (Array.isArray(children) && children.length > 0) walk(children as Array<Collection & { shared?: boolean }>);
    }
  };
  walk(nested);
  return { collections, requests };
}

function serverRequestToLocal(r: SavedRequest & { createdAt?: string; updatedAt?: string }): LocalSavedRequest {
  return {
    id: r.id,
    collectionId: r.collectionId,
    name: r.name,
    method: r.method,
    url: r.url,
    headers: parseJSONOr<KeyValue[]>(r.headers, []),
    params: parseJSONOr<KeyValue[]>(r.params, []),
    body: parseJSONOr<RequestBody>(r.body, { type: 'none', content: '' }),
    auth: parseJSONOr<RequestAuth>(r.auth, { type: 'none' }),
    preRequestScript: r.preRequestScript || '',
    testScript: r.testScript || '',
    sortOrder: r.sortOrder || 0,
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: r.updatedAt || new Date().toISOString(),
    _dirty: false,
    _origin: 'server',
  };
}

function serverCollectionToLocal(
  c: Collection & { userId?: string; createdAt?: string; updatedAt?: string },
  authedUserId: string,
): LocalCollection {
  return {
    id: c.id,
    name: c.name,
    description: c.description || '',
    type: c.type,
    parentId: c.parentId,
    sortOrder: c.sortOrder || 0,
    baseUrl: c.baseUrl,
    sourceUrl: c.sourceUrl,
    sourceType: c.sourceType,
    userId: c.userId || authedUserId,
    createdAt: c.createdAt || new Date().toISOString(),
    updatedAt: c.updatedAt || new Date().toISOString(),
    _dirty: false,
    _origin: 'server',
  };
}

function serverEnvToLocal(
  e: Environment & { userId?: string; createdAt?: string; updatedAt?: string },
  authedUserId: string,
): LocalEnvironment {
  return {
    id: e.id,
    name: e.name,
    isActive: !!e.isActive,
    variables: Array.isArray(e.variables) ? e.variables : parseJSONOr(e.variables, []),
    userId: e.userId || authedUserId,
    createdAt: e.createdAt || new Date().toISOString(),
    updatedAt: e.updatedAt || new Date().toISOString(),
    _dirty: false,
    _origin: 'server',
  };
}

function serverCookieToLocal(ck: CookieItem & { createdAt?: string; updatedAt?: string }): LocalCookie {
  return {
    id: ck.id,
    domain: ck.domain,
    name: ck.name,
    value: ck.value,
    path: ck.path || '/',
    secure: !!ck.secure,
    httpOnly: !!ck.httpOnly,
    expiresAt: ck.expiresAt,
    createdAt: ck.createdAt || new Date().toISOString(),
    updatedAt: ck.updatedAt || new Date().toISOString(),
  };
}

/**
 * Computed first-sync plan. Holds everything apply needs so the UI can show
 * the user what's about to happen and get confirmation without re-running
 * the expensive pull + conflict pass.
 *
 * Discriminated by `source`: IndexedDB (web) and the embedded sidecar (desktop-
 * local) carry different row shapes, so keeping them in separate variants
 * avoids lossy coercion through a shared type.
 */
interface FirstSyncPlanBase {
  authedUserId: string;
  serverCollections: Array<Collection & { userId?: string; createdAt?: string; updatedAt?: string }>;
  serverRequests: SavedRequest[];
  serverEnvs: Array<Environment & { userId?: string; createdAt?: string; updatedAt?: string }>;
  serverCookies: Array<CookieItem & { createdAt?: string; updatedAt?: string }>;
  renamed: number;
  skippedOrphanRequests: number;
}

export interface FirstSyncPlanIndexedDB extends FirstSyncPlanBase {
  source: 'indexeddb';
  pushCollections: LocalCollection[];
  pushRequests: LocalSavedRequest[];
  pushEnvs: LocalEnvironment[];
  pushCookies: LocalCookie[];
}

export interface FirstSyncPlanEmbedded extends FirstSyncPlanBase {
  source: 'embedded';
  pushCollections: Array<Record<string, unknown>>;
  pushRequests: Array<Record<string, unknown>>;
  pushEnvs: Array<Record<string, unknown>>;
  pushCookies: Array<Record<string, unknown>>;
  pushTestCases: Array<Record<string, unknown>>;
  pushTestPlans: Array<Record<string, unknown>>;
  pushDefects: Array<Record<string, unknown>>;
  pushRequirements: Array<Record<string, unknown>>;
  pushSharedSteps: Array<Record<string, unknown>>;
  pushMockServers: Array<Record<string, unknown>>;
  pushMockRoutes: Array<Record<string, unknown>>;
  // Board/folder METADATA only (id, name, parentId, type, sortOrder, …). Scene
  // JSON is fetched lazily at apply time for the boards actually pushed, so the
  // preview/count pass doesn't download every drawing. Each row carries _srcId
  // (its embedded id) so apply can fetch the scene even for renamed boards.
  pushWhiteboards: Array<Record<string, unknown>>;
}

export type FirstSyncPlan = FirstSyncPlanIndexedDB | FirstSyncPlanEmbedded;

export interface FirstSyncPreview {
  push: {
    collections: number;
    requests: number;
    environments: number;
    cookies: number;
    whiteboards: number;
    testCases?: number;
    testPlans?: number;
    defects?: number;
    requirements?: number;
    sharedSteps?: number;
    mockServers?: number;
    mockRoutes?: number;
  };
  pull: { collections: number; requests: number; environments: number; cookies: number; whiteboards: number };
  renamed: number;
  skippedOrphanRequests: number;
}

/**
 * Sync direction chosen by the user in the preview dialog.
 * - 'both': push local-only items AND pull server items (full merge).
 * - 'push': only push local-only items to the server; do not overwrite Dexie with server state.
 * - 'pull': only adopt server state locally; do not upload anything. Local-only data is dropped.
 */
export type SyncDirection = 'both' | 'push' | 'pull';

export function previewOf(plan: FirstSyncPlan): FirstSyncPreview {
  const pushBase = {
    collections: plan.pushCollections.length,
    requests: plan.pushRequests.length,
    environments: plan.pushEnvs.length,
    cookies: plan.pushCookies.length,
  };
  const push = plan.source === 'embedded'
    ? {
        ...pushBase,
        whiteboards: plan.pushWhiteboards.length,
        testCases: plan.pushTestCases.length,
        testPlans: plan.pushTestPlans.length,
        defects: plan.pushDefects.length,
        requirements: plan.pushRequirements.length,
        sharedSteps: plan.pushSharedSteps.length,
        mockServers: plan.pushMockServers.length,
        mockRoutes: plan.pushMockRoutes.length,
      }
    : { ...pushBase, whiteboards: 0 };
  return {
    push,
    pull: {
      collections: plan.serverCollections.length,
      requests: plan.serverRequests.length,
      environments: plan.serverEnvs.length,
      cookies: plan.serverCookies.length,
      // Whiteboards aren't pulled into the embedded/local store — the pull
      // column is always 0 for boards (they only travel local → cloud).
      whiteboards: 0,
    },
    renamed: plan.renamed,
    skippedOrphanRequests: plan.skippedOrphanRequests,
  };
}

/**
 * Dry-run half of first-sync: pull server, read local, and compute a merge
 * plan without touching Dexie. Safe to surface in a preview dialog. Conflict
 * strategy: local items sharing an id with a server item get a fresh UUID
 * and a "Name (1)" suffix, so both versions survive.
 */
export async function planFirstSync(authedUserId: string): Promise<FirstSyncPlan> {
  const [collectionsRes, envsRes, cookiesRes] = await Promise.all([
    collectionsAPI.list(),
    environmentsAPI.list(),
    cookiesAPI.list(),
  ]);

  const nestedServerCollections = ((collectionsRes.data as unknown) as Array<Collection & { shared?: boolean }>) || [];
  const { collections: serverCollections, requests: serverRequests } = flattenServerCollections(nestedServerCollections);
  const serverEnvs = ((envsRes.data as unknown) as Array<Environment & { userId?: string }>) || [];
  const serverCookies = ((cookiesRes.data as unknown) as CookieItem[]) || [];

  const [localCollections, localRequests, localEnvs, localCookies] = await Promise.all([
    db.collections.toArray(),
    db.requests.toArray(),
    db.environments.toArray(),
    db.cookies.toArray(),
  ]);

  const serverColIds = new Set(serverCollections.map((c) => c.id));
  const serverReqIds = new Set(serverRequests.map((r) => r.id));
  const serverEnvIds = new Set(serverEnvs.map((e) => e.id));
  const serverCookieIds = new Set(serverCookies.map((ck) => ck.id));

  let renamed = 0;
  let skippedOrphanRequests = 0;

  const collectionIdRemap = new Map<string, string>();
  const pushCollections: LocalCollection[] = [];
  for (const c of localCollections) {
    if (c._deleted || c._origin !== 'local') continue;
    if (serverColIds.has(c.id)) {
      const newId = crypto.randomUUID();
      collectionIdRemap.set(c.id, newId);
      pushCollections.push({ ...c, id: newId, name: `${c.name} (1)` });
      renamed++;
    } else {
      pushCollections.push(c);
    }
  }

  const pushRequests: LocalSavedRequest[] = [];
  for (const r of localRequests) {
    if (r._deleted || r._origin !== 'local') continue;
    const remappedCollectionId = collectionIdRemap.get(r.collectionId) || r.collectionId;
    if (!serverColIds.has(remappedCollectionId) && !pushCollections.some((pc) => pc.id === remappedCollectionId)) {
      skippedOrphanRequests++;
      continue;
    }
    if (serverReqIds.has(r.id)) {
      const newId = crypto.randomUUID();
      pushRequests.push({ ...r, id: newId, collectionId: remappedCollectionId, name: `${r.name} (1)` });
      renamed++;
    } else {
      pushRequests.push({ ...r, collectionId: remappedCollectionId });
    }
  }

  const pushEnvs: LocalEnvironment[] = [];
  for (const e of localEnvs) {
    if (e._deleted || e._origin !== 'local') continue;
    if (serverEnvIds.has(e.id)) {
      const newId = crypto.randomUUID();
      pushEnvs.push({ ...e, id: newId, name: `${e.name} (1)`, isActive: false });
      renamed++;
    } else {
      pushEnvs.push(e);
    }
  }

  const pushCookies: LocalCookie[] = [];
  for (const ck of localCookies) {
    if (serverCookieIds.has(ck.id)) {
      const newId = crypto.randomUUID();
      pushCookies.push({ ...ck, id: newId });
      renamed++;
    } else {
      pushCookies.push(ck);
    }
  }

  return {
    source: 'indexeddb',
    authedUserId,
    serverCollections,
    serverRequests,
    serverEnvs,
    serverCookies,
    pushCollections,
    pushRequests,
    pushEnvs,
    pushCookies,
    renamed,
    skippedOrphanRequests,
  };
}

/**
 * Apply half: execute the requested direction. After this call, Dexie reflects
 * the user's choice:
 *   - 'both': push local-only items, then rebuild Dexie from (server ∪ pushed locals).
 *   - 'push': push local-only items and mark them synced locally; server-only items are not pulled.
 *   - 'pull': clear Dexie and replace with server state. Local-only items are dropped.
 */
export async function applyFirstSync(
  plan: FirstSyncPlan,
  direction: SyncDirection = 'both',
): Promise<FirstSyncResult> {
  if (plan.source === 'embedded') {
    return applyFirstSyncFromEmbedded(plan, direction);
  }
  const {
    authedUserId,
    serverCollections,
    serverRequests,
    serverEnvs,
    serverCookies,
    pushCollections,
    pushRequests,
    pushEnvs,
    pushCookies,
  } = plan;

  const doPush = direction === 'both' || direction === 'push';
  const doPull = direction === 'both' || direction === 'pull';

  let pushedCollections = 0;
  let pushedRequests = 0;
  let pushedEnvironments = 0;
  let pushedCookies = 0;
  const hasAnythingToPush =
    pushCollections.length > 0 ||
    pushRequests.length > 0 ||
    pushEnvs.length > 0 ||
    pushCookies.length > 0;
  if (doPush && hasAnythingToPush) {
    const payload = {
      collections: pushCollections.map(collectionToPayload),
      requests: pushRequests.map(requestToPayload),
      environments: pushEnvs.map(environmentToPayload),
      cookies: pushCookies.map(cookieToPayload),
      testCases: [],
      testPlans: [],
      defects: [],
      requirements: [],
      sharedSteps: [],
      mockServers: [],
      mockRoutes: [],
      // Whiteboards live only on the embedded backend / cloud, never IndexedDB,
      // so the web push has none — the embedded path (below) carries boards.
      whiteboards: [],
    };
    await api.post('/sync/initial-push', payload);
    pushedCollections = pushCollections.length;
    pushedRequests = pushRequests.length;
    pushedEnvironments = pushEnvs.length;
    pushedCookies = pushCookies.length;
  }

  await db.transaction('rw', db.collections, db.requests, db.environments, db.cookies, async () => {
    if (doPull) {
      // Full replace: server state is the new source of truth. If we also pushed,
      // add the pushed items back (now synced) so the user keeps their uploads visible.
      await db.collections.clear();
      await db.requests.clear();
      await db.environments.clear();
      await db.cookies.clear();

      for (const c of serverCollections) {
        await db.collections.put(serverCollectionToLocal(c, authedUserId));
      }
      for (const r of serverRequests) {
        await db.requests.put(serverRequestToLocal(r));
      }
      for (const e of serverEnvs) {
        await db.environments.put(serverEnvToLocal(e, authedUserId));
      }
      for (const ck of serverCookies) {
        await db.cookies.put(serverCookieToLocal(ck));
      }
    }

    if (doPush) {
      // Mark pushed items as synced so they stop being treated as local-only.
      for (const c of pushCollections) {
        await db.collections.put({ ...c, _dirty: false, _origin: 'server' });
      }
      for (const r of pushRequests) {
        await db.requests.put({ ...r, _dirty: false, _origin: 'server' });
      }
      for (const e of pushEnvs) {
        await db.environments.put({ ...e, _dirty: false, _origin: 'server' });
      }
      for (const ck of pushCookies) {
        await db.cookies.put(ck);
      }
    }
  });

  return {
    pushedCollections,
    pushedRequests,
    pushedEnvironments,
    pushedCookies,
    pulledCollections: doPull ? serverCollections.length : 0,
    pulledRequests: doPull ? serverRequests.length : 0,
    pulledEnvironments: doPull ? serverEnvs.length : 0,
    pulledCookies: doPull ? serverCookies.length : 0,
    // Web/IndexedDB never has whiteboards to push.
    pushedWhiteboards: 0,
    whiteboardsPushSupported: true,
    renamed: doPush ? plan.renamed : 0,
  };
}

/** Convenience wrapper that auto-applies the plan without user preview. */
export async function firstSync(authedUserId: string): Promise<FirstSyncResult> {
  const plan = await planFirstSync(authedUserId);
  return applyFirstSync(plan);
}

// ──────────────────────────────────────────────────────────────
// Sync from the embedded desktop backend
//
// On desktop-local the source of truth is the embedded Go sidecar's SQLite
// file, not IndexedDB. When the user registers or logs in, we need to pull
// state out of the sidecar via its HTTP API and push it to the remote BE.
// The axios auth header and baseURL are mode-driven, so by the time the
// login response lands the shared `api` instance is already pointing at
// the remote. We therefore use a dedicated, permanently-embedded-pointing
// axios to snapshot state without fighting the mode machinery.
// ──────────────────────────────────────────────────────────────

function embeddedAxios() {
  const base = getLocalApiUrl();
  if (!base) {
    throw new Error('Embedded backend URL is not available on this platform');
  }
  return axios.create({
    baseURL: `${base}/api`,
    headers: { 'Content-Type': 'application/json' },
  });
}

function unwrapData<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in (raw as Record<string, unknown>)) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

interface EmbeddedSnapshot {
  collections: Array<Record<string, unknown>>;
  requests: Array<Record<string, unknown>>;
  environments: Array<Record<string, unknown>>;
  cookies: Array<Record<string, unknown>>;
  testCases: Array<Record<string, unknown>>;
  testPlans: Array<Record<string, unknown>>;
  defects: Array<Record<string, unknown>>;
  requirements: Array<Record<string, unknown>>;
  sharedSteps: Array<Record<string, unknown>>;
  mockServers: Array<Record<string, unknown>>;
  mockRoutes: Array<Record<string, unknown>>;
  // Board/folder metadata (no scene — fetched per-id at push time).
  whiteboards: Array<Record<string, unknown>>;
}

/**
 * Pull every first-party record out of the embedded backend and flatten it
 * into the shape /sync/initial-push expects. Shared/borrowed collections
 * are skipped — only the embedded user's own rows travel.
 */
async function snapshotEmbedded(): Promise<EmbeddedSnapshot> {
  const emb = embeddedAxios();
  // QA endpoints are best-effort — on older embedded builds they may 404. A
  // single missing endpoint shouldn't abort the whole sync, so wrap each in
  // a catch that returns an empty list.
  const safeGet = async (path: string): Promise<unknown> => {
    try {
      const res = await emb.get(path);
      return res.data;
    } catch {
      return { data: [] };
    }
  };
  const [
    colsRes,
    envsRes,
    cookiesRes,
    testCasesRes,
    testPlansRes,
    defectsRes,
    requirementsRes,
    sharedStepsRes,
    mockServersRes,
  ] = await Promise.all([
    emb.get('/collections'),
    emb.get('/environments'),
    emb.get('/cookies'),
    safeGet('/test-cases'),
    safeGet('/test-plans'),
    safeGet('/defects'),
    safeGet('/requirements'),
    safeGet('/shared-steps'),
    safeGet('/mock-servers'),
  ]);

  const nestedCollections = unwrapData<Array<Collection & { shared?: boolean; requests?: SavedRequest[]; children?: Collection[] }>>(colsRes.data) || [];

  const collectionsOut: Array<Record<string, unknown>> = [];
  const requestsOut: Array<Record<string, unknown>> = [];

  const walk = (nodes: Array<Collection & { shared?: boolean; requests?: SavedRequest[]; children?: Collection[] }>) => {
    for (const node of nodes) {
      if (node.shared) continue;
      const { children, requests, ...rest } = node;
      collectionsOut.push({
        id: rest.id,
        name: rest.name,
        description: rest.description || '',
        type: rest.type,
        parentId: rest.parentId,
        baseUrl: rest.baseUrl || '',
        sourceUrl: rest.sourceUrl || '',
        sourceType: rest.sourceType || '',
        sortOrder: rest.sortOrder || 0,
      });
      if (Array.isArray(requests)) {
        for (const r of requests) {
          requestsOut.push({
            id: r.id,
            collectionId: r.collectionId,
            name: r.name,
            method: r.method,
            url: r.url,
            // Embedded BE returns these as JSON strings, same as remote — forward as-is.
            headers: typeof r.headers === 'string' ? r.headers : JSON.stringify(r.headers ?? []),
            params: typeof r.params === 'string' ? r.params : JSON.stringify(r.params ?? []),
            body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? { type: 'none', content: '' }),
            auth: typeof r.auth === 'string' ? r.auth : JSON.stringify(r.auth ?? { type: 'none' }),
            preRequestScript: r.preRequestScript || '',
            testScript: r.testScript || '',
            sortOrder: r.sortOrder || 0,
          });
        }
      }
      if (Array.isArray(children) && children.length > 0) walk(children);
    }
  };
  walk(nestedCollections);

  // Embedded BE also exposes /requests/:id etc., but collections with
  // empty `requests` fields only happen when the list endpoint decides
  // not to join. Fall back to a per-collection fetch for those cases.
  const collectionsMissingRequests = collectionsOut.filter(
    (c) => !requestsOut.some((r) => r.collectionId === c.id) && c.type === 'collection',
  );
  for (const c of collectionsMissingRequests) {
    try {
      const res = await emb.get(`/collections/${c.id}/requests`);
      const reqs = unwrapData<SavedRequest[]>(res.data) || [];
      for (const r of reqs) {
        requestsOut.push({
          id: r.id,
          collectionId: r.collectionId,
          name: r.name,
          method: r.method,
          url: r.url,
          headers: typeof r.headers === 'string' ? r.headers : JSON.stringify(r.headers ?? []),
          params: typeof r.params === 'string' ? r.params : JSON.stringify(r.params ?? []),
          body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? { type: 'none', content: '' }),
          auth: typeof r.auth === 'string' ? r.auth : JSON.stringify(r.auth ?? { type: 'none' }),
          preRequestScript: r.preRequestScript || '',
          testScript: r.testScript || '',
          sortOrder: r.sortOrder || 0,
        });
      }
    } catch {
      // Best-effort: missing requests on a single collection shouldn't abort the whole sync.
    }
  }

  const envs = unwrapData<Array<Record<string, unknown>>>(envsRes.data) || [];
  const environmentsOut = envs.map((e) => ({
    id: e.id,
    name: e.name,
    variables: typeof e.variables === 'string' ? e.variables : JSON.stringify(e.variables ?? []),
    isActive: Boolean(e.isActive),
  }));

  const cookies = unwrapData<Array<Record<string, unknown>>>(cookiesRes.data) || [];
  const cookiesOut = cookies.map((ck) => ({
    id: ck.id,
    domain: ck.domain,
    name: ck.name,
    value: ck.value,
    path: ck.path || '/',
    secure: Boolean(ck.secure),
    httpOnly: Boolean(ck.httpOnly),
    sameSite: (ck.sameSite as string | undefined) || '',
    expiresAt: ck.expiresAt ?? null,
  }));

  // Whiteboards: metadata only. The list endpoint omits the scene body, which
  // is exactly what we want for the plan/count pass — scenes are fetched
  // per-id in applyFirstSyncFromEmbedded for the boards actually pushed.
  const boards = unwrapData<Array<Record<string, unknown>>>(
    (await safeGet('/whiteboards')) as { data?: unknown },
  ) || [];
  const whiteboardsOut = boards.map((w) => ({
    id: w.id,
    name: w.name,
    parentId: w.parentId ?? null,
    type: (w.type as string) || 'whiteboard',
    sortOrder: w.sortOrder || 0,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  }));

  // QA entities pass through as-is: the embedded BE serializes them in the
  // same DB-shaped form that /sync/initial-push accepts (tags as comma-
  // separated strings, steps as JSON strings, results as JSON strings, etc.).
  const testCases = unwrapData<Array<Record<string, unknown>>>(testCasesRes) || [];
  const testPlans = unwrapData<Array<Record<string, unknown>>>(testPlansRes) || [];
  const defects = unwrapData<Array<Record<string, unknown>>>(defectsRes) || [];
  const requirements = unwrapData<Array<Record<string, unknown>>>(requirementsRes) || [];
  const sharedSteps = unwrapData<Array<Record<string, unknown>>>(sharedStepsRes) || [];
  const mockServers = unwrapData<Array<Record<string, unknown>>>(mockServersRes) || [];

  // Mock routes are fetched per-server — the embedded BE doesn't expose a
  // flat list endpoint. Best-effort: if one server's routes fail we keep
  // going so a transient error doesn't nuke the whole merge.
  const mockRoutes: Array<Record<string, unknown>> = [];
  for (const srv of mockServers) {
    const serverId = srv.id as string | undefined;
    if (!serverId) continue;
    try {
      const routesRes = await emb.get(`/mock-servers/${serverId}/routes`);
      const routes = unwrapData<Array<Record<string, unknown>>>(routesRes.data) || [];
      for (const rt of routes) mockRoutes.push(rt);
    } catch {
      // Skip this server's routes on error.
    }
  }

  return {
    collections: collectionsOut,
    requests: requestsOut,
    environments: environmentsOut,
    cookies: cookiesOut,
    testCases,
    testPlans,
    defects,
    requirements,
    sharedSteps,
    mockServers,
    mockRoutes,
    whiteboards: whiteboardsOut,
  };
}

/**
 * Fetch the full scene for each pushed board (folders carry none) from the
 * embedded backend by its ORIGINAL id (_srcId), strip the sync-only _srcId
 * marker, and stamp the scene onto the row so /sync/initial-push stores the
 * drawing. Best-effort per board: a failed fetch pushes the board with an
 * empty scene rather than dropping it.
 */
async function attachBoardScenes(
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const emb = embeddedAxios();
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const { _srcId, ...rest } = row;
    const srcId = (_srcId as string) ?? (rest.id as string);
    if ((rest.type as string) === 'folder') {
      out.push({ ...rest, scene: '' });
      continue;
    }
    let scene = '{}';
    try {
      const res = await emb.get(`/whiteboards/${srcId}`);
      const full = unwrapData<{ scene?: string }>(res.data);
      if (full && typeof full.scene === 'string' && full.scene) scene = full.scene;
    } catch {
      /* best-effort: keep the board, empty scene */
    }
    out.push({ ...rest, scene });
  }
  return out;
}

/**
 * Desktop-local analogue of `initialPush`. Snapshots the embedded sidecar's
 * SQLite via HTTP and POSTs the payload to the freshly-authenticated
 * remote BE. Call after a successful register/login where the user was
 * previously in local mode and `isDesktop()` is true.
 */
export async function initialPushFromEmbedded(): Promise<InitialPushResult> {
  const snap = await snapshotEmbedded();
  // Fresh account (register from local): ids won't collide, so no remap — fetch
  // scenes by the snapshot ids directly.
  const whiteboards = await attachBoardScenes(snap.whiteboards);
  const payload = {
    collections: snap.collections,
    requests: snap.requests,
    environments: snap.environments,
    cookies: snap.cookies,
    testCases: snap.testCases,
    testPlans: snap.testPlans,
    defects: snap.defects,
    requirements: snap.requirements,
    sharedSteps: snap.sharedSteps,
    mockServers: snap.mockServers,
    mockRoutes: snap.mockRoutes,
    whiteboards,
  };
  const response = await api.post('/sync/initial-push', payload);
  // Interceptor already unwrapped the outer {data:…}.
  return response.data as InitialPushResult;
}

/**
 * Fetch every server-side first-party record so we can compare against the
 * embedded snapshot. Separate from planFirstSync's pull because the shape we
 * need is just ID sets — we don't feed these back into Dexie.
 */
async function fetchRemoteIdSets(): Promise<{
  collections: Set<string>;
  requests: Set<string>;
  envs: Set<string>;
  cookies: Set<string>;
  whiteboards: Set<string>;
  serverCollections: Array<Collection & { userId?: string; createdAt?: string; updatedAt?: string }>;
  serverRequests: SavedRequest[];
  serverEnvs: Array<Environment & { userId?: string; createdAt?: string; updatedAt?: string }>;
  serverCookies: Array<CookieItem & { createdAt?: string; updatedAt?: string }>;
}> {
  const [collectionsRes, envsRes, cookiesRes, boardsRes] = await Promise.all([
    collectionsAPI.list(),
    environmentsAPI.list(),
    cookiesAPI.list(),
    // Best-effort: an older hosted BE without whiteboards 404s — treat as none.
    whiteboardAPI.list().catch(() => ({ data: [] as Array<{ id: string }> })),
  ]);
  const nestedServerCollections = ((collectionsRes.data as unknown) as Array<Collection & { shared?: boolean }>) || [];
  const { collections: serverCollections, requests: serverRequests } = flattenServerCollections(nestedServerCollections);
  const serverEnvs = ((envsRes.data as unknown) as Array<Environment & { userId?: string }>) || [];
  const serverCookies = ((cookiesRes.data as unknown) as CookieItem[]) || [];
  const serverBoards = ((boardsRes.data as unknown) as Array<{ id: string }>) || [];
  return {
    collections: new Set(serverCollections.map((c) => c.id)),
    requests: new Set(serverRequests.map((r) => r.id)),
    envs: new Set(serverEnvs.map((e) => e.id)),
    cookies: new Set(serverCookies.map((ck) => ck.id)),
    whiteboards: new Set(serverBoards.map((w) => w.id)),
    serverCollections,
    serverRequests,
    serverEnvs,
    serverCookies,
  };
}

/**
 * Desktop-local analogue of `planFirstSync`. Snapshots the embedded sidecar,
 * fetches remote state, and computes a rename-on-collision merge plan.
 *
 * Collections/requests/environments/cookies go through the same rename logic
 * as the web path so a returning user keeps both copies on collision. QA
 * entities (testCases, testPlans, defects, requirements, sharedSteps,
 * mockServers, mockRoutes) pass straight through — the BE's OnConflict
 * DoNothing handles dedup, and UUID collisions are astronomically unlikely.
 */
export async function planFirstSyncFromEmbedded(authedUserId: string): Promise<FirstSyncPlanEmbedded> {
  const [snap, remote] = await Promise.all([snapshotEmbedded(), fetchRemoteIdSets()]);

  let renamed = 0;
  const collectionIdRemap = new Map<string, string>();
  const pushCollections: Array<Record<string, unknown>> = [];
  for (const c of snap.collections) {
    const id = c.id as string;
    if (remote.collections.has(id)) {
      const newId = crypto.randomUUID();
      collectionIdRemap.set(id, newId);
      pushCollections.push({ ...c, id: newId, name: `${c.name as string} (1)` });
      renamed++;
    } else {
      pushCollections.push(c);
    }
  }

  let skippedOrphanRequests = 0;
  const pushRequests: Array<Record<string, unknown>> = [];
  const pushedCollectionIds = new Set(pushCollections.map((c) => c.id as string));
  for (const r of snap.requests) {
    const origCollectionId = r.collectionId as string;
    const remappedCollectionId = collectionIdRemap.get(origCollectionId) || origCollectionId;
    if (!remote.collections.has(remappedCollectionId) && !pushedCollectionIds.has(remappedCollectionId)) {
      skippedOrphanRequests++;
      continue;
    }
    const id = r.id as string;
    if (remote.requests.has(id)) {
      pushRequests.push({
        ...r,
        id: crypto.randomUUID(),
        collectionId: remappedCollectionId,
        name: `${r.name as string} (1)`,
      });
      renamed++;
    } else {
      pushRequests.push({ ...r, collectionId: remappedCollectionId });
    }
  }

  const pushEnvs: Array<Record<string, unknown>> = [];
  for (const e of snap.environments) {
    const id = e.id as string;
    if (remote.envs.has(id)) {
      pushEnvs.push({ ...e, id: crypto.randomUUID(), name: `${e.name as string} (1)`, isActive: false });
      renamed++;
    } else {
      pushEnvs.push(e);
    }
  }

  const pushCookies: Array<Record<string, unknown>> = [];
  for (const ck of snap.cookies) {
    const id = ck.id as string;
    if (remote.cookies.has(id)) {
      pushCookies.push({ ...ck, id: crypto.randomUUID() });
      renamed++;
    } else {
      pushCookies.push(ck);
    }
  }

  // Whiteboards are SKIP-on-collision, not rename. Unlike collections, this
  // merge is a repeatable action (the user runs it whenever the AI drops a
  // board on the embedded store), so a shared id means "already synced" — not
  // two different boards. Renaming would duplicate the whole set on every
  // re-run. So we only push boards the remote doesn't already have. _srcId is
  // the embedded id, used at apply to fetch the scene. A pushed board whose
  // parent is an already-synced folder keeps its parentId: that folder is
  // owned on remote, so the BE's ownsParent check leaves the nesting intact.
  // LIMIT: an edit to an already-synced board won't propagate — new boards only.
  const pushWhiteboards: Array<Record<string, unknown>> = [];
  for (const w of snap.whiteboards) {
    const id = w.id as string;
    if (remote.whiteboards.has(id)) continue;
    pushWhiteboards.push({ ...w, _srcId: id });
  }

  return {
    source: 'embedded',
    authedUserId,
    serverCollections: remote.serverCollections,
    serverRequests: remote.serverRequests,
    serverEnvs: remote.serverEnvs,
    serverCookies: remote.serverCookies,
    pushCollections,
    pushRequests,
    pushEnvs,
    pushCookies,
    pushTestCases: snap.testCases,
    pushTestPlans: snap.testPlans,
    pushDefects: snap.defects,
    pushRequirements: snap.requirements,
    pushSharedSteps: snap.sharedSteps,
    pushMockServers: snap.mockServers,
    pushMockRoutes: snap.mockRoutes,
    pushWhiteboards,
    renamed,
    skippedOrphanRequests,
  };
}

/**
 * Apply half for desktop-local. The embedded SQLite is treated as read-only —
 * after this call the user transitions to synced mode and the embedded DB
 * becomes stale (future mutations land on remote). For MVP we only support
 * push direction: 'pull' is a no-op (user opted to drop embedded state), and
 * 'both' degrades to 'push' since we don't rewrite the embedded DB.
 */
export async function applyFirstSyncFromEmbedded(
  plan: FirstSyncPlanEmbedded,
  direction: SyncDirection = 'push',
): Promise<FirstSyncResult> {
  const doPush = direction === 'both' || direction === 'push';
  const hasAnythingToPush =
    plan.pushCollections.length > 0 ||
    plan.pushRequests.length > 0 ||
    plan.pushEnvs.length > 0 ||
    plan.pushCookies.length > 0 ||
    plan.pushTestCases.length > 0 ||
    plan.pushTestPlans.length > 0 ||
    plan.pushDefects.length > 0 ||
    plan.pushRequirements.length > 0 ||
    plan.pushSharedSteps.length > 0 ||
    plan.pushMockServers.length > 0 ||
    plan.pushMockRoutes.length > 0 ||
    plan.pushWhiteboards.length > 0;

  let pushedCollections = 0;
  let pushedRequests = 0;
  let pushedEnvironments = 0;
  let pushedCookies = 0;
  let pushedWhiteboards = 0;
  let whiteboardsPushSupported = true;
  if (doPush && hasAnythingToPush) {
    // Fetch scene bodies only now, only for the boards we're actually pushing.
    const whiteboards = plan.pushWhiteboards.length > 0
      ? await attachBoardScenes(plan.pushWhiteboards)
      : [];
    const payload = {
      collections: plan.pushCollections,
      requests: plan.pushRequests,
      environments: plan.pushEnvs,
      cookies: plan.pushCookies,
      testCases: plan.pushTestCases,
      testPlans: plan.pushTestPlans,
      defects: plan.pushDefects,
      requirements: plan.pushRequirements,
      sharedSteps: plan.pushSharedSteps,
      mockServers: plan.pushMockServers,
      mockRoutes: plan.pushMockRoutes,
      whiteboards,
    };
    const res = await api.post('/sync/initial-push', payload);
    pushedCollections = plan.pushCollections.length;
    pushedRequests = plan.pushRequests.length;
    pushedEnvironments = plan.pushEnvs.length;
    pushedCookies = plan.pushCookies.length;
    pushedWhiteboards = whiteboards.length;
    // Old-BE guard: a hosted BE without whiteboard sync silently drops the
    // field (ShouldBindJSON ignores unknowns). If we sent boards but the result
    // has no `whiteboards` key, they did NOT land — flag it so we don't lie.
    // NB: the response interceptor already unwraps the outer {data:…}, so
    // res.data IS the result object — do NOT read res.data.data (always undefined).
    const result = (res.data ?? {}) as InitialPushResult;
    if (whiteboards.length > 0 && result.whiteboards === undefined) {
      whiteboardsPushSupported = false;
      pushedWhiteboards = 0;
      console.warn(
        `[sync] server accepted the push but did not report whiteboards — ${whiteboards.length} board(s) were NOT synced (hosted backend likely predates whiteboard sync).`,
      );
    }
  }

  return {
    pushedCollections,
    pushedRequests,
    pushedEnvironments,
    pushedCookies,
    // Embedded path doesn't pull into embedded SQLite; those counters stay 0.
    pulledCollections: 0,
    pulledRequests: 0,
    pulledEnvironments: 0,
    pulledCookies: 0,
    pushedWhiteboards,
    whiteboardsPushSupported,
    renamed: doPush ? plan.renamed : 0,
  };
}

export interface OutboxFlushResult {
  sent: number;
  dropped: number;
  remaining: number;
}

/**
 * Enqueue a write that failed because of a transient network error so the
 * client can retry later. Call from HttpRepo's write paths when an axios
 * error with no response (i.e. network-level) is caught.
 */
export async function enqueueOutbox(entry: Omit<OutboxEntry, 'id' | 'createdAt' | 'attempts'>): Promise<void> {
  await db.outbox.put({
    id: crypto.randomUUID(),
    method: entry.method,
    url: entry.url,
    payload: entry.payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
}

function isNetworkError(err: unknown): boolean {
  // Axios populates `response` when the server replied (any status). If it's
  // absent AND the error is an AxiosError, we treat it as network-level
  // (DNS, connection refused, CORS, timeout, offline). Non-axios errors
  // fall through untouched so we don't accidentally queue local bugs.
  const e = err as { isAxiosError?: boolean; response?: unknown; code?: string };
  if (!e?.isAxiosError) return false;
  return !e.response;
}

/**
 * Wrap an idempotent write (PUT / DELETE / upsert) so a network-level
 * failure enqueues the request for later replay instead of just bubbling
 * up. The original error still throws so the caller can surface a UI hint,
 * but the write will eventually land when connectivity returns and
 * `flushOutbox` runs (triggered from authStore after login/loadUser).
 *
 * Do NOT use this for POST/create paths — the server assigns IDs, so a
 * replay would create duplicate rows if the original request actually
 * succeeded and only the response was lost.
 */
export async function writeWithOutbox<T>(
  fn: () => Promise<T>,
  entry: { method: 'PUT' | 'DELETE' | 'POST'; url: string; payload?: unknown },
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isNetworkError(err)) {
      try {
        await enqueueOutbox(entry);
      } catch {
        // Dexie failure shouldn't mask the original network error.
      }
    }
    throw err;
  }
}

/**
 * Replay every queued write in order. Sent-successfully and 4xx entries are
 * removed (4xx is permanent — retrying won't help). 5xx and network errors
 * stay in the queue with an incremented attempt counter so a later flush
 * picks them up. Safe to call fire-and-forget after login or loadUser.
 */
export async function flushOutbox(): Promise<OutboxFlushResult> {
  const entries = await db.outbox.orderBy('createdAt').toArray();
  let sent = 0;
  let dropped = 0;
  for (const entry of entries) {
    try {
      await api.request({ method: entry.method, url: entry.url, data: entry.payload });
      await db.outbox.delete(entry.id);
      sent++;
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        // Permanent client-side error — retrying won't help. Drop it.
        await db.outbox.delete(entry.id);
        dropped++;
      } else {
        // 5xx or network error — leave in queue for a future flush.
        await db.outbox.update(entry.id, { attempts: entry.attempts + 1 });
      }
    }
  }
  const remaining = await db.outbox.count();
  return { sent, dropped, remaining };
}
