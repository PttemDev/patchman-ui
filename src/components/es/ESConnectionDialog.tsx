import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  MonitorSmartphone,
  Cloud,
  Plus,
  X,
} from 'lucide-react';
import { esConnectionAPI, type DBScope } from '@/services/api';
import { useESConnectionStore } from '@/stores/esConnectionStore';
import { availableDBScopes, dualWrite, describePartialWrite } from '@/stores/dbConnectionStore';
import { isDesktop } from '@/lib/platform';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import type { ESConnection, ESFlavor, ESAuthKind } from '@/types';

interface ESConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: ESConnection | null;
  onSaved?: () => void;
}

const FLAVORS: ESFlavor[] = ['auto', 'elasticsearch', 'opensearch'];

const AUTH_KINDS: ESAuthKind[] = ['none', 'basic', 'apiKey', 'bearer', 'kibanaProxy'];

// Split a comma-joined node list into an editor list (always ≥1 entry so a
// row renders). Trims blanks on read.
function splitNodes(nodes: string): string[] {
  const parts = nodes.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [''];
}

// ESConnectionDialog mirrors RedisConnectionDialog: create / edit an
// Elasticsearch connection with a Test button and the same dual-write scope
// model. Secrets are only sent when freshly typed; on edit an empty field
// means "keep the stored secret". The auth kind reveals only the matching
// secret input(s). Nodes and Cloud ID are alternatives — a Cloud ID decodes
// to a node URL BE-side, so either reaches the cluster.
export function ESConnectionDialog({ open, onOpenChange, editing, onSaved }: ESConnectionDialogProps) {
  const { t } = useTranslation('es');
  const upsertLocal = useESConnectionStore((s) => s.upsertLocal);
  const { toast } = useToast();

  const flavorLabel: Record<ESFlavor, string> = {
    auto: t('dialog.flavorAuto'),
    elasticsearch: t('dialog.flavorElasticsearch'),
    opensearch: t('dialog.flavorOpensearch'),
  };
  const authLabel: Record<ESAuthKind, string> = {
    none: t('dialog.authNone'),
    basic: t('dialog.authBasic'),
    apiKey: t('dialog.authApiKey'),
    bearer: t('dialog.authBearer'),
    kibanaProxy: t('dialog.authKibana'),
  };

  const [name, setName] = useState('');
  const [nodes, setNodes] = useState<string[]>(['']);
  const [cloudId, setCloudId] = useState('');
  const [flavor, setFlavor] = useState<ESFlavor>('auto');
  const [authKind, setAuthKind] = useState<ESAuthKind>('none');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [bearer, setBearer] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showBearer, setShowBearer] = useState(false);
  const [tls, setTls] = useState(false);

  // Kibana Console-proxy mode (authKind 'kibanaProxy'). Basic sub-mode reuses
  // the `username` / `password` state above (they hold the KIBANA creds); the
  // cookie sub-mode uses `cookie`.
  const [kibanaUrl, setKibanaUrl] = useState('');
  const [kibanaAuthMode, setKibanaAuthMode] = useState<'basic' | 'cookie'>('basic');
  const [kibanaSpace, setKibanaSpace] = useState('');
  const [cookie, setCookie] = useState('');

  // Advanced options → assembled into the `options` blob.
  const [caCert, setCaCert] = useState('');
  const [insecureSkipVerify, setInsecureSkipVerify] = useState(false);
  const [caFingerprint, setCaFingerprint] = useState('');
  const [clientCert, setClientCert] = useState('');
  const [clientKey, setClientKey] = useState('');
  const [defaultIndex, setDefaultIndex] = useState('');
  const [advanced, setAdvanced] = useState(false);

  const scopes = availableDBScopes();
  const canPickScope = isDesktop() && scopes.length > 1;
  const [scope, setScope] = useState<DBScope>('remote');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; version?: string; flavor?: string; health?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isBasic = authKind === 'basic';
  const isApiKey = authKind === 'apiKey';
  const isBearer = authKind === 'bearer';
  const isKibanaProxy = authKind === 'kibanaProxy';
  // Whether username/password inputs are in play — direct-ES basic OR the
  // Kibana proxy running in its basic sub-mode.
  const usesBasicCreds = isBasic || (isKibanaProxy && kibanaAuthMode === 'basic');
  // Whether the connection speaks TLS at all — the TLS switch, an https node /
  // Kibana URL, or Elastic Cloud. Gates the skip-verify switch, which sits next
  // to the TLS switch (not in Advanced) so the fix for self-signed / IP-only
  // certs ("x509: … doesn't contain any IP SANs") is discoverable.
  const speaksTls =
    tls ||
    !!cloudId.trim() ||
    [...nodes, isKibanaProxy ? kibanaUrl : ''].some((u) => /^https:\/\//i.test(u.trim()));

  useEffect(() => {
    if (!open) return;
    setError('');
    setTestResult(null);
    setShowPassword(false);
    setShowApiKey(false);
    setShowBearer(false);
    if (editing) {
      setName(editing.name);
      setNodes(splitNodes(editing.nodes));
      setCloudId(editing.cloudId ?? '');
      setFlavor(editing.flavor ?? 'auto');
      setAuthKind(editing.authKind ?? 'none');
      setUsername(editing.username ?? '');
      setPassword('');
      setApiKey('');
      setBearer('');
      setTls(Boolean(editing.tls));
      setCaCert(String(editing.options?.caCert ?? ''));
      setInsecureSkipVerify(Boolean(editing.options?.insecureSkipVerify));
      setCaFingerprint(String(editing.options?.caFingerprint ?? ''));
      setClientCert(String(editing.options?.clientCert ?? ''));
      setClientKey(String(editing.options?.clientKey ?? ''));
      setDefaultIndex(String(editing.options?.defaultIndex ?? ''));
      setKibanaUrl(String(editing.kibanaUrl ?? editing.options?.kibanaUrl ?? ''));
      setKibanaAuthMode(
        (editing.kibanaAuthMode ?? editing.options?.kibanaAuthMode) === 'cookie' ? 'cookie' : 'basic',
      );
      setKibanaSpace(String(editing.kibanaSpace ?? editing.options?.kibanaSpace ?? ''));
      setCookie('');
      const stored = editing.primaryScope ? (editing.primaryScope as DBScope) : undefined;
      setScope(stored ?? (scopes.includes('remote') ? 'remote' : (scopes[0] ?? 'remote')));
    } else {
      setName('');
      setNodes(['']);
      setCloudId('');
      setFlavor('auto');
      setAuthKind('none');
      setUsername('');
      setPassword('');
      setApiKey('');
      setBearer('');
      setTls(false);
      setCaCert('');
      setInsecureSkipVerify(false);
      setCaFingerprint('');
      setClientCert('');
      setClientKey('');
      setDefaultIndex('');
      setKibanaUrl('');
      setKibanaAuthMode('basic');
      setKibanaSpace('');
      setCookie('');
      setScope(scopes.includes('remote') ? 'remote' : 'local');
    }
    setAdvanced(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const buildOptions = useCallback((): Record<string, unknown> => {
    const options: Record<string, unknown> = {};
    if (caCert.trim()) options.caCert = caCert.trim();
    if (insecureSkipVerify) options.insecureSkipVerify = true;
    if (caFingerprint.trim()) options.caFingerprint = caFingerprint.trim();
    if (clientCert.trim()) options.clientCert = clientCert.trim();
    if (clientKey.trim()) options.clientKey = clientKey.trim();
    if (defaultIndex.trim()) options.defaultIndex = defaultIndex.trim();
    if (isKibanaProxy) {
      if (kibanaUrl.trim()) options.kibanaUrl = kibanaUrl.trim();
      options.kibanaAuthMode = kibanaAuthMode;
      if (kibanaSpace.trim()) options.kibanaSpace = kibanaSpace.trim();
    }
    return options;
  }, [caCert, insecureSkipVerify, caFingerprint, clientCert, clientKey, defaultIndex, isKibanaProxy, kibanaUrl, kibanaAuthMode, kibanaSpace]);

  const buildPayload = useCallback((): Record<string, unknown> => {
    const nodesJoined = nodes.map((s) => s.trim()).filter(Boolean).join(',');
    const payload: Record<string, unknown> = {
      name: name.trim(),
      nodes: nodesJoined,
      cloudId: cloudId.trim(),
      flavor,
      authKind,
      username: usesBasicCreds ? username : '',
      tls,
      options: buildOptions(),
      primaryScope: scope,
    };
    if (usesBasicCreds && password) payload.password = password;
    if (isApiKey && apiKey) payload.apiKey = apiKey;
    if (isBearer && bearer) payload.bearer = bearer;
    if (isKibanaProxy && kibanaAuthMode === 'cookie' && cookie.trim()) payload.cookie = cookie.trim();
    return payload;
  }, [nodes, name, cloudId, flavor, authKind, usesBasicCreds, username, tls, buildOptions, scope, password, isApiKey, apiKey, isBearer, bearer, isKibanaProxy, kibanaAuthMode, cookie]);

  // Whether the connection already has the secret for the chosen auth kind
  // stored on the BE (so Test can reuse it without a freshly-typed value).
  const hasStoredSecretForKind = (): boolean => {
    if (!editing) return false;
    if (isKibanaProxy) {
      return kibanaAuthMode === 'cookie' ? Boolean(editing.hasCookie) : Boolean(editing.hasPassword);
    }
    if (isBasic) return Boolean(editing.hasPassword);
    if (isApiKey) return Boolean(editing.hasApiKey);
    if (isBearer) return Boolean(editing.hasBearer);
    return authKind === 'none';
  };

  const typedSecret = (): boolean => {
    if (isKibanaProxy) {
      return kibanaAuthMode === 'cookie' ? Boolean(cookie.trim()) : Boolean(password);
    }
    if (isBasic) return Boolean(password);
    if (isApiKey) return Boolean(apiKey);
    if (isBearer) return Boolean(bearer);
    return false;
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = buildPayload();
      // When editing with no freshly-typed secret, test by id so the BE
      // reuses the stored secret; otherwise send the full payload.
      const res = editing && hasStoredSecretForKind() && !typedSecret()
        ? await esConnectionAPI.test(editing.id, undefined, scope)
        : await esConnectionAPI.test(null, payload, scope);
      setTestResult(res.data as { ok: boolean; error?: string; version?: string; flavor?: string; health?: string });
    } catch (err) {
      setTestResult({ ok: false, error: extractErr(err, t('dialog.testFailed')) });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setError('');
    if (!name.trim()) {
      setError(t('dialog.errNameRequired'));
      return;
    }
    if (isKibanaProxy) {
      if (!kibanaUrl.trim()) {
        setError(t('dialog.errKibanaUrlRequired'));
        return;
      }
    } else if (nodes.every((s) => !s.trim()) && !cloudId.trim()) {
      setError(t('dialog.errNodeRequired'));
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      let saved: ESConnection;

      if (editing) {
        const writeScopes: DBScope[] = editing.availableScopes && editing.availableScopes.length > 0
          ? (editing.availableScopes as DBScope[])
          : [editing.scope ?? scope];
        const updates = await dualWrite(
          (s) => esConnectionAPI.update(editing.id, payload, s).then((r) => r.data as ESConnection),
          writeScopes,
        );
        const okScopes = updates.filter((r) => r.ok).map((r) => r.scope);
        if (okScopes.length === 0) {
          setError(extractErr(updates.find((r) => !r.ok)?.error, t('dialog.updateFailedAll')));
          setSaving(false);
          return;
        }
        const partial = describePartialWrite(updates, writeScopes, 'Updated');
        if (partial) toast(partial);
        const first = updates.find((r) => r.ok)!.value!;
        saved = { ...first, scope, primaryScope: scope, availableScopes: okScopes };
      } else {
        const writeScopes = availableDBScopes();
        const id = crypto.randomUUID();
        const creates = await dualWrite(
          (s) => esConnectionAPI.create({ id, ...payload }, s).then((r) => r.data as ESConnection),
          writeScopes,
        );
        const okScopes = creates.filter((r) => r.ok).map((r) => r.scope);
        if (okScopes.length === 0) {
          setError(extractErr(creates.find((r) => !r.ok)?.error, t('dialog.createFailedAll')));
          setSaving(false);
          return;
        }
        const partial = describePartialWrite(creates, writeScopes, 'Saved');
        if (partial) toast(partial);
        const first = creates.find((r) => r.ok)!.value!;
        saved = { ...first, scope, primaryScope: scope, availableScopes: okScopes };
      }
      upsertLocal(saved);
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(extractErr(err, t('dialog.saveFailed')));
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? t('dialog.titleEdit') : t('dialog.titleNew')}</DialogTitle>
          <DialogDescription>
            {t('dialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t('common:name')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('dialog.namePlaceholder')}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              data-bwignore="true"
            />
          </div>

          {!isKibanaProxy && (
          <>
          <div>
            <Label className="text-xs">{t('dialog.nodeUrls')}</Label>
            <div className="space-y-1.5">
              {nodes.map((node, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    value={node}
                    onChange={(e) => setNodes((arr) => arr.map((s, j) => (j === i ? e.target.value : s)))}
                    placeholder={t('dialog.nodePlaceholder')}
                    className="font-mono text-xs"
                    autoComplete="off"
                  />
                  {nodes.length > 1 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setNodes((arr) => arr.filter((_, j) => j !== i))}
                      title={t('common:remove')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setNodes((arr) => [...arr, ''])}
              className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3" /> {t('dialog.addNode')}
            </button>
          </div>

          <div>
            <Label className="text-xs">{t('dialog.cloudId')}</Label>
            <Input
              value={cloudId}
              onChange={(e) => setCloudId(e.target.value)}
              placeholder={t('dialog.cloudIdPlaceholder')}
              className="font-mono text-xs"
              autoComplete="off"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {t('dialog.cloudIdHelp')}
            </p>
          </div>
          </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('dialog.flavor')}</Label>
              <Select value={flavor} onValueChange={(v) => setFlavor(v as ESFlavor)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FLAVORS.map((f) => (
                    <SelectItem key={f} value={f}>{flavorLabel[f]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('dialog.authentication')}</Label>
              <Select value={authKind} onValueChange={(v) => setAuthKind(v as ESAuthKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUTH_KINDS.map((a) => (
                    <SelectItem key={a} value={a}>{authLabel[a]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isKibanaProxy && (
            <p className="text-[10px] text-muted-foreground -mt-1">
              {t('dialog.kibanaNote')}
            </p>
          )}

          {isBasic && (
            <>
              <div>
                <Label className="text-xs">{t('dialog.username')}</Label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('dialog.usernamePlaceholder')}
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore="true"
                />
              </div>
              <div>
                <Label className="text-xs">{t('dialog.password')}</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={editing?.hasPassword ? t('dialog.secretUnchanged') : ''}
                    className="pr-9"
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore="true"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </>
          )}

          {isApiKey && (
            <div>
              <Label className="text-xs">{t('dialog.apiKeyLabel')}</Label>
              <div className="relative">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={editing?.hasApiKey ? t('dialog.secretUnchanged') : t('dialog.apiKeyPlaceholder')}
                  className="pr-9 font-mono text-xs"
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore="true"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                <Trans
                  t={t}
                  i18nKey="dialog.apiKeyHelp"
                  values={{ header: 'Authorization: ApiKey <key>' }}
                  components={[<code />]}
                  tOptions={{ interpolation: { escapeValue: true } }}
                  shouldUnescape
                />
              </p>
            </div>
          )}

          {isBearer && (
            <div>
              <Label className="text-xs">{t('dialog.bearerLabel')}</Label>
              <div className="relative">
                <Input
                  type={showBearer ? 'text' : 'password'}
                  value={bearer}
                  onChange={(e) => setBearer(e.target.value)}
                  placeholder={editing?.hasBearer ? t('dialog.secretUnchanged') : ''}
                  className="pr-9 font-mono text-xs"
                  autoComplete="new-password"
                  data-1p-ignore
                  data-lpignore="true"
                  data-bwignore="true"
                />
                <button
                  type="button"
                  onClick={() => setShowBearer((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showBearer ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                <Trans
                  t={t}
                  i18nKey="dialog.bearerHelp"
                  values={{ header: 'Authorization: Bearer <token>' }}
                  components={[<code />]}
                  tOptions={{ interpolation: { escapeValue: true } }}
                  shouldUnescape
                />
              </p>
            </div>
          )}

          {isKibanaProxy && (
            <div className="space-y-3 rounded-md border p-3">
              <div>
                <Label className="text-xs">{t('dialog.kibanaUrl')}</Label>
                <Input
                  value={kibanaUrl}
                  onChange={(e) => setKibanaUrl(e.target.value)}
                  placeholder={t('dialog.kibanaUrlPlaceholder')}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t('dialog.kibanaUrlHelp')}
                </p>
              </div>

              <div>
                <Label className="text-xs">{t('dialog.kibanaAuth')}</Label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setKibanaAuthMode('basic')}
                    className={cn(
                      'rounded-md border p-2 text-xs font-medium transition-colors',
                      kibanaAuthMode === 'basic'
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                        : 'border-border text-muted-foreground hover:bg-accent/50',
                    )}
                  >
                    {t('dialog.authBasic')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setKibanaAuthMode('cookie')}
                    className={cn(
                      'rounded-md border p-2 text-xs font-medium transition-colors',
                      kibanaAuthMode === 'cookie'
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                        : 'border-border text-muted-foreground hover:bg-accent/50',
                    )}
                  >
                    {t('dialog.kibanaCookie')}
                  </button>
                </div>
              </div>

              {kibanaAuthMode === 'basic' ? (
                <>
                  <div>
                    <Label className="text-xs">{t('dialog.kibanaUsername')}</Label>
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={t('dialog.kibanaUsernamePlaceholder')}
                      autoComplete="off"
                      data-1p-ignore
                      data-lpignore="true"
                      data-bwignore="true"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t('dialog.kibanaPassword')}</Label>
                    <div className="relative">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={editing?.hasPassword ? t('dialog.secretUnchanged') : ''}
                        className="pr-9"
                        autoComplete="new-password"
                        data-1p-ignore
                        data-lpignore="true"
                        data-bwignore="true"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <Label className="text-xs">{t('dialog.kibanaCookie')}</Label>
                  <Textarea
                    value={cookie}
                    onChange={(e) => setCookie(e.target.value)}
                    placeholder={editing?.hasCookie ? t('dialog.cookieUnchangedPlaceholder') : t('dialog.cookiePlaceholder')}
                    className="font-mono text-xs min-h-[70px]"
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore="true"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    <Trans t={t} i18nKey="dialog.cookieHelp" components={[<code />]} />
                    {editing?.hasCookie && ` ${t('dialog.cookieSetNote')}`}
                  </p>
                </div>
              )}

              <div>
                <Label className="text-xs">{t('dialog.space')}</Label>
                <Input
                  value={kibanaSpace}
                  onChange={(e) => setKibanaSpace(e.target.value)}
                  placeholder={t('dialog.spacePlaceholder')}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t('dialog.spaceHelp')}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs">{t('dialog.tls')}</Label>
                <p className="text-[10px] text-muted-foreground">
                  {t('dialog.tlsHelp')}
                </p>
              </div>
              <Switch checked={tls} onCheckedChange={setTls} />
            </div>
            {speaksTls && (
              <div className="flex items-center justify-between border-t pt-3">
                <div>
                  <Label className="text-xs">{t('dialog.skipTls')}</Label>
                  <p className="text-[10px] text-muted-foreground">
                    {t('dialog.skipTlsHelp')}
                  </p>
                </div>
                <Switch checked={insecureSkipVerify} onCheckedChange={setInsecureSkipVerify} />
              </div>
            )}
          </div>

          {canPickScope && (
            <div>
              <Label className="text-xs">{t('dialog.backend')}</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <ScopeCard
                  icon={<MonitorSmartphone className="h-4 w-4" />}
                  title={t('dialog.backendLocal')}
                  desc={t('dialog.backendLocalDesc')}
                  active={scope === 'local'}
                  onClick={() => setScope('local')}
                />
                <ScopeCard
                  icon={<Cloud className="h-4 w-4" />}
                  title={t('dialog.backendRemote')}
                  desc={t('dialog.backendRemoteDesc')}
                  active={scope === 'remote'}
                  onClick={() => setScope('remote')}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {t('dialog.backendNote')}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {advanced ? '▼ ' : '▸ '}{t('dialog.advanced')}
          </button>
          {advanced && (
            <div className="space-y-3 rounded-md border p-3">
              <div>
                <Label className="text-xs">{t('dialog.caCert')}</Label>
                <Textarea
                  value={caCert}
                  onChange={(e) => setCaCert(e.target.value)}
                  className="font-mono text-xs min-h-[80px]"
                  placeholder={'-----BEGIN CERTIFICATE-----\n…'}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t('dialog.caCertHelp')}
                </p>
              </div>
              <div>
                <Label className="text-xs">{t('dialog.caFingerprint')}</Label>
                <Input
                  value={caFingerprint}
                  onChange={(e) => setCaFingerprint(e.target.value)}
                  placeholder={t('dialog.caFingerprintPlaceholder')}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t('dialog.caFingerprintHelp')}
                </p>
              </div>
              <div>
                <Label className="text-xs">{t('dialog.clientCert')}</Label>
                <Textarea
                  value={clientCert}
                  onChange={(e) => setClientCert(e.target.value)}
                  className="font-mono text-xs min-h-[60px]"
                  placeholder={'-----BEGIN CERTIFICATE-----\n…'}
                />
              </div>
              <div>
                <Label className="text-xs">{t('dialog.clientKey')}</Label>
                <Textarea
                  value={clientKey}
                  onChange={(e) => setClientKey(e.target.value)}
                  className="font-mono text-xs min-h-[60px]"
                  placeholder={'-----BEGIN PRIVATE KEY-----\n…'}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t('dialog.clientKeyHelp')}
                </p>
              </div>
              <div>
                <Label className="text-xs">{t('dialog.defaultIndex')}</Label>
                <Input
                  value={defaultIndex}
                  onChange={(e) => setDefaultIndex(e.target.value)}
                  placeholder={t('dialog.defaultIndexPlaceholder')}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          {testResult && (
            <div
              className={cn(
                'flex items-start gap-2 p-2 rounded text-xs',
                testResult.ok
                  ? 'bg-green-500/10 text-green-700 dark:text-green-300'
                  : 'bg-destructive/10 text-destructive',
              )}
            >
              {testResult.ok
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
              <span className="min-w-0 break-words">
                {testResult.ok
                  ? [
                      t('dialog.connectionOk'),
                      testResult.flavor && `· ${testResult.flavor}`,
                      testResult.version && `${testResult.version}`,
                      testResult.health && `· ${testResult.health}`,
                    ].filter(Boolean).join(' ')
                  : testResult.error}
              </span>
            </div>
          )}
          {error && <p className="text-xs text-destructive break-words">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
            {testing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t('dialog.testConnection')}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {editing ? t('common:save') : t('dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopeCard({
  icon, title, desc, active, onClick,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-left rounded-md border p-2.5 transition-colors',
        active
          ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
          : 'border-border hover:bg-accent/50',
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        {icon}
        {title}
      </div>
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
