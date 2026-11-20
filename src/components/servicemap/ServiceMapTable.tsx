import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, LineChart } from 'lucide-react';
import type { ServiceMapGraph, ServiceMapNode } from '@/types';
import { cn } from '@/lib/utils';
import { HealthIcon, NodeIcon } from './ServiceNodeCard';
import { errorKnown, fmtMs, fmtPct, fmtRate, hasServiceDetail, loadRateUnit, saveRateUnit, type RateUnit } from './serviceMapUtil';

type Mode = 'services' | 'calls';
type CallKey = 'from' | 'to' | 'protocol' | 'rps' | 'err' | 'p95';
type ServiceKey = 'name' | 'namespace' | 'kind' | 'rps' | 'err' | 'p95' | 'health';

const MODE_KEY = 'patchman_sm_table_mode';
const HEALTH_RANK: Record<string, number> = { critical: 3, warning: 2, unknown: 1, ok: 0 };

function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'calls' ? 'calls' : 'services';
  } catch {
    return 'services';
  }
}

function Sortable<K extends string>({ k, label, sort, setSort, right, numeric }: {
  k: K; label: string; sort: { key: K; desc: boolean }; setSort: (s: { key: K; desc: boolean }) => void; right?: boolean; numeric?: boolean;
}) {
  return (
    <th className={cn('px-3 py-2 font-medium cursor-pointer select-none whitespace-nowrap', right && 'text-right')}
      onClick={() => setSort({ key: k, desc: sort.key === k ? !sort.desc : Boolean(numeric) })}
      aria-sort={sort.key === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <span className="inline-flex items-center gap-1">{label}{sort.key === k && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}</span>
    </th>
  );
}

function compare(x: string | number, y: string | number, desc: boolean): number {
  const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
  return desc ? -c : c;
}

// The map as sortable tables — the exact view of the same data, and the one
// to read when the picture gets dense. "Services" lists each service's own
// traffic (what a node card shows); "Calls" lists the calls between them,
// which some backends (New Relic) report without rates.
export function ServiceMapTable({ graph, selectedEdge, selectedNode, onSelectEdge, onSelectNode, onOpenDetail }: {
  graph: ServiceMapGraph;
  selectedEdge: string | null;
  selectedNode?: string | null;
  onSelectEdge: (id: string) => void;
  onSelectNode?: (id: string) => void;
  /** Opens the service detail (charts, endpoints, errors) for a node. */
  onOpenDetail?: (node: ServiceMapNode) => void;
}) {
  const { t } = useTranslation('servicemap');
  const [mode, setModeState] = useState<Mode>(loadMode);
  const [unit, setUnitState] = useState<RateUnit>(loadRateUnit);
  const setMode = (m: Mode) => {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* per view only */ }
  };
  const setUnit = (u: RateUnit) => { setUnitState(u); saveRateUnit(u); };

  const [callSort, setCallSort] = useState<{ key: CallKey; desc: boolean }>({ key: 'rps', desc: true });
  const [svcSort, setSvcSort] = useState<{ key: ServiceKey; desc: boolean }>({ key: 'rps', desc: true });
  const names = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.namespace ? `${n.name} · ${n.namespace}` : n.name])), [graph]);

  const calls = useMemo(() => {
    const val = (e: ServiceMapGraph['edges'][number]): string | number => {
      switch (callSort.key) {
        case 'from': return names.get(e.from) ?? e.from;
        case 'to': return names.get(e.to) ?? e.to;
        case 'protocol': return e.protocol ?? '';
        case 'rps': return e.stats.hasRed ? e.stats.rps : -1;
        case 'err': return errorKnown(e.stats) ? e.stats.errorRate : -1;
        case 'p95': return e.stats.p95Ms ?? -1;
      }
    };
    return [...graph.edges].sort((a, b) => compare(val(a), val(b), callSort.desc));
  }, [graph, callSort, names]);

  const services = useMemo(() => {
    const val = (n: ServiceMapNode): string | number => {
      switch (svcSort.key) {
        case 'name': return n.name;
        case 'namespace': return n.namespace ?? '';
        case 'kind': return n.subtype || n.kind;
        case 'rps': return n.stats.hasRed ? n.stats.rps : -1;
        case 'err': return errorKnown(n.stats) ? n.stats.errorRate : -1;
        case 'p95': return n.stats.p95Ms ?? -1;
        case 'health': return HEALTH_RANK[n.health] ?? 0;
      }
    };
    return graph.nodes.filter((n) => !n.group).sort((a, b) => compare(val(a), val(b), svcSort.desc));
  }, [graph, svcSort]);

  const rateLabel = unit === 'rpm' ? t('table.rpm') : t('table.rps');
  const seg = (active: boolean) => cn('h-6 px-2 text-[11px]', active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent/50');

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b">
        <div className="flex rounded-md border overflow-hidden" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'services'} className={seg(mode === 'services')} onClick={() => setMode('services')}>{t('table.services')}</button>
          <button type="button" role="tab" aria-selected={mode === 'calls'} className={cn(seg(mode === 'calls'), 'border-l')} onClick={() => setMode('calls')}>{t('table.calls')}</button>
        </div>
        <div className="ml-auto flex rounded-md border overflow-hidden" title={t('table.unitHint')}>
          <button type="button" className={seg(unit === 'rps')} onClick={() => setUnit('rps')} aria-pressed={unit === 'rps'}>{t('table.unitRps')}</button>
          <button type="button" className={cn(seg(unit === 'rpm'), 'border-l')} onClick={() => setUnit('rpm')} aria-pressed={unit === 'rpm'}>{t('table.unitRpm')}</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === 'services' ? (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background/95 backdrop-blur text-muted-foreground text-left border-b">
              <tr>
                <Sortable k="name" label={t('table.service')} sort={svcSort} setSort={setSvcSort} />
                <Sortable k="namespace" label={t('table.namespace')} sort={svcSort} setSort={setSvcSort} />
                <Sortable k="kind" label={t('table.kind')} sort={svcSort} setSort={setSvcSort} />
                <Sortable k="rps" label={rateLabel} sort={svcSort} setSort={setSvcSort} right numeric />
                <Sortable k="err" label={t('table.errors')} sort={svcSort} setSort={setSvcSort} right numeric />
                <Sortable k="p95" label={t('table.p95')} sort={svcSort} setSort={setSvcSort} right numeric />
                <Sortable k="health" label={t('table.health')} sort={svcSort} setSort={setSvcSort} numeric />
                <th className="px-3 py-2 font-medium">{t('table.sources')}</th>
              </tr>
            </thead>
            <tbody>
              {services.map((n) => (
                <tr key={n.id} onClick={() => onSelectNode?.(n.id)}
                  className={cn('border-b border-border/50 cursor-pointer hover:bg-accent/40', selectedNode === n.id && 'bg-primary/5')}>
                  <td className="px-3 py-1.5">
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <NodeIcon node={n} className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{n.name}</span>
                      {onOpenDetail && hasServiceDetail(n) && (
                        <button type="button" className="shrink-0 text-muted-foreground hover:text-primary" title={t('detail.open')} aria-label={t('detail.open')}
                          onClick={(ev) => { ev.stopPropagation(); onOpenDetail(n); }}>
                          <LineChart className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{n.namespace || '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{n.subtype || n.kind}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n.stats.hasRed ? fmtRate(n.stats.rps, unit) : '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums" style={{ color: errorKnown(n.stats) && n.stats.errorRate >= 0.05 ? 'var(--sm-crit)' : undefined }}>
                    {errorKnown(n.stats) ? fmtPct(n.stats.errorRate) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{n.stats.rateOnly ? '—' : fmtMs(n.stats.p95Ms)}</td>
                  <td className="px-3 py-1.5"><span className="inline-flex items-center gap-1"><HealthIcon health={n.health} className="h-3 w-3" />{t(`health.${n.health}`, n.health)}</span></td>
                  <td className="px-3 py-1.5 text-muted-foreground">{n.sources.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background/95 backdrop-blur text-muted-foreground text-left border-b">
              <tr>
                <Sortable k="from" label={t('table.from')} sort={callSort} setSort={setCallSort} />
                <Sortable k="to" label={t('table.to')} sort={callSort} setSort={setCallSort} />
                <Sortable k="protocol" label={t('table.protocol')} sort={callSort} setSort={setCallSort} />
                <Sortable k="rps" label={rateLabel} sort={callSort} setSort={setCallSort} right numeric />
                <Sortable k="err" label={t('table.errors')} sort={callSort} setSort={setCallSort} right numeric />
                <Sortable k="p95" label={t('table.p95')} sort={callSort} setSort={setCallSort} right numeric />
                <th className="px-3 py-2 font-medium">{t('table.sources')}</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((e) => (
                <tr key={e.id} onClick={() => onSelectEdge(e.id)} className={cn('border-b border-border/50 cursor-pointer hover:bg-accent/40', selectedEdge === e.id && 'bg-primary/5')}>
                  <td className="px-3 py-1.5">{names.get(e.from) ?? e.from}</td>
                  <td className="px-3 py-1.5">{e.flow === 'consume' ? '⇠ ' : ''}{names.get(e.to) ?? e.to}</td>
                  <td className="px-3 py-1.5 font-mono">{e.protocol}{e.flow !== 'request' ? ` · ${t(`flow.${e.flow}`)}` : ''}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{e.stats.hasRed ? fmtRate(e.stats.rps, unit) : e.stats.conns ? t('table.conns', { count: Math.round(e.stats.conns) }) : '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums" style={{ color: errorKnown(e.stats) && e.stats.errorRate >= 0.05 ? 'var(--sm-crit)' : undefined }}>
                    {errorKnown(e.stats) ? fmtPct(e.stats.errorRate) : '—'}{e.issue ? ' ⚠' : ''}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{e.stats.rateOnly ? '—' : fmtMs(e.stats.p95Ms)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{e.sources.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {mode === 'services' && services.length === 0 && <p className="p-6 text-center text-xs text-muted-foreground">{t('table.noServices')}</p>}
        {mode === 'calls' && calls.length === 0 && <p className="p-6 text-center text-xs text-muted-foreground">{t('table.empty')}</p>}
        {mode === 'calls' && calls.length > 0 && calls.every((e) => !e.stats.hasRed) && (
          <p className="px-3 py-2 text-[11px] text-muted-foreground">{t('table.noCallRates')}</p>
        )}
      </div>
    </div>
  );
}
