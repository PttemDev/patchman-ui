import { useAuthStore } from '@/stores/authStore';
import { isDesktop } from '@/lib/platform';
import { httpRepo } from './http/HttpRepo';
import { localRepo } from './local/LocalRepo';
import type { Repository } from './types';

/**
 * Pick the repository backing the current session.
 *
 * - Synced (any platform): HttpRepo → remote BE via JWT.
 * - Web-local: LocalRepo → IndexedDB (the browser-offline story from
 *   Phases 1–3). No embedded BE is reachable from a plain browser tab.
 * - Desktop-local: HttpRepo → embedded Go BE on localhost. api.ts's
 *   baseURL interceptor routes the request to the sidecar; IndexedDB
 *   stays empty because the sidecar's SQLite is already the store of
 *   record for desktop users.
 */
export function getRepo(): Repository {
  const mode = useAuthStore.getState().mode;
  if (mode !== 'local') return httpRepo;
  return isDesktop() ? httpRepo : localRepo;
}

/**
 * True when the current session reads/writes its own device.
 *
 * Note: this does **not** imply "uses IndexedDB". Desktop-local is
 * `isLocalMode()===true` but hits the embedded HTTP BE. Callers that
 * really mean "IndexedDB-backed" should use `usesIndexedDB()` instead.
 */
export function isLocalMode(): boolean {
  return useAuthStore.getState().mode === 'local';
}

/**
 * True only for the web-local case where the repo is IndexedDB. Used by
 * code that needs to avoid features that don't exist in LocalRepo (global
 * search, server-rendered imports, etc.).
 */
export function usesIndexedDB(): boolean {
  return isLocalMode() && !isDesktop();
}

export type { Repository, Capabilities } from './types';
