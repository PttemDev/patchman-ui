// Per-tab client id, lifted out of liveSync.ts to avoid the import
// cycle: api.ts → clientId (header injection) is fine, but
// api.ts → liveSync.ts → authStore.ts → api.ts is not. Keeping this
// in its own dependency-free module lets both sides import safely.
//
// Two open tabs each get their own id (sessionStorage is per-tab),
// so a mutation in tab A still notifies tab B for the same user — the
// originating tab is the only one that silences its own event.

const CLIENT_ID_KEY = 'patchman_client_id';

function generate(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function load(): string {
  try {
    let id = sessionStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = generate();
      sessionStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    // sessionStorage unavailable (Safari private mode etc.) — fall
    // back to an in-memory id. The echo dedup degrades to "always
    // refresh on own mutation" which is harmless.
    return `mem-${Math.random().toString(36).slice(2)}`;
  }
}

export const clientId: string = load();
