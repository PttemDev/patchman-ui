import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, ChevronRight, Code2, Copy, CopyPlus, Loader2, Play, Plus, Trash2, Workflow,
} from 'lucide-react';
import { dbQueryAPI, type DBScope } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useDBConnectionStore } from '@/stores/dbConnectionStore';
import { cn } from '@/lib/utils';
import type { DBConnection, DBSchemaTable } from '@/types';
import {
  balanced, buildAggregate, STAGE_OPS, STAGE_TEMPLATES, stageText, WRITE_STAGES,
  type MongoTargetRef, type PipelineStage,
} from './mongoBarQuery';

const targetKey = (t: MongoTargetRef) => `${t.db ?? ''}\u0000${t.coll}`;
const PREVIEW_LIMIT = 5;

// Compass-style aggregation builder: one card per stage with its own editor
// and a live preview of the documents coming OUT of that stage (the pipeline
// up to it, capped and time-boxed on the server; writing stages never run).
export function MongoPipelineBuilder({ conn, scope, target, tables, stages, running, onChange, onTargetChange, onRun, onOpenInEditor }: {
  conn: DBConnection;
  scope: DBScope;
  target?: MongoTargetRef;
  tables: DBSchemaTable[];
  stages: PipelineStage[];
  running: boolean;
  onChange: (s: PipelineStage[]) => void;
  onTargetChange: (t: MongoTargetRef) => void;
  onRun: (query: string) => void;
  onOpenInEditor: (query: string) => void;
}) {
  const { t } = useTranslation('dbquery');
  const [copied, setCopied] = useState(false);
  const loadSchema = useDBConnectionStore((s) => s.loadSchema);
  useEffect(() => { if (tables.length === 0) loadSchema(conn.id).catch(() => { /* picker stays as is */ }); }, [conn.id, tables.length, loadSchema]);

  const options = useMemo(() => {
    const o = tables.map((x) => ({ key: targetKey({ db: x.schema, coll: x.name }), db: x.schema, coll: x.name }));
    if (target && !o.some((x) => x.coll === target.coll && (x.db ?? '') === (target.db ?? x.db ?? ''))) {
      o.unshift({ key: targetKey(target), db: target.db, coll: target.coll });
    }
    return o;
  }, [tables, target]);
  const selectedKey = useMemo(() => {
    if (!target) return '';
    const hit = options.find((x) => x.coll === target.coll && (x.db ?? '') === (target.db ?? x.db ?? ''));
    return hit ? hit.key : targetKey(target);
  }, [options, target]);

  const query = target ? buildAggregate(target, stages) : '';
  const bad = stages.some((s) => s.enabled && !balanced(s.body));
  const set = (i: number, patch: Partial<PipelineStage>) => onChange(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= stages.length) return;
    const next = [...stages];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = (op: string, at = stages.length) => {
    const next = [...stages];
    next.splice(at, 0, { op, body: STAGE_TEMPLATES[op] ?? '{ }', enabled: true });
    onChange(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <Select value={selectedKey} onValueChange={(v) => { const o = options.find((x) => x.key === v); if (o) onTargetChange({ db: o.db, coll: o.coll }); }}>
          <SelectTrigger className="h-8 w-[220px] shrink-0 text-xs"><SelectValue placeholder={t('mongoIndexes.pickCollection')} /></SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.key} value={o.key} className="text-xs">
                {o.db ? <span className="text-muted-foreground">{o.db}.</span> : null}{o.coll}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground">{t('pipeline.count', { count: stages.length })}</span>
        <div className="flex-1" />
        <button type="button" className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          disabled={!target} onClick={() => { void navigator.clipboard.writeText(query).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
          {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />} {t('pipeline.copy')}
        </button>
        <button type="button" className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          disabled={!target} onClick={() => onOpenInEditor(query)}>
          <Code2 className="h-3 w-3" /> {t('mongoBar.openInEditor')}
        </button>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={!target || bad || running} onClick={() => target && onRun(buildAggregate(target, stages, true))}>
          <Workflow className="h-3.5 w-3.5" /> {t('mongoBar.explain')}
        </Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={!target || bad || running} onClick={() => target && onRun(query)}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {t('pipeline.run')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-muted/10 p-3">
        {stages.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">{t('pipeline.empty')}</p>}
        {stages.map((s, i) => (
          <StageCard
            key={i}
            index={i}
            stage={s}
            stages={stages}
            conn={conn}
            scope={scope}
            target={target}
            onChange={(patch) => set(i, patch)}
            onMove={(d) => move(i, d)}
            onDuplicate={() => { const next = [...stages]; next.splice(i + 1, 0, { ...s }); onChange(next); }}
            onDelete={() => onChange(stages.filter((_, j) => j !== i))}
          />
        ))}
        <AddStage onAdd={(op) => add(op)} />
      </div>
    </div>
  );
}

function AddStage({ onAdd }: { onAdd: (op: string) => void }) {
  const { t } = useTranslation('dbquery');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs"><Plus className="h-3.5 w-3.5" /> {t('pipeline.addStage')}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[360px] overflow-auto">
        {STAGE_OPS.map((op) => (
          <DropdownMenuItem key={op} className="font-mono text-xs" onClick={() => onAdd(op)}>
            {op}{WRITE_STAGES.includes(op) && <span className="ml-2 text-[10px] text-amber-600">{t('pipeline.writes')}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StageCard({ index, stage, stages, conn, scope, target, onChange, onMove, onDuplicate, onDelete }: {
  index: number;
  stage: PipelineStage;
  stages: PipelineStage[];
  conn: DBConnection;
  scope: DBScope;
  target?: MongoTargetRef;
  onChange: (p: Partial<PipelineStage>) => void;
  onMove: (d: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('dbquery');
  const [docs, setDocs] = useState<string[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const writes = WRITE_STAGES.includes(stage.op);
  const valid = balanced(stage.body);

  // The preview depends on every enabled stage up to this one.
  const upstream = useMemo(() => {
    const list: string[] = [];
    let upTo = -1;
    stages.slice(0, index + 1).forEach((s) => { if (s.enabled) { list.push(stageText(s)); upTo++; } });
    return { list, upTo };
  }, [stages, index]);
  const key = JSON.stringify(upstream.list) + targetKey(target ?? { coll: '' });

  useEffect(() => {
    if (!target || !stage.enabled || writes || stage.collapsed || !valid || upstream.upTo < 0) { setDocs(null); setErr(''); return; }
    let cancelled = false;
    const h = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await dbQueryAPI.mongoAggregatePreview(conn.id, {
          db: target.db, coll: target.coll, stages: upstream.list, upTo: upstream.upTo, limit: PREVIEW_LIMIT,
        }, scope);
        if (!cancelled) { setDocs((res.data as { docs: string[] }).docs); setErr(''); }
      } catch (e) {
        const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? String(e);
        if (!cancelled) { setErr(msg); setDocs(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(h); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stage.enabled, stage.collapsed, writes, valid, conn.id, scope]);

  return (
    <div className={cn('rounded-md border bg-card', !stage.enabled && 'opacity-60')}>
      <div className="flex items-center gap-2 border-b px-2 py-1.5">
        <button type="button" onClick={() => onChange({ collapsed: !stage.collapsed })} className="text-muted-foreground hover:text-foreground" aria-expanded={!stage.collapsed}>
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', !stage.collapsed && 'rotate-90')} />
        </button>
        <span className="w-6 text-right font-mono text-[11px] text-muted-foreground">{index + 1}</span>
        <Select value={stage.op} onValueChange={(op) => onChange({ op, body: stage.body.trim() && stage.body !== STAGE_TEMPLATES[stage.op] ? stage.body : STAGE_TEMPLATES[op] })}>
          <SelectTrigger className="h-7 w-[150px] font-mono text-xs"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-[320px]">
            {STAGE_OPS.map((op) => <SelectItem key={op} value={op} className="font-mono text-xs">{op}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch checked={stage.enabled} onCheckedChange={(v) => onChange({ enabled: v })} className="scale-75" />
          {t('pipeline.enabled')}
        </label>
        {stage.collapsed && <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{stage.body}</code>}
        <div className="ml-auto flex items-center gap-0.5">
          <IconBtn label={t('pipeline.up')} onClick={() => onMove(-1)}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label={t('pipeline.down')} onClick={() => onMove(1)}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label={t('pipeline.duplicate')} onClick={onDuplicate}><CopyPlus className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn label={t('pipeline.delete')} onClick={onDelete} danger><Trash2 className="h-3.5 w-3.5" /></IconBtn>
        </div>
      </div>
      {!stage.collapsed && (
        <div className="grid grid-cols-2 divide-x">
          <textarea
            value={stage.body}
            onChange={(e) => onChange({ body: e.target.value })}
            spellCheck={false}
            rows={Math.min(12, Math.max(2, stage.body.split('\n').length))}
            className={cn('w-full resize-y bg-transparent p-2 font-mono text-xs outline-none', !valid && 'bg-destructive/5')}
          />
          <div className="max-h-[170px] min-w-0 overflow-auto p-2">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('pipeline.output', { op: stage.op })}
              {loading && <Loader2 className="h-3 w-3 animate-spin" />}
              {docs && <span className="normal-case tracking-normal">· {t('pipeline.sample', { count: docs.length })}</span>}
            </div>
            {writes ? (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{t('pipeline.writeNoPreview')}</p>
            ) : !stage.enabled ? (
              <p className="text-[11px] text-muted-foreground">{t('pipeline.disabled')}</p>
            ) : !valid ? (
              <p className="text-[11px] text-destructive">{t('pipeline.unbalanced')}</p>
            ) : err ? (
              <p className="break-words font-mono text-[11px] text-destructive">{err}</p>
            ) : docs && docs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">{t('pipeline.noDocs')}</p>
            ) : docs ? (
              <div className="space-y-1">
                {docs.map((d, i) => <pre key={i} title={pretty(d)} className="line-clamp-2 whitespace-pre-wrap break-all rounded bg-muted/40 px-2 py-1 font-mono text-[11px] leading-4">{pretty(d)}</pre>)}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function pretty(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 1).replace(/\n\s*/g, ' '); } catch { return s; }
}

function IconBtn({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick}
      className={cn('rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground', danger && 'hover:bg-destructive/10 hover:text-destructive')}>
      {children}
    </button>
  );
}
