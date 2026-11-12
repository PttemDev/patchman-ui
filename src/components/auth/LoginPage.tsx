import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Loader2, GitBranch } from 'lucide-react';
import { PatchmanLogo } from '@/components/PatchmanLogo';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DownloadAppBadge } from '@/components/layout/DownloadAppBadge';
import { getAppVersion } from '@/lib/version';
import { ssoAPI } from '@/services/api';
import { isDesktop } from '@/lib/platform';
import { emailPlaceholder } from '@/lib/tenant';
import type { AxiosError } from 'axios';

export function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const { login, enterLocalMode } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Where to send the user after a successful login. Set by deep links
  // that need an authenticated context — e.g. /join/<token>. Restricted
  // to absolute, same-origin paths so a malicious `?next=https://evil`
  // can't bounce the freshly-authed user off-site.
  const nextParam = new URLSearchParams(location.search).get('next');
  const safeNext = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

  const handleContinueLocal = () => {
    enterLocalMode();
    navigate(safeNext);
  };

  const handleSSO = async (provider: 'gitlab') => {
    setError('');
    setLoading(true);
    try {
      const surface = isDesktop() ? 'desktop' : 'web';
      const res = await ssoAPI.start(provider, surface, window.location.origin);
      // Stash the verifier-bound state so the callback page can guard
      // against an attacker-supplied state parameter.
      try {
        sessionStorage.setItem('patchman_sso_state', res.data.state);
        sessionStorage.setItem('patchman_sso_next', safeNext);
      } catch {
        // ignore — quota etc.
      }
      if (isDesktop()) {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(res.data.authUrl);
      } else {
        // Same-tab redirect: simpler than popup for sign-in (no parent
        // tab to coordinate with).
        window.location.href = res.data.authUrl;
      }
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      setError(ax.response?.data?.error || ax.message || t('auth:login.ssoStartFailed'));
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate(safeNext);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosError = err as { response?: { data?: { message?: string } } };
        setError(axiosError.response?.data?.message || t('auth:login.failed'));
      } else {
        setError(t('auth:login.failed'));
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <PatchmanLogo size={40} />
            <span className="text-3xl font-bold tracking-tight">PatchMan</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('auth:tagline')}
          </p>
        </div>

        <div className="border rounded-lg bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-1">{t('auth:login.heading')}</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {t('auth:login.subtitle')}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">{t('auth:fields.emailLabel')}</Label>
              <Input
                id="email"
                type="email"
                placeholder={emailPlaceholder()}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('auth:fields.passwordLabel')}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t('auth:fields.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t('auth:login.submit')}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">{t('auth:login.or')}</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full mb-2"
            onClick={() => handleSSO('gitlab')}
            disabled={loading}
          >
            <GitBranch className="h-4 w-4 mr-2" />
            {t('auth:login.gitlab')}
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleContinueLocal}
            disabled={loading}
          >
            {t('auth:login.continueLocal')}
          </Button>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {t('auth:login.localHint')}
          </p>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t('auth:login.noAccount')}{' '}
              <Link
                to="/register"
                className="text-primary font-medium hover:underline"
              >
                {t('auth:login.signUp')}
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-center">
          <DownloadAppBadge variant="full" />
        </div>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          {t('auth:versionLabel', { version: getAppVersion() })}
        </p>
      </div>
    </div>
  );
}
