// GitLab OAuth callback. Two flows land on this same FE route because
// they share the registered redirect URI on the GitLab OAuth Application:
//
//   1. Integration (Settings → Connect GitLab) — links the user's
//      account; we hand `code+state` to the originating Settings tab via
//      localStorage and close.
//
//   2. SSO sign-in (Login → Sign in with GitLab) — exchanges the code
//      with the BE and signs the user in.
//
// The discriminator is `sessionStorage.patchman_sso_state`: only the SSO
// flow stashes a state there, so its presence (and match against the
// URL's `state` param) means "this callback belongs to a sign-in".

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SSOCallbackPage } from './SSOCallbackPage';

export function GitLabOAuthCallback() {
  const { t } = useTranslation('auth');
  const [mode, setMode] = useState<'detecting' | 'sso' | 'integration'>('detecting');
  const [message, setMessage] = useState(t('auth:gitlab.linking'));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = params.get('state');

    let ssoExpected: string | null = null;
    try {
      ssoExpected = sessionStorage.getItem('patchman_sso_state');
    } catch {
      // sessionStorage unavailable — fall through to integration flow
    }

    if (state && ssoExpected && state === ssoExpected) {
      setMode('sso');
      return;
    }
    setMode('integration');

    // Integration flow — same payload-handoff we've always done.
    const code = params.get('code');
    const error = params.get('error') || params.get('error_description');
    const payload = {
      code: code || '',
      state: state || '',
      error: error || (!code || !state ? t('auth:gitlab.missingCodeState') : ''),
    };

    try {
      localStorage.setItem('patchman_gitlab_oauth_result', JSON.stringify(payload));
    } catch {
      // ignore
    }

    if (payload.error) {
      setMessage(t('auth:gitlab.linkFailed', { error: payload.error }));
      return;
    }

    setMessage(t('auth:gitlab.linked'));
    const closeTimer = window.setTimeout(() => {
      try {
        window.close();
      } catch {
        // user can close manually
      }
    }, 600);
    return () => window.clearTimeout(closeTimer);
  }, []);

  if (mode === 'sso') {
    return <SSOCallbackPage />;
  }

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-2">
        <div className="text-base font-medium">{message}</div>
        <div className="text-xs text-muted-foreground">PatchMan ↔ GitLab</div>
      </div>
    </div>
  );
}
