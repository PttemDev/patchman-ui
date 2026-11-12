import type {
  Collection,
  CookieItem,
  Defect,
  Environment,
  HistoryItem,
  Requirement,
  SavedRequest,
  SavedResponseDetail,
  SavedResponseInput,
  SavedResponseSummary,
  Workspace,
} from '@/types';

export interface TraceabilityLink {
  testCaseId: string;
  title: string;
  status: 'passed' | 'failed' | 'pending' | 'draft';
}

export interface TraceabilityEntry {
  requirementId: string;
  testCases: TraceabilityLink[];
}

export interface Capabilities {
  canShare: boolean;
  canInviteMember: boolean;
  canAudit: boolean;
  canServerProxy: boolean;
  canRunLoadTest: boolean;
  canComment: boolean;
  canWorkspace: boolean;
  canRunScripts: boolean;
  canJoinShared: boolean;
  canSwaggerSync: boolean;
  canGlobalSearch: boolean;
}

export interface CollectionsRepo {
  list(workspaceId?: string): Promise<Collection[]>;
  // Discovery query for the Public sidebar accordion — returns every
  // public-visibility collection the caller can see via grants (own
  // public + team grants + everyone grants). Optional in the repo
  // interface so non-HTTP backends (web-local IndexedDB) can return
  // an empty list without throwing — public collections are inherently
  // a server-side concept.
  listPublic?(): Promise<Collection[]>;
  create(input: Partial<Collection>): Promise<Collection>;
  update(id: string, patch: Partial<Collection>): Promise<Collection>;
  remove(id: string): Promise<void>;
}

export interface RequestsRepo {
  listByCollection(collectionId: string): Promise<SavedRequest[]>;
  create(input: Partial<SavedRequest> & { collectionId: string }): Promise<SavedRequest>;
  update(id: string, patch: Partial<SavedRequest>): Promise<SavedRequest>;
  remove(id: string): Promise<void>;
}

export interface EnvironmentsRepo {
  list(workspaceId?: string): Promise<Environment[]>;
  create(input: Partial<Environment>): Promise<Environment>;
  update(id: string, patch: Partial<Environment>): Promise<Environment>;
  remove(id: string): Promise<void>;
  activate(id: string | null, workspaceId?: string): Promise<void>;
}

export interface HistoryRepo {
  list(page?: number, limit?: number): Promise<HistoryItem[]>;
  append(item: Omit<HistoryItem, 'id' | 'createdAt'> & Partial<Pick<HistoryItem, 'id' | 'createdAt'>>): Promise<void>;
  clear(): Promise<void>;
}

/** Request/response pairs kept under collections ("Save response"). */
export interface SavedResponsesRepo {
  /** requestId narrows the list to one saved request's responses. */
  list(collectionIds: string[], requestId?: string): Promise<SavedResponseSummary[]>;
  get(id: string): Promise<SavedResponseDetail>;
  create(input: SavedResponseInput): Promise<SavedResponseSummary>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface CookiesRepo {
  list(domain?: string): Promise<CookieItem[]>;
  set(input: Partial<CookieItem>): Promise<void>;
  remove(id: string): Promise<void>;
  clear(domain?: string): Promise<void>;
}

export interface DefectsRepo {
  list(filters?: { status?: string; priority?: string; severity?: string }): Promise<Defect[]>;
  get(id: string): Promise<Defect>;
  create(input: Partial<Defect>): Promise<Defect>;
  update(id: string, patch: Partial<Defect>): Promise<Defect>;
  remove(id: string): Promise<void>;
}

export interface RequirementsRepo {
  list(filters?: { type?: string; priority?: string; status?: string }): Promise<Requirement[]>;
  get(id: string): Promise<Requirement>;
  create(input: Partial<Requirement>): Promise<Requirement>;
  update(id: string, patch: Partial<Requirement>): Promise<Requirement>;
  remove(id: string): Promise<void>;
  traceability(): Promise<TraceabilityEntry[]>;
}

export interface WorkspacesRepo {
  list(): Promise<Workspace[]>;
  create(input: { name: string; description?: string; type?: 'personal' | 'team' }): Promise<Workspace>;
  update(id: string, patch: { name?: string; description?: string }): Promise<Workspace>;
  remove(id: string): Promise<void>;
}

export interface Repository {
  collections: CollectionsRepo;
  requests: RequestsRepo;
  environments: EnvironmentsRepo;
  history: HistoryRepo;
  savedResponses: SavedResponsesRepo;
  cookies: CookiesRepo;
  defects: DefectsRepo;
  requirements: RequirementsRepo;
  workspaces: WorkspacesRepo;
  capabilities: Capabilities;
}
