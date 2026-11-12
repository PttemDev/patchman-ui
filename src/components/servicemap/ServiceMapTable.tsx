import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { ServiceMapGraph } from '@/types';
import { cn } from '@/lib/utils';
import { errorKnown, fmtMs, fmtPct, fmtRps } from './serviceMapUtil';

type SortKey = 'from' | 'to' | 'protocol' | 'rps' | 'err' | 'p95';

// The map as a sortable table of calls — the accessible / exact view of the
// same data (and the one to read when the picture gets dense).
export function ServiceMapTable({ graph, selectedEdge, onSelectEdge }: { graph: ServiceMapGraph; selectedEdge: string | null; onSelectEdge: (id: string) => void }) {
  const { t } = useTranslation('servicemap');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'rps', desc: true });
  const names = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.namespace ? `${n.name} · ${n.namespace}` : n.name])), [graph]);
  const rows = useMemo(() => {
    const val = (e: ServiceMapGraph['edges'][number]): string | number => {
      switch (sort.key) {
        case 'from': return names.get(e.from) ?? e.from;
        case 'to': return names.get(e.to) ?? e.to;
        case 'protocol': return e.protocol ?? '';
        case 'rps': return e.stats.hasRed ? e.stats.rps : -1;
        case 'err': return errorKnown(e.stats) ? e.stats.errorRate : -1;
        case 'p95': return e.stats.p95Ms ?? -1;
      }
    };
    return [...graph.edges].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -c : c;
    });
  }, [graph, sort, names]);
  const head = (key: SortKey, label: string, right = false) => (
    <th className={cn('px-3 py-2 font-medium cursor-pointer select-none whitespace-nowrap', right && 'text-right')}
      onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key === 'rps' || key === 'err' || key === 'p95' }))}
      aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <span className="inline-flex items-center gap-1">{label}{sort.key === key && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}</span>
    </th>
  );
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-background/95 backdrop-blur text-muted-foreground text-left border-b">
          <tr>
            {head('from', t('table.from'))}
            {head('to', t('table.to'))}
            {head('protocol', t('table.protocol'))}
            {head('rps', t('table.rps'), true)}
            {head('err', t('table.errors'), true)}
            {head('p95', t('table.p95'), true)}
            <th className="px-3 py-2 font-medium">{t('table.sources')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} onClick={() => onSelectEdge(e.id)} className={cn('border-b border-border/50 cursor-pointer hover:bg-accent/40', selectedEdge === e.id && 'bg-primary/5')}>
              <td className="px-3 py-1.5">{names.get(e.from) ?? e.from}</td>
              <td className="px-3 py-1.5">{e.flow === 'consume' ? '⇠ ' : ''}{names.get(e.to) ?? e.to}</td>
              <td className="px-3 py-1.5 font-mono">{e.protocol}{e.flow !== 'request' ? ` · ${t(`flow.${e.flow}`)}` : ''}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{e.stats.hasRed ? fmtRps(e.stats.rps) : e.stats.conns ? t('table.conns', { count: Math.round(e.stats.conns) }) : '—'}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums" style={{ color: errorKnown(e.stats) && e.stats.errorRate >= 0.05 ? 'var(--sm-crit)' : undefined }}>
                {errorKnown(e.stats) ? fmtPct(e.stats.errorRate) : '—'}{e.issue ? ' ⚠' : ''}
              </td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{e.stats.rateOnly ? '—' : fmtMs(e.stats.p95Ms)}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{e.sources.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-6 text-center text-xs text-muted-foreground">{t('table.empty')}</p>}
    </div>
  );
}
