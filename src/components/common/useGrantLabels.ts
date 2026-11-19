import { useCallback, useEffect, useMemo, useState } from 'react';
import { teamsAPI, usersAPI } from '@/services/api';

interface GrantLike {
  subjectKind: string;
  subjectId: string;
  label?: string;
}

// useGrantLabels names the people and teams in a connection's share list.
// The backend labels each grant from ITS users / teams tables, but a
// connection kept on the desktop's local backend only knows the local user,
// so grants to teammates came back as bare ids. Grants without a real label
// are looked up on the account (remote) backend; anything still unknown
// shows the id as before.
export function useGrantLabels(grants: GrantLike[]): (g: GrantLike) => string {
  const [names, setNames] = useState<Record<string, string>>({});

  const missing = useMemo(() => {
    const users = new Set<string>();
    const teams = new Set<string>();
    for (const g of grants) {
      if ((g.label && g.label !== g.subjectId) || names[g.subjectId]) continue;
      if (g.subjectKind === 'user') users.add(g.subjectId);
      else if (g.subjectKind === 'team') teams.add(g.subjectId);
    }
    return { users: [...users].sort(), teams: [...teams].sort() };
  }, [grants, names]);
  const key = `${missing.users.join(',')}|${missing.teams.join(',')}`;

  useEffect(() => {
    if (key === '|') return;
    // Signed out (local-only mode): there is no account backend to ask.
    let signedIn = false;
    try { signedIn = !!localStorage.getItem('patchman_token'); } catch { /* storage off */ }
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      const found: Record<string, string> = {};
      const [u, t] = await Promise.allSettled([
        missing.users.length ? usersAPI.lookup(missing.users) : Promise.resolve(null),
        missing.teams.length ? teamsAPI.list() : Promise.resolve(null),
      ]);
      if (u.status === 'fulfilled' && u.value) {
        for (const x of (u.value.data as { id: string; name?: string; email?: string }[] | undefined) ?? []) {
          const label = x.name || x.email;
          if (label) found[x.id] = label;
        }
      }
      if (t.status === 'fulfilled' && t.value) {
        const wanted = new Set(missing.teams);
        for (const x of (t.value.data as { id: string; name?: string }[] | undefined) ?? []) {
          if (wanted.has(x.id) && x.name) found[x.id] = x.name;
        }
      }
      if (!cancelled && Object.keys(found).length) setNames((prev) => ({ ...prev, ...found }));
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useCallback(
    (g: GrantLike) => (g.label && g.label !== g.subjectId ? g.label : names[g.subjectId] || g.label || g.subjectId),
    [names],
  );
}
