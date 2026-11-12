// Lands here after the SSO provider redirects back. Pulls code+state
// from the URL, finalises with the BE, stores the JWT, and bounces into
// the app.
//
// Two notable branches in the response:
//   - `new`: the BE just created the account → "welcome" toast on entry
//   - `merged`: an existing PatchMan account at this email was linked to
//     SSO for the first time → block on a notice modal so the user
//     knows which account they're signed into (their old password
//     still works)
//
// Same idea as the GitLab integration callback, but signs the user in
// instead of linking an account.

import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, AlertCircle, Users } from 'lucide-react';
import { ssoAPI } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import type { AxiosError } from 'axios';
import type { User } from '@/types';

const STATE_KEY = 'patchman_sso_state';
const NEXT_KEY = 'patchman_sso_next';

// Module-level in-flight promise cache, keyed on the OAuth code.
// Survives React StrictMode's mount-unmount-mount cycle so the
// second mount doesn't fire a second token-exchange POST (the OAuth
// code is one-shot — two concurrent POSTs raced takePending in the
// DB, both proceeded to GitLab, and one came back as "invalid_grant:
// code already used"). Mount #1 starts the promise; Mount #2 finds
// it and awaits the SAME response so the visible mount can update
// its own state when the answer arrives, even if the mount that
// kicked off the request has already unmounted.
type SSOResult = { token: string; user: User; new: boolean; merged: boolean };
const inflightExchanges = new Map<string, Promise<SSOResult>>();

interface MergedNotice {
  email: string;
  name: string;
  next: string;
}

export function SSOCallbackPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const setUserAndToken = useAuthStore((s) => s.setUserAndToken);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<MergedNotice | null>(null);
  // Mount-only guard — flips to false on REAL unmount, not on the
  // effect cleanup that runs on every dep change. Skips state writes
  // from a closure whose component is gone.
  //
  // CRITICAL: set true in the effect BODY, not just at useRef init.
  // React StrictMode simulates mount->unmount->mount synchronously
  // in dev, which triggers the cleanup ONCE and leaves
  // mountedRef.current == false even though the component is still
  // mounted. Re-asserting true on every effect setup pass restores
  // the invariant. Without this, every async response handler bails
  // and the page is stuck on "Finishing sign-in...".
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    const provErr = params.get('error') || params.get('error_description');

    if (provErr) {
      setError(provErr);
      return;
    }
    if (!code || !state) {
      setError(t('auth:sso.missingCodeState'));
      return;
    }

    let expected: string | null = null;
    try {
      expected = sessionStorage.getItem(STATE_KEY);
    } catch {
      // ignore
    }
    if (expected && expected !== state) {
      setError(t('auth:sso.stateMismatch'));
      return;
    }

    // Reuse the in-flight promise if a previous mount started one
    // (StrictMode dev double-mount). Both mounts await the SAME
    // response so whichever mount is still alive when it lands can
    // update its own state.
    let promise = inflightExchanges.get(code);
    if (!promise) {
      promise = ssoAPI.callback(code, state).then((res) => res.data as SSOResult);
      inflightExchanges.set(code, promise);
    }

    (async () => {
      try {
        const data = await promise!;
        if (!mountedRef.current) return;
        const { token, user, new: created, merged } = data;

        let next = '/';
        try {
          next = sessionStorage.getItem(NEXT_KEY) || '/';
          sessionStorage.removeItem(NEXT_KEY);
          sessionStorage.removeItem(STATE_KEY);
        } catch {
          // ignore
        }
        if (!next.startsWith('/') || next.startsWith('//')) next = '/';

        if (merged) {
          // Hold off on installing the JWT until the user dismisses the
          // notice. The deferred sign-in keeps the page on a clean
          // explanatory screen rather than briefly flashing the app.
          setNotice({
            email: user.email,
            name: user.name || user.email,
            next,
          });
          // Stash for the dismiss handler.
          (window as unknown as { __ssoPending?: { token: string; user: typeof user; next: string } }).__ssoPending = {
            token,
            user,
            next,
          };
          return;
        }

        if (setUserAndToken) {
          setUserAndToken(user, token);
        } else {
          localStorage.setItem('patchman_token', token);
          localStorage.setItem('patchman_user', JSON.stringify(user));
        }
        if (created) {
          toast({ title: t('auth:sso.welcome', { name: user.name || user.email }) });
        }
        navigate(next, { replace: true });
      } catch (err) {
        if (!mountedRef.current) return;
        const ax = err as AxiosError<{ error?: string }>;
        setError(ax.response?.data?.error || ax.message || t('auth:sso.failed'));
        // Drop the cached promise so a "Back to sign in" -> fresh
        // flow with a NEW code isn't accidentally awaited (different
        // key, but be defensive about state buildup across retries).
        inflightExchanges.delete(code);
      }
    })();
  }, [location.search, navigate, setUserAndToken]);

  const dismissNotice = () => {
    const pending = (window as unknown as { __ssoPending?: { token: string; user: User; next: string } }).__ssoPending;
    if (!pending) {
      setNotice(null);
      navigate('/', { replace: true });
      return;
    }
    if (setUserAndToken) {
      setUserAndToken(pending.user, pending.token);
    } else {
      localStorage.setItem('patchman_token', pending.token);
      localStorage.setItem('patchman_user', JSON.stringify(pending.user));
    }
    delete (window as unknown as { __ssoPending?: unknown }).__ssoPending;
    setNotice(null);
    navigate(pending.next, { replace: true });
  };

  if (notice) {
    return (
      <div className="h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full rounded-lg border bg-card p-6 space-y-4 shadow-sm">
          <div className="flex items-start gap-3">
            <Users className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <h2 className="text-base font-semibold">{t('auth:sso.mergedHeading')}</h2>
              <p className="text-sm text-muted-foreground">
                <Trans
                  t={t}
                  i18nKey="sso.mergedBody"
                  values={{ email: notice.email, name: notice.name }}
                  components={{ strong: <strong /> }}
                />
              </p>
              <p className="text-xs text-muted-foreground">
                {t('auth:sso.mergedNote')}
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={dismissNotice}>{t('auth:sso.continue')}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-sm w-full text-center space-y-3">
        {error ? (
          <>
            <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
            <p className="text-sm font-medium">{t('auth:sso.failedHeading')}</p>
            <p className="text-xs text-muted-foreground break-words">{error}</p>
            <Button onClick={() => navigate('/login', { replace: true })} variant="outline" size="sm">
              {t('auth:sso.backToSignIn')}
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm">{t('auth:sso.finishing')}</p>
          </>
        )}
      </div>
    </div>
  );
}
