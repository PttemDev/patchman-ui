export interface User {
  id: string;
  email: string;
  name: string;
  // 'admin' unlocks the /admin dashboard + the X-Act-As-User header on
  // CRUD endpoints. Defaults to 'user' on the BE so an absent field is
  // safe to read as non-admin.
  role?: 'user' | 'admin';
}

export interface Collection {
  id: string;
  // Owner user id — surfaced so the FE can render "you (owner)"
  // affordances on shared collections (e.g. the Public sharing panel's
  // fixed-editor row).
  userId?: string;
  name: string;
  description: string;
  type: 'collection' | 'folder';
  parentId: string | null;
  // Legacy rows created before workspaces may omit this; the BE backfills
  // them lazily on the first /workspaces fetch.
  workspaceId?: string;
  // Public/private toggle introduced by the Teams + Public Sharing RFC.
  // Defaults to 'private' on the BE for backward-compat.
  visibility?: Visibility;
  // Caller's effective role on this collection. Stamped by the BE on
  // the Public-scope discovery path so the FE can gate edit affordances
  // (only owner / editor see the request 3-dot menu in the Public
  // section). Empty on the legacy Private path where ownership is
  // implied.
  myRole?: 'owner' | 'editor' | 'viewer';
  sortOrder: number;
  children?: Collection[];
  requests?: SavedRequest[];
  baseUrl?: string;
  sourceUrl?: string;
  sourceType?: string;
  lastSynced?: string;
  shared?: boolean;
  ownerName?: string;
  // Set on collections the current user owns when they've shared with at
  // least one collaborator. Distinct from `shared`, which means "someone
  // else shared this with me".
  sharedByMe?: boolean;
  collaboratorCount?: number;
  // True when access comes from a team-bound workspace cascade (the
  // caller is in the team the workspace is bound to). Distinct from a
  // per-collection share — there's no share row to drop, so the FE
  // disables Leave + renders a workspace-share icon instead of the
  // generic Users / share icon.
  cascadedViaWorkspace?: boolean;
}

export interface CollectionCollaborator {
  id: string;
  collectionId: string;
  userId: string;
  role: string;
  userName: string;
  userEmail: string;
  createdAt: string;
}

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
  isDefault?: boolean;
}

export interface FormField {
  key: string;
  value: string;
  type: 'text' | 'file';
  enabled: boolean;
  fileName?: string;
  fileType?: string;
}

export interface RequestBody {
  type: 'none' | 'json' | 'form' | 'xml' | 'raw' | 'binary' | 'graphql' | 'soap';
  content: string;
  // Form encoding for type='form'. 'multipart' → multipart/form-data even for
  // text-only fields (curl -F semantics); 'urlencoded' → x-www-form-urlencoded.
  // Absent = legacy heuristic (multipart iff a field is a file). Serialized
  // into the persisted body blob alongside `content`, so it survives save.
  formEncoding?: 'multipart' | 'urlencoded';
  // SOAP mode metadata (serialized into the same body blob — no schema change).
  // The send path derives Content-Type + SOAPAction placement from soapVersion.
  soapVersion?: '1.1' | '1.2';
  soapAction?: string;
  soapOperation?: string;
  wsdlUrl?: string;
}

export interface RequestAuth {
  type: 'none' | 'bearer' | 'basic' | 'apikey' | 'oauth2' | 'digest' | 'aws' | 'hawk' | 'ntlm';
  // Bearer
  token?: string;
  // Basic / Digest / NTLM
  username?: string;
  password?: string;
  // API Key
  key?: string;
  value?: string;
  addTo?: 'header' | 'query';
  // OAuth 2.0
  oauth2GrantType?: 'authorization_code' | 'client_credentials' | 'password' | 'implicit';
  oauth2AuthUrl?: string;
  oauth2TokenUrl?: string;
  oauth2ClientId?: string;
  oauth2ClientSecret?: string;
  oauth2Scope?: string;
  oauth2State?: string;
  oauth2CallbackUrl?: string;
  oauth2AccessToken?: string;
  // Digest
  digestRealm?: string;
  digestNonce?: string;
  digestQop?: string;
  digestOpaque?: string;
  // AWS Signature
  awsAccessKey?: string;
  awsSecretKey?: string;
  awsRegion?: string;
  awsService?: string;
  awsSessionToken?: string;
  // Hawk
  hawkId?: string;
  hawkKey?: string;
  hawkAlgorithm?: string;
  // NTLM
  ntlmDomain?: string;
}

export interface SavedRequest {
  id: string;
  collectionId: string;
  name: string;
  method: string;
  url: string;
  headers: KeyValue[];
  params: KeyValue[];
  pathParams?: KeyValue[];
  body: RequestBody;
  auth: RequestAuth;
  preRequestScript: string;
  testScript: string;
  sortOrder: number;
}

/** The editable request a saved response re-opens (the tab's fields). */
export interface SavedResponseRequest {
  name?: string;
  method: string;
  url: string;
  protocol?: string;
  headers: KeyValue[];
  params: KeyValue[];
  pathParams?: KeyValue[];
  body: RequestBody;
  auth: RequestAuth;
  preRequestScript?: string;
  testScript?: string;
  sendMode?: 'proxy' | 'direct';
  corsBypass?: boolean;
}

/** A saved request/response pair (list row — no bodies). */
export interface SavedResponseSummary {
  id: string;
  userId: string;
  collectionId: string;
  requestId?: string;
  name: string;
  method: string;
  url: string;
  statusCode: number;
  statusText: string;
  durationMs: number;
  responseSize: number;
  bodyBase64?: boolean;
  truncated?: boolean;
  createdAt: string;
  authorName?: string;
  canDelete: boolean;
}

export interface SavedResponseDetail extends SavedResponseSummary {
  request: SavedResponseRequest;
  /** What went on the wire ({{variables}} resolved). */
  sent?: { method: string; url: string; headers: Record<string, string>; body: string; params?: Record<string, string> };
  responseHeaders: Record<string, string>;
  responseBody: string;
}

export interface SavedResponseInput {
  collectionId: string;
  requestId?: string;
  name: string;
  method: string;
  url: string;
  request: SavedResponseRequest;
  sent?: SavedResponseDetail['sent'];
  response: {
    statusCode: number; statusText: string; durationMs: number; size: number;
    headers: Record<string, string>; body: string; bodyBase64?: boolean;
  };
}

export interface ResponseCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  expiresAt?: string;
  rawSetCookie: string;
}

export interface ResponseData {
  statusCode: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  /** True when `body` holds base64-encoded bytes (binary responses —
   *  images, PDFs, media). The Render view decodes it into a data: URL. */
  bodyBase64?: boolean;
  size: number;
  duration: number;
  timing: {
    dns: number;
    tcp: number;
    tls: number;
    ttfb: number;
    total: number;
  };
  responseCookies?: ResponseCookie[];
  contentEncoding?: string; // gzip | deflate | br | zstd if the wire payload was compressed
  /** Resolved remote IP:port the upstream request actually connected to (via
   *  the BE proxy's httptrace) — like Postman's "request sent to" address.
   *  Absent on direct (in-browser fetch) sends, which can't observe it. */
  remoteAddr?: string;
}

// `Visibility` is declared in the Teams block further below; we reference
// it forward in `Environment` (same as `Collection`). TypeScript resolves
// forward type refs within a module, so the order isn't load-bearing.
export interface Environment {
  id: string;
  name: string;
  isActive: boolean;
  // Empty/undefined = global (visible in every workspace); a value scopes the
  // env to just that workspace.
  workspaceId?: string;
  variables: Array<{
    key: string;
    value: string;
    enabled: boolean;
    secret: boolean;
  }>;
  // Sharing-aware fields the BE stamps on the List response. `role`
  // is "owner" / "editor" / "viewer". `shared` is true when this row
  // came in via someone else's share, `sharedByMe` when at least one
  // collaborator has been added to a row I own.
  role?: 'owner' | 'editor' | 'viewer';
  shared?: boolean;
  sharedByMe?: boolean;
  ownerName?: string;
  ownerEmail?: string;
  // Owner user id — surfaced for the same reason as Collection.userId
  // (Public sharing panel's "you (owner)" affordance).
  userId?: string;
  // Public/private toggle parity with Collection.
  visibility?: Visibility;
}

// Wire shape for env collaborators returned by GET /environments/:id/collaborators
export interface EnvironmentCollaborator {
  id: string;
  environmentId: string;
  userId: string;
  role: 'editor' | 'viewer';
  userName: string;
  userEmail: string;
  createdAt: string;
}

export interface HistoryItem {
  id: string;
  method: string;
  url: string;
  statusCode: number;
  duration: number;
  createdAt: string;
}

// Whiteboard is an Excalidraw scene stored on the backend. `scene` is the raw
// Excalidraw scene JSON (elements + appState + files); List responses omit it
// (empty string) and Get returns it in full.
export interface Whiteboard {
  id: string;
  name: string;
  scene: string;
  workspaceId?: string;
  /** Self-referential tree, like Collection: null = root. */
  parentId?: string | null;
  /** 'whiteboard' (a drawable board, default) or 'folder' (holds children). */
  type?: 'whiteboard' | 'folder';
  /** Sibling ordering; drag-drop persists it. */
  sortOrder?: number;
  /** 'private' (owner only) or 'public' (grants/links apply). */
  visibility?: 'private' | 'public';
  /** Present only on "shared with me" rows: the viewer's role + owner. */
  role?: 'viewer' | 'editor';
  shared?: boolean;
  ownerId?: string;
  createdAt: string;
  updatedAt: string;
}

/** A Notes knowledge-base node as listed in the sidebar (no body). */
export interface NoteMeta {
  id: string;
  /** Owner of the tree (inherited from the space), not necessarily the author. */
  userId: string;
  parentId: string | null;
  /** 'folder' holds children only; a 'page' has markdown and may have children too.
   *  A 'card' is an agent-memory knowledge card (one fact + a one-line summary). */
  type: 'page' | 'folder' | 'card' | 'hub';
  title: string;
  slug: string;
  icon?: string;
  sortOrder: number;
  visibility: 'private' | 'public';
  /** Bumps on every title/body change; edits send it back as baseVersion. */
  version: number;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  /** Cards: one-line summary, who wrote it, outdated (superseded) flag. */
  summary?: string;
  source?: 'human' | 'agent';
  /** The AI agent that wrote a card ("Claude Code"), as it named itself over MCP. */
  agent?: string;
  stale?: boolean;
  /** Folders: an agent memory folder (its cards list as cards, not tree rows). */
  memory?: boolean;
  /** Folders inside a memory: the project key whose cards they hold. */
  project?: string;
  /** Public nodes: who they are shared with. */
  sharedWith?: { kind: 'team' | 'user' | 'everyone'; name?: string; role: 'editor' | 'viewer' }[];
  /** Shared-with-me roots: whose tree it is. */
  ownerName?: string;
  /** "Shared with me" rows only. */
  role?: 'viewer' | 'editor';
  shared?: boolean;
  /** Reached through an "everyone" grant (a company-wide space). */
  everyone?: boolean;
}

export interface Note extends Omit<NoteMeta, 'role'> {
  body: string;
  confidence?: number;
  supersededBy?: string | null;
  createdBy: string;
  updatedByName: string;
  createdByName?: string;
  role: 'owner' | 'editor' | 'viewer';
  breadcrumb: { id: string; title: string }[];
}

export interface NoteRevisionMeta {
  id: string;
  version: number;
  title: string;
  authorId: string;
  authorName: string;
  source: 'edit' | 'mcp' | 'restore' | 'git_pull' | 'git_push' | 'git_conflict';
  gitCommitSha?: string;
  createdAt: string;
  updatedAt: string;
}

/** Agent memory: how far a memory reaches, seen by the current user. */
export interface MemoryScope {
  kind: 'personal' | 'team' | 'shared' | 'everyone';
  teams?: string[];
  owner?: string;
}

export interface MemoryFolder {
  id: string;
  parentId: string | null;
  title: string;
  icon?: string;
  ownerId: string;
  ownerName: string;
  scope: MemoryScope;
  canWrite: boolean;
  isOwner: boolean;
  cards: number;
  suggestions: number;
  teamDefault?: boolean;
  /** Folders grouping this memory's cards by project. */
  projects?: MemoryProject[];
}

export interface MemoryProject {
  id: string;
  title: string;
  project: string;
  cards: number;
}

/** The memory graph ("Brain"): memories, projects, cards and what they link to. */
export interface MemoryGraphNode {
  id: string;
  kind: 'memory' | 'project' | 'folder' | 'card' | 'page' | 'entity';
  title: string;
  summary?: string;
  parentId?: string;
  memory?: string;
  project?: string;
  scope?: MemoryScope;
  agent?: string;
  source?: string;
  stale?: boolean;
  uses?: number;
  outside?: boolean;
  updatedAt?: string;
}

export interface MemoryGraphLink {
  src: string;
  dst: string;
  type: NoteLinkType;
  source: string;
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  links: MemoryGraphLink[];
  truncated: boolean;
}

export interface MemorySettings {
  teamFolderId: string;
  llmProviderId: string;
  llmModel: string;
}

export type NoteLinkType = 'depends_on' | 'part_of' | 'contradicts' | 'supersedes' | 'example_of' | 'related' | 'refers_to';

/** One end of a typed note link (GET /notes/:id/links). */
export interface NoteLinkView {
  type: NoteLinkType;
  noteId?: string;
  title?: string;
  icon?: string;
  uri?: string;
  source: 'human' | 'agent' | 'body';
  stale?: boolean;
}

export interface NoteSuggestion {
  id: string;
  kind: 'edit' | 'merge' | 'link' | 'supersede';
  noteId: string;
  noteTitle: string;
  noteType: string;
  folderId: string;
  folderTitle?: string;
  payload: Record<string, unknown>;
  current?: { title: string; summary: string; body: string; version: number };
  target?: { id?: string; title?: string; type?: string; uri?: string };
  createdBy: string;
  createdByName: string;
  /** The agent that proposed it ("Claude Code"). */
  agent?: string;
  createdAt: string;
}

export interface NoteSearchHit {
  id: string;
  title: string;
  type: 'page' | 'folder' | 'card' | 'hub';
  icon?: string;
  snippet: string;
  breadcrumb: string[];
  updatedAt: string;
}

export interface Tab {
  id: string;
  name: string;
  /** 'api' (default) for HTTP requests, 'db' for DB queries, 'kafka' for
   *  the Kafka topic browser, 's3' for the object-storage browser, 'tool'
   *  for a Dev Tools utility (kind in `toolKind`), 'redis' for the Redis
   *  key browser, 'es' for the Elasticsearch console, 'k8s' for the
   *  Kubernetes cluster explorer, 'git' for the Git client.
   *  Omitted on legacy tabs — treat as 'api'. */
  type?: 'api' | 'db' | 'kafka' | 's3' | 'redis' | 'es' | 'k8s' | 'git' | 'tool' | 'excalidraw' | 'note' | 'grafana' | 'rabbit' | 'servicemap' | 'graylog';
  /** Which Dev Tools utility a `type: 'tool'` tab renders. */
  toolKind?: ToolKind;
  /** The whiteboard a `type: 'excalidraw'` tab renders (reuse keys on this). */
  whiteboardId?: string;
  /** For a board shared WITH the user: their role. 'viewer' opens read-only.
   *  Omitted for the user's own boards (they're the owner → editable). */
  whiteboardRole?: 'viewer' | 'editor';
  /** The note a `type: 'note'` tab renders (reuse keys on this). */
  noteId?: string;
  method: string;
  url: string;
  protocol?: string;
  // Per-tab UI selections — kept on the tab (not a global store) so each
  // tab remembers its own open sub-tab. `requestSubTab` is the request
  // editor section (params/headers/body/auth/pre-request/tests/settings);
  // `responseView` is the response viewer section (body/headers/…). Absent
  // on legacy tabs → the editors fall back to their defaults.
  requestSubTab?: string;
  responseView?: string;
  sendMode: 'proxy' | 'direct';
  corsBypass?: boolean;
  requestId?: string;
  /** Saved request a tab re-opened from "Saved responses" came from (not
   *  linked like requestId — editing it doesn't touch the collection); a
   *  response saved from it is filed under that request again. */
  originRequestId?: string;
  headers: KeyValue[];
  params: KeyValue[];
  pathParams?: KeyValue[];
  body: RequestBody;
  auth: RequestAuth;
  preRequestScript: string;
  testScript: string;
  response: ResponseData | null;
  loading: boolean;
  sentRequest?: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
    params: Record<string, string>;
  };
  consoleOutput?: string[];
  // ── DB-tab-only fields ─────────────────────────────────────────────
  /** Connection currently selected on a 'db' tab. */
  dbConnectionId?: string;
  dbQuery?: string;
  dbResult?: DBQueryResult | null;
  /** Inline error from the last execute attempt (driver error, parser
   *  error, etc.). Cleared on next successful run. */
  dbError?: string;
  /** User-set row cap. 500 default unless overridden. 0 = lift (owner only). */
  dbLimit?: number;
  /** Values for {{var}} placeholders in dbQuery. Persists per-tab so the
   *  user doesn't have to re-enter them on tab switch. */
  dbParams?: Record<string, string>;
  /** Auto-refresh interval in seconds. 0 / undef = off. */
  dbAutoRefresh?: number;
  /** Optional pinned query-result history for diff view (newest first). */
  dbHistory?: DBQueryResult[];
  /** Selected statement index for multi-statement results. */
  dbStmtIdx?: number;
  /** All statements when the BE returned more than one. */
  dbStmtResults?: DBQueryResult[];
  /** Page offset for server-side pagination. */
  dbPage?: number;
  /** Per-tab BE override. Default = connection's scope. Mirrors the
   *  request-panel Local/Remote switch so power users can route a
   *  given query through the embedded BE on their desktop instead of
   *  the hosted BE (or vice versa). The picked BE must actually have
   *  the connection — otherwise it returns 404. */
  dbExecScope?: 'local' | 'remote';
  // ── Kafka-tab-only fields ──────────────────────────────────────────
  kafkaConnectionId?: string;
  kafkaTopic?: string;
  /** Per-tab BE override (local/remote). Default = connection's scope. */
  kafkaExecScope?: 'local' | 'remote';
  // Kafka fetch controls, persisted per tab so they survive a tab switch.
  kafkaFetchMode?: string; // KafkaFetchMode ('last' | 'offset' | 'timestamp')
  kafkaFetchN?: number;
  kafkaFetchPartition?: number;
  kafkaFetchOffset?: string;
  kafkaFetchTimestamp?: string;
  kafkaDecode?: string; // DecodeMode ('auto' | 'utf8' | 'hex' | 'base64' | 'json')
  // Per-tab bottom-pane UI state (kept on the tab, not localStorage/local
  // state, so each Kafka tab keeps its own and it survives switching tabs).
  kafkaBottomTab?: string; // 'lag' | 'topics'
  kafkaLagInterval?: string; // 'off' | '2' | '5' | '10' — consumer-lag auto-refresh
  // ── S3-tab-only fields ─────────────────────────────────────────────
  s3ConnectionId?: string;
  s3Bucket?: string;
  s3Prefix?: string;
  /** Per-tab BE override (local/remote). Default = connection's scope. */
  s3ExecScope?: 'local' | 'remote';
  // ── Redis-tab-only fields ──────────────────────────────────────────
  redisConnectionId?: string;
  /** Selected logical DB index for the key browser (0 for cluster). */
  redisDb?: number;
  /** Last MATCH glob used in the scan bar. Persists per-tab. */
  redisKeyPattern?: string;
  /** Per-tab BE override (local/remote). Default = connection's scope. */
  redisExecScope?: 'local' | 'remote';
  // ── Grafana-tab-only fields (Dashboards rail) ─────────────────────
  grafanaConnectionId?: string;
  /** 'dashboard' (default) renders `grafanaDashboardUid`; 'explore' is the free query view. */
  grafanaView?: 'dashboard' | 'explore';
  grafanaDashboardUid?: string;
  /** Public dashboard access token: the tab renders it through Grafana's public API. */
  grafanaPublicToken?: string;
  /** Time range as Grafana expressions ("now-6h" / epoch ms). */
  grafanaRange?: { from: string; to: string };
  /** Variable selections by name. */
  grafanaVars?: Record<string, string[]>;
  /** Auto-refresh interval ("" = off). */
  grafanaRefresh?: string;
  /** Explore state: datasource uid, query text, instant flag. */
  grafanaExplore?: { datasource?: string; query?: string; instant?: boolean; format?: string };
  // ── RabbitMQ-tab-only fields (Messaging rail) ─────────────────────
  rabbitConnectionId?: string;
  /** 'cluster' (default: overview / lists / topology), 'queue' or 'exchange'. */
  rabbitView?: 'cluster' | 'queue' | 'exchange';
  /** Cluster view section. */
  rabbitSection?: 'overview' | 'queues' | 'exchanges' | 'connections' | 'topology';
  /** Selected vhost ("" = all vhosts in the cluster view). */
  rabbitVhost?: string;
  rabbitQueue?: string;
  rabbitExchange?: string;
  /** Queue / exchange view pane. */
  rabbitPane?: string;
  /** Auto-refresh seconds ("" = off). */
  rabbitRefresh?: string;
  // ── Graylog-tab-only fields (Dashboards rail) ─────────────────────
  graylogConnectionId?: string;
  /** 'search' (default) or 'dashboards' (dashboards / saved searches list). */
  graylogView?: 'search' | 'dashboards';
  graylogQuery?: string;
  graylogRange?: GraylogRange;
  /** Stream ids the search is limited to (empty = all readable streams). */
  graylogStreams?: string[];
  // ── Service-map-tab-only fields ────────────────────────────────────
  /** Kubernetes source (config layer). */
  smK8sConnectionId?: string;
  smK8sContext?: string;
  smNamespaces?: string[];
  /** Also read traffic from the cluster's own Prometheus. */
  smClusterProm?: boolean;
  /** Observability sources: connection id or id@scope. */
  smApm?: string[];
  /** 5m | 15m | 1h | 6h | 24h. */
  smRange?: string;
  /** Auto-refresh seconds ("" = off). */
  smRefresh?: string;
  /** 'map' (default) or 'table'. */
  smView?: 'map' | 'table';
  /** Namespaces shown on the map (client-side; empty = all). */
  smNsFilter?: string[];
  /** Fold namespaces into one node each: 'auto' (big maps), 'on', 'off'. */
  smGroup?: 'auto' | 'on' | 'off';
  /** Namespaces opened up while grouped. */
  smExpanded?: string[];
  /** Which BE builds the map. */
  smExecScope?: 'local' | 'remote';
  // ── Elasticsearch-tab-only fields ──────────────────────────────────
  esConnectionId?: string;
  /** Per-tab BE override (local/remote). Default = connection's scope. */
  esExecScope?: 'local' | 'remote';
  /** Kibana-console request buffer (METHOD path\n{json body}, blank-line
   *  separated). Persists per-tab. */
  esQuery?: string;
  /** Last index/alias the console targeted — seeds the index browser + the
   *  mapping completion cache. */
  esIndex?: string;
  // ── Kubernetes-tab-only fields ─────────────────────────────────────
  k8sConnectionId?: string;
  /** Selected kubeconfig context for the explorer. Seeds from the
   *  connection's defaultContext on open. */
  k8sContext?: string;
  /** Selected namespace filter (empty = all / cluster-scoped). */
  k8sNamespace?: string;
  /** Selected resource kind in the left kind nav (pods, deployments, …). */
  k8sKind?: string;
  /** Left-nav view: the Lens-style cluster dashboard ('overview') vs the
   *  resource table ('resources'). Unset defaults to 'overview' until a
   *  resource kind is picked (see K8sExplorerPanel). */
  k8sView?: 'overview' | 'resources';
  /** Per-tab BE override (local/remote). Default = connection's scope. */
  k8sExecScope?: 'local' | 'remote';
  // ── Git-tab-only fields ────────────────────────────────────────────
  gitConnectionId?: string;
  /** Per-tab BE override (local/remote). Default = connection's scope.
   *  Seeded from the connection's resolved scope when the tab opens. */
  gitScope?: 'local' | 'remote';
  /** Selected remote project identifier — String(repo.id), the canonical
   *  `project` the commit/branch/file APIs take. Empty = no repo picked. */
  gitRepoRef?: string;
  /** Display name for the selected repo (fullPath || name). Persisted so the
   *  picker button + tab strip label survive a reload before the repos list
   *  re-fetches. */
  gitRepoName?: string;
  /** Local clone id (models.GitRepo.id) when this repo has been cloned on the
   *  desktop BE. Convenience mirror — the panel also derives it from the
   *  managed-clone list by projectRef. */
  gitRepoId?: string;
  /** Active center view: the commit graph, the file tree, or the working-tree
   *  changes view (desktop-local only). Unset defaults to 'history'. */
  gitView?: 'history' | 'browse' | 'changes' | 'ci';
  /** Selected branch / ref for history + browse. Empty until seeded (or when
   *  no main/master/default branch exists — the user then picks explicitly). */
  gitRef?: string;
}

export interface MockServer {
  id: string;
  name: string;
  prefix: string;
  isActive: boolean;
}

export interface MockRoute {
  id: string;
  mockServerId: string;
  method: string;
  path: string;
  statusCode: number;
  responseHeaders: string;
  responseBody: string;
  delay: number;
  isActive: boolean;
}

export interface TestStep {
  stepNo: number;
  type: 'request' | 'assertion' | 'extract' | 'wait';
  action: string;
  expected: string;
  // For request type
  request?: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  };
  // For assertion type (checked against last response)
  assertions?: Array<{
    type: 'status' | 'body_contains' | 'json_path' | 'response_time' | 'header';
    operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'exists' | 'not_empty' | 'greater_than' | 'less_than' | 'matches';
    value?: string;
    path?: string;  // for json_path
    key?: string;   // for header
  }>;
  // For extract type
  extractions?: Array<{
    variable: string;
    source: 'json_path' | 'header' | 'body' | 'status';
    path?: string;
    key?: string;
  }>;
  // For wait type
  waitMs?: number;
}

export interface TestCase {
  id: string;
  title: string;
  description: string;
  priority: string;
  type: string;
  tags: string[];
  steps: TestStep[];
  status: string;
  createdAt: string;
  // Folder the case is filed in (TestCaseFolder.id); null/absent = root.
  folderId?: string | null;
}

// QA test-case folder (owner-only, nests via parentId; null = top level).
export interface TestCaseFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestExecutionResult {
  status: 'passed' | 'failed' | 'error';
  duration: number;
  steps: Array<{
    stepNo: number;
    type: string;
    status: 'passed' | 'failed' | 'error' | 'skipped';
    duration: number;
    request?: { method: string; url: string };
    response?: { statusCode: number; body: string; headers: Record<string, string> };
    assertions?: Array<{
      type: string;
      expected: string;
      actual: string;
      passed: boolean;
    }>;
    extractions?: Array<{
      variable: string;
      value: string;
    }>;
    error?: string;
  }>;
  variables: Record<string, string>;
  summary: { total: number; passed: number; failed: number; skipped: number };
}

export interface TestPlan {
  id: string;
  name: string;
  description: string;
  status: string;
  testCaseIds: string[];
  createdAt: string;
}

export interface TestRun {
  id: string;
  testPlanId: string;
  // Set (and testPlanId empty) for a folder "Run all".
  testFolderId?: string;
  environment: string;
  status: string;
  results: Array<{
    testCaseId: string;
    title?: string;
    status: string;
    notes?: string;
    duration: number;
    // Full per-step execution detail. Populated by BE plan-execute; older
    // runs created before that field existed may omit it, so callers must
    // treat it as optional.
    result?: TestExecutionResult;
  }>;
  startedAt: string;
  completedAt?: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  type: 'personal' | 'team';
  /** Team this workspace is bound to. Members of the team see it in
   *  their selector. Null / undefined = personal/unshared. */
  teamId?: string | null;
  /** Bound team's display name, stamped by the BE on List so the
   *  selector can render "<workspace> · <team>" without an N+1
   *  round-trip. */
  teamName?: string;
  createdAt: string;
  updatedAt: string;
}

// Teams + public-sharing types — see TEAMS_AND_PUBLIC_SHARING_RFC.md.
// The legacy `TeamMember` interface that used to live here (workspace-
// scoped, admin/editor/viewer) has been replaced by `Team` + the new
// `TeamMember` shape below (team-scoped, admin/member).

export interface Team {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  creatorName?: string;
  memberCount?: number;
  myRole?: 'admin' | 'member' | '';
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

// Dual-list editor row for collection / environment public sharing.
export interface PublicGrant {
  id: string;
  role: 'editor' | 'viewer';
  subjectKind: 'user' | 'team' | 'everyone';
  subjectId?: string;
  label: string; // display string ("Everyone" / user email / team name)
}

export type Visibility = 'private' | 'public';

// ── DB Query Tool ───────────────────────────────────────────────────
// See DB_QUERY_TOOL_RFC.md. The kind enum drives the BE driver
// selection; the FE uses it to pick syntax highlighting + autocomplete
// language inside the Monaco editor.

// Wire-compatible variants of the three base drivers. The BE routes
// these through the same driver as their family — only the label +
// default port differ at the UI layer.
export type DBKind =
  | 'postgres'
  | 'cockroachdb'
  | 'yugabytedb'
  | 'redshift'
  | 'mysql'
  | 'mariadb'
  | 'tidb'
  | 'sqlserver'
  | 'mongo';

export const DB_KIND_FAMILY: Record<DBKind, 'postgres' | 'mysql' | 'mongo'> = {
  postgres: 'postgres',
  cockroachdb: 'postgres',
  yugabytedb: 'postgres',
  redshift: 'postgres',
  mysql: 'mysql',
  mariadb: 'mysql',
  tidb: 'mysql',
  // SQL Server has its own BE driver but behaves like the Postgres family
  // at the UI layer: one database per connection (introspection is per-DB),
  // double-quoted identifiers, no "browse all databases" mode.
  sqlserver: 'postgres',
  mongo: 'mongo',
};

export const DB_KIND_DEFAULT_PORT: Record<DBKind, number> = {
  postgres: 5432,
  cockroachdb: 26257,
  yugabytedb: 5433,
  redshift: 5439,
  mysql: 3306,
  mariadb: 3306,
  tidb: 4000,
  sqlserver: 1433,
  mongo: 27017,
};

export const DB_KIND_LABEL: Record<DBKind, string> = {
  postgres: 'PostgreSQL',
  cockroachdb: 'CockroachDB',
  yugabytedb: 'YugabyteDB',
  redshift: 'Amazon Redshift',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  tidb: 'TiDB',
  sqlserver: 'SQL Server',
  mongo: 'MongoDB',
};

export interface DBConnection {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  kind: DBKind;
  host: string;
  port: number;
  /** Empty for Mongo connections that roam all DBs, or for SQL
   *  connections that rely on a custom connection string. */
  database: string;
  username: string;
  options?: Record<string, unknown>;
  /** Set when the row carries a custom DSN override. The plaintext is
   *  never sent back in list/get; owners reveal it via a dedicated
   *  endpoint, same way as the password. */
  hasConnectionString?: boolean;
  /** True when the row was reached via a delegated grant — owner is
   *  someone else. */
  shared?: boolean;
  ownerName?: string;
  /** 'owner' | 'write' (co-owner) | 'read'. Stamped by the BE so the FE
   *  can gate "Manage sharing" / "Edit" / "Delete" / read-write-toggle
   *  affordances. A 'write' grant is a full co-owner; 'read' is query-only. */
  grantRole?: 'owner' | 'read' | 'write';
  /** Per-connection read-write master switch. false (default) = read-only:
   *  the execute path refuses every write/DML statement for everyone. true =
   *  a well-formed write runs for owner/co-owner. Renders the R / R+W badge
   *  and gates the ⋯ "Read-write mode" toggle. */
  allowWrite?: boolean;
  /** Primary BE for this connection — used as the toolbar Local/Remote
   *  toggle default. Derived FE-side from `primaryScope` (user-chosen,
   *  persisted on both BEs) with a 'remote' fallback for legacy rows.
   *  The connection itself is dual-written so both BEs hold a copy with
   *  the same id; `availableScopes` lists every BE that successfully
   *  accepted the write. */
  scope?: 'local' | 'remote';
  /** User-chosen default scope persisted on the BE row. Same value lives
   *  on both BE copies via the FE's dual-write. Empty / undefined means
   *  the row predates the column — UI should treat that as 'remote'. */
  primaryScope?: 'local' | 'remote' | '';
  /** Which BEs currently hold this connection. With successful dual-write
   *  the user sees both ['local','remote']; if one BE was unreachable at
   *  create time only the other one appears. The toolbar toggle disables
   *  options not in this list. */
  availableScopes?: Array<'local' | 'remote'>;
  createdAt: string;
  updatedAt: string;
}

export interface DBSchemaColumn {
  name: string;
  type: string;
}

export interface DBForeignKey {
  column: string;
  targetSchema?: string;
  targetTable: string;
  targetColumn: string;
}

export interface DBSchemaTable {
  schema?: string;
  name: string;
  columns: DBSchemaColumn[];
  foreignKeys?: DBForeignKey[];
  /** Mongo-only: one sampled document used to seed JSON intellisense. */
  sample?: Record<string, unknown>;
}

export interface DBSchema {
  tables: DBSchemaTable[];
  updatedAt: number;
}

export interface DBQueryResult {
  queryId: string;
  columns: DBSchemaColumn[];
  rows: unknown[][];
  rowCount: number;
  execMs: number;
  rowsTruncated: boolean;
  offset?: number;
  statementText?: string;
}

export interface DBQueryHistoryRow {
  id: string;
  userId: string;
  delegatedOwner?: string;
  connectionId: string;
  kind: DBKind;
  queryExcerpt: string;
  rowCount: number;
  execMs: number;
  rowsTruncated: boolean;
  error?: string;
  executedAt: string;
}

export interface SavedDBQuery {
  id: string;
  userId: string;
  workspaceId?: string;
  connectionId: string;
  name: string;
  queryText: string;
  folder?: string;
  tags?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface DBConnectionGrant {
  id: string;
  subjectKind: 'user' | 'team';
  subjectId: string;
  role: 'read' | 'write';
  label: string;
  grantedBy: string;
  createdAt: string;
}

export interface Defect {
  id: string;
  userId: string;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'fixed' | 'verified' | 'closed' | 'reopened';
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  severity: 'critical' | 'major' | 'minor' | 'trivial';
  assigneeId?: string;
  testCaseId?: string;
  testRunId?: string;
  environment?: string;
  stepsToReproduce?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  userId: string;
  user?: { id: string; name: string; email: string };
  targetType: string;
  targetId: string;
  content: string;
  parentId?: string;
  replies?: Comment[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  resource: string;
  resourceId: string;
  details: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
}

export interface SharedStep {
  id: string;
  userId: string;
  title: string;
  steps: Array<{ stepNo: number; action: string; expected: string }>;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TestCaseVersion {
  id: string;
  testCaseId: string;
  version: number;
  title: string;
  description: string;
  steps: string;
  priority: string;
  tags: string;
  changedBy: string;
  changeNote: string;
  createdAt: string;
}

export interface Requirement {
  id: string;
  userId: string;
  title: string;
  description: string;
  type: 'functional' | 'non_functional' | 'user_story' | 'epic';
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'draft' | 'approved' | 'implemented' | 'deprecated';
  parentId?: string;
  externalRef?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CookieItem {
  id: string;
  domain: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expiresAt?: string;
}

export interface RunnerResult {
  results: Array<{
    requestId: string;
    name: string;
    method: string;
    url: string;
    statusCode: number;
    duration: number;
    passed: boolean;
    error?: string;
    iteration?: number;
  }>;
  summary: {
    total: number;
    passed: number;
    failed: number;
    duration: number;
    iterations?: number;
  };
}

export interface SearchResult {
  type: string;
  id: string;
  title: string;
  subtitle: string;
  matchedField: string;
}

export interface JUnitImportResult {
  id: string;
  fileName: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  duration: number;
  importedAt: string;
  /** JSON-encoded JUnitSuiteDetail[] — present on the single-row GET,
   *  omitted on List for payload size. Parse with JSON.parse before
   *  consuming. */
  suites?: string;
}

export interface JUnitSuiteDetail {
  name: string;
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  time: number;
  testCases: JUnitTestCaseDetail[];
}

export interface JUnitTestCaseDetail {
  name: string;
  className: string;
  time: number;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  message?: string;
  detail?: string;
}

// ── Kafka Tool ──────────────────────────────────────────────────────
// See KAFKA_S3_AND_DBQUERY_FIXES_RFC.md §A. Connections mirror the DB
// connection scope/dual-write model (scope/primaryScope/availableScopes).

export type KafkaSecurityProtocol = 'PLAINTEXT' | 'SSL' | 'SASL_PLAINTEXT' | 'SASL_SSL';
export type KafkaSASLMechanism = 'PLAIN' | 'SCRAM-SHA-256' | 'SCRAM-SHA-512';

export interface KafkaConnection {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  bootstrapServers: string;
  securityProtocol: KafkaSecurityProtocol;
  saslMechanism?: KafkaSASLMechanism | '';
  saslUsername?: string;
  hasSaslPassword?: boolean;
  options?: Record<string, unknown>;
  ownerName?: string;
  shared?: boolean;
  grantRole?: 'owner' | 'read' | 'write';
  scope?: 'local' | 'remote';
  primaryScope?: 'local' | 'remote' | '';
  availableScopes?: Array<'local' | 'remote'>;
  createdAt: string;
  updatedAt: string;
}

export interface KafkaTopicSummary {
  name: string;
  partitions: number;
  replicationFactor: number;
  internal: boolean;
}

export interface KafkaConfigEntry {
  key: string;
  value: string;
  source: string;
  sensitive: boolean;
  editable: boolean;
}

// Enriched topic row for the Topics tab (mirrors kafkaquery.TopicOverview).
// messageCount is the approximate end−start offset span summed over
// partitions (over-counts on compacted topics); -1 when unknown.
export interface KafkaTopicOverview {
  name: string;
  partitions: number;
  replicationFactor: number;
  internal: boolean;
  messageCount: number; // -1 when unknown
  underReplicated: boolean;
  offline: boolean;
  /** Σ leader-replica sizes (≈ data size), bytes; -1 unknown (e.g. no DESCRIBE on CLUSTER). */
  sizeBytes?: number;
  /** Σ all replicas (disk footprint), bytes; -1 unknown. */
  replicaSizeBytes?: number;
}

export interface KafkaTopicPartitionDetail {
  partition: number;
  leader: number;
  replicas: number[] | null;
  isr: number[] | null;
  offlineReplicas?: number[];
  low: number; // start offset, -1 unknown
  high: number; // high watermark, -1 unknown
  count: number; // high-low, -1 unknown
  sizeBytes?: number; // leader replica size, -1 unknown
  replicaSizeBytes?: number; // all replicas, -1 unknown
  err?: string;
}

export interface KafkaTopicDetail {
  name: string;
  partitions: number;
  replicationFactor: number;
  internal: boolean;
  messageCount: number; // -1 when unknown
  underReplicated: boolean;
  offline: boolean;
  sizeBytes?: number; // Σ leader sizes, -1 unknown
  replicaSizeBytes?: number; // Σ all replicas, -1 unknown
  partitionDetail: KafkaTopicPartitionDetail[];
  config: KafkaConfigEntry[];
}

export interface KafkaBroker {
  nodeId: number;
  host: string;
  port: number;
  rack?: string;
}

export interface KafkaMessageHeader {
  key: string;
  value: string;
}

export interface KafkaMessage {
  partition: number;
  offset: number;
  timestampMs: number;
  key: string | null;
  value: string;
  valueEncoding: 'utf8' | 'base64';
  headers?: KafkaMessageHeader[];
}

export type KafkaFetchMode = 'first' | 'last' | 'offset' | 'timestamp';

export interface KafkaConsumeResult {
  messages: KafkaMessage[];
  partitions: number;
  truncated: boolean;
  /** The BE's peek budget ran out before N messages arrived (older BEs omit it). */
  timedOut?: boolean;
  fetchMs: number;
}

export interface KafkaGroupSummary {
  group: string;
  state: string;
  protocolType: string;
  members: number;
}

// Consumer-group lag dashboard DTOs (mirror be/internal/kafkaquery/types.go).
export interface KafkaGroupLagSummary {
  group: string;
  state: string;
  protocolType: string;
  members: number;
  totalLag: number; // -1 when unknown/errored
  coordinator: number;
  error?: string;
}

export interface KafkaPartAssign {
  topic: string;
  partitions: number[];
}

export interface KafkaGroupMemberInfo {
  memberId: string;
  clientId: string;
  clientHost: string;
  instanceId?: string;
  assigned: KafkaPartAssign[];
}

export interface KafkaPartitionLag {
  topic: string;
  partition: number;
  committed: number;
  end: number;
  lag: number; // -1 when unknown
  memberId?: string;
  clientId?: string;
  err?: string;
}

export interface KafkaGroupLagDetail {
  group: string;
  state: string;
  protocolType: string;
  coordinator: number;
  totalLag: number;
  memberCount: number;
  error?: string;
  members: KafkaGroupMemberInfo[];
  partitions: KafkaPartitionLag[];
}

export interface KafkaGroupMemberOffset {
  topic: string;
  partition: number;
  committed: number;
  end: number;
  lag: number;
}

export interface KafkaGroupDetail {
  group: string;
  state: string;
  protocolType: string;
  protocol: string;
  members: number;
  offsets: KafkaGroupMemberOffset[];
}

// ── S3 / Object Storage Tool ────────────────────────────────────────
// See KAFKA_S3_AND_DBQUERY_FIXES_RFC.md §B.

export type S3Provider =
  | 'aws' | 'minio' | 'ceph' | 'wasabi' | 'r2' | 'b2' | 'spaces' | 'gcs' | 'oracle' | 'huawei' | 'custom';

export interface S3Connection {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  provider: S3Provider;
  endpoint?: string;
  region: string;
  accessKeyId?: string;
  hasSecretKey?: boolean;
  hasSessionToken?: boolean;
  forcePathStyle: boolean;
  insecureSkipVerify: boolean;
  options?: Record<string, unknown>;
  ownerName?: string;
  shared?: boolean;
  grantRole?: 'owner' | 'read' | 'write';
  scope?: 'local' | 'remote';
  primaryScope?: 'local' | 'remote' | '';
  availableScopes?: Array<'local' | 'remote'>;
  createdAt: string;
  updatedAt: string;
}

export interface S3Bucket {
  name: string;
  createdAt?: string;
}

export interface S3ObjectEntry {
  key: string;
  name: string;
  size: number;
  lastModified?: string;
  storageClass?: string;
  isPrefix: boolean;
}

export interface S3ObjectListing {
  prefix: string;
  objects: S3ObjectEntry[];
  nextToken?: string;
  isTruncated: boolean;
}

export interface S3ObjectMeta {
  key: string;
  size: number;
  contentType?: string;
  etag?: string;
  storageClass?: string;
  lastModified?: string;
  metadata?: Record<string, string>;
}

// ── Redis Tool ──────────────────────────────────────────────────────
// See REDIS_TOOL_RFC / redis-impl-spec. Connections mirror the DB / Kafka
// connection scope/dual-write model (scope/primaryScope/availableScopes).
// The DTO field names below are the BE wire contract (redisquery/types.go)
// — the FE must not rename them.

export type RedisMode = 'standalone' | 'sentinel' | 'cluster';

export interface RedisConnection {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  /** "host:6379" for standalone, or a comma-joined seed list for
   *  sentinel / cluster. */
  address: string;
  mode: RedisMode;
  /** Required when mode = 'sentinel' — the monitored master's name. */
  sentinelMaster?: string;
  /** ACL username; empty for legacy (requirepass) auth. */
  username?: string;
  /** True when a data-node password is stored (never sent in the clear). */
  hasPassword?: boolean;
  /** True when a sentinel password is stored (sentinel mode only). */
  hasSentinelPassword?: boolean;
  /** Logical DB index (0..N). Ignored for cluster. */
  dbIndex: number;
  tls: boolean;
  /** Read-write master switch (⋯ menu); off = no write commands, owner included. */
  allowWrite?: boolean;
  options?: Record<string, unknown>;
  ownerName?: string;
  shared?: boolean;
  grantRole?: 'owner' | 'read' | 'write';
  scope?: 'local' | 'remote';
  primaryScope?: 'local' | 'remote' | '';
  availableScopes?: Array<'local' | 'remote'>;
  createdAt: string;
  updatedAt: string;
}

// ── Redis DTOs (mirror be/internal/redisquery/types.go) ─────────────
export interface KeyEntry {
  key: string;
  type: string;
  /** -1 = no expire, -2 = missing. */
  ttlMs: number;
  sizeBytes: number;
}

export interface KeyListing {
  keys: KeyEntry[];
  cursor: number;
  complete: boolean;
  db: number;
  scanMs: number;
  /** Effective MATCH glob (after the smart search expanded plain text). Older BEs omit it. */
  pattern?: string;
  /** Matching-key target the BE used for this page. */
  limit?: number;
  /** Why an incomplete scan paused: 'limit' (enough matches) | 'budget' (time / iteration budget). */
  stopReason?: 'limit' | 'budget';
  /** SCAN calls made for this page. */
  iterations?: number;
}

/** One element of a collection key, addressed for removal (POST /redis/:id/key/element/remove). */
export type RedisElementRef =
  | { type: 'hash'; field: string }
  | { type: 'list'; index: number; value: string }
  | { type: 'set'; member: string }
  | { type: 'zset'; member: string }
  | { type: 'stream'; entryId: string };

export interface KeyMeta {
  key: string;
  type: string;
  encoding: string;
  ttlMs: number;
  pttlMs: number;
  memoryBytes: number;
  length: number;
}

export interface ValueResult {
  key: string;
  type: string;
  valueEncoding: string;
  ttlMs: number;
  memoryBytes: number;
  string?: string;
  hash?: Record<string, string>;
  list?: string[];
  set?: string[];
  zset?: Array<{ member: string; score: number }>;
  stream?: Array<{ id: string; fields: Record<string, string> }>;
  cursor: number;
  truncated: boolean;
}

export interface CommandResult {
  reply: unknown;
  kind: string;
  durationMs: number;
  write: boolean;
}

export interface PubSubResult {
  messages: Array<{ channel: string; pattern: string; payload: string; payloadEncoding: string }>;
  truncated: boolean;
  fetchMs: number;
}

// ── Elasticsearch Tool ──────────────────────────────────────────────
// See es-impl-spec. Connections mirror the DB / Kafka / S3 / Redis
// connection scope/dual-write model (scope/primaryScope/availableScopes).
// The DTO field names below are the BE wire contract (esquery/types.go)
// — the FE must not rename them. The BE is a thin authenticated HTTP
// forwarder; auth secrets (basic password, API key, bearer token) are
// AES-GCM encrypted at rest and never sent back in list/get.

export type ESFlavor = 'auto' | 'elasticsearch' | 'opensearch';
export type ESAuthKind = 'none' | 'basic' | 'apiKey' | 'bearer' | 'kibanaProxy';

export interface ESConnection {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  /** Comma-separated base URLs, e.g. "https://h1:9200,https://h2:9200". */
  nodes: string;
  /** Optional Elastic Cloud id (decodes to a node URL). */
  cloudId?: string;
  flavor: ESFlavor;
  authKind: ESAuthKind;
  /** Basic-auth user; empty for none / apiKey / bearer. */
  username?: string;
  /** True when a basic-auth password is stored (never sent in the clear). */
  hasPassword?: boolean;
  /** True when an "id:api_key" API key is stored. */
  hasApiKey?: boolean;
  /** True when a bearer / service token is stored. */
  hasBearer?: boolean;
  /** Kibana Console-proxy mode (authKind 'kibanaProxy'): Kibana base URL. */
  kibanaUrl?: string;
  /** Kibana auth sub-mode — basic (reuses username/password) or a pasted session cookie. */
  kibanaAuthMode?: 'basic' | 'cookie';
  /** Kibana space slug ("" = default space). */
  kibanaSpace?: string;
  /** True when a Kibana session cookie is stored (never sent in the clear). */
  hasCookie?: boolean;
  /** https transport (also implied by a node's scheme). */
  tls: boolean;
  options?: Record<string, unknown>;
  ownerName?: string;
  shared?: boolean;
  grantRole?: 'owner' | 'read' | 'write';
  scope?: 'local' | 'remote';
  primaryScope?: 'local' | 'remote' | '';
  availableScopes?: Array<'local' | 'remote'>;
  createdAt: string;
  updatedAt: string;
}

// ── RabbitMQ (mirror be/internal/rabbitquery) ───────────────────────
/** A saved Graylog server (Dashboards rail). PatchMan only reads it. */
export interface GraylogConnection {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  /** Graylog web URL (the API is under /api). */
  url: string;
  /** "token" = access token; "basic" = username + password. */
  authKind: 'token' | 'basic';
  username?: string;
  hasSecret?: boolean;
  options?: { insecureSkipVerify?: boolean; caCert?: string };
  ownerName?: string;
  shared?: boolean;
  grantRole?: 'owner' | 'read' | 'write';
  scope?: 'local' | 'remote';
  primaryScope?: 'local' | 'remote' | '';
  availableScopes?: Array<'local' | 'remote'>;
  createdAt: string;
  updatedAt: string;
}

/** Graylog time range: last N seconds, from/to (RFC 3339) or a keyword. */
export interface GraylogRange {
  type: 'relative' | 'absolute' | 'keyword';
  range?: number;
  from?: string;
  to?: string;
  keyword?: string;
}

export interface RabbitConnection {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  /** Management API base URL, e.g. http://rabbit:15672. */
  url: string;
  username?: string;
  hasPassword?: boolean;
  options?: {
    insecureSkipVerify?: boolean; caCert?: string;
    amqpHost?: string; amqpPort?: number | string; amqpTLS?: boolean; defaultVhost?: string;
  };
  ownerName?: string;
  shared?: boolean;
  grantRole?: 'owner' | 'read' | 'write';
  scope?: 'local' | 'remote';
  primaryScope?: 'local' | 'remote' | '';
  availableScopes?: Array<'local' | 'remote'>;
  createdAt: string;
  updatedAt: string;
}

/** Rate field of management message_stats (`publish_details` …). */
export interface RabbitRate {
  rate?: number;
  samples?: Array<{ sample: number; timestamp: number }>;
}
export type RabbitMessageStats = Record<string, number | RabbitRate | undefined>;

/** Management API queue object (only the fields PatchMan reads). */
export interface RabbitQueue {
  name: string;
  vhost: string;
  type?: 'classic' | 'quorum' | 'stream' | string;
  state?: string;
  durable?: boolean;
  auto_delete?: boolean;
  exclusive?: boolean;
  arguments?: Record<string, unknown>;
  policy?: string | null;
  effective_policy_definition?: Record<string, unknown> | [];
  consumers?: number;
  consumer_utilisation?: number | null;
  messages?: number;
  messages_ready?: number;
  messages_unacknowledged?: number;
  message_bytes?: number;
  memory?: number;
  node?: string;
  leader?: string;
  members?: string[];
  delivery_limit?: number;
  idle_since?: string;
  message_stats?: RabbitMessageStats;
  messages_details?: RabbitRate;
  messages_ready_details?: RabbitRate;
  messages_unacknowledged_details?: RabbitRate;
  consumer_details?: Array<{
    consumer_tag: string; prefetch_count?: number; ack_required?: boolean; active?: boolean; activity_status?: string;
    channel_details?: { name?: string; connection_name?: string; peer_host?: string; peer_port?: number; user?: string };
  }>;
}

export interface RabbitExchange {
  name: string;
  vhost: string;
  type: string;
  durable?: boolean;
  auto_delete?: boolean;
  internal?: boolean;
  arguments?: Record<string, unknown>;
  policy?: string | null;
  message_stats?: RabbitMessageStats;
}

export interface RabbitBinding {
  source: string;
  vhost: string;
  destination: string;
  destination_type: 'queue' | 'exchange';
  routing_key: string;
  arguments?: Record<string, unknown>;
  properties_key?: string;
}

export interface RabbitPage<T> {
  items: T[];
  filtered_count: number;
  item_count: number;
  page: number;
  page_count: number;
  page_size: number;
  total_count: number;
}

export interface RabbitPeekInfo {
  mode: 'requeue' | 'stream';
  risk: 'none' | 'redelivered' | 'delivery_limit';
  deliveryLimit?: number;
  hasDlx: boolean;
  version: string;
}

/** A message as the management get answer (also used for stream reads + tail). */
export interface RabbitMessage {
  payload_bytes: number;
  redelivered: boolean;
  exchange: string;
  routing_key: string;
  /** The management API sends [] when a message has no properties. */
  properties: Record<string, unknown> | [];
  payload: string;
  payload_encoding: 'string' | 'base64';
  message_count?: number;
  offset?: number;
  received_at?: number;
}

// ── Grafana (mirror be/internal/grafanaquery) ───────────────────────
export type GrafanaAuthKind = 'token' | 'basic' | 'session' | 'none';

/** A public dashboard link saved on a connection (…/public-dashboards/<token>). */
export interface GrafanaPublicDashboard {
  token: string;
  title?: string;
}

export interface GrafanaConnection {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  url: string;
  authKind: GrafanaAuthKind;
  username?: string;
  hasPassword?: boolean;
  hasToken?: boolean;
  hasSession?: boolean;
  sessionRotatedAt?: string;
  options?: {
    insecureSkipVerify?: boolean; caCert?: string; orgId?: number | string; cookieName?: string;
    publicDashboards?: GrafanaPublicDashboard[];
  };
  ownerName?: string;
  shared?: boolean;
  grantRole?: 'owner' | 'read' | 'write';
  scope?: 'local' | 'remote';
  primaryScope?: 'local' | 'remote' | '';
  availableScopes?: Array<'local' | 'remote'>;
  createdAt: string;
  updatedAt: string;
}

export type ObservabilityProviderName = 'coroot' | 'prometheus' | 'jaeger' | 'kiali' | 'signoz' | 'datadog';
export type ObservabilityAuthKind = 'none' | 'basic' | 'bearer' | 'apikey' | 'session' | 'login' | 'datadog';

/** APM / observability backend the service map reads (Coroot, Prometheus,
 *  Jaeger, Kiali, SigNoz, Datadog). Secrets never come back — only which are set. */
export interface ObservabilityConnection {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  provider: ObservabilityProviderName;
  url: string;
  authKind: ObservabilityAuthKind;
  username?: string;
  hasSecrets: Array<'password' | 'token' | 'apiKey' | 'appKey' | 'session'>;
  /** Coroot project, Datadog / SigNoz env, Kiali namespaces. */
  scope?: string;
  options?: { insecureSkipVerify?: boolean; caCert?: string; headerName?: string };
  ownerName?: string;
  shared?: boolean;
  grantRole?: 'owner' | 'read' | 'write';
  /** Which BE the row was read from (FE-side). */
  beScope?: 'local' | 'remote';
  primaryScope?: 'local' | 'remote' | '';
  availableScopes?: Array<'local' | 'remote'>;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceMapStats {
  rps: number;
  /** 0..1 */
  errorRate: number;
  p95Ms?: number;
  conns?: number;
  hasRed?: boolean;
  /** Rates known, errors / latency unknown (Jaeger). */
  rateOnly?: boolean;
  /** Requests/s per response status ("2xx", "5xx", "failed", "unknown", "grpc:…"). */
  statuses?: Record<string, number>;
}

export type ServiceMapNodeKind = 'service' | 'datastore' | 'messaging' | 'external' | 'ingress';

export interface ServiceMapNode {
  id: string;
  kind: ServiceMapNodeKind;
  subtype?: string;
  namespace?: string;
  name: string;
  address?: string;
  replicas?: string;
  images?: string[];
  services?: string[];
  health: 'ok' | 'warning' | 'critical' | 'unknown';
  /** Backend category (Coroot: application | monitoring | control-plane). */
  category?: string;
  stats: ServiceMapStats;
  connection?: { tool: 'db' | 'kafka' | 'rabbit' | 'redis' | 'es' | 's3'; id: string; name: string };
  k8s?: { kind: string; namespace: string; name: string };
  coroot?: { project: string; appId: string };
  sources: string[];
  /** FE only: a namespace folded into one node. */
  group?: ServiceMapGroup;
}

export interface ServiceMapGroup {
  /** The namespace ('' = nodes outside any namespace). */
  namespace: string;
  members: number;
  health: Partial<Record<ServiceMapNode['health'], number>>;
  kinds: Partial<Record<ServiceMapNodeKind, number>>;
}

export interface ServiceMapEvidence {
  source: 'env' | 'configMap' | 'secret' | 'ingress' | 'coroot';
  workload?: string;
  name?: string;
  key?: string;
  extracted?: string;
}

export interface ServiceMapEdge {
  id: string;
  from: string;
  to: string;
  sources: string[];
  protocol?: string;
  flow: 'request' | 'publish' | 'consume';
  /** The backend's verdict on the link (Coroot: "failed connections"). */
  issue?: string;
  stats: ServiceMapStats;
  evidence?: ServiceMapEvidence[];
  /** FE only: how many calls a namespace-level link stands for. */
  calls?: number;
}

export interface ServiceMapSourceStatus {
  ok: boolean;
  error?: string;
  notes?: string[];
}

export interface ServiceMapGraph {
  nodes: ServiceMapNode[];
  edges: ServiceMapEdge[];
  sources: Record<string, ServiceMapSourceStatus>;
}

export interface GrafanaDatasource {
  id?: number;
  uid: string;
  name: string;
  type: string;
  isDefault?: boolean;
  backend: boolean;
  timeInterval?: string;
  /** Elasticsearch / OpenSearch time field. */
  timeField?: string;
}

export interface GrafanaServerInfo {
  version: string;
  major: number;
  minor: number;
  namespace?: string;
  datasources: GrafanaDatasource[];
  defaultDatasource?: string;
  appSubUrl?: string;
  user?: { login: string; name?: string; email?: string; orgRole?: string };
}

export interface GrafanaSearchHit {
  uid: string;
  title: string;
  type: 'dash-db' | 'dash-folder';
  url?: string;
  tags?: string[];
  folderUid?: string;
  isStarred?: boolean;
}

/** Classic (v1) dashboard JSON — loosely typed: PatchMan reads what it renders. */
export interface GrafanaPanel {
  id?: number;
  type: string;
  title?: string;
  description?: string;
  gridPos?: { x: number; y: number; w: number; h: number };
  datasource?: unknown;
  targets?: Array<Record<string, unknown>>;
  options?: Record<string, unknown>;
  fieldConfig?: { defaults?: Record<string, unknown>; overrides?: Array<Record<string, unknown>> };
  transformations?: unknown[];
  interval?: string;
  maxDataPoints?: number;
  collapsed?: boolean;
  panels?: GrafanaPanel[];
  libraryPanel?: { uid?: string; name?: string };
  repeat?: string;
  [k: string]: unknown;
}

export interface GrafanaDashboardModel {
  uid: string;
  title: string;
  tags?: string[];
  time?: { from: string; to: string };
  /** Auto-refresh interval; Grafana also stores `false` for "off". */
  refresh?: string | boolean;
  timezone?: string;
  /** 0 = default, 1 = shared crosshair, 2 = shared tooltip. */
  graphTooltip?: number;
  panels?: GrafanaPanel[];
  templating?: { list?: Array<Record<string, unknown>> };
  [k: string]: unknown;
}

export interface GrafanaDashboard {
  dashboard: GrafanaDashboardModel;
  meta: { url?: string; slug?: string; folderUid?: string; folderTitle?: string; version?: number; schema: 'v1' | 'v2' };
}

export interface GrafanaVarValue {
  values: string[];
  texts?: string[];
  multi?: boolean;
  includeAll?: boolean;
  allValue?: string;
  allOptions?: string[];
}

export interface GrafanaVariable {
  name: string;
  label?: string;
  type: string;
  hide: number;
  multi: boolean;
  includeAll: boolean;
  allValue?: string;
  options: Array<{ text: string; value: string }>;
  current: GrafanaVarValue;
  free?: boolean;
  error?: string;
}

/** A Grafana data frame (JSON wire format). */
export interface GrafanaFrame {
  schema: {
    name?: string;
    refId?: string;
    meta?: Record<string, unknown>;
    fields: Array<{
      name: string;
      type?: string;
      labels?: Record<string, string>;
      config?: Record<string, unknown>;
    }>;
  };
  data: { values: unknown[][]; entities?: Array<Record<string, number[]> | null>; nanos?: unknown };
}

export interface GrafanaQueryResult {
  results: Record<string, { frames: GrafanaFrame[]; error?: string; notice?: string }>;
  intervalMs: number;
  from: number;
  to: number;
}

// ── ES DTOs (mirror be/internal/esquery/types.go) ───────────────────
export interface Field {
  path: string;
  type: string;
  searchable: boolean;
  aggregatable: boolean;
  isKeyword: boolean;
  isNested: boolean;
}

export interface ClusterInfo {
  name: string;
  clusterName: string;
  version: string;
  flavor: string;
  healthStatus: string;
  numberOfNodes: number;
  numberOfDataNodes: number;
  activeShards: number;
  unassignedShards: number;
  relocatingShards: number;
}

export interface NodeInfo {
  name: string;
  version: string;
  roles: string;
  heapPercent: string;
  cpu: string;
  load: string;
  diskPercent: string;
}

export interface ClusterResult {
  info: ClusterInfo;
  nodes: NodeInfo[];
}

export interface ExecResult {
  status: number;
  tookMs: number;
  /** Raw ES response body (json.RawMessage on the wire). */
  body: unknown;
}

export interface IndexRow {
  health: string;
  status: string;
  index: string;
  uuid: string;
  docsCount: number;
  docsDeleted: number;
  priShards: number;
  repShards: number;
  storeSize: string;
  priStoreSize: string; // primary-only size (raw bytes), human-formatted in the browser
}

// AliasRow is one row of _cat/aliases — an alias → target index plus its
// routing / filter / write-index facts (rendered as badges in the sidebar).
export interface AliasRow {
  alias: string;
  index: string;
  filter: string;        // "-" (none) or "*" (a filter is set)
  routingIndex: string;  // "-" or a routing value
  routingSearch: string; // "-" or a routing value
  isWriteIndex: string;  // "true" / "false" / "-"
}

// ── Dev Tools ───────────────────────────────────────────────────────
// Client-side developer utilities that open as main-pane tabs
// (type: 'tool'). See fe/src/components/devtools/*.
export type ToolKind =
  | 'json-diff'
  | 'jwt'
  | 'base64'
  | 'url'
  | 'timestamp'
  | 'uuid'
  | 'hash'
  | 'regex'
  | 'snippets'
  | 'js-console'
  | 'mock-data'
  | 'dns'
  | 'web-audit';

// ── Web Audit (Dev Tools) ───────────────────────────────────────────
// Browser-less SEO + web-quality report. The BE fetches a URL (following
// redirects), parses the HTML with golang.org/x/net/html (no browser),
// runs the checks, and best-effort fetches robots.txt + sitemap.xml.
// These interfaces mirror the BE WebAuditReport wire contract field-for-
// field — do not rename. NOTE: the BE is Go, so nil slices/maps marshal
// as `null` (not []/{}); the renderer guards every array/record.
export interface WebAuditRedirect {
  from: string;
  to: string;
  status: number;
}
export interface WebAuditValueLength {
  value: string;
  length: number;
}
export interface WebAuditHreflang {
  lang: string;
  href: string;
}
export interface WebAuditHeading {
  level: number;
  text: string;
}
export interface WebAuditStructuredData {
  type: string;
}
export interface WebAuditSeo {
  title: WebAuditValueLength;
  metaDescription: WebAuditValueLength;
  canonical: string;
  robotsMeta: string;
  lang: string;
  viewport: string;
  hreflang: WebAuditHreflang[];
  h1Count: number;
  h1: string[];
  headings: WebAuditHeading[];
  images: { total: number; missingAlt: number };
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  structuredData: WebAuditStructuredData[];
}
export interface WebAuditSecurity {
  hsts: boolean;
  csp: boolean;
  xFrameOptions: boolean;
  xContentTypeOptions: boolean;
  referrerPolicy: boolean;
}
export interface WebAuditQuality {
  https: boolean;
  contentEncoding: string;
  cacheControl: string;
  contentType: string;
  bytes: number;
  security: WebAuditSecurity;
}
export type WebAuditSeverity = 'error' | 'warning' | 'ok' | 'info';
export interface WebAuditIssue {
  severity: WebAuditSeverity;
  category: string;
  message: string;
  // Short "why it matters" rationale for the check, surfaced by the FE as a
  // hover tooltip. Optional — older payloads may omit it.
  why?: string;
}
export interface WebAuditReport {
  url: string;
  finalUrl: string;
  statusCode: number;
  ok: boolean;
  fetchedAt: string;
  durationMs: number;
  redirects: WebAuditRedirect[];
  seo: WebAuditSeo;
  quality: WebAuditQuality;
  robotsTxt: { present: boolean; url: string; hasSitemap: boolean };
  sitemap: { present: boolean; url: string };
  issues: WebAuditIssue[];
}

// ── Kubernetes Tool ─────────────────────────────────────────────────
// See k8s-v1-impl-spec. A control-plane / data-plane split rides the
// connection spine: connection CRUD dual-writes (scope/primaryScope/
// availableScopes) like the other tools, while live cluster reads are
// single-routed to a reachable BE. v1 is READ ONLY. The whole kubeconfig
// YAML is AES-GCM encrypted at rest and never sent back in list/get; only
// the non-secret parsed context list travels. The DTO field names below
// are the BE wire contract (k8sclient/types.go) — the FE must not rename
// them.

// v1 uses kubeconfig; token auth is reserved for a later revision.
export type K8sAuthMode = 'kubeconfig' | 'token';

// Non-secret, parsed from the kubeconfig BE-side (no cluster call).
export interface ContextInfo {
  name: string;
  cluster: string;
  server: string;
  namespace: string;
}

// Server-version + reachability probe (Discovery().ServerVersion()).
export interface ClusterVersion {
  version: string;
  platform: string;
  reachable: boolean;
}

// Normalized table row for any listed kind. `extra` holds kind-specific
// columns the generic table renders after the common ones.
export interface ResourceRow {
  kind: string;
  namespace: string;
  name: string;
  status: string;
  ready: string;
  restarts: number;
  age: string;
  node: string;
  extra?: Record<string, string>;
}

// A workload's rollout history entry (mirrors k8sclient.WorkloadRevision).
export interface K8sWorkloadRevision {
  revision: number;
  name: string;
  kind: 'ReplicaSet' | 'ControllerRevision';
  desired?: number;
  ready?: number;
  images?: string[];
  changeCause?: string;
  age: string;
  current: boolean;
}

// Pods matched by a workload's selector + its revisions (k8sclient.WorkloadRelated).
export interface K8sWorkloadRelated {
  pods: ResourceRow[];
  podsErr?: string;
  supportsRevisions: boolean;
  revisions: K8sWorkloadRevision[];
  revisionsErr?: string;
}

// Full object for the detail drawer — the BE returns both JSON (raw) and a
// rendered YAML string. Secret data values are masked server-side.
export interface ResourceDetail {
  kind: string;
  namespace: string;
  name: string;
  /** Raw object JSON (json.RawMessage on the wire). */
  json: unknown;
  yaml: string;
}

export interface K8sConnection {
  id: string;
  userId: string;
  workspaceId?: string;
  name: string;
  /** Selected context name — the default the explorer opens on. */
  defaultContext: string;
  /** Cached non-secret context list parsed from the kubeconfig. */
  contexts: ContextInfo[];
  authMode: K8sAuthMode;
  /** True when a kubeconfig is stored (never sent back in the clear). */
  hasKubeconfig?: boolean;
  /** insecureSkipVerify(bool), allowedNamespaces(string[]),
   *  disableExecPlugins(bool), allowExecPlugins(bool — desktop-local opt-in
   *  for EKS/GKE kubeconfig exec credential plugins; ignored on hosted BE),
   *  prometheusService(string "ns/svc:port" — pins Prometheus for historical
   *  pod metrics, skipping auto-discovery). */
  options?: Record<string, unknown>;
  ownerName?: string;
  shared?: boolean;
  grantRole?: 'owner' | 'read' | 'write';
  scope?: 'local' | 'remote';
  primaryScope?: 'local' | 'remote' | '';
  availableScopes?: Array<'local' | 'remote'>;
  createdAt: string;
  updatedAt: string;
}

// Cluster Overview (Lens-style dashboard) — GET /k8s/:id/overview?context=.
// A single aggregate snapshot of the selected connection+context. The BE wire
// contract; the axios interceptor unwraps the outer { data } so a caller sees
// this shape directly.
export interface ClusterOverview {
  version: { version: string; platform: string; reachable: boolean };
  nodes: { total: number; ready: number; notReady: number };
  pods: { total: number; running: number; pending: number; succeeded: number; failed: number; unknown: number };
  workloads: {
    deployments: number;
    statefulSets: number;
    daemonSets: number;
    jobs: number;
    cronJobs: number;
    replicaSets: number;
  };
  networking: { services: number; ingresses: number; configMaps: number; secrets: number };
  namespaces: number;
  events: { total: number; warnings: number };
  // metrics-server derived. `available` is false when the metrics API is
  // absent — the optional fields are then omitted and the UI shows an install
  // hint instead of the CPU/memory gauges.
  metrics: {
    available: boolean;
    cpuUsedCores?: number;
    cpuCapacityCores?: number;
    memUsedBytes?: number;
    memCapacityBytes?: number;
    nodes?: Array<{
      name: string;
      cpuUsedCores: number;
      cpuCapacityCores: number;
      memUsedBytes: number;
      memCapacityBytes: number;
    }>;
  };
}

// Live pod resource usage from the cluster's metrics-server
// (metrics.k8s.io/v1beta1) — GET /k8s/:id/pod-metrics?context=&namespace=.
// `available` is false when metrics-server is absent/not ready; the UI then
// shows the `reason` as an install hint instead of the (empty) pods list. CPU
// is millicores (e.g. 12 → "12m"), memory is bytes. The BE wire contract.
export interface K8sContainerMetrics {
  name: string;
  cpuMilli: number;
  memBytes: number;
}

export interface K8sPodMetrics {
  namespace: string;
  name: string;
  /** Pod total (sum of containers), in millicores. */
  cpuMilli: number;
  /** Pod total (sum of containers), in bytes. */
  memBytes: number;
  window?: string;
  containers?: K8sContainerMetrics[];
}

export interface K8sPodMetricsResult {
  available: boolean;
  reason?: string;
  pods: K8sPodMetrics[];
}

/** One historical sample: t = unix ms, val = millicores (CPU) or bytes (memory). */
export interface K8sPromSeriesPoint {
  t: number;
  val: number;
}

export interface K8sPromContainerSeries {
  container: string;
  cpu: K8sPromSeriesPoint[];
  mem: K8sPromSeriesPoint[];
}

/**
 * Historical pod metrics from an in-cluster Prometheus (via the kube-apiserver
 * service-proxy). available=false ⇒ no Prometheus discoverable, fall back to the
 * metrics-server live snapshot (K8sPodMetricsResult). CPU/Mem are pod totals.
 */
export interface K8sPodMetricsHistoryResult {
  available: boolean;
  reason?: string;
  source?: string;         // "prometheus" when available
  service?: string;        // ns/svc:port that answered
  range?: string;          // "15m" | "1h" | "6h" | "24h"
  stepSec?: number;
  cpu: K8sPromSeriesPoint[];
  mem: K8sPromSeriesPoint[];
  containers: K8sPromContainerSeries[];
}

// ── Git Tools (v1) ──────────────────────────────────────────────────
// See GIT_V1_CONTRACT.md. A control-plane / data-plane split rides the
// connection spine, exactly like the DB / Kafka / S3 / Redis / ES / K8s
// tools: connection CRUD dual-writes (scope/primaryScope/availableScopes)
// while remote reads authenticate as the caller's linked GitLab account
// and local working-tree ops run git on the user's own machine. The DTO
// field names below are the BE wire contract (contract §3) — the FE must
// not rename them.

// The stored PAT/token/SSH credential (authKind != 'oauth') is AES-GCM
// encrypted at rest and never returned in the clear — only `hasCredential`
// travels (mirrors K8sConnection.hasKubeconfig). Matches the BE DTO
// (models/git.go) plus the FE-derived dual-write scope fields.
export interface GitConnection {
  id: string;
  userId: string;
  name: string;
  /** Provider — "gitlab" in v1. */
  provider: string;
  baseUrl: string;
  /** "oauth" | "pat" | "ssh". */
  authKind: string;
  /** True when a credential is stored (authKind != 'oauth'); never exposed. */
  hasCredential: boolean;
  ownerName?: string;
  shared?: boolean;
  grantRole?: 'owner' | 'read' | 'write';
  scope?: 'local' | 'remote';
  primaryScope?: 'local' | 'remote' | '';
  availableScopes?: Array<'local' | 'remote'>;
  createdAt: string;
  updatedAt: string;
}

// One project the caller can browse (GitLab /projects?membership=true).
export interface GitRepoSummary {
  id: number | string;
  name: string;
  path: string;
  fullPath: string;
  defaultBranch: string;
  httpUrl: string;
  lastActivityAt: string;
  visibility: string;
}

export interface GitBranch {
  name: string;
  isDefault: boolean;
  /** Set on local branch listings — true for the checked-out branch. */
  current?: boolean;
  commitSha: string;
  ahead?: number;
  behind?: number;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  title: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  /** Parent SHAs — drives the commit graph/DAG lane algorithm. */
  parents: string[];
  webUrl?: string;
}

export interface GitTreeEntry {
  name: string;
  path: string;
  type: 'tree' | 'blob';
  mode?: string;
  size?: number;
  sha?: string;
}

export interface GitFileDiff {
  oldPath: string;
  newPath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  renamed: boolean;
  binary: boolean;
  /** Unified patch text (empty for binary). */
  patch: string;
  additions?: number;
  deletions?: number;
}

export interface GitContributor {
  name: string;
  email: string;
  commits: number;
  additions?: number;
  deletions?: number;
}

export interface GitMergeRequest {
  iid: number;
  title: string;
  state: string;
  sourceBranch: string;
  targetBranch: string;
  author: string;
  webUrl: string;
  createdAt: string;
}

// One changed path from `git status --porcelain=v2`. `x`/`y` are the raw
// staged/worktree status codes; `status` is the normalized bucket.
export interface GitStatusEntry {
  path: string;
  x: string;
  y: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  oldPath?: string;
}

export interface GitStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: GitStatusEntry[];
  unstaged: GitStatusEntry[];
  untracked: string[];
  conflicted: string[];
  clean: boolean;
}
