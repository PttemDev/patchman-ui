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
} from '@/types';
import { db, HISTORY_RETENTION_DAYS, pruneHistory, type LocalCollection, type LocalDefect, type LocalEnvironment, type LocalRequirement, type LocalSavedRequest, type LocalWorkspace } from '../db';
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
  WorkspacesRepo,
} from '../types';
import type { Workspace } from '@/types';

const LOCAL_USER_ID = 'local';

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function stripCollection(item: LocalCollection): Collection {
  const { _dirty, _deleted, _origin, ...rest } = item;
  void _dirty; void _deleted; void _origin;
  return rest as Collection;
}

function stripRequest(item: LocalSavedRequest): SavedRequest {
  const { _dirty, _deleted, _origin, ...rest } = item;
  void _dirty; void _deleted; void _origin;
  return rest as SavedRequest;
}

function stripEnvironment(item: LocalEnvironment): Environment {
  const { _dirty, _deleted, _origin, ...rest } = item;
  void _dirty; void _deleted; void _origin;
  return rest as Environment;
}

function stripDefect(item: LocalDefect): Defect {
  const { _dirty, _deleted, _origin, ...rest } = item;
  void _dirty; void _deleted; void _origin;
  return rest as Defect;
}

function stripRequirement(item: LocalRequirement): Requirement {
  const { _dirty, _deleted, _origin, ...rest } = item;
  void _dirty; void _deleted; void _origin;
  return rest as Requirement;
}

function stripWorkspace(item: LocalWorkspace): Workspace {
  const { _dirty, _deleted, _origin, ...rest } = item;
  void _dirty; void _deleted; void _origin;
  return rest as Workspace;
}

async function listCollectionTreeInternal(workspaceId?: string): Promise<Collection[]> {
  const [rawCollections, rawRequests] = await Promise.all([
    db.collections.toArray(),
    db.requests.toArray(),
  ]);

  // When a workspaceId is given, include collections pinned to that workspace
  // plus "global" rows (workspaceId empty) so pre-workspace data stays
  // visible. Undefined workspaceId means "show everything" (the All view).
  const matchesWorkspace = (ws: string | undefined): boolean => {
    if (workspaceId === undefined) return true;
    const w = ws ?? '';
    return w === workspaceId || w === '';
  };

  const collections = rawCollections
    .filter((c) => !c._deleted)
    .filter((c) => matchesWorkspace(c.workspaceId));
  const requests = rawRequests.filter((r) => !r._deleted);

  const requestsByCollection = new Map<string, SavedRequest[]>();
  for (const r of requests) {
    const list = requestsByCollection.get(r.collectionId) || [];
    list.push(stripRequest(r));
    requestsByCollection.set(r.collectionId, list);
  }
  for (const [, list] of requestsByCollection) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const byId = new Map<string, Collection & { children?: Collection[] }>();
  for (const c of collections) {
    byId.set(c.id, { ...stripCollection(c), children: [], requests: requestsByCollection.get(c.id) || [] });
  }

  const roots: Collection[] = [];
  for (const c of byId.values()) {
    if (c.parentId && byId.has(c.parentId)) {
      byId.get(c.parentId)!.children!.push(c);
    } else {
      roots.push(c);
    }
  }

  const sortRec = (list: Collection[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const c of list) if (c.children) sortRec(c.children);
  };
  sortRec(roots);
  return roots;
}

const collectionsRepo: CollectionsRepo = {
  async list(workspaceId) {
    return listCollectionTreeInternal(workspaceId);
  },
  async create(input) {
    const id = input.id || newId();
    const ts = now();
    const doc: LocalCollection = {
      id,
      userId: LOCAL_USER_ID,
      workspaceId: input.workspaceId || '',
      name: input.name || 'Untitled',
      description: input.description || '',
      type: input.type || 'collection',
      parentId: input.parentId || null,
      sortOrder: input.sortOrder ?? 0,
      baseUrl: input.baseUrl || '',
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      createdAt: ts,
      updatedAt: ts,
      _dirty: true,
      _origin: 'local',
    };
    await db.collections.put(doc);
    return stripCollection(doc);
  },
  async update(id, patch) {
    const existing = await db.collections.get(id);
    if (!existing) throw new Error('Collection not found');
    const merged: LocalCollection = { ...existing, ...patch, updatedAt: now(), _dirty: true };
    await db.collections.put(merged);
    // Cascade workspace moves down the tree so descendants stay in the same
    // workspace as their root — mirrors the BE's cascadeWorkspace helper.
    if (patch.workspaceId !== undefined) {
      const cascade = async (parentId: string, workspaceId: string) => {
        const children = await db.collections.where('parentId').equals(parentId).toArray();
        for (const child of children) {
          if (child._deleted) continue;
          await db.collections.put({ ...child, workspaceId, updatedAt: now(), _dirty: true });
          await cascade(child.id, workspaceId);
        }
      };
      await cascade(id, patch.workspaceId ?? '');
    }
    return stripCollection(merged);
  },
  async remove(id) {
    const toDelete = new Set<string>();
    const collectAll = async (rootId: string) => {
      toDelete.add(rootId);
      const children = await db.collections.where('parentId').equals(rootId).toArray();
      for (const child of children) {
        await collectAll(child.id);
      }
    };
    await collectAll(id);
    const parentId = (await db.collections.get(id))?.parentId;
    await db.transaction('rw', db.collections, db.requests, db.savedResponses, async () => {
      await db.requests.where('collectionId').anyOf([...toDelete]).delete();
      // Saved responses: a folder's move up to its parent; a whole
      // collection's go with it.
      const saved = db.savedResponses.where('collectionId').anyOf([...toDelete]);
      if (parentId) await saved.modify({ collectionId: parentId });
      else await saved.delete();
      await db.collections.bulkDelete([...toDelete]);
    });
  },
};

const requestsRepo: RequestsRepo = {
  async listByCollection(collectionId) {
    const items = await db.requests.where('collectionId').equals(collectionId).toArray();
    return items.filter((r) => !r._deleted).sort((a, b) => a.sortOrder - b.sortOrder).map((r) => stripRequest(r));
  },
  async create(input) {
    const id = input.id || newId();
    const ts = now();
    const doc: LocalSavedRequest = {
      id,
      collectionId: input.collectionId,
      name: input.name || 'New Request',
      method: input.method || 'GET',
      url: input.url || '',
      headers: (input.headers as unknown as SavedRequest['headers']) ?? [],
      params: (input.params as unknown as SavedRequest['params']) ?? [],
      body: (input.body as SavedRequest['body']) ?? { type: 'none', content: '' },
      auth: (input.auth as SavedRequest['auth']) ?? { type: 'none' },
      preRequestScript: input.preRequestScript || '',
      testScript: input.testScript || '',
      sortOrder: input.sortOrder ?? 0,
      createdAt: ts,
      updatedAt: ts,
      _dirty: true,
      _origin: 'local',
    };
    await db.requests.put(doc);
    return stripRequest(doc);
  },
  async update(id, patch) {
    const existing = await db.requests.get(id);
    if (!existing) throw new Error('Request not found');
    const merged: LocalSavedRequest = { ...existing, ...patch, updatedAt: now(), _dirty: true };
    await db.requests.put(merged);
    return stripRequest(merged);
  },
  async remove(id) {
    await db.requests.delete(id);
  },
};

const environmentsRepo: EnvironmentsRepo = {
  async list(workspaceId) {
    const items = await db.environments.toArray();
    // Match collections behavior: when scoped, return envs pinned to this
    // workspace plus global (workspaceId empty) envs. Undefined = all.
    return items
      .filter((e) => !e._deleted)
      .filter((e) => {
        if (workspaceId === undefined) return true;
        const w = e.workspaceId ?? '';
        return w === workspaceId || w === '';
      })
      .map((e) => stripEnvironment(e));
  },
  async create(input) {
    const id = input.id || newId();
    const ts = now();
    const doc: LocalEnvironment = {
      id,
      userId: LOCAL_USER_ID,
      workspaceId: input.workspaceId || '',
      name: input.name || 'New Environment',
      variables: input.variables || [],
      isActive: input.isActive ?? false,
      createdAt: ts,
      updatedAt: ts,
      _dirty: true,
      _origin: 'local',
    };
    await db.environments.put(doc);
    return stripEnvironment(doc);
  },
  async update(id, patch) {
    const existing = await db.environments.get(id);
    if (!existing) throw new Error('Environment not found');
    const merged: LocalEnvironment = { ...existing, ...patch, updatedAt: now(), _dirty: true };
    await db.environments.put(merged);
    return stripEnvironment(merged);
  },
  async remove(id) {
    await db.environments.delete(id);
  },
  async activate(id, _workspaceId) {
    // Local mode is single-user, so the legacy isActive flag on the
    // env row is enough — _workspaceId is accepted for type parity
    // with the remote repo but unused here.
    void _workspaceId;
    await db.transaction('rw', db.environments, async () => {
      const all = await db.environments.toArray();
      for (const e of all) {
        const shouldBeActive = id !== null && e.id === id;
        if (e.isActive !== shouldBeActive) {
          await db.environments.put({ ...e, isActive: shouldBeActive, updatedAt: now(), _dirty: true });
        }
      }
    });
  },
};

const historyRepo: HistoryRepo = {
  async list(page = 1, limit = 50) {
    await pruneHistory();
    const offset = (page - 1) * limit;
    return db.history.orderBy('createdAt').reverse().offset(offset).limit(limit).toArray();
  },
  async append(item) {
    const doc: HistoryItem = {
      id: item.id || newId(),
      method: item.method,
      url: item.url,
      statusCode: item.statusCode,
      duration: item.duration,
      createdAt: item.createdAt || now(),
    };
    await db.history.put(doc);
    if (Math.random() < 0.05) {
      pruneHistory().catch(() => {});
    }
  },
  async clear() {
    await db.history.clear();
  },
};

const SAVED_RESPONSE_MAX_BODY = 5 << 20;

function toSummary(row: SavedResponseDetail): SavedResponseSummary {
  return {
    id: row.id, userId: row.userId, collectionId: row.collectionId, requestId: row.requestId, name: row.name,
    method: row.method, url: row.url, statusCode: row.statusCode, statusText: row.statusText, durationMs: row.durationMs,
    responseSize: row.responseSize, bodyBase64: row.bodyBase64, truncated: row.truncated, createdAt: row.createdAt,
    canDelete: true,
  };
}

const savedResponsesRepo: SavedResponsesRepo = {
  async list(collectionIds, requestId) {
    // A request's saved responses wherever they were filed; else by collection.
    if (!requestId && collectionIds.length === 0) return [];
    const rows = requestId
      ? await db.savedResponses.filter((r) => r.requestId === requestId).toArray()
      : await db.savedResponses.where('collectionId').anyOf(collectionIds).toArray();
    return rows
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toSummary);
  },
  async get(id) {
    const row = await db.savedResponses.get(id);
    if (!row) throw new Error('Saved response not found');
    return row;
  },
  async create(input) {
    const body = input.response.body ?? '';
    const truncated = body.length > SAVED_RESPONSE_MAX_BODY;
    const method = (input.method || 'GET').toUpperCase();
    const row = {
      id: newId(),
      userId: LOCAL_USER_ID,
      collectionId: input.collectionId,
      requestId: input.requestId,
      name: input.name.trim() || `${method} ${input.url}`,
      method,
      url: input.url,
      statusCode: input.response.statusCode,
      statusText: input.response.statusText,
      durationMs: input.response.durationMs,
      responseSize: input.response.size,
      bodyBase64: input.response.bodyBase64,
      truncated,
      createdAt: now(),
      canDelete: true,
      request: input.request,
      sent: input.sent,
      responseHeaders: input.response.headers,
      responseBody: truncated ? body.slice(0, SAVED_RESPONSE_MAX_BODY) : body,
    };
    await db.savedResponses.put(row);
    return toSummary(row);
  },
  async rename(id, name) {
    await db.savedResponses.update(id, { name: name.trim() });
  },
  async remove(id) {
    await db.savedResponses.delete(id);
  },
};

const cookiesRepo: CookiesRepo = {
  async list(domain) {
    if (domain) {
      return db.cookies.where('domain').equals(domain).toArray();
    }
    return db.cookies.toArray();
  },
  async set(input) {
    const existing = input.domain && input.name
      ? await db.cookies
          .where({ domain: input.domain, name: input.name, path: input.path || '/' })
          .first()
      : undefined;
    const ts = now();
    const doc: CookieItem & { createdAt: string; updatedAt: string } = {
      id: existing?.id || input.id || newId(),
      domain: input.domain || existing?.domain || '',
      name: input.name || existing?.name || '',
      value: input.value ?? existing?.value ?? '',
      path: input.path || existing?.path || '/',
      secure: input.secure ?? existing?.secure ?? false,
      httpOnly: input.httpOnly ?? existing?.httpOnly ?? false,
      expiresAt: input.expiresAt || existing?.expiresAt,
      createdAt: existing ? (existing as { createdAt?: string }).createdAt || ts : ts,
      updatedAt: ts,
    };
    await db.cookies.put(doc);
  },
  async remove(id) {
    await db.cookies.delete(id);
  },
  async clear(domain) {
    if (domain) {
      await db.cookies.where('domain').equals(domain).delete();
    } else {
      await db.cookies.clear();
    }
  },
};

const defectsRepo: DefectsRepo = {
  async list(filters) {
    let items = await db.defects.toArray();
    items = items.filter((d) => !d._deleted);
    if (filters?.status) items = items.filter((d) => d.status === filters.status);
    if (filters?.priority) items = items.filter((d) => d.priority === filters.priority);
    if (filters?.severity) items = items.filter((d) => d.severity === filters.severity);
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return items.map(stripDefect);
  },
  async get(id) {
    const existing = await db.defects.get(id);
    if (!existing || existing._deleted) throw new Error('Defect not found');
    return stripDefect(existing);
  },
  async create(input) {
    const id = input.id || newId();
    const ts = now();
    const doc: LocalDefect = {
      id,
      userId: LOCAL_USER_ID,
      title: input.title || 'Untitled',
      description: input.description || '',
      status: input.status || 'open',
      priority: input.priority || 'P2',
      severity: input.severity || 'minor',
      assigneeId: input.assigneeId,
      testCaseId: input.testCaseId,
      testRunId: input.testRunId,
      environment: input.environment,
      stepsToReproduce: input.stepsToReproduce,
      tags: input.tags,
      createdAt: ts,
      updatedAt: ts,
      _dirty: true,
      _origin: 'local',
    };
    await db.defects.put(doc);
    return stripDefect(doc);
  },
  async update(id, patch) {
    const existing = await db.defects.get(id);
    if (!existing) throw new Error('Defect not found');
    const merged: LocalDefect = { ...existing, ...patch, updatedAt: now(), _dirty: true };
    await db.defects.put(merged);
    return stripDefect(merged);
  },
  async remove(id) {
    await db.defects.delete(id);
  },
};

const requirementsRepo: RequirementsRepo = {
  async list(filters) {
    let items = await db.requirements.toArray();
    items = items.filter((r) => !r._deleted);
    if (filters?.type) items = items.filter((r) => r.type === filters.type);
    if (filters?.priority) items = items.filter((r) => r.priority === filters.priority);
    if (filters?.status) items = items.filter((r) => r.status === filters.status);
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return items.map(stripRequirement);
  },
  async get(id) {
    const existing = await db.requirements.get(id);
    if (!existing || existing._deleted) throw new Error('Requirement not found');
    return stripRequirement(existing);
  },
  async create(input) {
    const id = input.id || newId();
    const ts = now();
    const doc: LocalRequirement = {
      id,
      userId: LOCAL_USER_ID,
      title: input.title || 'Untitled',
      description: input.description || '',
      type: input.type || 'functional',
      priority: input.priority || 'medium',
      status: input.status || 'draft',
      parentId: input.parentId,
      externalRef: input.externalRef,
      tags: input.tags,
      createdAt: ts,
      updatedAt: ts,
      _dirty: true,
      _origin: 'local',
    };
    await db.requirements.put(doc);
    return stripRequirement(doc);
  },
  async update(id, patch) {
    const existing = await db.requirements.get(id);
    if (!existing) throw new Error('Requirement not found');
    const merged: LocalRequirement = { ...existing, ...patch, updatedAt: now(), _dirty: true };
    await db.requirements.put(merged);
    return stripRequirement(merged);
  },
  async remove(id) {
    await db.requirements.delete(id);
  },
  async traceability() {
    // Test cases aren't in LocalRepo yet (future slice), so traceability is
    // empty in local mode.
    return [];
  },
};

const workspacesRepo: WorkspacesRepo = {
  async list() {
    const items = await db.workspaces.toArray();
    return items.filter((w) => !w._deleted).map(stripWorkspace);
  },
  async create(input) {
    const id = newId();
    const ts = now();
    const doc: LocalWorkspace = {
      id,
      ownerId: LOCAL_USER_ID,
      name: input.name,
      description: input.description || '',
      type: input.type || 'personal',
      createdAt: ts,
      updatedAt: ts,
      _dirty: true,
      _origin: 'local',
    };
    await db.workspaces.put(doc);
    return stripWorkspace(doc);
  },
  async update(id, patch) {
    const existing = await db.workspaces.get(id);
    if (!existing) throw new Error('Workspace not found');
    const merged: LocalWorkspace = { ...existing, ...patch, updatedAt: now(), _dirty: true };
    await db.workspaces.put(merged);
    return stripWorkspace(merged);
  },
  async remove(id) {
    // Unbind any collections/environments pinned to this workspace so they
    // fall back to "global" rather than disappearing from every view.
    await db.transaction('rw', db.collections, db.environments, db.workspaces, async () => {
      const [cols, envs] = await Promise.all([
        db.collections.where('workspaceId').equals(id).toArray(),
        db.environments.where('workspaceId').equals(id).toArray(),
      ]);
      for (const c of cols) await db.collections.put({ ...c, workspaceId: '', updatedAt: now(), _dirty: true });
      for (const e of envs) await db.environments.put({ ...e, workspaceId: '', updatedAt: now(), _dirty: true });
      await db.workspaces.delete(id);
    });
  },
};

const localCapabilities: Capabilities = {
  canShare: false,
  canInviteMember: false,
  canAudit: false,
  canServerProxy: false,
  canRunLoadTest: false,
  canComment: false,
  canWorkspace: true,
  canRunScripts: false,
  canJoinShared: false,
  canSwaggerSync: false,
  canGlobalSearch: true,
};

export const localRepo: Repository = {
  collections: collectionsRepo,
  requests: requestsRepo,
  environments: environmentsRepo,
  history: historyRepo,
  savedResponses: savedResponsesRepo,
  cookies: cookiesRepo,
  defects: defectsRepo,
  requirements: requirementsRepo,
  workspaces: workspacesRepo,
  capabilities: localCapabilities,
};

export { HISTORY_RETENTION_DAYS };
