import type { DBScope } from '@/services/api';
import { isDesktop } from '@/lib/platform';

// Where a connection's share grants live. Other people only ever reach the
// account (remote) backend, so a grant written to the desktop's local
// backend — what happened when the connection's acting scope was local —
// was invisible to the person it was for, read or write alike. Grants go to
// remote whenever the connection exists there; a connection kept only on
// this computer can't be shared (localOnly).
export function shareScopeFor(c: { scope?: string; beScope?: DBScope; availableScopes?: DBScope[] }): {
  grantScope: DBScope;
  localOnly: boolean;
  /** Also on this computer's backend: grants made there before are moved. */
  alsoLocal: boolean;
} {
  // Observability rows use `scope` for something else; their BE scope is beScope.
  const acting: DBScope = c.beScope ?? (c.scope === 'local' || c.scope === 'remote' ? c.scope : 'remote');
  if (!isDesktop()) return { grantScope: acting, localOnly: false, alsoLocal: false };
  const avail = c.availableScopes?.length ? c.availableScopes : [acting];
  if (avail.includes('remote')) return { grantScope: 'remote', localOnly: false, alsoLocal: avail.includes('local') };
  return { grantScope: acting, localOnly: true, alsoLocal: false };
}

interface GrantRow { id: string; subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' }

export interface GrantMover {
  list: (scope: DBScope) => Promise<GrantRow[]>;
  add: (g: GrantRow, scope: DBScope) => Promise<unknown>;
  remove: (g: GrantRow, scope: DBScope) => Promise<unknown>;
}

// moveLocalGrants copies grants that were saved on the local backend (where
// nobody else could see them) to the remote one, then drops the local copy.
// Best effort: a grant that fails to copy stays local; returns how many moved.
export async function moveLocalGrants(m: GrantMover): Promise<number> {
  let local: GrantRow[];
  let remote: GrantRow[];
  try {
    [local, remote] = await Promise.all([m.list('local'), m.list('remote')]);
  } catch {
    return 0;
  }
  if (!local.length) return 0;
  const have = new Set(remote.map((g) => `${g.subjectKind}:${g.subjectId}`));
  let moved = 0;
  for (const g of local) {
    try {
      if (!have.has(`${g.subjectKind}:${g.subjectId}`)) await m.add(g, 'remote');
      await m.remove(g, 'local');
      moved++;
    } catch { /* keep it local; next open retries */ }
  }
  return moved;
}

/** The usual connection grant API shape (DB, ES, Kafka, S3, …). */
export function grantMover(
  api: {
    listGrants: (id: string, scope?: DBScope) => Promise<{ data: unknown }>;
    addGrant: (id: string, data: { subjectKind: 'user' | 'team'; subjectId: string; role?: 'read' | 'write' }, scope?: DBScope) => Promise<unknown>;
    deleteGrant: (id: string, grantId: string, scope?: DBScope) => Promise<unknown>;
  },
  connId: string,
): GrantMover {
  return {
    list: async (s) => ((await api.listGrants(connId, s)).data as GrantRow[] | undefined) ?? [],
    add: (g, s) => api.addGrant(connId, { subjectKind: g.subjectKind, subjectId: g.subjectId, role: g.role }, s),
    remove: (g, s) => api.deleteGrant(connId, g.id, s),
  };
}
