import Dexie, { type Table } from 'dexie';
import type {
  Collection,
  CookieItem,
  Defect,
  Environment,
  HistoryItem,
  SavedResponseDetail,
  Requirement,
  SavedRequest,
  Workspace,
} from '@/types';
import { useDbStatusStore } from '@/stores/dbStatusStore';

export interface LocalCollection extends Collection {
  userId: string;
  createdAt: string;
  updatedAt: string;
  _dirty?: boolean;
  _deleted?: boolean;
  _origin?: 'local' | 'server';
}

export interface LocalSavedRequest extends SavedRequest {
  createdAt: string;
  updatedAt: string;
  _dirty?: boolean;
  _deleted?: boolean;
  _origin?: 'local' | 'server';
}

export interface LocalEnvironment extends Environment {
  userId: string;
  createdAt: string;
  updatedAt: string;
  _dirty?: boolean;
  _deleted?: boolean;
  _origin?: 'local' | 'server';
}

export interface LocalHistoryItem extends HistoryItem {
  requestHeaders?: string;
  requestBody?: string;
  responseHeaders?: string;
  responseBody?: string;
  responseSize?: number;
}

export interface LocalCookie extends CookieItem {
  createdAt: string;
  updatedAt: string;
}

export interface OutboxEntry {
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  payload?: unknown;
  createdAt: string;
  attempts: number;
}

export interface LocalDefect extends Omit<Defect, 'tags'> {
  tags?: string[];
  _dirty?: boolean;
  _deleted?: boolean;
  _origin?: 'local' | 'server';
}

export interface LocalRequirement extends Omit<Requirement, 'tags'> {
  tags?: string[];
  _dirty?: boolean;
  _deleted?: boolean;
  _origin?: 'local' | 'server';
}

export interface LocalWorkspace extends Workspace {
  _dirty?: boolean;
  _deleted?: boolean;
  _origin?: 'local' | 'server';
}

/** A saved response in web-local mode (IndexedDB holds the whole pair). */
export type LocalSavedResponse = SavedResponseDetail;

class PatchManDB extends Dexie {
  collections!: Table<LocalCollection, string>;
  requests!: Table<LocalSavedRequest, string>;
  environments!: Table<LocalEnvironment, string>;
  history!: Table<LocalHistoryItem, string>;
  cookies!: Table<LocalCookie, string>;
  outbox!: Table<OutboxEntry, string>;
  defects!: Table<LocalDefect, string>;
  requirements!: Table<LocalRequirement, string>;
  workspaces!: Table<LocalWorkspace, string>;
  savedResponses!: Table<LocalSavedResponse, string>;

  constructor() {
    super('patchman-data');
    this.version(1).stores({
      collections: 'id, userId, parentId, sortOrder, _dirty, _deleted',
      requests: 'id, collectionId, sortOrder, _dirty, _deleted',
      environments: 'id, userId, isActive, _dirty, _deleted',
      history: 'id, createdAt',
      cookies: 'id, domain, [domain+name+path]',
    });
    // v2: outbox for retrying synced-mode writes that failed due to
    // transient network errors. Replayed on next loadUser/login success.
    this.version(2).stores({
      collections: 'id, userId, parentId, sortOrder, _dirty, _deleted',
      requests: 'id, collectionId, sortOrder, _dirty, _deleted',
      environments: 'id, userId, isActive, _dirty, _deleted',
      history: 'id, createdAt',
      cookies: 'id, domain, [domain+name+path]',
      outbox: 'id, createdAt',
    });
    // v3: QA entities — defects + requirements. Local-first CRUD; _dirty lets
    // future sync identify items to push.
    this.version(3).stores({
      collections: 'id, userId, parentId, sortOrder, _dirty, _deleted',
      requests: 'id, collectionId, sortOrder, _dirty, _deleted',
      environments: 'id, userId, isActive, _dirty, _deleted',
      history: 'id, createdAt',
      cookies: 'id, domain, [domain+name+path]',
      outbox: 'id, createdAt',
      defects: 'id, userId, status, priority, severity, createdAt, _dirty, _deleted',
      requirements: 'id, userId, type, priority, status, createdAt, _dirty, _deleted',
    });
    // v4: workspaces table — enables workspace scoping in offline/local mode.
    // Collections and environments already carry a workspaceId; this table
    // just gives the UI something to list + switch between.
    this.version(4).stores({
      collections: 'id, userId, parentId, sortOrder, workspaceId, _dirty, _deleted',
      requests: 'id, collectionId, sortOrder, _dirty, _deleted',
      environments: 'id, userId, isActive, workspaceId, _dirty, _deleted',
      history: 'id, createdAt',
      cookies: 'id, domain, [domain+name+path]',
      outbox: 'id, createdAt',
      defects: 'id, userId, status, priority, severity, createdAt, _dirty, _deleted',
      requirements: 'id, userId, type, priority, status, createdAt, _dirty, _deleted',
      workspaces: 'id, ownerId, type, _dirty, _deleted',
    });
    // v5: saved responses ("Save response" next to Download).
    this.version(5).stores({
      collections: 'id, userId, parentId, sortOrder, workspaceId, _dirty, _deleted',
      requests: 'id, collectionId, sortOrder, _dirty, _deleted',
      environments: 'id, userId, isActive, workspaceId, _dirty, _deleted',
      history: 'id, createdAt',
      cookies: 'id, domain, [domain+name+path]',
      outbox: 'id, createdAt',
      defects: 'id, userId, status, priority, severity, createdAt, _dirty, _deleted',
      requirements: 'id, userId, type, priority, status, createdAt, _dirty, _deleted',
      workspaces: 'id, ownerId, type, _dirty, _deleted',
      savedResponses: 'id, collectionId, createdAt',
    });
  }
}

export const db = new PatchManDB();

// When a newer tab starts a schema upgrade, this older tab's Dexie version
// becomes incompatible. Closing the connection here unblocks the upgrade in
// the new tab; we reload so this tab picks up the latest code.
db.on('versionchange', () => {
  db.close();
  if (typeof window !== 'undefined') window.location.reload();
});

// Surfaced when a pending upgrade is being held up by another tab still on the
// old schema. Flip the status store so App renders a modal asking the user to
// close other tabs — logs alone wouldn't be noticed.
db.on('blocked', () => {
  console.warn('[db] Schema upgrade blocked — close other tabs of this app to continue.');
  useDbStatusStore.getState().setBlocked();
});

// Proactively open so any open errors surface immediately rather than on the
// first query. A failed open leaves every Dexie call pending forever, so we
// surface the failure in-app so the user can reset if the schema is wedged.
db.open().catch((err: unknown) => {
  console.error('[db] Failed to open IndexedDB:', err);
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? String(err);
  if (name === 'VersionError' || name === 'UpgradeError' || /version/i.test(message)) {
    useDbStatusStore.getState().setIncompatible(message);
  } else {
    useDbStatusStore.getState().setError(message);
  }
});

export async function resetLocalDatabase(): Promise<void> {
  try {
    db.close();
  } catch {
    // Ignore — if close fails the delete below will usually still succeed.
  }
  await Dexie.delete('patchman-data');
}

export const HISTORY_RETENTION_DAYS = 30;

export async function pruneHistory(): Promise<void> {
  const cutoff = new Date(Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.history.where('createdAt').below(cutoff).delete();
}
