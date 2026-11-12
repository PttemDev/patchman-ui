import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Boxes, Cloud, Layers, MonitorSmartphone, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useK8sConnectionStore } from '@/stores/k8sConnectionStore';
import { useObservabilityConnectionStore } from '@/stores/observabilityConnectionStore';
import { availableDBScopes } from '@/stores/dbConnectionStore';
import { isDesktop } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { ObservabilityConnection, Tab } from '@/types';
import { ProviderGlyph } from '@/components/observability/ProviderGlyph';
import { providerMeta } from '@/components/observability/providers';
import { useObservabilitySidebarUI } from '@/components/observability/obsSidebarUI';
import { ProjectSelect } from '@/components/observability/ProjectSelect';
import { useProviderScopes } from '@/components/observability/providerScopes';

const NONE = '__none__';

export interface Sources {
  smK8sConnectionId?: string;
  smK8sContext?: string;
  smNamespaces?: string[];
  smClusterProm?: boolean;
  smApm?: string[];
  smExecScope?: 'local' | 'remote';
}

// Which sources a map merges: one Kubernetes connection (its configuration,
// optionally its own Prometheus) and any number of observability
// connections, each with an optional scope (Coroot project, Datadog env,
// Kiali namespaces).
export function SourcePicker({ tab, onApply, children }: { tab: Tab; onApply: (s: Sources) => void; children: React.ReactNode }) {
  const { t } = useTranslation('servicemap');
  const k8sConns = useK8sConnectionStore((s) => s.connections);
  const fetchK8s = useK8sConnectionStore((s) => s.fetchConnections);
  const obsConns = useObservabilityConnectionStore((s) => s.connections);
  const fetchObs = useObservabilityConnectionStore((s) => s.fetchConnections);
  const addObs = useObservabilitySidebarUI((s) => s.openAdd);
  const [open, setOpen] = useState(false);
  const [k8s, setK8s] = useState('');
  const [ctx, setCtx] = useState('');
  const [ns, setNs] = useState('');
  const [clusterProm, setClusterProm] = useState(false);
  const [apm, setApm] = useState<Record<string, { on: boolean; scope: string }>>({});
  const [exec, setExec] = useState<'local' | 'remote' | ''>('');
  const scopes = availableDBScopes();

  useEffect(() => {
    if (!open) return;
    if (k8sConns.length === 0) void fetchK8s();
    if (obsConns.length === 0) void fetchObs();
    setK8s(tab.smK8sConnectionId ?? '');
    setCtx(tab.smK8sContext ?? '');
    setNs((tab.smNamespaces ?? []).join(', '));
    setClusterProm(!!tab.smClusterProm);
    const m: Record<string, { on: boolean; scope: string }> = {};
    for (const entry of tab.smApm ?? []) {
      const [id, scope] = entry.split('@');
      m[id] = { on: true, scope: scope ?? '' };
    }
    setApm(m);
    setExec(tab.smExecScope ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const k8sConn = k8sConns.find((c) => c.id === k8s);
  const apply = () => {
    const list = Object.entries(apm).filter(([, v]) => v.on).map(([id, v]) => (v.scope.trim() ? `${id}@${v.scope.trim()}` : id));
    onApply({
      smK8sConnectionId: k8s || undefined,
      smK8sContext: k8s ? ctx || undefined : undefined,
      smNamespaces: k8s ? ns.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean) : [],
      smClusterProm: !!k8s && clusterProm,
      smApm: list,
      smExecScope: exec || undefined,
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] p-0">
        <div className="max-h-[70vh] overflow-y-auto p-3 space-y-4">
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold"><Boxes className="h-3.5 w-3.5 text-sky-500" /> {t('sources.kubernetes')}</div>
            <Select value={k8s || NONE} onValueChange={(v) => { setK8s(v === NONE ? '' : v); setCtx(''); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('sources.noK8s')}</SelectItem>
                {k8sConns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {k8sConn && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">{t('sources.context')}</Label>
                  <Select value={ctx || k8sConn.defaultContext || NONE} onValueChange={(v) => setCtx(v === NONE ? '' : v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(k8sConn.contexts ?? []).map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                      {(k8sConn.contexts ?? []).length === 0 && <SelectItem value={NONE}>{t('sources.defaultContext')}</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px]">{t('sources.namespaces')}</Label>
                  <Input value={ns} onChange={(e) => setNs(e.target.value)} placeholder={t('sources.allNamespaces')} className="h-8 text-xs font-mono" />
                </div>
                <label className="col-span-2 flex items-center justify-between gap-2 rounded-md border px-2 py-1.5">
                  <span className="text-[11px]">
                    <span className="font-medium">{t('sources.clusterProm')}</span>
                    <span className="block text-[10px] text-muted-foreground">{t('sources.clusterPromHelp')}</span>
                  </span>
                  <Switch checked={clusterProm} onCheckedChange={setClusterProm} />
                </label>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold"><Layers className="h-3.5 w-3.5 text-emerald-500" /> {t('sources.observability')}</div>
            {obsConns.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">{t('sources.noObservability')}</p>
            ) : (
              <div className="space-y-1">
                {obsConns.map((c) => {
                  const v = apm[c.id] ?? { on: false, scope: c.scope ?? '' };
                  const meta = providerMeta(c.provider);
                  return (
                    <div key={c.id} className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5', v.on && 'border-primary/50 bg-primary/5')}>
                      <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={v.on} aria-label={c.name}
                        onChange={(e) => setApm((m) => ({ ...m, [c.id]: { on: e.target.checked, scope: v.scope || c.scope || '' } }))} />
                      <ProviderGlyph provider={c.provider} className="h-3.5 w-3.5" />
                      <span className="text-xs truncate flex-1">{c.name}</span>
                      {meta.scope === 'project' && v.on && (
                        <ConnProjectSelect conn={c} value={v.scope} onChange={(scope) => setApm((m) => ({ ...m, [c.id]: { ...v, scope } }))} />
                      )}
                      {meta.scope && meta.scope !== 'project' && v.on && (
                        <Input value={v.scope} onChange={(e) => setApm((m) => ({ ...m, [c.id]: { ...v, scope: e.target.value } }))}
                          placeholder={t(`conn.scope.${meta.scope}`)} className="h-6 w-28 text-[11px] font-mono" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setOpen(false); addObs(); }}>
              <Plus className="h-3.5 w-3.5 mr-1" /> {t('sources.addObservability')}
            </Button>
          </section>

          {isDesktop() && scopes.length > 1 && (
            <section className="space-y-1">
              <Label className="text-[10px]">{t('sources.backend')}</Label>
              <div className="flex gap-1.5">
                {(['', 'local', 'remote'] as const).map((s) => (
                  <button key={s || 'auto'} type="button" onClick={() => setExec(s)}
                    className={cn('flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]', exec === s ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent/50')}>
                    {s === 'local' ? <MonitorSmartphone className="h-3 w-3" /> : s === 'remote' ? <Cloud className="h-3 w-3" /> : null}
                    {t(`sources.backend_${s || 'auto'}`)}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t p-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t('common:cancel')}</Button>
          <Button size="sm" onClick={apply} disabled={!k8s && !Object.values(apm).some((v) => v.on)}>{t('sources.apply')}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ConnProjectSelect({ conn, value, onChange }: { conn: ObservabilityConnection; value: string; onChange: (id: string) => void }) {
  const { scopes, failed } = useProviderScopes(conn.id, conn.beScope);
  return <ProjectSelect size="sm" className="w-40" value={value} onChange={onChange} scopes={scopes} loading={!scopes && !failed} />;
}
