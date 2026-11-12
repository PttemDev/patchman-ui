import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  MonitorSmartphone,
  Cloud,
  Upload,
  Eye,
} from 'lucide-react';
import { k8sConnectionAPI, type DBScope } from '@/services/api';
import { useK8sConnectionStore } from '@/stores/k8sConnectionStore';
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
import type { ContextInfo, K8sConnection } from '@/types';

interface K8sConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: K8sConnection | null;
  onSaved?: () => void;
}

// Lightweight client-side scan of the kubeconfig to populate the Default
// context Select before the connection is saved. We deliberately avoid a
// YAML dependency: within the top-level `contexts:` block every `name:` key
// is a context name (cluster / user / namespace live nested under
// `context:`), so a scoped line scan is enough. The BE re-parses the full
// ContextInfo (cluster / server / namespace) authoritatively on save.
function parseContextNames(kubeconfig: string): string[] {
  const lines = kubeconfig.split(/\r?\n/);
  const names: string[] = [];
  let inContexts = false;
  for (const line of lines) {
    // A non-indented, non-list key ends the contexts block.
    if (/^[A-Za-z0-9_-]+:/.test(line)) {
      inContexts = line.startsWith('contexts:');
      continue;
    }
    if (!inContexts) continue;
    const m = line.match(/^\s+-?\s*name:\s*"?([^"\s]+)"?\s*$/);
    if (m) names.push(m[1]);
  }
  return [...new Set(names)];
}

function parseCurrentContext(kubeconfig: string): string {
  const m = kubeconfig.match(/^current-context:\s*"?([^"\s]+)"?\s*$/m);
  return m ? m[1] : '';
}

// K8sConnectionDialog mirrors ESConnectionDialog: create / edit a Kubernetes
// connection with a Test button and the same dual-write scope model. The
// whole kubeconfig is only sent when freshly pasted / uploaded; on edit an
// empty textarea means "keep the stored kubeconfig". Contexts are parsed
// client-side to seed the Default context Select. Test probes the cluster
// (Discovery().ServerVersion()) and reports the detected version + platform.
export function K8sConnectionDialog({ open, onOpenChange, editing, onSaved }: K8sConnectionDialogProps) {
  const { t } = useTranslation('k8s');
  const upsertLocal = useK8sConnectionStore((s) => s.upsertLocal);
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [kubeconfig, setKubeconfig] = useState('');
  const [defaultContext, setDefaultContext] = useState('');

  // Advanced options → assembled into the `options` blob.
  const [insecureSkipVerify, setInsecureSkipVerify] = useState(false);
  const [allowedNamespaces, setAllowedNamespaces] = useState('');
  const [allowExecPlugins, setAllowExecPlugins] = useState(false);
  const [prometheusService, setPrometheusService] = useState('');
  const [readSecretHosts, setReadSecretHosts] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [revealing, setRevealing] = useState(false);

  // Exec credential plugins (aws/gcloud) can only ever run on the embedded
  // desktop BE, and only when the user opts in — the hosted backend always
  // strips them (RCE guard). Gate the toggle to desktop.
  const desktop = isDesktop();

  const scopes = availableDBScopes();
  const canPickScope = isDesktop() && scopes.length > 1;
  const [scope, setScope] = useState<DBScope>('remote');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ reachable: boolean; version?: string; platform?: string; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Context options: freshly-parsed from the textarea when a kubeconfig is
  // present, else the stored (BE-parsed) list on edit.
  const contextNames = useMemo<string[]>(() => {
    if (kubeconfig.trim()) return parseContextNames(kubeconfig);
    if (editing?.contexts?.length) return editing.contexts.map((c: ContextInfo) => c.name);
    return [];
  }, [kubeconfig, editing]);

  useEffect(() => {
    if (!open) return;
    setError('');
    setTestResult(null);
    if (editing) {
      setName(editing.name);
      setKubeconfig('');
      setDefaultContext(editing.defaultContext ?? '');
      setInsecureSkipVerify(Boolean(editing.options?.insecureSkipVerify));
      setAllowExecPlugins(Boolean(editing.options?.allowExecPlugins));
      const ns = editing.options?.allowedNamespaces;
      setAllowedNamespaces(Array.isArray(ns) ? (ns as string[]).join(', ') : '');
      setPrometheusService(typeof editing.options?.prometheusService === 'string' ? editing.options.prometheusService : '');
      setReadSecretHosts(Boolean(editing.options?.readSecretHosts));
      const stored = editing.primaryScope ? (editing.primaryScope as DBScope) : undefined;
      setScope(stored ?? (scopes.includes('remote') ? 'remote' : (scopes[0] ?? 'remote')));
    } else {
      setName('');
      setKubeconfig('');
      setDefaultContext('');
      setInsecureSkipVerify(false);
      setAllowExecPlugins(false);
      setReadSecretHosts(false);
      setAllowedNamespaces('');
      setPrometheusService('');
      setScope(scopes.includes('remote') ? 'remote' : 'local');
    }
    setAdvanced(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  // When a kubeconfig is pasted / uploaded and no context is chosen yet,
  // default to its current-context (or the first parsed context).
  useEffect(() => {
    if (!kubeconfig.trim()) return;
    if (defaultContext && contextNames.includes(defaultContext)) return;
    const current = parseCurrentContext(kubeconfig);
    setDefaultContext(current || contextNames[0] || '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kubeconfig]);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => setKubeconfig(String(reader.result ?? ''));
    reader.readAsText(file);
  }, []);

  // Loads the stored kubeconfig into the editor (owner-only, audited BE-side).
  const showStored = useCallback(async () => {
    if (!editing) return;
    setRevealing(true);
    try {
      const res = await k8sConnectionAPI.revealSecret(editing.id, editing.scope);
      setKubeconfig((res.data as { kubeconfig?: string })?.kubeconfig ?? '');
    } catch (err) {
      toast({ title: t('sidebar.kubeconfigFailed'), description: extractErr(err, t('sidebar.kubeconfigFailed')), variant: 'destructive' });
    }
    setRevealing(false);
  }, [editing, t, toast]);

  const buildOptions = useCallback((): Record<string, unknown> => {
    const nsList = allowedNamespaces.split(',').map((s) => s.trim()).filter(Boolean);
    return {
      insecureSkipVerify,
      allowedNamespaces: nsList,
      // Exec credential plugins are always stripped on the hosted backend
      // (no BE shell-out — RCE guard); v1 pins this on.
      disableExecPlugins: true,
      // Desktop-only opt-in: run the kubeconfig's exec auth plugin
      // (aws/gcloud) on the local embedded BE for EKS/GKE clusters. Only
      // meaningful when set from desktop; ignored on the hosted backend.
      allowExecPlugins: desktop && allowExecPlugins,
      // Optional override for historical pod metrics: pins the in-cluster
      // Prometheus service ("namespace/service:port"), skipping auto-discovery.
      prometheusService: prometheusService.trim(),
      // Service map: read the Secrets a workload references to extract
      // host:port only (values never leave the backend).
      readSecretHosts,
    };
  }, [insecureSkipVerify, allowedNamespaces, desktop, allowExecPlugins, prometheusService, readSecretHosts]);

  const buildPayload = useCallback((): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      name: name.trim(),
      defaultContext,
      authMode: 'kubeconfig',
      options: buildOptions(),
      primaryScope: scope,
    };
    // Only send the kubeconfig when freshly typed / uploaded (empty on edit
    // = keep the stored one).
    if (kubeconfig.trim()) payload.kubeconfig = kubeconfig;
    return payload;
  }, [name, defaultContext, buildOptions, scope, kubeconfig]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = buildPayload();
      // When editing with no freshly-typed kubeconfig, test by id so the BE
      // reuses the stored kubeconfig; otherwise send the full payload.
      const res = editing && !kubeconfig.trim()
        ? await k8sConnectionAPI.test(editing.id, undefined, scope)
        : await k8sConnectionAPI.test(null, payload, scope);
      setTestResult(res.data as { reachable: boolean; version?: string; platform?: string; error?: string });
    } catch (err) {
      setTestResult({ reachable: false, error: extractErr(err, t('dialog.testFailed')) });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setError('');
    if (!name.trim()) {
      setError(t('dialog.errNameRequired'));
      return;
    }
    if (!editing && !kubeconfig.trim()) {
      setError(t('dialog.errKubeconfigRequired'));
      return;
    }
    if (!defaultContext) {
      setError(t('dialog.errSelectContext'));
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      let saved: K8sConnection;

      if (editing) {
        const writeScopes: DBScope[] = editing.availableScopes && editing.availableScopes.length > 0
          ? (editing.availableScopes as DBScope[])
          : [editing.scope ?? scope];
        const updates = await dualWrite(
          (s) => k8sConnectionAPI.update(editing.id, payload, s).then((r) => r.data as K8sConnection),
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
          (s) => k8sConnectionAPI.create({ id, ...payload }, s).then((r) => r.data as K8sConnection),
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

          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('dialog.kubeconfig')}</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".yaml,.yml,.conf,.kubeconfig,text/yaml,application/x-yaml,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = '';
                }}
              />
              <span className="inline-flex items-center gap-3">
                {editing?.hasKubeconfig && !kubeconfig && (
                  <button
                    type="button"
                    onClick={() => void showStored()}
                    disabled={revealing}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    {revealing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} {t('dialog.showStored')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <Upload className="h-3 w-3" /> {t('dialog.uploadFile')}
                </button>
              </span>
            </div>
            <Textarea
              value={kubeconfig}
              onChange={(e) => setKubeconfig(e.target.value)}
              className="font-mono text-xs min-h-[140px]"
              placeholder={editing?.hasKubeconfig
                ? t('dialog.kubeconfigPlaceholderStored')
                : 'apiVersion: v1\nkind: Config\nclusters:\n- …\ncontexts:\n- …'}
              spellCheck={false}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {t('dialog.kubeconfigHelp')}
            </p>
          </div>

          <div>
            <Label className="text-xs">{t('dialog.defaultContext')}</Label>
            {contextNames.length > 0 ? (
              <Select value={defaultContext} onValueChange={setDefaultContext}>
                <SelectTrigger><SelectValue placeholder={t('dialog.selectContext')} /></SelectTrigger>
                <SelectContent>
                  {contextNames.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={defaultContext}
                onChange={(e) => setDefaultContext(e.target.value)}
                placeholder={t('dialog.contextPlaceholder')}
                className="font-mono text-xs"
                autoComplete="off"
              />
            )}
            <p className="text-[10px] text-muted-foreground mt-1">
              {t('dialog.defaultContextHelp')}
            </p>
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
            {advanced ? '▼' : '▸'} {t('dialog.advanced')}
          </button>
          {advanced && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs">{t('dialog.skipTls')}</Label>
                  <p className="text-[10px] text-muted-foreground">
                    {t('dialog.skipTlsHelp')}
                  </p>
                </div>
                <Switch checked={insecureSkipVerify} onCheckedChange={setInsecureSkipVerify} />
              </div>
              <div>
                <Label className="text-xs">{t('dialog.allowedNamespaces')}</Label>
                <Input
                  value={allowedNamespaces}
                  onChange={(e) => setAllowedNamespaces(e.target.value)}
                  placeholder={t('dialog.allowedNamespacesPlaceholder')}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t('dialog.allowedNamespacesHelp')}
                </p>
              </div>
              <div>
                <Label className="text-xs">{t('dialog.prometheusService')}</Label>
                <Input
                  value={prometheusService}
                  onChange={(e) => setPrometheusService(e.target.value)}
                  placeholder="monitoring/prometheus-operated:9090"
                  className="font-mono text-xs"
                  autoComplete="off"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t('dialog.prometheusServiceHelp')}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="text-xs">{t('dialog.readSecretHosts')}</Label>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t('dialog.readSecretHostsHelp')}</p>
                </div>
                <Switch checked={readSecretHosts} onCheckedChange={setReadSecretHosts} />
              </div>

              {desktop && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs">{t('dialog.allowExecPlugins')}</Label>
                      <p className="text-[10px] text-muted-foreground">
                        {t('dialog.allowExecPluginsHelp')}
                      </p>
                    </div>
                    <Switch checked={allowExecPlugins} onCheckedChange={setAllowExecPlugins} />
                  </div>
                  {allowExecPlugins && (
                    <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-[10px] leading-tight text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                      <span className="min-w-0">
                        <Trans
                          t={t}
                          i18nKey="dialog.execPluginsWarning"
                          components={[<code className="font-mono" />, <code className="font-mono" />]}
                        />
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {testResult && (
            <div
              className={cn(
                'flex items-start gap-2 p-2 rounded text-xs',
                testResult.reachable
                  ? 'bg-green-500/10 text-green-700 dark:text-green-300'
                  : 'bg-destructive/10 text-destructive',
              )}
            >
              {testResult.reachable
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
              <span className="min-w-0 break-words">
                {testResult.reachable
                  ? [
                      t('dialog.clusterReachable'),
                      testResult.version && t('dialog.reachableVersion', { version: testResult.version }),
                      testResult.platform && t('dialog.reachablePlatform', { platform: testResult.platform }),
                    ].filter(Boolean).join(' ')
                  : testResult.error || t('dialog.clusterUnreachable')}
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
