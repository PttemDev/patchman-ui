import type {
  Collection,
  CookieItem,
  Defect,
  Environment,
  HistoryItem,
  Requirement,
  SavedRequest,
  SavedResponseDetail,
  SavedResponseSummary,
  Workspace,
} from '@/types';
import {
  collectionsAPI,
  cookiesAPI,
  defectsAPI,
  environmentsAPI,
  historyAPI,
  requestsAPI,
  savedResponsesAPI,
  requirementsAPI,
  workspacesAPI,
} from '@/services/api';
import { writeWithOutbox } from '@/data/sync/SyncEngine';
import type {
  Capabilities,
  CollectionsRepo,
  CookiesRepo,
  DefectsRepo,
  EnvironmentsRepo,
  HistoryRepo,
  RequestsRepo,
  SavedResponsesRepo,
  RequirementsRepo,
  Repository,
  TraceabilityEntry,
  WorkspacesRepo,
} from '../types';

async function loadRequestsForCollections(collections: Collection[]): Promise<Collection[]> {
  return Promise.all(
    collections.map(async (col) => {
      let requests = col.requests;
      if (!requests || requests.length === 0) {
        try {
          const res = await requestsAPI.list(col.id);
          requests = (res.data as unknown as SavedRequest[]) || [];
        } catch {
          requests = [];
        }
      }
      const children = col.children && col.children.length > 0
        ? await loadRequestsForCollections(col.children)
        : col.children || [];
      return { ...col, requests, children };
    }),
  );
}

const collectionsRepo: CollectionsRepo = {
  async list(workspaceId?: string) {
    const response = await collectionsAPI.list(workspaceId);
    return loadRequestsForCollections(response.data || []);
  },
  async listPublic() {
    const response = await collectionsAPI.listPublic();
    return loadRequestsForCollections(response.data || []);
  },
  async create(input) {
    const response = await collectionsAPI.create(input);
    return response.data as Collection;
  },
  async update(id, patch) {
    const response = await writeWithOutbox(
      () => collectionsAPI.update(id, patch),
      { method: 'PUT', url: `/collections/${id}`, payload: patch },
    );
    return response.data as Collection;
  },
  async remove(id) {
    await writeWithOutbox(
      () => collectionsAPI.delete(id),
      { method: 'DELETE', url: `/collections/${id}` },
    );
  },
};

function serializeRequestPayload(data: Partial<SavedRequest>): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...data };
  if (data.headers !== undefined) payload.headers = typeof data.headers === 'string' ? data.headers : JSON.stringify(data.headers);
  if (data.params !== undefined) payload.params = typeof data.params === 'string' ? data.params : JSON.stringify(data.params);
  if (data.pathParams !== undefined) payload.pathParams = typeof data.pathParams === 'string' ? data.pathParams : JSON.stringify(data.pathParams);
  if (data.body !== undefined) payload.body = typeof data.body === 'string' ? data.body : JSON.stringify(data.body);
  if (data.auth !== undefined) payload.auth = typeof data.auth === 'string' ? data.auth : JSON.stringify(data.auth);
  return payload;
}

const requestsRepo: RequestsRepo = {
  async listByCollection(collectionId) {
    const response = await requestsAPI.list(collectionId);
    return (response.data as unknown as SavedRequest[]) || [];
  },
  async create(input) {
    const payload = serializeRequestPayload(input);
    payload.collectionId = input.collectionId;
    const response = await requestsAPI.create(payload);
    return response.data as SavedRequest;
  },
  async update(id, patch) {
    const payload = serializeRequestPayload(patch);
    const response = await writeWithOutbox(
      () => requestsAPI.update(id, payload),
      { method: 'PUT', url: `/requests/${id}`, payload },
    );
    return response.data as SavedRequest;
  },
  async remove(id) {
    await writeWithOutbox(
      () => requestsAPI.delete(id),
      { method: 'DELETE', url: `/requests/${id}` },
    );
  },
};

const environmentsRepo: EnvironmentsRepo = {
  async list(workspaceId?: string) {
    const response = await environmentsAPI.list(workspaceId);
    const raw = (response.data as unknown as Array<Record<string, unknown>>) || [];
    return raw.map((env) => ({
      ...env,
      variables: typeof env.variables === 'string'
        ? (env.variables ? JSON.parse(env.variables as string) : [])
        : (env.variables || []),
    })) as Environment[];
  },
  async create(input) {
    const payload: Record<string, unknown> = {
      ...input,
      variables: input.variables ? JSON.stringify(input.variables) : '[]',
    };
    const response = await environmentsAPI.create(payload as Partial<Environment>);
    return response.data as Environment;
  },
  async update(id, patch) {
    const payload: Record<string, unknown> = { ...patch };
    if (patch.variables !== undefined) {
      payload.variables = JSON.stringify(patch.variables);
    }
    const response = await writeWithOutbox(
      () => environmentsAPI.update(id, payload as Partial<Environment>),
      { method: 'PUT', url: `/environments/${id}`, payload },
    );
    return response.data as Environment;
  },
  async remove(id) {
    await writeWithOutbox(
      () => environmentsAPI.delete(id),
      { method: 'DELETE', url: `/environments/${id}` },
    );
  },
  async activate(id, workspaceId) {
    if (id === null) return;
    await writeWithOutbox(
      () => environmentsAPI.activate(id, workspaceId),
      {
        method: 'PUT',
        url: `/environments/${id}/activate${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`,
      },
    );
  },
};

const historyRepo: HistoryRepo = {
  async list(page = 1, limit = 50) {
    const response = await historyAPI.list(page, limit);
    const data = response.data as unknown as { items?: HistoryItem[] } | HistoryItem[];
    if (Array.isArray(data)) return data;
    return data.items || [];
  },
  async append() {
    // BE auto-records history via proxy endpoint; nothing to do here.
  },
  async clear() {
    await historyAPI.clear();
  },
};

const savedResponsesRepo: SavedResponsesRepo = {
  async list(collectionIds, requestId) {
    if (collectionIds.length === 0) return [];
    const res = await savedResponsesAPI.list(collectionIds, requestId);
    return (res.data as unknown as SavedResponseSummary[]) ?? [];
  },
  async get(id) {
    const res = await savedResponsesAPI.get(id);
    return res.data as unknown as SavedResponseDetail;
  },
  async create(input) {
    const res = await savedResponsesAPI.create(input);
    return res.data as unknown as SavedResponseSummary;
  },
  async rename(id, name) {
    await savedResponsesAPI.rename(id, name);
  },
  async remove(id) {
    await savedResponsesAPI.delete(id);
  },
};

const cookiesRepo: CookiesRepo = {
  async list(domain) {
    const response = await cookiesAPI.list(domain);
    return (response.data as unknown as CookieItem[]) || [];
  },
  async set(input) {
    // BE `Set` upserts by (userID, domain, name, path), so replay is safe.
    await writeWithOutbox(
      () => cookiesAPI.set(input),
      { method: 'POST', url: '/cookies', payload: input },
    );
  },
  async remove(id) {
    await writeWithOutbox(
      () => cookiesAPI.delete(id),
      { method: 'DELETE', url: `/cookies/${id}` },
    );
  },
  async clear(domain) {
    await writeWithOutbox(
      () => cookiesAPI.clear(domain),
      { method: 'DELETE', url: domain ? `/cookies?domain=${encodeURIComponent(domain)}` : '/cookies' },
    );
  },
};

// BE persists defect/requirement tags as a JSON-encoded string; FE types expose
// them as string[]. Normalize in both directions so callers can stay array-shaped.
function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function serializeTags(tags: unknown): string | undefined {
  if (tags === undefined) return undefined;
  if (Array.isArray(tags)) return JSON.stringify(tags);
  if (typeof tags === 'string') return tags;
  return JSON.stringify([]);
}

function normalizeDefect(raw: Record<string, unknown>): Defect {
  return { ...raw, tags: parseTags(raw.tags) } as Defect;
}

function normalizeRequirement(raw: Record<string, unknown>): Requirement {
  return { ...raw, tags: parseTags(raw.tags) } as Requirement;
}

function serializeDefectPayload(data: Partial<Defect>): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...data };
  if (data.tags !== undefined) payload.tags = serializeTags(data.tags);
  return payload;
}

function serializeRequirementPayload(data: Partial<Requirement>): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...data };
  if (data.tags !== undefined) payload.tags = serializeTags(data.tags);
  return payload;
}

const defectsRepo: DefectsRepo = {
  async list(filters) {
    const params: Record<string, string> = {};
    if (filters?.status) params.status = filters.status;
    if (filters?.priority) params.priority = filters.priority;
    if (filters?.severity) params.severity = filters.severity;
    const response = await defectsAPI.list(Object.keys(params).length ? params : undefined);
    const raw = (response.data as unknown as Array<Record<string, unknown>>) || [];
    return raw.map(normalizeDefect);
  },
  async get(id) {
    const response = await defectsAPI.get(id);
    return normalizeDefect(response.data as Record<string, unknown>);
  },
  async create(input) {
    const response = await defectsAPI.create(serializeDefectPayload(input));
    return normalizeDefect(response.data as Record<string, unknown>);
  },
  async update(id, patch) {
    const payload = serializeDefectPayload(patch);
    const response = await writeWithOutbox(
      () => defectsAPI.update(id, payload),
      { method: 'PUT', url: `/defects/${id}`, payload },
    );
    return normalizeDefect(response.data as Record<string, unknown>);
  },
  async remove(id) {
    await writeWithOutbox(
      () => defectsAPI.delete(id),
      { method: 'DELETE', url: `/defects/${id}` },
    );
  },
};

const requirementsRepo: RequirementsRepo = {
  async list(filters) {
    const params: Record<string, string> = {};
    if (filters?.type) params.type = filters.type;
    if (filters?.priority) params.priority = filters.priority;
    if (filters?.status) params.status = filters.status;
    const response = await requirementsAPI.list(Object.keys(params).length ? params : undefined);
    const raw = (response.data as unknown as Array<Record<string, unknown>>) || [];
    return raw.map(normalizeRequirement);
  },
  async get(id) {
    const response = await requirementsAPI.get(id);
    return normalizeRequirement(response.data as Record<string, unknown>);
  },
  async create(input) {
    const response = await requirementsAPI.create(serializeRequirementPayload(input));
    return normalizeRequirement(response.data as Record<string, unknown>);
  },
  async update(id, patch) {
    const payload = serializeRequirementPayload(patch);
    const response = await writeWithOutbox(
      () => requirementsAPI.update(id, payload),
      { method: 'PUT', url: `/requirements/${id}`, payload },
    );
    return normalizeRequirement(response.data as Record<string, unknown>);
  },
  async remove(id) {
    await writeWithOutbox(
      () => requirementsAPI.delete(id),
      { method: 'DELETE', url: `/requirements/${id}` },
    );
  },
  async traceability() {
    // BE returns rows shaped as { requirement: {...}, testCases: [{testCase, latestStatus}], coverage }.
    // Flatten to TraceabilityEntry so the FE can read `requirementId` and per-case
    // `{testCaseId, title, status}` directly. Without this transform every entry
    // gets keyed by `undefined` and link-state stays out of sync after a toggle.
    const response = await requirementsAPI.traceability();
    const raw = (response.data as unknown as Array<{
      requirement?: { id?: string };
      testCases?: Array<{
        testCase?: { id?: string; title?: string };
        latestStatus?: string;
      }>;
    }>) || [];
    return raw.map((row) => ({
      requirementId: row.requirement?.id ?? '',
      testCases: (row.testCases || []).map((tc) => ({
        testCaseId: tc.testCase?.id ?? '',
        title: tc.testCase?.title ?? '',
        status: (tc.latestStatus as TraceabilityEntry['testCases'][number]['status']) ?? 'pending',
      })),
    }));
  },
};

const httpCapabilities: Capabilities = {
  canShare: true,
  canInviteMember: true,
  canAudit: true,
  canServerProxy: true,
  canRunLoadTest: true,
  canComment: true,
  canWorkspace: true,
  canRunScripts: true,
  canJoinShared: true,
  canSwaggerSync: true,
  canGlobalSearch: true,
};

const workspacesRepo: WorkspacesRepo = {
  async list() {
    const response = await workspacesAPI.list();
    return (response.data as unknown as Workspace[]) || [];
  },
  async create(input) {
    const response = await workspacesAPI.create(input);
    return response.data as Workspace;
  },
  async update(id, patch) {
    const response = await writeWithOutbox(
      () => workspacesAPI.update(id, patch),
      { method: 'PUT', url: `/workspaces/${id}`, payload: patch },
    );
    return response.data as Workspace;
  },
  async remove(id) {
    await writeWithOutbox(
      () => workspacesAPI.delete(id),
      { method: 'DELETE', url: `/workspaces/${id}` },
    );
  },
};

export const httpRepo: Repository = {
  collections: collectionsRepo,
  requests: requestsRepo,
  environments: environmentsRepo,
  history: historyRepo,
  savedResponses: savedResponsesRepo,
  cookies: cookiesRepo,
  defects: defectsRepo,
  requirements: requirementsRepo,
  workspaces: workspacesRepo,
  capabilities: httpCapabilities,
};
