import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, AlertTriangle, Eye, EyeOff, MonitorSmartphone, Cloud, Info } from 'lucide-react';
import { observabilityConnectionAPI, type DBScope } from '@/services/api';
import { useObservabilityConnectionStore } from '@/stores/observabilityConnectionStore';
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
import type { ObservabilityAuthKind, ObservabilityConnection, ObservabilityProviderName } from '@/types';
import { PROVIDERS, providerMeta, noteText } from './providers';
import { ProviderGlyph } from './ProviderGlyph';
import { ProjectSelect } from './ProjectSelect';
import { useProviderScopes } from './providerScopes';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: ObservabilityConnection | null;
  onSaved?: (conn: ObservabilityConnection) => void;
}

interface TestResult {
  ok: boolean;
  error?: string;
  version?: string;
  user?: string;
  scopes?: Array<{ id: string; name: string }>;
  notes?: string[];
}

// ObservabilityConnectionDialog — create / edit a connection to an APM /
// observability backend the service map reads: Coroot, Prometheus, Jaeger,
// Kiali, SigNoz or Datadog. The sign-in methods follow the provider.
// Secrets are sent only when typed; on edit an empty field keeps the stored
// one. A pasted session lives on ONE backend, so it is not dual-written.
export function ObservabilityConnectionDialog({ open, onOpenChange, editing, onSaved }: Props) {
  const { t } = useTranslation('servicemap');
  const upsertLocal = useObservabilityConnectionStore((s) => s.upsertLocal);
  const { toast } = useToast();

  const [provider, setProvider] = useState<ObservabilityProviderName>('coroot');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authKind, setAuthKind] = useState<ObservabilityAuthKind>('bearer');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [appKey, setAppKey] = useState('');
  const [session, setSession] = useState('');
  const [scopeValue, setScopeValue] = useState('');
  const [headerName, setHeaderName] = useState('');
  const [insecure, setInsecure] = useState(false);
  const [caCert, setCaCert] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const scopes = availableDBScopes();
  const canPickScope = isDesktop() && scopes.length > 1;
  const [beScope, setBeScope] = useState<DBScope>('remote');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const meta = providerMeta(provider);
  // Editing a Coroot connection: list its projects with the stored sign-in
  // so the project is picked by name; a Test result replaces the list.
  const storedId = open && editing && editing.provider === provider && meta.scope === 'project' ? editing.id : undefined;
  const stored = useProviderScopes(storedId, editing?.beScope);
  const projectList = testResult?.scopes?.length ? testResult.scopes : stored.scopes;
  /** Coroot sessions may also carry a project API key for per-call metrics. */
  const corootExtraKey = provider === 'coroot' && (authKind === 'bearer' || authKind === 'login' || authKind === 'session');

  useEffect(() => {
    if (!open) return;
    setError('');
    setTestResult(null);
    setShowSecret(false);
    setPassword('');
    setToken('');
    setApiKey('');
    setAppKey('');
    setSession('');
    setAdvanced(false);
    if (editing) {
      setProvider(editing.provider);
      setName(editing.name);
      setUrl(editing.url);
      setAuthKind(editing.authKind);
      setUsername(editing.username ?? '');
      setScopeValue(editing.scope ?? '');
      setHeaderName(editing.options?.headerName ?? '');
      setInsecure(Boolean(editing.options?.insecureSkipVerify));
      setCaCert(editing.options?.caCert ?? '');
      setBeScope((editing.primaryScope as DBScope) || editing.beScope || (scopes.includes('remote') ? 'remote' : 'local'));
    } else {
      setProvider('coroot');
      setName('');
      setUrl('');
      setAuthKind('bearer');
      setUsername('');
      setScopeValue('');
      setHeaderName('');
      setInsecure(false);
      setCaCert('');
      setBeScope(scopes.includes('remote') ? 'remote' : 'local');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const pickProvider = (p: ObservabilityProviderName) => {
    setProvider(p);
    setAuthKind(providerMeta(p).auth[0]);
    setTestResult(null);
  };

  const typed = (): Record<string, string> => {
    const s: Record<string, string> = {};
    if ((authKind === 'basic' || authKind === 'login') && password) s.password = password;
    if (authKind === 'bearer' && token.trim()) s.token = token.trim();
    if ((authKind === 'apikey' || authKind === 'datadog' || corootExtraKey) && apiKey.trim()) s.apiKey = apiKey.trim();
    if (authKind === 'datadog' && appKey.trim()) s.appKey = appKey.trim();
    if (authKind === 'session' && session.trim()) s.session = session.trim().replace(/^coroot_session=/, '');
    return s;
  };

  const buildPayload = (): Record<string, unknown> => {
    const options: Record<string, unknown> = {};
    if (insecure) options.insecureSkipVerify = true;
    if (caCert.trim()) options.caCert = caCert.trim();
    if (authKind === 'apikey' && headerName.trim()) options.headerName = headerName.trim();
    return {
      name: name.trim(),
      provider,
      url: url.trim(),
      authKind,
      username: authKind === 'basic' || authKind === 'login' ? username.trim() : '',
      scope: scopeValue.trim(),
      secrets: typed(),
      options,
      primaryScope: beScope,
    };
  };

  /** Secrets this sign-in method needs that are neither typed nor stored. */
  const missingSecret = (): string | null => {
    const stored = editing && editing.authKind === authKind ? editing.hasSecrets : [];
    const has = (k: string, v: string) => !!v || stored.includes(k as never);
    if ((authKind === 'basic' || authKind === 'login') && !has('password', password)) return t('conn.errPassword');
    if (authKind === 'bearer' && !has('token', token.trim())) return t('conn.errToken');
    if ((authKind === 'apikey' || authKind === 'datadog') && !has('apiKey', apiKey.trim())) return t('conn.errApiKey');
    if (authKind === 'datadog' && !has('appKey', appKey.trim())) return t('conn.errAppKey');
    if (authKind === 'session' && !has('session', session.trim())) return t('conn.errSession');
    return null;
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const untouched = editing && Object.keys(typed()).length === 0 && editing.url === url.trim() && editing.authKind === authKind &&
        (editing.username ?? '') === username.trim() && (editing.scope ?? '') === scopeValue.trim();
      const res = untouched
        ? await observabilityConnectionAPI.test(editing!.id, undefined, beScope)
        : await observabilityConnectionAPI.test(null, buildPayload(), beScope);
      const r = res.data as TestResult;
      setTestResult(r);
      if (r.ok && r.scopes?.length && !scopeValue.trim() && meta.scope === 'project') setScopeValue(r.scopes[0].id);
    } catch (err) {
      setTestResult({ ok: false, error: extractErr(err, t('conn.testFailed')) });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setError('');
    if (!name.trim()) return setError(t('conn.errName'));
    if (!url.trim()) return setError(t('conn.errUrl'));
    if ((authKind === 'basic' || authKind === 'login') && !username.trim()) return setError(t('conn.errUsername'));
    if (meta.scopeRequired && !scopeValue.trim()) return setError(t('conn.errEnv'));
    const missing = missingSecret();
    if (missing) return setError(missing);
    setSaving(true);
    try {
      const payload = buildPayload();
      const singleScope = authKind === 'session';
      let saved: ObservabilityConnection;
      if (editing) {
        let writeScopes: DBScope[] = editing.availableScopes?.length ? (editing.availableScopes as DBScope[]) : [editing.beScope ?? beScope];
        if (singleScope) writeScopes = writeScopes.includes(beScope) ? [beScope] : [writeScopes[0]];
        const { provider: _p, ...update } = payload;
        void _p;
        const updates = await dualWrite((s) => observabilityConnectionAPI.update(editing.id, update, s).then((r) => r.data as ObservabilityConnection), writeScopes);
        const ok = updates.filter((r) => r.ok).map((r) => r.scope);
        if (ok.length === 0) {
          setError(extractErr(updates.find((r) => !r.ok)?.error, t('conn.saveFailed')));
          setSaving(false);
          return;
        }
        const partial = describePartialWrite(updates, writeScopes, 'Updated');
        if (partial) toast(partial);
        saved = { ...updates.find((r) => r.ok)!.value!, beScope: ok[0], primaryScope: beScope, availableScopes: editing.availableScopes ?? ok };
      } else {
        const writeScopes: DBScope[] = singleScope ? [beScope] : availableDBScopes();
        const id = crypto.randomUUID();
        const creates = await dualWrite((s) => observabilityConnectionAPI.create({ id, ...payload }, s).then((r) => r.data as ObservabilityConnection), writeScopes);
        const ok = creates.filter((r) => r.ok).map((r) => r.scope);
        if (ok.length === 0) {
          setError(extractErr(creates.find((r) => !r.ok)?.error, t('conn.saveFailed')));
          setSaving(false);
          return;
        }
        const partial = describePartialWrite(creates, writeScopes, 'Saved');
        if (partial) toast(partial);
        saved = { ...creates.find((r) => r.ok)!.value!, beScope: ok.includes(beScope) ? beScope : ok[0], primaryScope: beScope, availableScopes: ok };
      }
      upsertLocal(saved);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      setError(extractErr(err, t('conn.saveFailed')));
    }
    setSaving(false);
  };

  const keep = (k: string) => (editing && editing.authKind === authKind && editing.hasSecrets.includes(k as never) ? t('conn.keepStored') : '');
  const secret = (value: string, set: (v: string) => void, placeholder: string) => (
    <SecretInput value={value} onChange={set} show={showSecret} onToggle={() => setShowSecret((v) => !v)} placeholder={placeholder} />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('conn.titleEdit') : t('conn.titleNew')}</DialogTitle>
          <DialogDescription>{t('conn.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">{t('conn.provider')}</Label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  disabled={!!editing && editing.provider !== p.name}
                  onClick={() => pickProvider(p.name)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors disabled:opacity-40',
                    provider === p.name ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'hover:bg-accent/50',
                  )}
                >
                  <ProviderGlyph provider={p.name} className="h-4 w-4" />
                  <span className="font-medium">{p.title}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">{t(`conn.providerHelp.${provider}`)}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('conn.name')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={meta.title} />
            </div>
            <div>
              <Label className="text-xs">{t('conn.url')}</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={meta.urlPlaceholder} className="font-mono text-xs" autoComplete="off" />
            </div>
          </div>

          {meta.auth.length > 1 && (
            <div>
              <Label className="text-xs">{t('conn.authKind')}</Label>
              <div role="radiogroup" className="mt-1 flex flex-wrap gap-1.5">
                {meta.auth.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={authKind === k}
                    onClick={() => setAuthKind(k)}
                    className={cn('rounded-md border px-2.5 py-1 text-xs transition-colors', authKind === k ? 'border-primary bg-primary/10 text-primary font-medium' : 'hover:bg-accent/50')}
                  >
                    {t(`conn.auth.${k}`)}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{t(`conn.authHelp.${provider}.${authKind}`, { defaultValue: t(`conn.authHelpGeneric.${authKind}`) })}</p>
            </div>
          )}

          {(authKind === 'basic' || authKind === 'login') && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={authKind === 'login' ? t('conn.email') : t('conn.username')}>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              </Field>
              <Field label={t('conn.password')}>{secret(password, setPassword, keep('password'))}</Field>
            </div>
          )}
          {authKind === 'bearer' && <Field label={t('conn.token')}>{secret(token, setToken, keep('token') || (provider === 'coroot' ? 'crt_…' : ''))}</Field>}
          {authKind === 'apikey' && <Field label={t('conn.apiKey')}>{secret(apiKey, setApiKey, keep('apiKey'))}</Field>}
          {authKind === 'session' && (
            <Field label={t('conn.session')} help={t('conn.sessionHelp')}>{secret(session, setSession, keep('session') || 'coroot_session=…')}</Field>
          )}
          {authKind === 'datadog' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('conn.apiKey')}>{secret(apiKey, setApiKey, keep('apiKey'))}</Field>
              <Field label={t('conn.appKey')}>{secret(appKey, setAppKey, keep('appKey'))}</Field>
            </div>
          )}

          {corootExtraKey && (
            <Field label={t('conn.corootProjectKey')} help={t('conn.corootProjectKeyHelp')}>
              {secret(apiKey, setApiKey, editing?.hasSecrets.includes('apiKey') ? t('conn.keepStored') : t('conn.optional'))}
            </Field>
          )}

          {meta.scope && (
            <Field label={t(`conn.scope.${meta.scope}`)} help={t(`conn.scopeHelp.${meta.scope}`)}>
              {meta.scope === 'project' ? (
                <ProjectSelect value={scopeValue} onChange={setScopeValue} scopes={projectList}
                  loading={!!storedId && !testResult && !stored.scopes && !stored.failed} />
              ) : (
                <Input value={scopeValue} onChange={(e) => setScopeValue(e.target.value)} className="font-mono text-xs"
                  placeholder={meta.scope === 'env' ? 'prod' : meta.scope === 'namespaces' ? 'shop, payments' : ''} />
              )}
            </Field>
          )}

          {canPickScope && authKind !== 'none' && (
            <div>
              <Label className="text-xs">{t('conn.backend')}</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <KindCard icon={<MonitorSmartphone className="h-4 w-4" />} title={t('conn.backendLocal')} desc={t('conn.backendLocalDesc')} active={beScope === 'local'} onClick={() => setBeScope('local')} />
                <KindCard icon={<Cloud className="h-4 w-4" />} title={t('conn.backendRemote')} desc={t('conn.backendRemoteDesc')} active={beScope === 'remote'} onClick={() => setBeScope('remote')} />
              </div>
              {authKind === 'session' && <p className="text-[10px] text-muted-foreground mt-1">{t('conn.backendNoteSession')}</p>}
            </div>
          )}

          <button type="button" onClick={() => setAdvanced((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">
            {advanced ? '▼ ' : '▸ '}{t('conn.advanced')}
          </button>
          {advanced && (
            <div className="space-y-3 rounded-md border p-3">
              {authKind === 'apikey' && (
                <Field label={t('conn.headerName')} help={t('conn.headerNameHelp')}>
                  <Input value={headerName} onChange={(e) => setHeaderName(e.target.value)} className="font-mono text-xs" placeholder={provider === 'coroot' ? 'X-API-Key' : provider === 'signoz' ? 'SIGNOZ-API-KEY' : 'Authorization'} />
                </Field>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">{t('conn.insecure')}</Label>
                  <p className="text-[10px] text-muted-foreground">{t('conn.insecureHelp')}</p>
                </div>
                <Switch checked={insecure} onCheckedChange={setInsecure} />
              </div>
              <Field label={t('conn.caCert')}>
                <Textarea value={caCert} onChange={(e) => setCaCert(e.target.value)} className="font-mono text-xs min-h-[70px]" placeholder={'-----BEGIN CERTIFICATE-----\n…'} />
              </Field>
            </div>
          )}

          {provider === 'datadog' && (
            <div className="flex gap-1.5 rounded bg-muted/50 p-2 text-[10px] text-muted-foreground">
              <Info className="h-3 w-3 shrink-0 mt-px" /><span>{t('conn.datadogNote')}</span>
            </div>
          )}

          {testResult && (
            <div className={cn('flex items-start gap-2 p-2 rounded text-xs', testResult.ok ? 'bg-green-500/10 text-green-700 dark:text-green-300' : 'bg-destructive/10 text-destructive')}>
              {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
              <span className="min-w-0 break-words">
                {testResult.ok
                  ? [
                    t('conn.testOk'),
                    testResult.version && t('conn.testVersion', { version: testResult.version }),
                    testResult.user && t('conn.testUser', { user: testResult.user }),
                    ...(testResult.notes ?? []).map((n) => noteText(t, n)),
                  ].filter(Boolean).join(' · ')
                  : testResult.error}
              </span>
            </div>
          )}
          {error && <p className="text-xs text-destructive break-words">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing || saving || !url.trim()}>
            {testing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t('conn.test')}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>{t('common:cancel')}</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {editing ? t('common:save') : t('conn.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
      {help && <p className="text-[10px] text-muted-foreground mt-1">{help}</p>}
    </div>
  );
}

function SecretInput({ value, onChange, show, onToggle, placeholder }: {
  value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; placeholder?: string;
}) {
  return (
    <div className="relative">
      <Input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pr-8 font-mono text-xs" autoComplete="new-password" />
      <button type="button" onClick={onToggle} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function KindCard({ icon, title, desc, active, onClick }: { icon: ReactNode; title: string; desc: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('text-left rounded-md border p-2.5 transition-colors', active ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-border hover:bg-accent/50')}>
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
