// Desktop-only: receive `patchman://auth/gitlab/callback?code=…&state=…`
// deep links from the OS and dispatch them to the right flow.
//
// Two flows share this URI scheme:
//   - integration: `code+state` goes to localStorage so the Settings tab
//     finalises the link
//   - SSO sign-in: navigate the in-app webview to /auth/gitlab/callback
//     so the GitLabOAuthCallback route runs the SSO branch
//
// Web/dev (no Tauri) the hook is a no-op.

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { isDesktop } from '@/lib/platform';

export function useGitLabDeepLink() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isDesktop()) return;
    let unlisten: (() => void) | undefined;

    const handleUrls = (urls: string[]) => {
      for (const raw of urls) {
        try {
          const u = new URL(raw);
          // Custom-scheme URLs parse with `host` = first path segment, so
          // accept either `patchman://auth/gitlab/callback` (host=auth) or
          // a clean pathname match.
          const path = `${u.host}${u.pathname}`.replace(/\/+/g, '/').replace(/^\//, '');
          if (path !== 'auth/gitlab/callback') continue;
          const code = u.searchParams.get('code') || '';
          const state = u.searchParams.get('state') || '';
          const error = u.searchParams.get('error') || u.searchParams.get('error_description') || '';

          // SSO sign-in path? Match the URL state against the one we
          // stashed in sessionStorage when starting the flow.
          let ssoExpected: string | null = null;
          try {
            ssoExpected = sessionStorage.getItem('patchman_sso_state');
          } catch {
            // ignore
          }
          if (state && ssoExpected && state === ssoExpected) {
            // Navigate the in-app webview to the SSO callback route so
            // SSOCallbackPage runs and signs the user in.
            navigate(`/auth/gitlab/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}${error ? `&error=${encodeURIComponent(error)}` : ''}`);
            continue;
          }

          // Integration flow — same localStorage handoff as before.
          const payload = { code, state, error };
          localStorage.setItem('patchman_gitlab_oauth_result', JSON.stringify(payload));
          window.dispatchEvent(
            new StorageEvent('storage', {
              key: 'patchman_gitlab_oauth_result',
              newValue: JSON.stringify(payload),
            }),
          );
        } catch {
          // ignore malformed URLs
        }
      }
    };

    (async () => {
      try {
        const { onOpenUrl, getCurrent } = await import('@tauri-apps/plugin-deep-link');
        // Cold-start case: the OS may have launched us with the URL. getCurrent
        // returns the URL list seen during launch.
        const initial = await getCurrent();
        if (initial && initial.length) handleUrls(initial);
        unlisten = await onOpenUrl(handleUrls);
      } catch {
        // Plugin not available (e.g. running web build under Tauri-style
        // environment detection mistakes) — silently ignore.
      }
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);
}
