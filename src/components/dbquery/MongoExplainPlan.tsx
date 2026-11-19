import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isDoc, type Doc } from './mongoExplainUtil';

// Mongo explain renderer: find(...).explain() and aggregate(...).explain()
// (MONGO_COMPASS_PLAN §D). Shows the winning plan as a stage tree with the
// executionStats counters, and calls out collection scans.

interface Stage {
  stage: string;
  indexName?: string;
  keyPattern?: unknown;
  filter?: unknown;
  nReturned?: number;
  docsExamined?: number;
  keysExamined?: number;
  ms?: number;
  children: Stage[];
}

function toStage(n: unknown): Stage | null {
  if (!isDoc(n)) return null;
  // SBE plans wrap the classic tree in queryPlan.
  if (isDoc(n.queryPlan) && !n.stage) return toStage(n.queryPlan);
  const kids: unknown[] = [];
  if (n.inputStage) kids.push(n.inputStage);
  if (Array.isArray(n.inputStages)) kids.push(...n.inputStages);
  if (n.outerStage) kids.push(n.outerStage);
  if (n.innerStage) kids.push(n.innerStage);
  const num = (x: unknown) => (typeof x === 'number' ? x : undefined);
  return {
    stage: String(n.stage ?? '?'),
    indexName: typeof n.indexName === 'string' ? n.indexName : undefined,
    keyPattern: n.keyPattern,
    filter: n.filter,
    nReturned: num(n.nReturned),
    docsExamined: num(n.docsExamined),
    keysExamined: num(n.keysExamined),
    ms: num(n.executionTimeMillisEstimate),
    children: kids.map(toStage).filter((x): x is Stage => !!x),
  };
}

function hasStage(s: Stage | null, name: string): boolean {
  return !!s && (s.stage === name || s.children.some((c) => hasStage(c, name)));
}

/** The query part of an explain: find-explain itself, or an aggregate's $cursor stage. */
function queryPart(doc: Doc): Doc | null {
  if (isDoc(doc.queryPlanner)) return doc;
  if (Array.isArray(doc.stages)) {
    const first = doc.stages[0];
    if (isDoc(first) && isDoc(first.$cursor)) return first.$cursor;
  }
  return null;
}

export function MongoExplainPlan({ doc }: { doc: Doc }) {
  const { t } = useTranslation('dbquery');
  const q = queryPart(doc);
  const stats = q && isDoc(q.executionStats) ? q.executionStats : null;
  const planner = q && isDoc(q.queryPlanner) ? q.queryPlanner : null;
  const tree = toStage(stats?.executionStages) ?? toStage(planner?.winningPlan);
  const collscan = hasStage(tree, 'COLLSCAN');
  const rejected = Array.isArray(planner?.rejectedPlans) ? planner!.rejectedPlans.length : 0;
  const pipeline = Array.isArray(doc.stages) ? doc.stages.slice(q && doc.stages.length && isDoc(doc.stages[0]) && doc.stages[0].$cursor ? 1 : 0) : [];
  const num = (k: string) => (stats && typeof stats[k] === 'number' ? (stats[k] as number) : undefined);

  return (
    <div className="h-full overflow-auto p-4 text-xs">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px]">
        {num('executionTimeMillis') !== undefined && <KV k={t('mongoExplain.time')} v={`${num('executionTimeMillis')} ms`} />}
        {num('nReturned') !== undefined && <KV k={t('mongoExplain.returned')} v={String(num('nReturned'))} />}
        {num('totalKeysExamined') !== undefined && <KV k={t('mongoExplain.keys')} v={String(num('totalKeysExamined'))} />}
        {num('totalDocsExamined') !== undefined && <KV k={t('mongoExplain.docs')} v={String(num('totalDocsExamined'))} />}
        {planner?.namespace != null && <KV k={t('mongoExplain.ns')} v={String(planner.namespace)} />}
        {rejected > 0 && <KV k={t('mongoExplain.rejected')} v={String(rejected)} />}
      </div>
      {collscan && (
        <div className="mb-3 flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('mongoExplain.collscan')}</span>
        </div>
      )}
      {tree ? <StageNode s={tree} depth={0} /> : <p className="text-muted-foreground">{t('mongoExplain.noPlan')}</p>}
      {pipeline.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('mongoExplain.pipeline')}</div>
          <ol className="space-y-1">
            {pipeline.map((st, i) => {
              const name = isDoc(st) ? Object.keys(st).find((k) => k.startsWith('$')) ?? '?' : '?';
              return (
                <li key={i} className="flex items-center gap-2 rounded border px-2 py-1 font-mono">
                  <span className="text-muted-foreground">{i + 1}</span>
                  <span className="text-sky-600 dark:text-sky-400">{name}</span>
                  <span className="truncate text-muted-foreground">{JSON.stringify(isDoc(st) ? st[name] : st)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <span className="font-mono">
      <span className="mr-1 text-[9px] uppercase tracking-wider text-muted-foreground">{k}</span>
      {v}
    </span>
  );
}

const STAGE_TONE: Record<string, string> = {
  COLLSCAN: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40',
  IXSCAN: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
  IDHACK: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
  EXPRESS_IXSCAN: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
  FETCH: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/40',
  SORT: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40',
};

function StageNode({ s, depth }: { s: Stage; depth: number }) {
  const { t } = useTranslation('dbquery');
  return (
    <div className={cn(depth > 0 && 'ml-5 border-l pl-3')}>
      <div className="my-1 flex flex-wrap items-center gap-2 rounded border bg-card px-2 py-1.5">
        {depth > 0 && <ChevronRight className="-ml-1 h-3 w-3 text-muted-foreground" />}
        <span className={cn('rounded border px-1.5 py-px font-mono text-[11px] font-semibold', STAGE_TONE[s.stage] ?? 'bg-muted text-foreground')}>{s.stage}</span>
        {s.indexName && <span className="font-mono text-[11px]">{s.indexName}</span>}
        {s.keyPattern != null && <span className="font-mono text-[10px] text-muted-foreground">{JSON.stringify(s.keyPattern)}</span>}
        <span className="ml-auto flex gap-3 font-mono text-[10px] text-muted-foreground">
          {s.nReturned !== undefined && <span>{t('mongoExplain.returned')} {s.nReturned}</span>}
          {s.keysExamined !== undefined && <span>{t('mongoExplain.keys')} {s.keysExamined}</span>}
          {s.docsExamined !== undefined && <span>{t('mongoExplain.docs')} {s.docsExamined}</span>}
          {s.ms !== undefined && <span>{s.ms} ms</span>}
        </span>
        {s.filter != null && <div className="w-full truncate font-mono text-[10px] text-muted-foreground">{t('mongoExplain.filter')} {JSON.stringify(s.filter)}</div>}
      </div>
      {s.children.map((c, i) => <StageNode key={i} s={c} depth={depth + 1} />)}
    </div>
  );
}
