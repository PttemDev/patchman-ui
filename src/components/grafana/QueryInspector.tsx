import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Monaco } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';
import { Play, Loader2, Compass, Plus, X, Braces, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { grafanaAPI, type DBScope } from '@/services/api';
import { useGrafanaConnectionStore, grafanaError } from '@/stores/grafanaConnectionStore';
import { useThemeStore } from '@/stores/themeStore';
import { cn } from '@/lib/utils';
import type { GrafanaPanel, GrafanaQueryResult, GrafanaVarValue } from '@/types';
import { TimeRangePicker, type TimeRange } from './TimeRangePicker';
import { ResultView, type QueryOutcome } from './ResultView';
import { kindOf, newTargetFor, resolveDatasource, textFieldOf, PLACEHOLDER } from './dsKind';
import { openGrafanaTab } from './useOpenGrafana';

// Query inspector: run a panel's queries (or a fresh one) against the
// dashboard's variables and time range, edit them, and analyse the result as
// a graph, table, log list or per-series stats — without leaving the
// dashboard. Edits stay in the modal; the dashboard is never changed.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connId: string;
  connName?: string;
  scope: DBScope;
  /** Panel to inspect; omitted for a fresh dashboard-level query. */
  panel?: GrafanaPanel;
  title: string;
  from: string;
  to: string;
  vars: Record<string, GrafanaVarValue>;
  /** Datasource for a fresh query (dashboard's first panel / default). */
  defaultDatasource?: unknown;
  /** Result the panel already has, shown until the first run. */
  initial?: QueryOutcome | null;
}

type EditTarget = { id: string; target: Record<string, unknown>; json: boolean };

const nextRef = (used: string[]) => {
  for (let i = 0; i < 26; i++) {
    const r = String.fromCharCode(65 + i);
    if (!used.includes(r)) return r;
  }
  return `Q${used.length + 1}`;
};

export function QueryInspector({ open, onOpenChange, connId, connName, scope, panel, title, from, to, vars, defaultDatasource, initial }: Props) {
  const { t } = useTranslation('grafana');
  const theme = useThemeStore((s) => s.theme);
  const { info, loadInfo } = useGrafanaConnectionStore();
  const datasources = useMemo(() => (info[connId]?.datasources ?? []).filter((d) => d.uid !== 'grafana'), [info, connId]);
  const [range, setRange] = useState<TimeRange>({ from, to });
  const [targets, setTargets] = useState<EditTarget[]>([]);
  const [active, setActive] = useState(0);
  const [outcome, setOutcome] = useState<QueryOutcome | null>(null);
  const [running, setRunning] = useState(false);
  const runRef = useRef<() => void>(() => {});

  useEffect(() => { if (open) void loadInfo(connId); }, [open, connId, loadInfo]);

  // (Re)seed when opened.
  useEffect(() => {
    if (!open) return;
    setRange({ from, to });
    setOutcome(initial ?? null);
    setActive(0);
    const panelTargets = (panel?.targets ?? []).filter((tg) => !tg.hide);
    if (panelTargets.length > 0) {
      setTargets(panelTargets.map((tg, i) => {
        const ds = resolveDatasource(tg.datasource ?? panel?.datasource, datasources, vars);
        return { id: `${i}`, target: { ...tg, datasource: tg.datasource ?? panel?.datasource }, json: textFieldOf(tg, kindOf(ds)) === null };
      }));
    } else {
      const ds = resolveDatasource(defaultDatasource, datasources, vars);
      const tg = newTargetFor(ds, 'A');
      setTargets([{ id: '0', target: tg, json: textFieldOf(tg, kindOf(ds)) === null }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, panel]);

  const cur = targets[active];
  const curDs = cur ? resolveDatasource(cur.target.datasource ?? panel?.datasource, datasources, vars) : undefined;
  const curKind = kindOf(curDs);
  const field = cur && !cur.json ? textFieldOf(cur.target, curKind) : null;
  const editorValue = !cur ? '' : field ? String(cur.target[field] ?? '') : JSON.stringify(cur.target, null, 2);

  const patchTarget = (i: number, fn: (e: EditTarget) => EditTarget) => setTargets((ts) => ts.map((e, k) => (k === i ? fn(e) : e)));

  const onEdit = (value: string) => {
    if (!cur) return;
    if (field) {
      patchTarget(active, (e) => ({ ...e, target: { ...e.target, [field]: value } }));
      return;
    }
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      patchTarget(active, (e) => ({ ...e, target: parsed }));
    } catch { /* keep typing — applied once it parses */ }
  };

  const run = useCallback(async () => {
    const list = targets.map((e) => e.target).filter((tg) => !tg.hide);
    if (list.length === 0) return;
    setRunning(true);
    const started = performance.now();
    try {
      const res = await grafanaAPI.query(connId, {
        from: range.from, to: range.to, targets: list, panelDatasource: panel?.datasource,
        vars, maxDataPoints: 1000, source: 'explore',
      }, scope);
      const data = res.data as GrafanaQueryResult;
      const frames = Object.values(data.results ?? {}).flatMap((r) => (r.frames ?? []).filter(Boolean));
      const errors = Object.entries(data.results ?? {}).filter(([, r]) => r.error).map(([ref, r]) => (list.length > 1 ? `${ref}: ${r.error}` : String(r.error)));
      const notice = Object.values(data.results ?? {}).find((r) => r.notice)?.notice;
      setOutcome({ frames, errors, notice, ms: Math.round(performance.now() - started), from: data.from, to: data.to });
    } catch (e) {
      setOutcome({ frames: [], errors: [grafanaError(e).message], ms: Math.round(performance.now() - started) });
    }
    setRunning(false);
  }, [targets, connId, range.from, range.to, panel?.datasource, vars, scope]);
  runRef.current = () => { void run(); };

  const onMount = useCallback((editor: MonacoType.editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
  }, []);

  const addQuery = () => {
    const ds = curDs ?? resolveDatasource(defaultDatasource, datasources, vars);
    const ref = nextRef(targets.map((e) => String(e.target.refId ?? '')));
    const tg = newTargetFor(ds, ref);
    setTargets((ts) => [...ts, { id: `${Date.now()}`, target: tg, json: textFieldOf(tg, kindOf(ds)) === null }]);
    setActive(targets.length);
  };

  const openInExplore = () => {
    if (!cur || !curDs) return;
    const text = field ? String(cur.target[field] ?? '') : JSON.stringify(cur.target, null, 2);
    openGrafanaTab({ connId, view: 'explore', title: `${t('explore.title')} · ${connName ?? ''}`.trim(), datasource: curDs.uid, query: text });
    onOpenChange(false);
  };

  const varSummary = Object.entries(vars)
    .filter(([, v]) => v.values.length > 0)
    .slice(0, 6)
    .map(([k, v]) => `$${k}=${v.values.includes('$__all') ? 'All' : (v.texts?.length ? v.texts : v.values).join('+')}`)
    .join('  ');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1200px] w-[min(1200px,96vw)] h-[min(860px,90vh)] flex flex-col gap-2 p-4">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-sm flex items-center gap-2 pr-6">
            <span className="truncate">{title}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="shrink-0 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 overflow-x-auto">
            {targets.map((e, i) => (
              <span key={e.id} className={cn('flex items-center rounded border text-xs', i === active ? 'bg-accent border-primary/40' : 'text-muted-foreground')}>
                <button type="button" className="px-2 py-0.5 font-mono" onClick={() => setActive(i)}>{String(e.target.refId ?? i + 1)}</button>
                {targets.length > 1 && (
                  <button type="button" className="pr-1 hover:text-destructive" onClick={() => { setTargets((ts) => ts.filter((_, k) => k !== i)); setActive(0); }} title={t('inspector.removeQuery')}>
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={addQuery} title={t('inspector.addQuery')}><Plus className="h-3.5 w-3.5" /></Button>
          </div>
          {cur && (
            <Select
              value={curDs?.uid ?? ''}
              onValueChange={(uid) => {
                const ds = datasources.find((d) => d.uid === uid);
                if (!ds) return;
                const same = kindOf(ds) === curKind;
                patchTarget(active, (e) => {
                  const fresh = same ? { ...e.target, datasource: { uid: ds.uid, type: ds.type } } : newTargetFor(ds, String(e.target.refId ?? 'A'));
                  return { ...e, target: fresh, json: textFieldOf(fresh, kindOf(ds)) === null };
                });
              }}
            >
              <SelectTrigger className="h-7 w-56 text-xs"><SelectValue placeholder={t('explore.pickDatasource')} /></SelectTrigger>
              <SelectContent>
                {datasources.map((d) => (
                  <SelectItem key={d.uid} value={d.uid} className="text-xs">{d.name} <span className="text-muted-foreground ml-1">{d.type}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {cur && textFieldOf(cur.target, curKind) !== null && (
            <Button size="sm" variant={cur.json ? 'secondary' : 'ghost'} className="h-7 text-xs gap-1" onClick={() => patchTarget(active, (e) => ({ ...e, json: !e.json }))} title={t('inspector.jsonHint')}>
              <Braces className="h-3.5 w-3.5" /> JSON
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <TimeRangePicker value={range} onChange={setRange} />
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openInExplore} disabled={!curDs}>
              <Compass className="h-3.5 w-3.5" /> {t('inspector.openExplore')}
            </Button>
            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => void run()} disabled={running || targets.length === 0}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {t('explore.run')}
            </Button>
          </div>
        </div>

        <div className="shrink-0 h-36 rounded border overflow-hidden">
          {cur && (
            <CodeEditor
              key={`${cur.id}:${cur.json}:${field}:${curDs?.uid ?? ''}`}
              height="100%"
              language={cur.json || curKind === 'other' ? 'json' : field === 'rawSql' ? 'sql' : 'plaintext'}
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              defaultValue={editorValue}
              onChange={(v) => onEdit(v ?? '')}
              onMount={onMount}
              options={{ minimap: { enabled: false }, fontSize: 12, wordWrap: 'on', lineNumbers: 'off', scrollBeyondLastLine: false, automaticLayout: true, placeholder: PLACEHOLDER[curKind] } as MonacoType.editor.IStandaloneEditorConstructionOptions}
            />
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
          <Info className="h-3 w-3 shrink-0" />
          <span className="truncate" title={varSummary}>{t('inspector.varsHint')}{varSummary ? ` — ${varSummary}` : ''}</span>
          <span className="ml-auto shrink-0">{t('explore.hintRun')}</span>
        </div>

        <div className="flex-1 min-h-0 rounded border p-2">
          <ResultView
            outcome={outcome}
            panel={panel}
            fileName={(title || 'query').replace(/[^\w.-]+/g, '_').slice(0, 60)}
            onZoom={(f, tt) => setRange({ from: String(Math.round(f)), to: String(Math.round(tt)) })}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
