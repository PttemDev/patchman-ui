import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Loader2, GitBranch, Github } from 'lucide-react';
import { PatchmanLogo } from '@/components/PatchmanLogo';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DownloadAppBadge } from '@/components/layout/DownloadAppBadge';
import { getAppVersion } from '@/lib/version';
import { ssoAPI, type SSOProvider } from '@/services/api';
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
  // SSO buttons the server offers (GET /auth/methods). Until it answers we
  // show none; an older server without the endpoint keeps the GitLab button.
  const [providers, setProviders] = useState<SSOProvider[] | null>(null);
  const [googleDomains, setGoogleDomains] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    ssoAPI.methods()
      .then((res) => {
        if (!live) return;
        const list = Array.isArray(res.data) ? res.data : [];
        setProviders(list.map((m) => m.id).filter((id): id is SSOProvider => id === 'gitlab' || id === 'github' || id === 'google'));
        setGoogleDomains(list.find((m) => m.id === 'google')?.domains ?? []);
      })
      .catch(() => { if (live) setProviders(['gitlab']); });
    return () => { live = false; };
  }, []);

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

  const handleSSO = async (provider: SSOProvider) => {
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

          {(providers ?? []).map((p) => (
            <Button
              key={p}
              type="button"
              variant="outline"
              className="w-full mb-2"
              onClick={() => handleSSO(p)}
              disabled={loading}
              title={p === 'google' && googleDomains.length ? t('auth:login.googleDomains', { domains: googleDomains.join(', ') }) : undefined}
            >
              <ProviderIcon provider={p} />
              {t(`auth:login.${p}`)}
            </Button>
          ))}

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

function ProviderIcon({ provider }: { provider: SSOProvider }) {
  if (provider === 'github') return <Github className="h-4 w-4 mr-2" />;
  if (provider === 'google') {
    // Google's "G" mark (brand colours).
    return (
      <svg className="h-4 w-4 mr-2" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
    );
  }
  return <GitBranch className="h-4 w-4 mr-2" />;
}
