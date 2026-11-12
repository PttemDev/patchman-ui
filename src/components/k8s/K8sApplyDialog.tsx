import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Loader2, AlertTriangle, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { k8sAPI, type DBScope, type K8sApplyResult } from '@/services/api';
import { useSafeConfirm } from '@/components/k8s/safeConfirm';
import { cn } from '@/lib/utils';

interface K8sApplyDialogProps {
  open: boolean;
  onClose: () => void;
  connId: string;
  context: string;
  kind: string;
  namespace?: string;
  name: string;
  /** The edited YAML to Server-Side Apply. */
  yaml: string;
  scope?: DBScope;
  /** Called after a successful (non-dry-run) apply. */
  onApplied?: () => void;
}

// K8sApplyDialog drives the edit → Server-Side Apply flow. On open it runs a
// dry-run apply and shows the returned field-level diff plus any ownership
// conflicts. "Apply" commits (dryRun:false); "Force apply" — only offered when
// there are conflicts — steals the conflicting fields and is gated behind the
// type-to-confirm safe dialog. All errors render inline.
export function K8sApplyDialog({
  open, onClose, connId, context, kind, namespace, name, yaml, scope, onApplied,
}: K8sApplyDialogProps) {
  const { t } = useTranslation('k8s');
  const [result, setResult] = useState<K8sApplyResult | null>(null);
  const [loadingDry, setLoadingDry] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const { confirm, dialog } = useSafeConfirm();

  // Dry-run on open (and whenever the target/yaml changes while open).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError('');
    setResult(null);
    setDone(false);
    setLoadingDry(true);
    k8sAPI.apply(connId, { context, yaml, dryRun: true }, scope)
      .then((res) => { if (!cancelled) setResult(res.data); })
      .catch((err) => { if (!cancelled) setError(extractErr(err, t('apply.dryRunFailed'))); })
      .finally(() => { if (!cancelled) setLoadingDry(false); });
    return () => { cancelled = true; };
  }, [open, connId, context, yaml, scope, t]);

  const conflicts = result?.conflicts ?? [];
  const hasConflicts = conflicts.length > 0;

  const doApply = async (force: boolean) => {
    setApplying(true);
    setError('');
    try {
      await k8sAPI.apply(connId, { context, yaml, dryRun: false, force }, scope);
      setDone(true);
      onApplied?.();
      // Brief success flash before closing.
      setTimeout(() => onClose(), 600);
    } catch (err) {
      setError(extractErr(err, t('apply.applyFailed')));
    } finally {
      setApplying(false);
    }
  };

  const onForce = async () => {
    const ok = await confirm({
      title: t('apply.forceApply'),
      destructive: true,
      confirmLabel: t('apply.forceApply'),
      typeToConfirm: name,
      description: t('apply.forceApplyDescription'),
    });
    if (ok) await doApply(true);
  };

  const target = `${singular(kind)} ${namespace ? `${namespace}/` : ''}${name}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl w-[90vw] max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Trans
              t={t}
              i18nKey="apply.title"
              values={{ target }}
              components={{ mono: <span className="font-mono text-xs text-muted-foreground" /> }}
            />
          </DialogTitle>
          <DialogDescription className="text-xs">
            <Trans
              t={t}
              i18nKey="apply.description"
              components={{ mono: <span className="font-mono" /> }}
            />
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-3">
          {loadingDry ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('apply.runningDryRun')}
            </div>
          ) : (
            <>
              {hasConflicts && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] space-y-1">
                  <div className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {t(conflicts.length === 1 ? 'apply.conflictsOne' : 'apply.conflictsOther', { count: conflicts.length })}
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 font-mono text-foreground/80">
                    {conflicts.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                  <p className="text-muted-foreground">
                    {t('apply.conflictsHint')}
                  </p>
                </div>
              )}

              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('apply.diff')}</span>
                  {result && !result.diff && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{t('apply.noChanges')}</Badge>}
                </div>
                <div className="rounded-md border bg-muted/20 overflow-auto max-h-[42vh]">
                  {result?.diff ? (
                    <pre className="text-[11px] font-mono leading-relaxed p-3 whitespace-pre-wrap break-words">
                      {result.diff.split('\n').map((line, i) => (
                        <div key={i} className={diffLineClass(line)}>{line || ' '}</div>
                      ))}
                    </pre>
                  ) : (
                    <p className="text-[11px] text-muted-foreground p-3">
                      {result ? t('apply.noFieldChanges') : '—'}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <pre className="whitespace-pre-wrap break-words font-mono">{error}</pre>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t shrink-0">
          {done && (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-500">
              <Check className="h-3.5 w-3.5" /> {t('apply.applied')}
            </span>
          )}
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={onClose} disabled={applying}>{t('common:cancel')}</Button>
          {hasConflicts && (
            <Button
              variant="destructive"
              size="sm"
              onClick={onForce}
              disabled={applying || loadingDry}
              className="gap-1.5"
            >
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t('apply.forceApply')}
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => doApply(false)}
            disabled={applying || loadingDry}
            className="gap-1.5"
          >
            {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('apply.apply')}
          </Button>
        </div>
      </DialogContent>
      {dialog}
    </Dialog>
  );
}

function diffLineClass(line: string): string {
  const t = line.trimStart();
  if (t.startsWith('+')) return 'text-emerald-600 dark:text-emerald-400';
  if (t.startsWith('-')) return 'text-destructive';
  if (t.startsWith('@@')) return 'text-blue-500';
  return 'text-foreground/80';
}

function singular(kind: string): string {
  const map: Record<string, string> = {
    nodes: 'Node', namespaces: 'Namespace', events: 'Event',
    pods: 'Pod', deployments: 'Deployment', statefulsets: 'StatefulSet',
    daemonsets: 'DaemonSet', jobs: 'Job', cronjobs: 'CronJob',
    services: 'Service', configmaps: 'ConfigMap', secrets: 'Secret', ingresses: 'Ingress',
  };
  return map[kind] ?? kind;
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}
