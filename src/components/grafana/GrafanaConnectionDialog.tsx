import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, AlertTriangle, Eye, EyeOff, MonitorSmartphone, Cloud, KeyRound, User, LogIn, Info, Globe } from 'lucide-react';
import { grafanaConnectionAPI, type DBScope } from '@/services/api';
import { useGrafanaConnectionStore } from '@/stores/grafanaConnectionStore';
import { availableDBScopes, dualWrite, describePartialWrite } from '@/stores/dbConnectionStore';
import { isDesktop } from '@/lib/platform';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import type { GrafanaAuthKind, GrafanaConnection, GrafanaPublicDashboard } from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: GrafanaConnection | null;
  onSaved?: () => void;
}

interface TestResult {
  ok: boolean;
  error?: string;
  code?: string;
  /** The probe rotated the pasted session: this is the live value to save. */
  session?: string;
  version?: string;
  datasources?: number;
  user?: { login: string; name?: string; orgRole?: string };
  /** Grafana answered under a sub path of the URL (Percona PMM: /graph). */
  resolvedUrl?: string;
  /** Only the public dashboard links work (anonymous access is off). */
  publicOnly?: boolean;
  publicDashboards?: GrafanaPublicDashboard[];
}

const PUBLIC_RE = /\/public(?:-dashboards|\/dashboards)\/([A-Za-z0-9_-]{8,128})/;

/** A public dashboard link → { root, token }; null when it isn't one. */
function parsePublicLink(raw: string): { root: string; token: string } | null {
  const s = raw.trim();
  const m = PUBLIC_RE.exec(s);
  if (!m) return null;
  try {
    const u = new URL(s);
    const i = u.pathname.search(/\/public(?:-dashboards|\/dashboards)\//);
    return { root: `${u.origin}${u.pathname.slice(0, i).replace(/\/+$/, '')}`, token: m[1] };
  } catch {
    return null;
  }
}

/** Tokens from the "public dashboard links" box: full links or bare tokens. */
function parseTokens(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/[\s,]+/)) {
    const tok = PUBLIC_RE.exec(line)?.[1] ?? (/^[A-Za-z0-9_-]{8,128}$/.test(line) ? line : '');
    if (tok && !out.includes(tok)) out.push(tok);
  }
  return out;
}

// GrafanaConnectionDialog — create / edit a Grafana connection. Three auth
// kinds so every user can connect:
//   token   service-account / API token (recommended; works everywhere)
//   basic   username + password (local / LDAP users; the backend falls back
//           to Grafana's login form when HTTP Basic is disabled)
//   session the grafana_session of an SSO-only user — pasted on the web,
//           captured by "Sign in with Grafana" on desktop. Lives on ONE
//           backend (it rotates there), so it is not dual-written.
//   none    no sign-in: Grafana's anonymous access and/or public dashboard
//           links (pasting such a link in the URL field picks this kind).
// Secrets are sent only when typed; on edit an empty field keeps the stored one.
export function GrafanaConnectionDialog({ open, onOpenChange, editing, onSaved }: Props) {
  const { t } = useTranslation('grafana');
  const upsertLocal = useGrafanaConnectionStore((s) => s.upsertLocal);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authKind, setAuthKind] = useState<GrafanaAuthKind>('token');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState('');
  const [sessionCaptured, setSessionCaptured] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [orgId, setOrgId] = useState('');
  const [insecure, setInsecure] = useState(false);
  const [caCert, setCaCert] = useState('');
  const [cookieName, setCookieName] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [publicLinks, setPublicLinks] = useState('');
  const [publicTitles, setPublicTitles] = useState<Record<string, string>>({});
  const [urlNote, setUrlNote] = useState('');

  const scopes = availableDBScopes();
  const canPickScope = isDesktop() && scopes.length > 1;
  const [scope, setScope] = useState<DBScope>('remote');

  const [testing, setTesting] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setTestResult(null);
    setShowSecret(false);
    setToken('');
    setPassword('');
    setSession('');
    setSessionCaptured(false);
    setUrlNote('');
    const pubs = editing?.options?.publicDashboards ?? [];
    setPublicLinks(pubs.map((p) => `${(editing?.url ?? '').replace(/\/+$/, '')}/public-dashboards/${p.token}`).join('\n'));
    setPublicTitles(Object.fromEntries(pubs.filter((p) => p.title).map((p) => [p.token, p.title!])));
    if (editing) {
      setName(editing.name);
      setUrl(editing.url);
      setAuthKind(editing.authKind ?? 'token');
      setUsername(editing.username ?? '');
      setOrgId(editing.options?.orgId != null ? String(editing.options.orgId) : '');
      setInsecure(Boolean(editing.options?.insecureSkipVerify));
      setCaCert(String(editing.options?.caCert ?? ''));
      setCookieName(String(editing.options?.cookieName ?? ''));
      const stored = editing.primaryScope ? (editing.primaryScope as DBScope) : undefined;
      setScope(stored ?? editing.scope ?? (scopes.includes('remote') ? 'remote' : (scopes[0] ?? 'remote')));
    } else {
      setName('');
      setUrl('');
      setAuthKind('token');
      setUsername('');
      setOrgId('');
      setInsecure(false);
      setCaCert('');
      setCookieName('');
      setScope(scopes.includes('remote') ? 'remote' : 'local');
    }
    setAdvanced(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const buildPayload = (): Record<string, unknown> => {
    const options: Record<string, unknown> = {};
    if (orgId.trim()) options.orgId = Number(orgId.trim()) || orgId.trim();
    if (insecure) options.insecureSkipVerify = true;
    if (caCert.trim()) options.caCert = caCert.trim();
    if (cookieName.trim()) options.cookieName = cookieName.trim();
    if (authKind === 'none') {
      const tokens = parseTokens(publicLinks);
      if (tokens.length) options.publicDashboards = tokens.map((token) => (publicTitles[token] ? { token, title: publicTitles[token] } : { token }));
    }
    const payload: Record<string, unknown> = {
      name: name.trim(),
      url: url.trim(),
      authKind,
      username: authKind === 'basic' ? username.trim() : '',
      options,
      primaryScope: scope,
    };
    if (authKind === 'token' && token.trim()) payload.token = token.trim();
    if (authKind === 'basic' && password) payload.password = password;
    if (authKind === 'session' && session.trim()) payload.session = session.trim();
    return payload;
  };

  const hasStoredSecret = (): boolean => {
    if (authKind === 'none') return true; // nothing to type: test the stored row as is
    if (!editing || editing.authKind !== authKind) return false;
    if (authKind === 'token') return Boolean(editing.hasToken);
    if (authKind === 'basic') return Boolean(editing.hasPassword);
    return Boolean(editing.hasSession);
  };
  const typedSecret = (): boolean =>
    (authKind === 'token' && !!token.trim()) || (authKind === 'basic' && !!password) || (authKind === 'session' && !!session.trim());

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = editing && authKind !== 'none' && hasStoredSecret() && !typedSecret() && editing.url === url.trim()
        ? await grafanaConnectionAPI.test(editing.id, undefined, scope)
        : await grafanaConnectionAPI.test(null, buildPayload(), scope);
      const result = res.data as TestResult;
      if (result.session) setSession(result.session);
      if (result.resolvedUrl && result.resolvedUrl !== url.trim().replace(/\/+$/, '')) {
        setUrl(result.resolvedUrl);
        setUrlNote(t('dialog.urlResolved', { url: result.resolvedUrl }));
      }
      if (result.publicDashboards?.length) {
        setPublicTitles((m) => ({ ...m, ...Object.fromEntries(result.publicDashboards!.filter((p) => p.title).map((p) => [p.token, p.title!])) }));
      }
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: extractErr(err, t('dialog.testFailed')) });
    }
    setTesting(false);
  };

  // Desktop: open Grafana's login page in its own window and capture the
  // session once the SSO flow lands back on Grafana.
  const signInWithGrafana = async () => {
    if (!url.trim()) {
      setError(t('dialog.errUrlRequired'));
      return;
    }
    setError('');
    setSigningIn(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const value = await invoke<string>('grafana_sso_login', { url: url.trim(), cookieName: cookieName.trim() || null });
      setSession(value);
      setSessionCaptured(true);
      setTestResult(null);
    } catch (e) {
      const msg = String(e);
      if (msg !== 'cancelled') setError(msg === 'timeout' ? t('dialog.ssoTimeout') : msg);
    }
    setSigningIn(false);
  };

  const handleSave = async () => {
    setError('');
    if (!name.trim()) return setError(t('dialog.errNameRequired'));
    if (!url.trim()) return setError(t('dialog.errUrlRequired'));
    if (authKind === 'basic' && !username.trim()) return setError(t('dialog.errUsernameRequired'));
    if (!editing || editing.authKind !== authKind) {
      if (authKind === 'token' && !token.trim()) return setError(t('dialog.errTokenRequired'));
      if (authKind === 'basic' && !password) return setError(t('dialog.errPasswordRequired'));
      if (authKind === 'session' && !session.trim()) return setError(t('dialog.errSessionRequired'));
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      // A session belongs to the backend that rotates it: write it to the
      // chosen scope only. Token / basic are stateless → every scope.
      const singleScope = authKind === 'session';
      let saved: GrafanaConnection;
      if (editing) {
        let writeScopes: DBScope[] = editing.availableScopes?.length ? (editing.availableScopes as DBScope[]) : [editing.scope ?? scope];
        if (singleScope) writeScopes = writeScopes.includes(scope) ? [scope] : [writeScopes[0]];
        const updates = await dualWrite((s) => grafanaConnectionAPI.update(editing.id, payload, s).then((r) => r.data as GrafanaConnection), writeScopes);
        const ok = updates.filter((r) => r.ok).map((r) => r.scope);
        if (ok.length === 0) {
          setError(extractErr(updates.find((r) => !r.ok)?.error, t('dialog.saveFailed')));
          setSaving(false);
          return;
        }
        const partial = describePartialWrite(updates, writeScopes, 'Updated');
        if (partial) toast(partial);
        saved = { ...updates.find((r) => r.ok)!.value!, scope: ok[0], primaryScope: scope, availableScopes: editing.availableScopes ?? ok };
      } else {
        const writeScopes: DBScope[] = singleScope ? [scope] : availableDBScopes();
        const id = crypto.randomUUID();
        const creates = await dualWrite((s) => grafanaConnectionAPI.create({ id, ...payload }, s).then((r) => r.data as GrafanaConnection), writeScopes);
        const ok = creates.filter((r) => r.ok).map((r) => r.scope);
        if (ok.length === 0) {
          setError(extractErr(creates.find((r) => !r.ok)?.error, t('dialog.saveFailed')));
          setSaving(false);
          return;
        }
        const partial = describePartialWrite(creates, writeScopes, 'Saved');
        if (partial) toast(partial);
        saved = { ...creates.find((r) => r.ok)!.value!, scope: singleScope ? scope : (ok.includes(scope) ? scope : ok[0]), primaryScope: scope, availableScopes: ok };
      }
      upsertLocal(saved);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(extractErr(err, t('dialog.saveFailed')));
    }
    setSaving(false);
  };

  const secretPlaceholder = editing && hasStoredSecret() ? t('dialog.keepStored') : '';

  // Pasting a public dashboard link into the URL field: keep Grafana's root
  // as the URL, switch to "no sign-in" and remember the link.
  const onUrlChange = (value: string) => {
    const pub = parsePublicLink(value);
    if (!pub) {
      setUrl(value);
      return;
    }
    setUrl(pub.root);
    setAuthKind('none');
    setPublicLinks((cur) => (parseTokens(cur).includes(pub.token) ? cur : [cur.trim(), value.trim()].filter(Boolean).join('\n')));
    setUrlNote(t('dialog.publicLinkDetected'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[580px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('dialog.titleEdit') : t('dialog.titleNew')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('dialog.name')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('dialog.namePlaceholder')} />
            </div>
            <div>
              <Label className="text-xs">{t('dialog.url')}</Label>
              <Input value={url} onChange={(e) => onUrlChange(e.target.value)} placeholder="https://grafana.example.com" className="font-mono text-xs" autoComplete="off" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-2">{t('dialog.urlHelp')}</p>
          {urlNote && (
            <div className="flex gap-1.5 rounded bg-sky-500/10 p-2 text-[10px] text-sky-700 dark:text-sky-300 -mt-2">
              <Info className="h-3 w-3 shrink-0 mt-px" /><span className="break-all">{urlNote}</span>
            </div>
          )}

          <div>
            <Label className="text-xs">{t('dialog.authKind')}</Label>
            <div role="radiogroup" className="mt-1 rounded-md border divide-y overflow-hidden">
              <MethodOption icon={<KeyRound className="h-4 w-4" />} title={t('dialog.authToken')} desc={t('dialog.authTokenDesc')} badge={t('dialog.recommended')} active={authKind === 'token'} onClick={() => setAuthKind('token')} />
              <MethodOption icon={<User className="h-4 w-4" />} title={t('dialog.authBasic')} desc={t('dialog.authBasicDesc')} active={authKind === 'basic'} onClick={() => setAuthKind('basic')} />
              <MethodOption icon={<LogIn className="h-4 w-4" />} title={t('dialog.authSession')} desc={t('dialog.authSessionDesc')} active={authKind === 'session'} onClick={() => setAuthKind('session')} />
              <MethodOption icon={<Globe className="h-4 w-4" />} title={t('dialog.authNone')} desc={t('dialog.authNoneDesc')} active={authKind === 'none'} onClick={() => setAuthKind('none')} />
            </div>
          </div>

          {authKind === 'token' && (
            <div>
              <Label className="text-xs">{t('dialog.token')}</Label>
              <SecretInput value={token} onChange={setToken} show={showSecret} onToggle={() => setShowSecret((v) => !v)} placeholder={secretPlaceholder || 'glsa_…'} />
              <p className="text-[10px] text-muted-foreground mt-1">{t('dialog.tokenHelp')}</p>
            </div>
          )}

          {authKind === 'basic' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('dialog.username')}</Label>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              </div>
              <div>
                <Label className="text-xs">{t('dialog.password')}</Label>
                <SecretInput value={password} onChange={setPassword} show={showSecret} onToggle={() => setShowSecret((v) => !v)} placeholder={secretPlaceholder} />
              </div>
              <p className="col-span-2 text-[10px] text-muted-foreground -mt-1">{t('dialog.basicHelp')}</p>
            </div>
          )}

          {authKind === 'session' && (
            <div className="space-y-2">
              {isDesktop() && (
                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs">
                      <div className="font-medium">{t('dialog.ssoTitle')}</div>
                      <div className="text-[10px] text-muted-foreground">{t('dialog.ssoDesc')}</div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={signInWithGrafana} disabled={signingIn}>
                      {signingIn ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <LogIn className="h-3.5 w-3.5 mr-1.5" />}
                      {signingIn ? t('dialog.ssoWaiting') : t('dialog.ssoButton')}
                    </Button>
                  </div>
                  {sessionCaptured && (
                    <div className="flex items-center gap-1.5 text-[11px] text-green-600 dark:text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {t('dialog.ssoCaptured')}
                    </div>
                  )}
                </div>
              )}
              {!sessionCaptured && (
                <div>
                  <Label className="text-xs">{isDesktop() ? t('dialog.sessionPasteAlt') : t('dialog.sessionPaste')}</Label>
                  <SecretInput value={session} onChange={setSession} show={showSecret} onToggle={() => setShowSecret((v) => !v)} placeholder={secretPlaceholder || 'grafana_session=…'} />
                  <p className="text-[10px] text-muted-foreground mt-1">{t('dialog.sessionHelp')}</p>
                </div>
              )}
              <div className="flex gap-1.5 rounded bg-muted/50 p-2 text-[10px] text-muted-foreground">
                <Info className="h-3 w-3 shrink-0 mt-px" />
                <span>{t('dialog.sessionNote')}</span>
              </div>
            </div>
          )}

          {authKind === 'none' && (
            <div className="space-y-2">
              <div>
                <Label className="text-xs">{t('dialog.publicLinks')}</Label>
                <Textarea
                  value={publicLinks}
                  onChange={(e) => setPublicLinks(e.target.value)}
                  className="font-mono text-xs min-h-[64px]"
                  placeholder="https://grafana.example.com/public-dashboards/…"
                />
                <p className="text-[10px] text-muted-foreground mt-1">{t('dialog.publicLinksHelp')}</p>
              </div>
              <div className="flex gap-1.5 rounded bg-muted/50 p-2 text-[10px] text-muted-foreground">
                <Info className="h-3 w-3 shrink-0 mt-px" />
                <span>{t('dialog.noneNote')}</span>
              </div>
            </div>
          )}

          {canPickScope && (
            <div>
              <Label className="text-xs">{t('dialog.backend')}</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <KindCard icon={<MonitorSmartphone className="h-4 w-4" />} title={t('dialog.backendLocal')} desc={t('dialog.backendLocalDesc')} active={scope === 'local'} onClick={() => setScope('local')} />
                <KindCard icon={<Cloud className="h-4 w-4" />} title={t('dialog.backendRemote')} desc={t('dialog.backendRemoteDesc')} active={scope === 'remote'} onClick={() => setScope('remote')} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {authKind === 'session' ? t('dialog.backendNoteSession') : t('dialog.backendNote')}
              </p>
            </div>
          )}

          <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">
            {advanced ? '▼ ' : '▸ '}{t('dialog.advanced')}
          </button>
          {advanced && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">{t('dialog.orgId')}</Label>
                  <Input value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="1" className="font-mono text-xs" />
                  <p className="text-[10px] text-muted-foreground mt-1">{t('dialog.orgIdHelp')}</p>
                </div>
                <div>
                  <Label className="text-xs">{t('dialog.cookieName')}</Label>
                  <Input value={cookieName} onChange={(e) => setCookieName(e.target.value)} placeholder="grafana_session" className="font-mono text-xs" />
                  <p className="text-[10px] text-muted-foreground mt-1">{t('dialog.cookieNameHelp')}</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">{t('dialog.insecure')}</Label>
                  <p className="text-[10px] text-muted-foreground">{t('dialog.insecureHelp')}</p>
                </div>
                <Switch checked={insecure} onCheckedChange={setInsecure} />
              </div>
              <div>
                <Label className="text-xs">{t('dialog.caCert')}</Label>
                <Textarea value={caCert} onChange={(e) => setCaCert(e.target.value)} className="font-mono text-xs min-h-[70px]" placeholder={'-----BEGIN CERTIFICATE-----\n…'} />
              </div>
            </div>
          )}

          {testResult && (
            <div className={cn('flex items-start gap-2 p-2 rounded text-xs', testResult.ok ? 'bg-green-500/10 text-green-700 dark:text-green-300' : 'bg-destructive/10 text-destructive')}>
              {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
              <span className="min-w-0 break-words">
                {!testResult.ok
                  ? testResult.error
                  : testResult.publicOnly
                    ? t('dialog.testOkPublicOnly', { count: testResult.publicDashboards?.length ?? 0, titles: (testResult.publicDashboards ?? []).map((p) => p.title || p.token.slice(0, 8)).join(', ') })
                    : authKind === 'none'
                      ? t('dialog.testOkAnonymous', { version: testResult.version ?? '?', count: testResult.datasources ?? 0 })
                      : t('dialog.testOk', {
                        version: testResult.version ?? '?',
                        user: testResult.user?.name || testResult.user?.login || '—',
                        count: testResult.datasources ?? 0,
                      })}
              </span>
            </div>
          )}
          {error && <p className="text-xs text-destructive break-words">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
            {testing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t('dialog.test')}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>{t('common:cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {editing ? t('common:save') : t('dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SecretInput({ value, onChange, show, onToggle, placeholder }: {
  value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; placeholder?: string;
}) {
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-8 font-mono text-xs"
        autoComplete="new-password"
      />
      <button type="button" onClick={onToggle} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// One row of the sign-in method picker: icon, title (+ optional badge), a
// one-line description and a radio dot — full width, so titles never wrap.
function MethodOption({ icon, title, desc, badge, active, onClick }: {
  icon: ReactNode; title: string; desc: string; badge?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn('w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors', active ? 'bg-primary/5' : 'hover:bg-accent/50')}
    >
      <span className={cn('shrink-0', active ? 'text-primary' : 'text-muted-foreground')}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 text-xs font-semibold">
          {title}
          {badge && <span className="rounded bg-primary/10 text-primary px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide">{badge}</span>}
        </span>
        <span className="block text-[11px] text-muted-foreground mt-0.5">{desc}</span>
      </span>
      <span className={cn('h-4 w-4 shrink-0 rounded-full border flex items-center justify-center', active ? 'border-primary' : 'border-muted-foreground/40')}>
        {active && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
    </button>
  );
}

function KindCard({ icon, title, desc, active, onClick }: { icon: ReactNode; title: string; desc: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('text-left rounded-md border p-2.5 transition-colors', active ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-border hover:bg-accent/50')}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold">{icon}{title}</div>
      <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{desc}</p>
    </button>
  );
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}
