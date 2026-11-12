import { useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ChevronRight, AlertTriangle, Database, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DBExplainPlanProps {
  rows: unknown[][];
  columns: { name: string }[];
}

// DBExplainPlan renders a postgres EXPLAIN (FORMAT JSON) plan tree.
// Falls back to a plain table view when the result doesn't look like
// a JSON plan (text-format EXPLAIN, MySQL, Mongo, etc.).
export function DBExplainPlan({ rows, columns }: DBExplainPlanProps) {
  const { t } = useTranslation('dbquery');
  const plan = useMemo(() => extractPlanJson(rows, columns), [rows, columns]);
  if (!plan) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        <Trans t={t} i18nKey="explain.fallback" components={{ code: <code className="font-mono" /> }} />
      </div>
    );
  }

  const totalCost = plan['Total Cost'] ?? plan['Actual Total Time'] ?? 0;

  return (
    <div className="h-full overflow-auto p-4 text-xs">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px]">
        {plan['Planning Time'] != null && (
          <KV k={t('explain.kvPlan')} v={`${plan['Planning Time']} ms`} />
        )}
        {plan['Execution Time'] != null && (
          <KV k={t('explain.kvExec')} v={`${plan['Execution Time']} ms`} />
        )}
        {plan['Total Cost'] != null && (
          <KV k={t('explain.kvCost')} v={String(plan['Total Cost'])} />
        )}
      </div>
      <PlanNode node={(plan['Plan'] as PlanNodeShape | undefined) ?? plan} totalCost={Number(totalCost) || 1} depth={0} />
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <span className="font-mono">
      <span className="text-muted-foreground uppercase tracking-wider text-[9px] mr-1">{k}</span>
      {v}
    </span>
  );
}

interface PlanNodeShape {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Alias'?: string;
  'Total Cost'?: number;
  'Actual Total Time'?: number;
  'Plan Rows'?: number;
  'Actual Rows'?: number;
  'Plans'?: PlanNodeShape[];
  'Filter'?: string;
  'Index Cond'?: string;
  'Hash Cond'?: string;
  'Join Type'?: string;
  [k: string]: unknown;
}

function PlanNode({ node, totalCost, depth }: { node: PlanNodeShape; totalCost: number; depth: number }) {
  const { t } = useTranslation('dbquery');
  const cost = Number(node['Total Cost'] ?? node['Actual Total Time'] ?? 0);
  const share = totalCost > 0 ? cost / totalCost : 0;
  const isSeqScan = node['Node Type'] === 'Seq Scan';
  const isHotPath = share > 0.4;

  return (
    <div className={cn('mb-1', depth > 0 && 'pl-4 border-l border-border ml-2')}>
      <div className={cn(
        'rounded border px-2 py-1.5 flex items-start gap-2',
        isHotPath && 'border-amber-500/50 bg-amber-500/5',
        isSeqScan && 'border-rose-500/40 bg-rose-500/5',
      )}>
        <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{node['Node Type']}</span>
            {node['Join Type'] && <span className="text-muted-foreground">[{node['Join Type']}]</span>}
            {node['Relation Name'] && (
              <span className="font-mono text-blue-500 inline-flex items-center gap-0.5">
                <Database className="h-2.5 w-2.5" />
                {node['Relation Name']}{node['Alias'] && node['Alias'] !== node['Relation Name'] ? ` (${node['Alias']})` : ''}
              </span>
            )}
            {node['Index Name'] && (
              <span className="font-mono text-emerald-500 inline-flex items-center gap-0.5">
                <Zap className="h-2.5 w-2.5" />
                {node['Index Name']}
              </span>
            )}
            {isSeqScan && (
              <span className="inline-flex items-center gap-0.5 text-rose-500 text-[10px]">
                <AlertTriangle className="h-2.5 w-2.5" />
                {t('explain.seqScan')}
              </span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {node['Total Cost'] != null && (
              <span className="font-mono">{t('explain.cost')} {Number(node['Total Cost']).toFixed(2)}</span>
            )}
            {node['Actual Total Time'] != null && (
              <span className="font-mono">{Number(node['Actual Total Time']).toFixed(2)} ms</span>
            )}
            {node['Plan Rows'] != null && (
              <span className="font-mono">{t('explain.planRows', { count: Number(node['Plan Rows']).toLocaleString() })}</span>
            )}
            {node['Actual Rows'] != null && (
              <span className="font-mono">{t('explain.actualRows', { count: Number(node['Actual Rows']).toLocaleString() })}</span>
            )}
            {share > 0 && (
              <span className="font-mono">{t('explain.pctTotal', { pct: (share * 100).toFixed(0) })}</span>
            )}
          </div>
          {(node['Filter'] || node['Index Cond'] || node['Hash Cond']) && (
            <div className="text-[10px] mt-1 font-mono space-y-0.5">
              {node['Filter'] && <div className="text-muted-foreground">{t('explain.filter')}: {node['Filter']}</div>}
              {node['Index Cond'] && <div className="text-muted-foreground">{t('explain.index')}: {node['Index Cond']}</div>}
              {node['Hash Cond'] && <div className="text-muted-foreground">{t('explain.hash')}: {node['Hash Cond']}</div>}
            </div>
          )}
        </div>
      </div>
      {(node['Plans'] ?? []).map((child, i) => (
        <PlanNode key={i} node={child} totalCost={totalCost} depth={depth + 1} />
      ))}
    </div>
  );
}

function extractPlanJson(rows: unknown[][], columns: { name: string }[]): PlanNodeShape | null {
  if (rows.length === 0) return null;
  // EXPLAIN (FORMAT JSON) returns 1 row × 1 col with a JSON array or object.
  const first = rows[0]?.[0];
  if (first == null) return null;
  let parsed: unknown = first;
  if (typeof first === 'string') {
    try { parsed = JSON.parse(first); } catch { return null; }
  }
  if (Array.isArray(parsed) && parsed.length > 0) parsed = parsed[0];
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as PlanNodeShape;
  if (obj['Plan'] || obj['Node Type']) return obj;
  // MySQL JSON-format explain has a 'query_block' top key.
  if ('query_block' in obj) {
    return mysqlToPgShape((obj as Record<string, unknown>).query_block);
  }
  // Suppress unused-warning on columns and bail.
  void columns;
  return null;
}

function mysqlToPgShape(qb: unknown): PlanNodeShape | null {
  if (!qb || typeof qb !== 'object') return null;
  const o = qb as Record<string, unknown>;
  return {
    'Node Type': (o.table as Record<string, unknown>)?.['access_type'] as string ?? 'Query Block',
    'Relation Name': (o.table as Record<string, unknown>)?.['table_name'] as string,
    'Total Cost': Number((o.cost_info as Record<string, unknown>)?.['query_cost']) || undefined,
  };
}
