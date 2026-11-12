import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Monaco } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';
import { Play, Loader2, Database } from 'lucide-react';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { grafanaAPI } from '@/services/api';
import { useGrafanaConnectionStore, scopeForGrafana, grafanaError } from '@/stores/grafanaConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import { useThemeStore } from '@/stores/themeStore';
import type { GrafanaDatasource, GrafanaQueryResult, Tab } from '@/types';
import { TimeRangePicker, type TimeRange } from './TimeRangePicker';
import { ResultView, type QueryOutcome } from './ResultView';
import { kindOf, newTargetFor, PLACEHOLDER } from './dsKind';

// Explore: run a free query against any datasource of the connection.
// Prometheus gets metric / label completion through the allowlisted
// resource API; results render as graph, table or log lines.
export function ExploreView({ tab }: { tab: Tab }) {
  const { t } = useTranslation('grafana');
  const theme = useThemeStore((s) => s.theme);
  const updateTab = useRequestStore((s) => s.updateTab);
  const { connections, loaded, fetchConnections, info, loadInfo } = useGrafanaConnectionStore();
  const connId = tab.grafanaConnectionId ?? '';
  const scope = scopeForGrafana(connections, connId);
  const state = tab.grafanaExplore ?? {};
  const [range, setRange] = useState<TimeRange>(tab.grafanaRange ?? { from: 'now-1h', to: 'now' });
  const [query, setQuery] = useState(state.query ?? '');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryOutcome | null>(null);
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  const runRef = useRef<() => void>(() => {});
  const currentDs = useRef<GrafanaDatasource | undefined>(undefined);

  useEffect(() => { if (!loaded) void fetchConnections(); }, [loaded, fetchConnections]);
  useEffect(() => { if (loaded && connId) void loadInfo(connId); }, [loaded, connId, loadInfo]);

  const srv = info[connId];
  const datasources = useMemo(() => (srv?.datasources ?? []).filter((d) => d.uid !== 'grafana'), [srv]);
  const ds = datasources.find((d) => d.uid === state.datasource) ?? datasources.find((d) => d.isDefault) ?? datasources[0];
  const kind = kindOf(ds);

  const save = useCallback((patch: Partial<NonNullable<Tab['grafanaExplore']>>) => {
    updateTab(tab.id, { grafanaExplore: { ...(tab.grafanaExplore ?? {}), ...patch } });
  }, [tab.id, tab.grafanaExplore, updateTab]);

  const run = useCallback(async () => {
    if (!ds) return;
    const q = editorRef.current?.getValue() ?? query;
    let target: Record<string, unknown> = { refId: 'A' };
    if (kind === 'prom') target = { ...target, expr: q, instant: !!state.instant, range: !state.instant };
    else if (kind === 'loki') target = { ...target, expr: q, queryType: state.instant ? 'instant' : 'range', maxLines: 1000 };
    else if (kind === 'sql') target = { ...target, rawSql: q, rawQuery: true, editorMode: 'code', format: state.format || 'table' };
    else if (kind === 'es' || kind === 'influx') target = { ...newTargetFor(ds, 'A'), query: q || (kind === 'es' ? '*' : '') };
    else {
      try { target = { refId: 'A', ...(JSON.parse(q) as Record<string, unknown>) }; } catch { target = { ...target, query: q }; }
    }
    target.datasource = { uid: ds.uid, type: ds.type };
    setRunning(true);
    const started = performance.now();
    try {
      const res = await grafanaAPI.query(connId, { from: range.from, to: range.to, targets: [target], maxDataPoints: 1000, source: 'explore' }, scope);
      const data = res.data as GrafanaQueryResult;
      const r = data.results?.A ?? Object.values(data.results ?? {})[0];
      setResult({ frames: (r?.frames ?? []).filter(Boolean), errors: r?.error ? [r.error] : [], notice: r?.notice, ms: Math.round(performance.now() - started), from: data.from, to: data.to });
    } catch (e) {
      setResult({ frames: [], errors: [grafanaError(e).message], ms: Math.round(performance.now() - started) });
    }
    setRunning(false);
  }, [ds, query, kind, state.instant, state.format, connId, range.from, range.to, scope]);
  runRef.current = () => { void run(); };

  // Prometheus completion: metric names, label names inside {…}, label values after label="…
  const completionCache = useRef<Record<string, string[]>>({});
  const onMount = useCallback((editor: MonacoType.editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
    const model = editor.getModel();
    const provider = monaco.languages.registerCompletionItemProvider('plaintext', {
      triggerCharacters: ['{', ',', '"', '='],
      provideCompletionItems: async (m: MonacoType.editor.ITextModel, pos: MonacoType.Position) => {
        if (m !== model) return { suggestions: [] };
        const dsNow = currentDs.current;
        if (!dsNow || kindOf(dsNow) !== 'prom') return { suggestions: [] };
        const before = m.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: pos.lineNumber, endColumn: pos.column });
        const word = m.getWordUntilPosition(pos);
        const rangeW = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const fetchList = async (key: string, path: string) => {
          if (!completionCache.current[key]) {
            try {
              const res = await grafanaAPI.resource(connId, dsNow.uid, path, {}, scope);
              completionCache.current[key] = ((res.data as { data?: string[] }).data ?? []).slice(0, 5000);
            } catch { completionCache.current[key] = []; }
          }
          return completionCache.current[key];
        };
        const open = before.lastIndexOf('{') > before.lastIndexOf('}');
        const valueMatch = /(\w+)\s*=~?\s*"([^"]*)$/.exec(before);
        if (open && valueMatch) {
          const vals = await fetchList(`${dsNow.uid}:v:${valueMatch[1]}`, `api/v1/label/${valueMatch[1]}/values`);
          return { suggestions: vals.map((v) => ({ label: v, kind: monaco.languages.CompletionItemKind.Value, insertText: v, range: rangeW })) };
        }
        if (open) {
          const labels = await fetchList(`${dsNow.uid}:labels`, 'api/v1/labels');
          return { suggestions: labels.map((l) => ({ label: l, kind: monaco.languages.CompletionItemKind.Field, insertText: `${l}="`, range: rangeW })) };
        }
        const metrics = await fetchList(`${dsNow.uid}:metrics`, 'api/v1/label/__name__/values');
        return { suggestions: metrics.map((n) => ({ label: n, kind: monaco.languages.CompletionItemKind.Function, insertText: n, range: rangeW })) };
      },
    });
    editor.onDidDispose(() => provider.dispose());
  }, [connId, scope]);
  currentDs.current = ds;


  if (!connId) return <div className="p-6 text-sm text-muted-foreground">{t('dashboard.missing')}</div>;

  return (
    <div className="h-full flex flex-col min-h-0 bg-background">
      <div className="shrink-0 border-b px-3 py-2 flex flex-wrap items-center gap-2">
        <Database className="h-4 w-4 text-muted-foreground" />
        <Select value={ds?.uid ?? ''} onValueChange={(v) => { save({ datasource: v }); setResult(null); }}>
          <SelectTrigger className="h-7 w-56 text-xs"><SelectValue placeholder={srv ? t('explore.pickDatasource') : t('explore.loadingDatasources')} /></SelectTrigger>
          <SelectContent>
            {datasources.map((d) => (
              <SelectItem key={d.uid} value={d.uid} className="text-xs">
                {d.name} <span className="text-muted-foreground ml-1">{d.type}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(kind === 'prom' || kind === 'loki') && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={!!state.instant} onCheckedChange={(v) => save({ instant: v })} /> {t('explore.instant')}
          </label>
        )}
        {kind === 'sql' && (
          <Select value={state.format || 'table'} onValueChange={(v) => save({ format: v })}>
            <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="table" className="text-xs">{t('explore.formatTable')}</SelectItem>
              <SelectItem value="time_series" className="text-xs">{t('explore.formatTimeSeries')}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-2">
          <TimeRangePicker value={range} onChange={(r) => { setRange(r); updateTab(tab.id, { grafanaRange: r }); }} />
          <Button size="sm" className="h-7 text-xs gap-1" onClick={() => void run()} disabled={running || !ds}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {t('explore.run')}
          </Button>
        </div>
      </div>
      <div className="shrink-0 h-36 border-b">
        <CodeEditor
          height="100%"
          language={kind === 'sql' ? 'sql' : kind === 'other' ? 'json' : 'plaintext'}
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          value={query}
          onChange={(v) => { setQuery(v ?? ''); save({ query: v ?? '' }); }}
          onMount={onMount}
          options={{ minimap: { enabled: false }, fontSize: 12, wordWrap: 'on', lineNumbers: 'off', scrollBeyondLastLine: false, automaticLayout: true, quickSuggestions: true, placeholder: PLACEHOLDER[kind] } as MonacoType.editor.IStandaloneEditorConstructionOptions}
        />
      </div>
      <div className="shrink-0 px-3 py-0.5 text-[10px] text-muted-foreground border-b text-right">{t('explore.hintRun')}</div>
      <div className="flex-1 min-h-0 p-2">
        <ResultView
          outcome={result}
          fileName="explore"
          onZoom={(f, to) => { const r = { from: String(Math.round(f)), to: String(Math.round(to)) }; setRange(r); updateTab(tab.id, { grafanaRange: r }); }}
        />
      </div>
    </div>
  );
}
