// Desktop-only: receive `patchman://connect?backend=<url>&name=<label>` deep
// links and point the app at that backend. This is how a backend's download
// page hands a freshly-installed desktop app its own address — one click on
// the download page, no rebuild, no manual URL typing.
//
// Coexists with useGitLabDeepLink: the plugin fans every URL out to all
// onOpenUrl listeners, and each filters by path (this one = `connect`).
//
// Switching the active backend invalidates the current JWT (it belongs to the
// old backend), so an authenticated+synced session is signed out first. We
// then reload so axios / SSE / caches re-init cleanly and land on the new
// backend's login. Web/dev (no Tauri) the hook is a no-op.

import { useEffect } from 'react';
import { isDesktop } from '@/lib/platform';
import { useRemoteStore, normalizeRemoteUrl, checkRemote, cacheServerConfig } from '@/stores/remoteStore';
import { useAuthStore } from '@/stores/authStore';

// Marks that this app SESSION already applied its launch deep link, so a webview
// reload doesn't replay it. Cleared when the app closes (sessionStorage).
const INITIAL_HANDLED_KEY = 'patchman_connect_initial_handled';

export function useRemoteConnectDeepLink() {
  useEffect(() => {
    if (!isDesktop()) return;
    let unlisten: (() => void) | undefined;

    const handleUrls = async (urls: string[]) => {
      for (const raw of urls) {
        try {
          const u = new URL(raw);
          // Custom-scheme URLs parse with host = first path segment, so
          // `patchman://connect?...` has host === 'connect'.
          const path = `${u.host}${u.pathname}`.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
          if (path !== 'connect') continue;

          const backend = u.searchParams.get('backend') || u.searchParams.get('url') || '';
          const queryName = u.searchParams.get('name') || '';
          const normalized = normalizeRemoteUrl(backend);
          if (!normalized) continue; // invalid/missing backend — ignore silently

          // Validate the backend before pointing the app at it: it must be a
          // reachable, version-compatible PatchMan backend. (Even a deep link
          // from a download page can target a backend that's now too old/new.)
          const outcome = await checkRemote(normalized, 4000);
          if (outcome.verdict === 'unreachable' || outcome.verdict === 'not_patchman') {
            continue; // can't verify / not ours — don't switch, ignore silently
          }
          if (outcome.verdict === 'incompatible') {
            // Remember the verdict and tell the user, but don't switch to an
            // unusable backend.
            useRemoteStore.getState().recordCompat(normalized, {
              compat: 'incompatible',
              apiVersion: outcome.cfg.apiVersion,
              reason: outcome.reason,
              checkedAt: Date.now(),
            });
            useRemoteStore.getState().setNotice({
              kind: 'incompatible',
              label: queryName || outcome.cfg.name || normalized,
              reason: outcome.reason,
            });
            return;
          }

          // ok — cache the tenant config so the login after the reload shows the
          // right values, and record the compatible verdict.
          cacheServerConfig(normalized, outcome.cfg);
          const label = queryName || outcome.cfg.name || '';

          // Idempotent by URL — pressing the deep link twice reuses the same
          // remote instead of adding a duplicate.
          const id = useRemoteStore.getState().upsertRemote(label, normalized, {
            compat: 'ok',
            apiVersion: outcome.cfg.apiVersion,
          });
          if (!id) continue;

          const alreadyActive = id === useRemoteStore.getState().activeId;
          useRemoteStore.getState().setActive(id);

          const { isAuthenticated, mode } = useAuthStore.getState();
          if (isAuthenticated && mode === 'synced') {
            // The old JWT won't work on the new backend — sign out.
            useAuthStore.getState().logout();
            localStorage.removeItem('patchman_act_as_user');
            localStorage.removeItem('patchman_act_as_user_name');
          }
          // Reload unless this was a no-op (already the active backend) — a
          // reload re-inits every connection against the new backend. The
          // alreadyActive guard also stops a cold-start reload loop.
          if (!alreadyActive || (isAuthenticated && mode === 'synced')) {
            window.location.reload();
          }
          return;
        } catch {
          // ignore malformed URLs
        }
      }
    };

    (async () => {
      try {
        const { onOpenUrl, getCurrent } = await import('@tauri-apps/plugin-deep-link');
        // Process the LAUNCH deep link only ONCE per app session — not on every
        // webview reload. getCurrent() keeps returning the URL the app was
        // launched with, so without this guard a manual backend switch (which
        // reloads) gets reverted to the launch backend on the very next reload
        // (the user "can't switch away"), and any in-flight request the reload
        // interrupts — e.g. the GitLab OAuth start — fails with a network error.
        // sessionStorage survives reload but clears when the app closes, so the
        // next real launch still handles its deep link. Set the flag BEFORE
        // handling, since handleUrls itself may reload.
        let handledInitial = false;
        try { handledInitial = sessionStorage.getItem(INITIAL_HANDLED_KEY) === '1'; } catch { /* ignore */ }
        if (!handledInitial) {
          try { sessionStorage.setItem(INITIAL_HANDLED_KEY, '1'); } catch { /* ignore */ }
          const initial = await getCurrent();
          if (initial && initial.length) await handleUrls(initial);
        }
        // The live listener still handles NEW connect links while the app runs.
        unlisten = await onOpenUrl((urls) => { void handleUrls(urls); });
      } catch {
        // Plugin unavailable — ignore.
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);
}
