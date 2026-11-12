import type { Collection, SavedRequest } from '@/types';
import type { Repository } from '@/data/types';

export interface ParsedRequest {
  name: string;
  method: string;
  url: string;
  headers: string;
  params: string;
  body: string;
  auth: string;
  preRequestScript?: string;
  testScript?: string;
  sortOrder: number;
}

export interface ParsedNode {
  folder: { name: string; sortOrder: number; description?: string };
  children: ParsedNode[];
  requests: ParsedRequest[];
}

export interface ParsedImport {
  collection: {
    name: string;
    description?: string;
    baseUrl?: string;
    sourceUrl?: string;
    sourceType?: string;
  };
  rootRequests: ParsedRequest[];
  folders: ParsedNode[];
}

export type ImportFormat = 'patchman' | 'postman' | 'swagger' | 'wsdl';

/**
 * Best-effort format detection from a JSON/YAML payload. Conservative —
 * returns null when the shape is ambiguous so the caller can fall back to a
 * manual override dropdown instead of guessing wrong.
 */
export function detectImportFormat(text: string): ImportFormat | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // WSDL is XML with a <definitions> root (usually the wsdl namespace). Detect
  // it before the YAML/JSON branches since it starts with '<'.
  if (trimmed.startsWith('<')) {
    if (/<(?:[\w-]+:)?definitions[\s>]/.test(trimmed) && /wsdl|soap/i.test(trimmed)) return 'wsdl';
    return null;
  }
  // YAML-only spec is almost always OpenAPI 3 — nothing else commonly ships
  // as YAML in this dialog.
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    if (/^(swagger|openapi)\s*:/m.test(trimmed)) return 'swagger';
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  // Postman: info.schema is signature-perfect; fall back to info.name + item[].
  const info = obj.info as Record<string, unknown> | undefined;
  if (typeof info?.schema === 'string' && info.schema.includes('postman')) return 'postman';
  if (info?.name && Array.isArray(obj.item)) return 'postman';
  // OpenAPI / Swagger
  if (typeof obj.swagger === 'string' || typeof obj.openapi === 'string') return 'swagger';
  // PatchMan native export shape
  const collection = obj.collection as Record<string, unknown> | undefined;
  if (collection?.name && ('rootRequests' in obj || 'folders' in obj)) return 'patchman';
  return null;
}

// ──────────────────────────────────────────────────────────────
// Postman Collection v2.1
// ──────────────────────────────────────────────────────────────

interface PostmanKV { key: string; value: string; disabled?: boolean }
interface PostmanURL { raw?: string; protocol?: string; host?: string[]; path?: string[]; query?: PostmanKV[] }
interface PostmanFormData { key?: string; value?: string; type?: string; src?: string | string[]; disabled?: boolean }
interface PostmanBody {
  mode?: string;
  raw?: string;
  options?: { raw?: { language?: string } };
  formdata?: PostmanFormData[];
  urlencoded?: PostmanKV[];
}
interface PostmanAuth { type?: string; bearer?: PostmanKV[]; basic?: PostmanKV[]; apikey?: PostmanKV[] }
interface PostmanReq { method?: string; header?: PostmanKV[]; url?: PostmanURL | string; body?: PostmanBody; auth?: PostmanAuth }
interface PostmanItem { name?: string; item?: PostmanItem[]; request?: PostmanReq }
interface PostmanCollection { info?: { name?: string; description?: string }; item?: PostmanItem[] }

function kvValue(kvs: PostmanKV[] | undefined, key: string): string {
  if (!kvs) return '';
  const found = kvs.find((kv) => kv.key === key);
  return found?.value ?? '';
}

function normalizePostmanURL(url: PostmanURL | string | undefined): { raw: string; query: PostmanKV[] } {
  if (!url) return { raw: '', query: [] };
  if (typeof url === 'string') return { raw: url, query: [] };
  if (url.raw) return { raw: url.raw, query: url.query ?? [] };
  const protocol = url.protocol || 'https';
  const host = (url.host ?? []).join('.');
  const path = (url.path ?? []).join('/');
  if (!host) return { raw: '', query: url.query ?? [] };
  const parts = [`${protocol}://${host}`];
  if (path) parts.push(path);
  return { raw: parts.join('/'), query: url.query ?? [] };
}

function convertPostmanRequest(item: PostmanItem, sortOrder: number): ParsedRequest {
  const pr = item.request ?? {};
  const method = (pr.method || 'GET').toUpperCase();
  const { raw, query } = normalizePostmanURL(pr.url);

  const headers = (pr.header ?? []).map((h) => ({
    key: h.key,
    value: h.value,
    enabled: !h.disabled,
  }));
  const params = query.map((q) => ({
    key: q.key,
    value: q.value,
    enabled: !q.disabled,
  }));

  let bodyType = 'none';
  let bodyContent = '';
  let formEncoding: 'multipart' | 'urlencoded' | undefined;
  if (pr.body) {
    switch (pr.body.mode) {
      case 'raw': {
        bodyContent = pr.body.raw ?? '';
        const lang = pr.body.options?.raw?.language;
        bodyType = lang === 'json' ? 'json' : lang === 'xml' ? 'xml' : 'raw';
        break;
      }
      case 'urlencoded': {
        // x-www-form-urlencoded: every field is text.
        const fields = (pr.body.urlencoded ?? []).map((f) => ({
          key: f.key ?? '',
          value: f.value ?? '',
          type: 'text' as const,
          enabled: !f.disabled,
        }));
        bodyType = 'form';
        bodyContent = JSON.stringify(fields);
        formEncoding = 'urlencoded';
        break;
      }
      case 'formdata': {
        // multipart/form-data. Text fields carry their value; file fields keep
        // only the filename (the collection has no file bytes to import — the
        // user re-attaches), and force multipart on send anyway.
        const fields = (pr.body.formdata ?? []).map((f) => {
          const isFile = f.type === 'file';
          const src = Array.isArray(f.src) ? f.src[0] : f.src;
          return {
            key: f.key ?? '',
            value: isFile ? '' : (f.value ?? ''),
            type: isFile ? ('file' as const) : ('text' as const),
            enabled: !f.disabled,
            ...(isFile && src ? { fileName: src.split(/[\\/]/).pop() || src } : {}),
          };
        });
        bodyType = 'form';
        bodyContent = JSON.stringify(fields);
        formEncoding = 'multipart';
        break;
      }
      case 'graphql':
        bodyType = 'graphql';
        bodyContent = pr.body.raw ?? '';
        break;
      default:
        bodyType = 'raw';
        bodyContent = pr.body.raw ?? '';
    }
  }

  let auth: Record<string, string> = { type: 'none' };
  if (pr.auth) {
    switch (pr.auth.type) {
      case 'bearer':
        auth = { type: 'bearer', token: kvValue(pr.auth.bearer, 'token') };
        break;
      case 'basic':
        auth = {
          type: 'basic',
          username: kvValue(pr.auth.basic, 'username'),
          password: kvValue(pr.auth.basic, 'password'),
        };
        break;
      case 'apikey': {
        const addTo = kvValue(pr.auth.apikey, 'in') || 'header';
        auth = {
          type: 'apikey',
          key: kvValue(pr.auth.apikey, 'key'),
          value: kvValue(pr.auth.apikey, 'value'),
          addTo,
        };
        break;
      }
    }
  }

  return {
    name: item.name || 'Untitled',
    method,
    url: raw,
    headers: JSON.stringify(headers),
    params: JSON.stringify(params),
    body: JSON.stringify({ type: bodyType, content: bodyContent, ...(formEncoding ? { formEncoding } : {}) }),
    auth: JSON.stringify(auth),
    sortOrder,
  };
}

function processPostmanItems(items: PostmanItem[]): { folders: ParsedNode[]; requests: ParsedRequest[] } {
  const folders: ParsedNode[] = [];
  const requests: ParsedRequest[] = [];
  items.forEach((item, idx) => {
    if (item.item && item.item.length > 0) {
      const sub = processPostmanItems(item.item);
      folders.push({
        folder: { name: item.name || 'Untitled folder', sortOrder: idx },
        children: sub.folders,
        requests: sub.requests,
      });
    } else if (item.request) {
      requests.push(convertPostmanRequest(item, idx));
    }
  });
  return { folders, requests };
}

export function parsePostman(text: string): ParsedImport {
  const data = JSON.parse(text) as PostmanCollection;
  const { folders, requests } = processPostmanItems(data.item ?? []);
  return {
    collection: {
      name: data.info?.name || 'Imported Postman Collection',
      description: data.info?.description,
      sourceType: 'postman',
    },
    rootRequests: requests,
    folders,
  };
}

// ──────────────────────────────────────────────────────────────
// OpenAPI / Swagger (JSON only — YAML support would add a parser dep)
// ──────────────────────────────────────────────────────────────

interface OpenAPIParam { name?: string; in?: string; required?: boolean }
interface OpenAPIOp {
  summary?: string;
  operationId?: string;
  description?: string;
  parameters?: OpenAPIParam[];
  // Tags groups operations under named buckets — modern OpenAPI specs
  // (Swashbuckle .NET, NSwag, FastAPI, NestJS, etc.) carry their
  // hierarchy here instead of in directories. We mirror it into
  // PatchMan folders so the imported collection isn't a 200-row flat
  // list.
  tags?: string[];
}
interface OpenAPIServer { url?: string }
interface OpenAPISpec {
  info?: { title?: string; description?: string; version?: string };
  paths?: Record<string, Record<string, OpenAPIOp>>;
  servers?: OpenAPIServer[];
  host?: string;
  basePath?: string;
  schemes?: string[];
}

function openAPIBaseURL(spec: OpenAPISpec): string {
  if (spec.servers && spec.servers.length > 0 && spec.servers[0].url) {
    return spec.servers[0].url.replace(/\/+$/, '');
  }
  if (spec.host) {
    const scheme = spec.schemes && spec.schemes.length > 0 ? spec.schemes[0] : 'https';
    let base = `${scheme}://${spec.host}`;
    if (spec.basePath && spec.basePath !== '/') base += spec.basePath;
    return base.replace(/\/+$/, '');
  }
  return '';
}

// Stable HTTP-method order so re-importing the same spec produces the
// same on-screen layout. Anything outside this list (custom verbs)
// falls through to alphabetical.
const METHOD_RANK: Record<string, number> = {
  get: 0, post: 1, put: 2, patch: 3, delete: 4, head: 5, options: 6, trace: 7,
};

function buildOperationFromOp(
  op: OpenAPIOp,
  method: string,
  path: string,
  sortOrder: number,
): ParsedRequest {
  const upper = method.toUpperCase();
  const name = op.summary || op.operationId || `${upper} ${path}`;
  const headers: Array<{ key: string; value: string; enabled: boolean }> = [];
  const params: Array<{ key: string; value: string; enabled: boolean }> = [];
  (op.parameters ?? []).forEach((p) => {
    const entry = { key: p.name ?? '', value: '', enabled: !!p.required };
    if (p.in === 'header') headers.push(entry);
    else if (p.in === 'query') params.push(entry);
  });
  return {
    name,
    method: upper,
    url: path,
    headers: JSON.stringify(headers),
    params: JSON.stringify(params),
    body: JSON.stringify({ type: 'none', content: '' }),
    auth: JSON.stringify({ type: 'none' }),
    sortOrder,
  };
}

export function parseSwagger(text: string, sourceURL?: string): ParsedImport {
  const spec = JSON.parse(text) as OpenAPISpec;
  const title = spec.info?.title || 'Imported API';
  const description = spec.info?.description;
  const baseUrl = openAPIBaseURL(spec);

  // Walk every (path, method, op) triple once and bucket by first tag.
  // Modern specs (Swashbuckle, NSwag, FastAPI, NestJS, etc.) carry
  // their hierarchy in op.tags rather than directories — so a flat
  // import would dump the entire spec at the root of the collection.
  // We mirror that grouping into PatchMan folders.
  type Entry = { path: string; method: string; op: OpenAPIOp; tag: string };
  const entries: Entry[] = [];
  const paths = spec.paths ?? {};
  for (const path of Object.keys(paths).sort()) {
    const methods = paths[path] ?? {};
    const methodKeys = Object.keys(methods)
      .map((m) => m.toLowerCase())
      .filter((m) => m !== 'parameters' && m !== 'servers')
      .sort((a, b) => {
        const ra = METHOD_RANK[a];
        const rb = METHOD_RANK[b];
        if (ra !== undefined && rb !== undefined) return ra - rb;
        return a.localeCompare(b);
      });
    for (const m of methodKeys) {
      const op = methods[m] ?? {};
      const tag = (op.tags && op.tags.length > 0 ? op.tags[0] : '').trim();
      entries.push({ path, method: m, op, tag });
    }
  }

  // Distinct tags, alphabetical, become folders. Untagged ops stay at
  // the root above the folders so a tiny spec with no tags still
  // imports cleanly without a fake "Untagged" folder.
  const tagSet = new Set<string>();
  for (const e of entries) if (e.tag) tagSet.add(e.tag);
  const tags = Array.from(tagSet).sort((a, b) => a.localeCompare(b));

  const folderByTag = new Map<string, ParsedNode>();
  tags.forEach((t, idx) => {
    folderByTag.set(t, {
      // sortOrder offset by 1 so the untagged-root group renders above
      // the tag folders in tree views that order by sortOrder.
      folder: { name: t, sortOrder: idx + 1 },
      children: [],
      requests: [],
    });
  });

  const rootRequests: ParsedRequest[] = [];
  let rootSort = 0;
  const folderSortByTag = new Map<string, number>();
  for (const e of entries) {
    if (e.tag && folderByTag.has(e.tag)) {
      const node = folderByTag.get(e.tag)!;
      const so = folderSortByTag.get(e.tag) ?? 0;
      node.requests.push(buildOperationFromOp(e.op, e.method, e.path, so));
      folderSortByTag.set(e.tag, so + 1);
    } else {
      rootRequests.push(buildOperationFromOp(e.op, e.method, e.path, rootSort++));
    }
  }

  return {
    collection: {
      name: title,
      description,
      baseUrl,
      sourceUrl: sourceURL,
      sourceType: 'swagger',
    },
    rootRequests,
    folders: tags.map((t) => folderByTag.get(t)!),
  };
}

// ──────────────────────────────────────────────────────────────
// PatchMan bundle (the format produced by collection export)
// ──────────────────────────────────────────────────────────────

interface PatchmanBundle {
  collection?: { name?: string; description?: string; type?: string };
  requests?: Array<Partial<SavedRequest>>;
  name?: string;
  description?: string;
}

export function parsePatchman(text: string): ParsedImport {
  const data = JSON.parse(text) as PatchmanBundle;
  const coll = data.collection
    ? { name: data.collection.name || 'Imported', description: data.collection.description }
    : { name: data.name || 'Imported', description: data.description };

  const requests: ParsedRequest[] = (data.requests ?? []).map((r, idx) => ({
    name: r.name || `Request ${idx + 1}`,
    method: (r.method || 'GET').toString().toUpperCase(),
    url: r.url || '',
    headers: typeof r.headers === 'string' ? r.headers : JSON.stringify(r.headers ?? []),
    params: typeof r.params === 'string' ? r.params : JSON.stringify(r.params ?? []),
    body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? { type: 'none', content: '' }),
    auth: typeof r.auth === 'string' ? r.auth : JSON.stringify(r.auth ?? { type: 'none' }),
    preRequestScript: typeof r.preRequestScript === 'string' ? r.preRequestScript : undefined,
    testScript: typeof r.testScript === 'string' ? r.testScript : undefined,
    sortOrder: r.sortOrder ?? idx,
  }));

  return {
    collection: { name: coll.name, description: coll.description },
    rootRequests: requests,
    folders: [],
  };
}

// ──────────────────────────────────────────────────────────────
// Persistence — writes parsed tree through the repo.
// Creates the root collection, then folders (as child collections) recursively,
// then requests in the order they appear. Returns the root collection id.
// ──────────────────────────────────────────────────────────────

export async function persistParsedImport(
  parsed: ParsedImport,
  repo: Repository,
  opts: { workspaceId?: string } = {},
): Promise<{ collection: Collection; requestCount: number }> {
  // Stamp the caller's active workspace onto the root so the imported
  // collection shows up in the workspace the user is currently looking at.
  // Without this the BE falls back to the user's default workspace, which
  // may not be the one that's filtering the sidebar — so the import looks
  // silently lost.
  const collection = await repo.collections.create({
    name: parsed.collection.name,
    description: parsed.collection.description ?? '',
    type: 'collection',
    parentId: null,
    sortOrder: 0,
    baseUrl: parsed.collection.baseUrl,
    sourceUrl: parsed.collection.sourceUrl,
    sourceType: parsed.collection.sourceType,
    ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
  });

  let requestCount = 0;

  async function writeRequests(parentId: string, requests: ParsedRequest[]) {
    for (const req of requests) {
      await repo.requests.create({
        collectionId: parentId,
        name: req.name,
        method: req.method,
        url: req.url,
        headers: req.headers,
        params: req.params,
        body: req.body,
        auth: req.auth,
        preRequestScript: req.preRequestScript ?? '',
        testScript: req.testScript ?? '',
        sortOrder: req.sortOrder,
      } as unknown as Partial<SavedRequest> & { collectionId: string });
      requestCount++;
    }
  }

  async function writeFolders(parentId: string, folders: ParsedNode[]) {
    for (const node of folders) {
      const folder = await repo.collections.create({
        name: node.folder.name,
        description: node.folder.description ?? '',
        type: 'folder',
        parentId,
        sortOrder: node.folder.sortOrder,
      });
      await writeRequests(folder.id, node.requests);
      await writeFolders(folder.id, node.children);
    }
  }

  await writeRequests(collection.id, parsed.rootRequests);
  await writeFolders(collection.id, parsed.folders);

  return { collection, requestCount };
}

// ──────────────────────────────────────────────────────────────
// Swagger URL fetch — best-effort direct fetch.
// Works when the spec server sends CORS headers; otherwise the caller sees
// a clear error and can upload the file instead.
// ──────────────────────────────────────────────────────────────

export async function fetchSwaggerText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch spec: HTTP ${res.status}`);
  }
  return res.text();
}
