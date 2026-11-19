import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces, Check, ChevronDown, Code2, Copy, ListFilter, Loader2, Play, Plus, RotateCcw, Workflow, X } from 'lucide-react';
import { confirmDialog } from '@/components/ui/confirm';
import { dbQueryAPI, type DBScope } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDBConnectionStore } from '@/stores/dbConnectionStore';
import { cn } from '@/lib/utils';
import type { DBConnection, DBSchemaTable, MongoIndex } from '@/types';
import { balanced, buildFind, compileConds, COND_OPS, EMPTY_BAR, VALUELESS, type Cond, type CondOp, type MongoBarState, type MongoTargetRef } from './mongoBarQuery';

const targetKey = (t: MongoTargetRef) => `${t.db ?? ''}\u0000${t.coll}`;

// Compass-style query bar: Filter up front, Project / Sort / Collation /
// Hint / Skip / Limit behind Options. Runs the equivalent shell text.
export function MongoQueryBar({ conn, scope, target, tables, value, running, onChange, onTargetChange, onRun, onOpenInEditor }: {
  conn: DBConnection;
  scope: DBScope;
  target?: MongoTargetRef;
  tables: DBSchemaTable[];
  value?: MongoBarState;
  running: boolean;
  onChange: (b: MongoBarState) => void;
  onTargetChange: (t: MongoTargetRef) => void;
  onRun: (query: string) => void;
  onOpenInEditor: (query: string) => void;
}) {
  const { t } = useTranslation('dbquery');
  const bar = (value ?? EMPTY_BAR) as MongoBarState;
  // Builder by default; a hand-written filter (e.g. parsed from the editor)
  // opens in JSON mode.
  const mode: 'builder' | 'json' = bar.filterMode ?? (bar.filter.trim() && !bar.conds?.length ? 'json' : 'builder');
  const conds: Cond[] = bar.conds ?? [];
  const [optionsOpen, setOptionsOpen] = useState(() => !!(bar.project || bar.sort || bar.collation || bar.hint || bar.skip));
  const [indexes, setIndexes] = useState<MongoIndex[]>([]);
  const [copied, setCopied] = useState(false);
  const loadSchema = useDBConnectionStore((s) => s.loadSchema);
  useEffect(() => { if (tables.length === 0) loadSchema(conn.id).catch(() => { /* picker stays as is */ }); }, [conn.id, tables.length, loadSchema]);

  useEffect(() => {
    if (!target?.coll) { setIndexes([]); return; }
    let cancelled = false;
    dbQueryAPI.mongoIndexes(conn.id, { db: target.db || undefined, coll: target.coll }, scope)
      .then((r) => { if (!cancelled) setIndexes((r.data as MongoIndex[]) ?? []); })
      .catch(() => { if (!cancelled) setIndexes([]); });
    return () => { cancelled = true; };
  }, [conn.id, target?.db, target?.coll, scope]);

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

  // Field names + sampled types of the picked collection (builder + hints).
  const fieldTypes = useMemo(() => {
    const tb = tables.find((x) => x.name === target?.coll && (x.schema ?? '') === (target?.db ?? x.schema ?? ''));
    return Object.fromEntries((tb?.columns ?? []).map((c) => [c.name, c.type]));
  }, [tables, target]);
  const setConds = (next: Cond[]) => onChange({ ...bar, filterMode: 'builder', conds: next, filter: compileConds(next, fieldTypes) });
  const setMode = async (m: 'builder' | 'json') => {
    if (m === mode) return;
    if (m === 'builder' && bar.filter.trim() && bar.filter.trim() !== compileConds(conds, fieldTypes)) {
      const ok = await confirmDialog({ title: t('mongoBar.replaceFilterTitle'), description: t('mongoBar.replaceFilterBody'), confirmLabel: t('mongoBar.builder') });
      if (!ok) return;
      onChange({ ...bar, filterMode: 'builder', filter: compileConds(conds, fieldTypes) });
      return;
    }
    onChange({ ...bar, filterMode: m });
  };
  const set = (k: keyof MongoBarState) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...bar, [k]: e.target.value });
  const bad = (k: 'filter' | 'project' | 'sort' | 'collation') => !!bar[k].trim() && !balanced(bar[k]);
  const anyBad = bad('filter') || bad('project') || bad('sort') || bad('collation')
    || (!!bar.skip.trim() && !/^\d+$/.test(bar.skip.trim())) || (!!bar.limit.trim() && !/^\d+$/.test(bar.limit.trim()));
  const query = target ? buildFind(target, bar) : '';
  const run = (explain = false) => { if (target && !anyBad && !running) onRun(buildFind(target, bar, explain)); };
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); run(); } };

  const field = (k: 'filter' | 'project' | 'sort' | 'collation', label: string, placeholder: string, cls = '') => (
    <label className={cn('flex min-w-0 items-center rounded-md border bg-background focus-within:ring-1 focus-within:ring-ring', bad(k) && 'border-destructive', cls)}>
      <span className="shrink-0 border-r px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        value={bar[k]}
        onChange={set(k)}
        onKeyDown={onKey}
        placeholder={placeholder}
        spellCheck={false}
        className="h-8 min-w-0 flex-1 bg-transparent px-2 font-mono text-xs outline-none placeholder:text-muted-foreground/50"
      />
    </label>
  );

  return (
    <div className="shrink-0 space-y-2 border-b px-4 py-3">
      <div className="flex items-center gap-2">
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
        <div className="flex h-8 shrink-0 items-center rounded-md border p-0.5" role="tablist" aria-label={t('mongoBar.filter')}>
          {(['builder', 'json'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => void setMode(m)}
              className={cn('flex h-full items-center gap-1 rounded px-2 text-[11px]', mode === m ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {m === 'builder' ? <ListFilter className="h-3.5 w-3.5" /> : <Braces className="h-3.5 w-3.5" />}
              {t(m === 'builder' ? 'mongoBar.builder' : 'mongoBar.json')}
            </button>
          ))}
        </div>
        {mode === 'json' ? field('filter', t('mongoBar.filter'), "{ status: 'paid', total: { $gt: 100 } }", 'flex-1') : (
          <div className="flex h-8 min-w-0 flex-1 items-center rounded-md border bg-muted/30 px-2">
            <span className="shrink-0 border-r pr-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('mongoBar.filter')}</span>
            <code className="min-w-0 flex-1 truncate pl-2 font-mono text-xs text-muted-foreground" title={bar.filter}>{bar.filter || t('mongoBar.allDocs')}</code>
          </div>
        )}
        <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setOptionsOpen((v) => !v)} aria-expanded={optionsOpen}>
          {t('mongoBar.options')} <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', optionsOpen && 'rotate-180')} />
        </Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => onChange({ ...EMPTY_BAR })} title={t('mongoBar.reset')} aria-label={t('mongoBar.reset')}>
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={!target || anyBad || running} onClick={() => run(true)}>
          <Workflow className="h-3.5 w-3.5" /> {t('mongoBar.explain')}
        </Button>
        <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={!target || anyBad || running} onClick={() => run()}>
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {t('mongoBar.find')}
        </Button>
      </div>
      {mode === 'builder' && (
        <div className="space-y-1.5">
          <datalist id="pm-mongo-bar-fields">{Object.keys(fieldTypes).map((f) => <option key={f} value={f}>{fieldTypes[f]}</option>)}</datalist>
          {conds.map((c, i) => {
            const ty = fieldTypes[c.field.trim()];
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="w-9 shrink-0 text-right text-[10px] font-semibold uppercase text-muted-foreground">{i === 0 ? t('mongoBar.where') : t('mongoBar.and')}</span>
                <div className="flex h-8 w-[240px] shrink-0 items-center rounded-md border bg-background focus-within:ring-1 focus-within:ring-ring">
                  <input list="pm-mongo-bar-fields" value={c.field} placeholder={t('mongoBar.field')} spellCheck={false}
                    onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}
                    onKeyDown={onKey}
                    className="h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-xs outline-none" />
                  {ty && <span className="shrink-0 pr-2 text-[10px] text-muted-foreground">{ty}</span>}
                </div>
                <Select value={c.op} onValueChange={(v) => setConds(conds.map((x, j) => (j === i ? { ...x, op: v as CondOp } : x)))}>
                  <SelectTrigger className="h-8 w-[140px] shrink-0 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COND_OPS.map((op) => <SelectItem key={op} value={op} className="text-xs">{t(`mongoBar.op.${op}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {!VALUELESS.includes(c.op) && (
                  <Input value={c.value} onKeyDown={onKey}
                    onChange={(e) => setConds(conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                    placeholder={c.op === 'in' || c.op === 'nin' ? t('mongoBar.listPlaceholder') : /date/i.test(ty ?? '') ? '2026-11-01' : t('mongoBar.value')}
                    className="h-8 min-w-0 flex-1 font-mono text-xs" />
                )}
                <Button size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0" aria-label={t('mongoBar.removeCond')}
                  onClick={() => setConds(conds.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></Button>
              </div>
            );
          })}
          <div className="flex items-center gap-2">
            <span className="w-9 shrink-0" />
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setConds([...conds, { field: '', op: 'eq', value: '' }])}>
              <Plus className="h-3 w-3" /> {t('mongoBar.addCond')}
            </Button>
          </div>
        </div>
      )}
      {optionsOpen && (
        <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
          {field('project', t('mongoBar.project'), '{ name: 1, total: 1 }')}
          {field('sort', t('mongoBar.sort'), '{ placedAt: -1 }')}
          {field('collation', t('mongoBar.collation'), "{ locale: 'tr', strength: 2 }")}
          <label className="flex min-w-0 items-center rounded-md border bg-background">
            <span className="shrink-0 border-r px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('mongoBar.hint')}</span>
            <Select value={bar.hint || '__auto'} onValueChange={(v) => onChange({ ...bar, hint: v === '__auto' ? '' : v })}>
              <SelectTrigger className="h-8 min-w-0 flex-1 border-0 font-mono text-xs shadow-none focus:ring-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto" className="text-xs">{t('mongoBar.hintAuto')}</SelectItem>
                {indexes.filter((ix) => !ix.hidden).map((ix) => <SelectItem key={ix.name} value={ix.name} className="font-mono text-xs">{ix.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 items-center rounded-md border bg-background">
              <span className="shrink-0 border-r px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('mongoBar.skip')}</span>
              <Input value={bar.skip} onChange={set('skip')} onKeyDown={onKey} placeholder="0" className="h-8 border-0 font-mono text-xs shadow-none focus-visible:ring-0" />
            </label>
            <label className="flex min-w-0 flex-1 items-center rounded-md border bg-background">
              <span className="shrink-0 border-r px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('mongoBar.limit')}</span>
              <Input value={bar.limit} onChange={set('limit')} onKeyDown={onKey} placeholder="20" className="h-8 border-0 font-mono text-xs shadow-none focus-visible:ring-0" />
            </label>
          </div>
        </div>
      )}
      {target && (
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <code className="min-w-0 flex-1 truncate font-mono" title={query}>{query}</code>
          <button type="button" className="rounded p-1 hover:bg-accent hover:text-foreground" title={copied ? t('mongoIndexes.copied') : t('mongoIndexes.copy')} aria-label={t('mongoIndexes.copy')}
            onClick={() => { void navigator.clipboard.writeText(query).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
          <button type="button" className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground" onClick={() => onOpenInEditor(query)}>
            <Code2 className="h-3 w-3" /> {t('mongoBar.openInEditor')}
          </button>
        </div>
      )}
    </div>
  );
}
