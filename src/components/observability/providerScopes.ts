import { useEffect, useState } from 'react';
import { observabilityConnectionAPI, type DBScope } from '@/services/api';

export interface ProviderScope { id: string; name: string }

// One request per connection + backend, shared by the dialog and the map's
// source picker; a failure is not cached so the next open retries.
const cache = new Map<string, { at: number; p: Promise<ProviderScope[]> }>();
const TTL = 5 * 60_000;

function loadScopes(id: string, be?: DBScope): Promise<ProviderScope[]> {
  const key = `${id}@${be ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = observabilityConnectionAPI.scopes(id, be).then((r) => (Array.isArray(r.data) ? r.data : []) as ProviderScope[]);
  p.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), p });
  return p;
}

/** The stored connection's projects; null while loading or without an id. */
export function useProviderScopes(id: string | undefined, be?: DBScope): { scopes: ProviderScope[] | null; failed: boolean } {
  const [state, setState] = useState<{ key: string; scopes: ProviderScope[] | null; failed: boolean }>({ key: '', scopes: null, failed: false });
  const key = id ? `${id}@${be ?? ''}` : '';
  useEffect(() => {
    if (!id) return;
    let live = true;
    loadScopes(id, be).then(
      (scopes) => { if (live) setState({ key, scopes, failed: false }); },
      () => { if (live) setState({ key, scopes: null, failed: true }); },
    );
    return () => { live = false; };
  }, [id, be, key]);
  return state.key === key ? { scopes: state.scopes, failed: state.failed } : { scopes: null, failed: false };
}
