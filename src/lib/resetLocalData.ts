// Wipes every local persistence layer the app uses, then reloads. The
// "Reset local data" button in the error dialog and Settings → Data
// calls this when a user is stuck behind a corrupt persisted state
// (the headers.filter class of crashes that survives an in-place
// upgrade because the bad object lives in localStorage / IDB).
//
// Local-only on purpose: workspaces, collections, environments, etc.
// living on the BE are untouched — once the user signs back in, all
// remote data flows back. The escape hatch is for the local cache.
//
// Order matters: close the Dexie handle first so the delete doesn't
// race with a connection that's about to flush. Storage clears come
// next; reload is last so the UI redraws against a clean slate.

import { resetLocalDatabase } from '@/data/db';

const ZUSTAND_IDB_NAME = 'patchman'; // see src/lib/indexeddb-storage.ts

/**
 * Delete a single named IndexedDB database. Wraps the callback API in a
 * Promise that resolves whether or not the delete succeeds — we don't
 * want a stuck connection from another tab to block the reset.
 */
function deleteIDB(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Clear every local persistence layer and reload the page. Returns a
 * promise that doesn't resolve in normal flow — the page navigates away
 * before the await settles. If anything throws, we still attempt the
 * reload so the user isn't stranded.
 */
export async function resetLocalData(): Promise<void> {
  try {
    await resetLocalDatabase();
  } catch {
    /* fall through */
  }
  await deleteIDB(ZUSTAND_IDB_NAME);

  try { localStorage.clear(); } catch { /* SecurityError on locked-down web views */ }
  try { sessionStorage.clear(); } catch { /* same */ }

  // Use replace() so the back button doesn't carry the user back into
  // the broken pre-reset state.
  window.location.replace(window.location.origin);
}
