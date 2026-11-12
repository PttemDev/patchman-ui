import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {type Monaco} from '@monaco-editor/react';
import { CodeEditor } from '@/components/ui/CodeEditor';
import type * as MonacoType from 'monaco-editor';
import {
  Play,
  PlayCircle,
  Loader2,
  RefreshCw,
  AlertTriangle,
  BookOpen,
  Boxes,
  Copy,
  FileDown,
  CheckCircle2,
  ShieldCheck,
  ChevronDown,
  Sparkles,
  Bookmark,
} from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import { useESConnectionStore, scopeForEs } from '@/stores/esConnectionStore';
import { availableDBScopes } from '@/stores/dbConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { esAPI, type DBScope } from '@/services/api';
import { substituteEnvVars } from '@/lib/envSubstitute';
import { parseCurl } from '@/lib/parseCurl';
import { setMarkers } from '@/lib/monacoLangKit/markers';
import {
  parseKibanaRequests,
  findRequestAtLine,
  targetIndex,
  bindEsModel,
  unbindEsModel,
  setEsModelIndices,
  KIBANA_LANG,
  type KibanaRequest,
} from '@/lib/monacoLangKit/es';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Tab, ClusterResult, ExecResult, IndexRow } from '@/types';
import { ExecScopePicker } from '@/components/common/ExecScopePicker';
import { ESCheatsheet } from './ESCheatsheet';
import { ESIndexBrowser } from './ESIndexBrowser';
import { ESResultViewer } from './ESResultViewer';
import { ESSavedQueries } from './ESSavedQueries';
import { useESConsoleStore } from '@/stores/esConsoleStore';

interface ESConsolePanelProps {
  tab: Tab;
}

interface RunResult {
  method: string;
  path: string;
  ok: boolean;
  status: number;
  tookMs: number;
  body?: unknown;
  error?: string;
}

const DEFAULT_QUERY = 'GET /_cat/indices?v\n\nGET my-index/_search\n{\n  "size": 10,\n  "query": { "match_all": {} }\n}\n';

// ESConsolePanel is the Elasticsearch tab body — a Kibana Dev Tools-style
// console: a cluster header card, a request editor (METHOD path + JSON body,
// multiple requests split by blank lines, run-under-cursor / run-all), a
// result viewer (hits / raw / aggregations / meta), and toggleable left panels
// (cheatsheet + index browser). Mirrors DBQueryPanel's structure + design.
export function ESConsolePanel({ tab }: ESConsolePanelProps) {
  const { t } = useTranslation('es');
  const { theme } = useThemeStore();
  const { connections, fetchConnections, loadMapping } = useESConnectionStore();
  const updateTab = useRequestStore((s) => s.updateTab);
  const activeEnv = useEnvironmentStore((s) => s.activeEnvironment);

  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const codeLensDisposeRef = useRef<MonacoType.IDisposable | null>(null);
  const modelUriRef = useRef<string | null>(null);

  const [cluster, setCluster] = useState<ClusterResult | null>(null);
  const [clusterErr, setClusterErr] = useState<string>('');
  const [clusterLoading, setClusterLoading] = useState(false);
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [activeRunIdx, setActiveRunIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [leftMode, setLeftMode] = useState<'none' | 'cheatsheet' | 'indices' | 'saved'>('none');
  const [saveFocusNonce, setSaveFocusNonce] = useState(0);
  const [allowWrite, setAllowWrite] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [copied, setCopied] = useState(false);
  const [validateMsg, setValidateMsg] = useState<string>('');

  useEffect(() => {
    if (connections.length === 0) fetchConnections();
  }, [connections.length, fetchConnections]);

  const conn = useMemo(
    () => connections.find((c) => c.id === tab.esConnectionId) ?? null,
    [connections, tab.esConnectionId],
  );

  const scopes = availableDBScopes();
  const effectiveScope: DBScope =
    tab.esExecScope ?? conn?.scope ?? scopeForEs(connections, tab.esConnectionId ?? '');

  // A fresh tab for a connection starts from that connection's last console
  // text (kept on this device), so closing the tab doesn't lose the queries.
  // Snapshot once: another tab of the same connection updating the draft must
  // not rewrite this editor.
  const [initialDraft] = useState(() =>
    tab.esConnectionId ? useESConsoleStore.getState().drafts[tab.esConnectionId]?.text : undefined,
  );
  const query = tab.esQuery ?? initialDraft ?? DEFAULT_QUERY;

  // Remember the console text per connection: debounced while typing, and
  // flushed on unmount so closing the tab inside the debounce window keeps it.
  const setDraft = useESConsoleStore((s) => s.setDraft);
  const latestDraft = useRef<{ conn?: string; text?: string }>({});
  latestDraft.current = { conn: tab.esConnectionId, text: tab.esQuery };
  useEffect(() => {
    const connId = tab.esConnectionId;
    const text = tab.esQuery;
    if (!connId || text == null) return;
    const h = window.setTimeout(() => setDraft(connId, text), 400);
    return () => window.clearTimeout(h);
  }, [tab.esConnectionId, tab.esQuery, setDraft]);
  useEffect(() => () => {
    const { conn: c, text } = latestDraft.current;
    if (c && text != null) useESConsoleStore.getState().setDraft(c, text);
  }, []);
  const canWrite = conn?.shared ? conn.grantRole === 'write' : true;

  // ── Cluster header ──────────────────────────────────────────────────
  const loadCluster = useCallback(async () => {
    if (!conn) return;
    setClusterLoading(true);
    setClusterErr('');
    try {
      const res = await esAPI.cluster(conn.id, effectiveScope);
      setCluster(res.data as ClusterResult);
    } catch (err) {
      setCluster(null);
      setClusterErr(extractErr(err, t('console.clusterUnreachable')));
    } finally {
      setClusterLoading(false);
    }
  }, [conn, effectiveScope]);

  useEffect(() => {
    setCluster(null);
    if (conn) loadCluster();
  }, [conn?.id, effectiveScope]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Index names → completion + model binding ────────────────────────
  const refreshIndexNames = useCallback(async () => {
    if (!conn || !modelUriRef.current) return;
    try {
      const res = await esAPI.indices(conn.id, effectiveScope);
      const names = ((res.data as IndexRow[]) ?? []).map((r) => r.index);
      setEsModelIndices(modelUriRef.current, names);
    } catch { /* offline completion still works without index names */ }
  }, [conn, effectiveScope]);

  useEffect(() => {
    const uri = modelUriRef.current;
    if (uri && conn) {
      bindEsModel(uri, conn.id);
      refreshIndexNames();
    }
  }, [conn?.id, refreshIndexNames]);

  // ── Run ─────────────────────────────────────────────────────────────
  const runOne = useCallback(async (req: KibanaRequest): Promise<RunResult> => {
    const path = substituteEnvVars(req.path, activeEnv);
    const bodyText = substituteEnvVars(req.body, activeEnv).trim();
    let body: unknown;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch (e) {
        return {
          method: req.method,
          path,
          ok: false,
          status: 0,
          tookMs: 0,
          error: t('console.invalidJsonBody', { msg: e instanceof Error ? e.message : String(e) }),
        };
      }
    }
    // Warm the mapping cache for autocomplete on the addressed index.
    const idx = targetIndex(path);
    if (idx && conn) loadMapping(conn.id, idx, effectiveScope).catch(() => { /* ignore */ });
    try {
      const res = await esAPI.request(
        conn!.id,
        { method: req.method, path, body, allowWrite },
        effectiveScope,
      );
      const exec = res.data as ExecResult;
      return {
        method: req.method,
        path,
        ok: exec.status >= 200 && exec.status < 300,
        status: exec.status,
        tookMs: exec.tookMs,
        body: exec.body,
      };
    } catch (err) {
      return {
        method: req.method,
        path,
        ok: false,
        status: statusOf(err),
        tookMs: 0,
        body: upstreamBody(err),
        error: extractErr(err, t('console.requestFailed')),
      };
    }
  }, [conn, effectiveScope, allowWrite, activeEnv, loadMapping]);

  const runUnderCursor = useCallback(async () => {
    if (!conn || running) return;
    const reqs = parseKibanaRequests(editorRef.current?.getValue() ?? query);
    if (reqs.length === 0) return;
    const line = editorRef.current?.getPosition()?.lineNumber ?? reqs[0].startLine;
    const req = findRequestAtLine(reqs, line) ?? reqs[0];
    setRunning(true);
    setValidateMsg('');
    const result = await runOne(req);
    setRuns([result]);
    setActiveRunIdx(0);
    setRunning(false);
  }, [conn, running, query, runOne]);

  const runAll = useCallback(async () => {
    if (!conn || running) return;
    const reqs = parseKibanaRequests(editorRef.current?.getValue() ?? query);
    if (reqs.length === 0) return;
    setRunning(true);
    setValidateMsg('');
    const results: RunResult[] = [];
    for (const req of reqs) {
      results.push(await runOne(req));
    }
    setRuns(results);
    setActiveRunIdx(0);
    setRunning(false);
  }, [conn, running, query, runOne]);

  // Run one specific request (used by the per-request "▶ Run" CodeLens).
  const runSpecific = useCallback(async (req: KibanaRequest) => {
    if (!conn || running) return;
    setRunning(true);
    setValidateMsg('');
    const result = await runOne(req);
    setRuns([result]);
    setActiveRunIdx(0);
    setRunning(false);
  }, [conn, running, runOne]);
  const runSpecificRef = useRef(runSpecific);
  useEffect(() => { runSpecificRef.current = runSpecific; }, [runSpecific]);

  // Beautify: pretty-print each request's JSON body in place. METHOD lines,
  // comments, and non-JSON bodies are left untouched.
  const beautify = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;
    const reqs = parseKibanaRequests(model.getValue());
    const edits: MonacoType.editor.IIdentifiedSingleEditOperation[] = [];
    for (const r of reqs) {
      if (!r.body.trim()) continue;
      let pretty: string;
      try { pretty = JSON.stringify(JSON.parse(r.body), null, 2); } catch { continue; }
      if (pretty === r.body) continue;
      edits.push({
        range: new monaco.Range(r.startLine + 1, 1, r.endLine, model.getLineMaxColumn(r.endLine)),
        text: pretty,
      });
    }
    if (edits.length) {
      editor.executeEdits('beautify', edits);
      updateTab(tab.id, { esQuery: model.getValue() });
    }
  }, [tab.id, updateTab]);

  const runRef = useRef(runUnderCursor);
  useEffect(() => { runRef.current = runUnderCursor; }, [runUnderCursor]);

  // ── Validate ────────────────────────────────────────────────────────
  const handleValidate = useCallback(async () => {
    if (!conn) return;
    const reqs = parseKibanaRequests(editorRef.current?.getValue() ?? query);
    const line = editorRef.current?.getPosition()?.lineNumber ?? reqs[0]?.startLine ?? 1;
    const req = findRequestAtLine(reqs, line);
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!req || !monaco || !model) return;
    let parsed: Record<string, unknown> = {};
    if (req.body.trim()) {
      try { parsed = JSON.parse(substituteEnvVars(req.body, activeEnv)); } catch {
        setValidateMsg(t('console.bodyNotJson'));
        return;
      }
    }
    const q = (parsed.query ?? {}) as unknown;
    const idx = targetIndex(substituteEnvVars(req.path, activeEnv)) || '_all';
    setValidateMsg(t('console.validating'));
    try {
      const res = await esAPI.request(
        conn.id,
        { method: 'POST', path: `${idx}/_validate/query?explain=true`, body: { query: q } },
        effectiveScope,
      );
      const body = (res.data as ExecResult).body as {
        valid?: boolean;
        explanations?: Array<{ index?: string; valid?: boolean; error?: string }>;
      };
      const diags: MonacoType.editor.IMarkerData[] = [];
      const bad = (body.explanations ?? []).filter((e) => e.valid === false && e.error);
      if (body.valid && bad.length === 0) {
        setValidateMsg(t('console.queryValid'));
      } else {
        setValidateMsg(bad[0]?.error ?? t('console.queryInvalid'));
        for (const e of bad) {
          diags.push({
            severity: monaco.MarkerSeverity.Error,
            message: e.error ?? t('console.invalidQuery'),
            startLineNumber: req.startLine,
            startColumn: 1,
            endLineNumber: req.endLine,
            endColumn: model.getLineMaxColumn(req.endLine),
          });
        }
      }
      setMarkers(monaco, model, 'es-validate', diags);
    } catch (err) {
      setValidateMsg(extractErr(err, t('console.validationFailed')));
    }
  }, [conn, query, effectiveScope, activeEnv]);

  // ── Copy as curl / import curl ──────────────────────────────────────
  const copyAsCurl = useCallback(async () => {
    if (!conn) return;
    const reqs = parseKibanaRequests(editorRef.current?.getValue() ?? query);
    const line = editorRef.current?.getPosition()?.lineNumber ?? reqs[0]?.startLine ?? 1;
    const req = findRequestAtLine(reqs, line);
    if (!req) return;
    const node = (conn.nodes || '').split(',')[0]?.trim() || 'https://localhost:9200';
    const path = req.path.startsWith('/') ? req.path : '/' + req.path;
    const parts = [`curl -X ${req.method} '${node}${path}'`, `  -H 'Content-Type: application/json'`];
    if (conn.authKind === 'basic') parts.push(`  -u '${conn.username ?? '<user>'}:<password>'`);
    else if (conn.authKind === 'apiKey') parts.push(`  -H 'Authorization: ApiKey <api-key>'`);
    else if (conn.authKind === 'bearer') parts.push(`  -H 'Authorization: Bearer <token>'`);
    if (req.body.trim()) parts.push(`  -d '${req.body.replace(/'/g, "'\\''")}'`);
    try {
      await navigator.clipboard.writeText(parts.join(' \\\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* ignore */ }
  }, [conn, query]);

  const handleImportCurl = useCallback(() => {
    const parsed = parseCurl(importText);
    if (!parsed) { setImportText(''); setImportOpen(false); return; }
    let path = parsed.url;
    try {
      const u = new URL(parsed.url);
      path = u.pathname;
    } catch { /* keep raw */ }
    if (parsed.params.length > 0) {
      path += '?' + parsed.params.map((p) => `${p.key}=${p.value}`).join('&');
    }
    const block = `${parsed.method} ${path}${parsed.body ? '\n' + prettyIfJson(parsed.body) : ''}`;
    const prev = (editorRef.current?.getValue() ?? query).replace(/\s*$/, '');
    const next = prev ? `${prev}\n\n${block}\n` : `${block}\n`;
    updateTab(tab.id, { esQuery: next });
    editorRef.current?.setValue(next);
    setImportText('');
    setImportOpen(false);
  }, [importText, query, tab.id, updateTab]);

  const insertSnippet = useCallback((snippet: string) => {
    const prev = (editorRef.current?.getValue() ?? query).replace(/\s*$/, '');
    const next = prev ? `${prev}\n\n${snippet}\n` : `${snippet}\n`;
    updateTab(tab.id, { esQuery: next });
    editorRef.current?.setValue(next);
  }, [query, tab.id, updateTab]);

  // Saved queries: "open" replaces the editor as one undoable edit (⌘Z gets
  // the previous text back); "insert" appends like a cheatsheet snippet.
  const getCurrentText = useCallback(() => editorRef.current?.getValue() ?? query, [query]);
  const openSaved = useCallback((text: string) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (editor && model) {
      editor.pushUndoStop();
      editor.executeEdits('open-saved', [{ range: model.getFullModelRange(), text }]);
      editor.pushUndoStop();
      updateTab(tab.id, { esQuery: model.getValue() });
    } else {
      updateTab(tab.id, { esQuery: text });
    }
  }, [tab.id, updateTab]);

  const queryIndex = useCallback((index: string) => {
    insertSnippet(`GET ${index}/_search\n{\n  "size": 10,\n  "query": { "match_all": {} }\n}`);
    if (conn) loadMapping(conn.id, index, effectiveScope).catch(() => { /* ignore */ });
  }, [insertSnippet, conn, effectiveScope, loadMapping]);

  // ── Editor mount + split ────────────────────────────────────────────
  const handleEditorMount = useCallback(
    (editor: MonacoType.editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      const model = editor.getModel();
      if (model) {
        modelUriRef.current = model.uri.toString();
        if (conn) { bindEsModel(model.uri.toString(), conn.id); refreshIndexNames(); }
      }
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { runRef.current?.(); });
      // ⌘S: open the Saved panel ready to name + save the current console.
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        setLeftMode('saved');
        setSaveFocusNonce((n) => n + 1);
      });

      // A "▶ Run" CodeLens above each request; the command routes through the
      // ref so it always calls the latest run handler.
      const runCmdId = editor.addCommand(0, (_a: unknown, ...args: unknown[]) => {
        const startLine = args[0] as number;
        const reqs = parseKibanaRequests(editor.getValue());
        const req = reqs.find((r) => r.startLine === startLine);
        if (req) runSpecificRef.current(req);
      });
      codeLensDisposeRef.current?.dispose();
      codeLensDisposeRef.current = monaco.languages.registerCodeLensProvider(KIBANA_LANG, {
        provideCodeLenses: (m: MonacoType.editor.ITextModel) => {
          if (m !== editor.getModel()) return { lenses: [], dispose() { /* no-op */ } };
          const reqs = parseKibanaRequests(m.getValue());
          return {
            lenses: reqs.map((r, i) => ({
              range: { startLineNumber: r.startLine, startColumn: 1, endLineNumber: r.startLine, endColumn: 1 },
              id: `es-run-${i}`,
              command: runCmdId ? { id: runCmdId, title: '▶ Run', arguments: [r.startLine] } : undefined,
            })),
            dispose() { /* no-op */ },
          };
        },
        resolveCodeLens: (_m: MonacoType.editor.ITextModel, lens: MonacoType.languages.CodeLens) => lens,
      });
    },
    [conn, refreshIndexNames],
  );

  useEffect(() => () => {
    const uri = modelUriRef.current;
    if (uri) unbindEsModel(uri);
    codeLensDisposeRef.current?.dispose();
  }, []);

  const [splitRatio, setSplitRatio] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem('patchman_es_split_ratio') || '');
      if (!isNaN(v) && v >= 15 && v <= 85) return v;
    } catch { /* ignore */ }
    return 45;
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const onSplitDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = Math.min(Math.max(((ev.clientY - rect.top) / rect.height) * 100, 15), 85);
      setSplitRatio(pct);
      try { localStorage.setItem('patchman_es_split_ratio', String(pct)); } catch { /* ignore */ }
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'row-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const activeRun = runs[activeRunIdx] ?? null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Cluster header + toolbar */}
      <div className="shrink-0 border-b">
        <ClusterHeader
          cluster={cluster}
          loading={clusterLoading}
          error={clusterErr}
          hasConn={!!conn}
          onRefresh={loadCluster}
        />

        <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
          <Select
            value={tab.esConnectionId ?? ''}
            onValueChange={(v) => updateTab(tab.id, { esConnectionId: v })}
          >
            <SelectTrigger className="w-[240px] h-9 text-sm">
              <SelectValue placeholder={t('console.selectConnection')} />
            </SelectTrigger>
            <SelectContent>
              {connections.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  {t('console.noConnections')}
                </div>
              ) : (
                connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="font-mono text-[10px] mr-2 text-muted-foreground uppercase">{c.flavor}</span>
                    {c.name}
                    {c.shared && <span className="ml-2 text-[10px] text-muted-foreground">· {c.grantRole === 'write' ? t('roles.write') : t('roles.readOnly')}</span>}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          <ExecScopePicker
            scope={effectiveScope}
            availableScopes={conn?.availableScopes ?? (conn?.scope ? [conn.scope] : undefined)}
            onChange={(s) => updateTab(tab.id, { esExecScope: s })}
            noun="request"
          />

          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 h-9 rounded-md border px-2.5">
                  <ShieldCheck className={cn('h-3.5 w-3.5', allowWrite ? 'text-amber-500' : 'text-muted-foreground')} />
                  <span className="text-[11px] text-muted-foreground select-none">{t('console.writes')}</span>
                  <Switch checked={allowWrite} onCheckedChange={setAllowWrite} disabled={!canWrite} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs max-w-[240px]">
                  {canWrite
                    ? t('console.writesTooltipOn')
                    : t('console.writesTooltipReadonly')}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="flex-1" />

          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className={cn('gap-1.5 h-9', leftMode === 'cheatsheet' && 'text-primary')}
                  onClick={() => setLeftMode((m) => (m === 'cheatsheet' ? 'none' : 'cheatsheet'))}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('console.cheatsheet')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs max-w-[220px]">{t('console.cheatsheetTip')}</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!conn}
                  className={cn('gap-1.5 h-9', leftMode === 'indices' && 'text-primary')}
                  onClick={() => setLeftMode((m) => (m === 'indices' ? 'none' : 'indices'))}
                >
                  <Boxes className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('console.indices')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs max-w-[220px]">{t('console.indicesTip')}</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!conn}
                  className={cn('gap-1.5 h-9', leftMode === 'saved' && 'text-primary')}
                  onClick={() => setLeftMode((m) => (m === 'saved' ? 'none' : 'saved'))}
                >
                  <Bookmark className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('console.saved')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs max-w-[220px]">{t('console.savedTip')}</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" disabled={!conn} onClick={copyAsCurl} className="gap-1.5 h-9">
                  <Copy className="h-3.5 w-3.5" />
                  <span className="text-xs">{copied ? t('common:copied') : t('console.copyCurl')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs max-w-[220px]">{t('console.copyCurlTip')}</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)} className="gap-1.5 h-9">
                  <FileDown className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('console.importCurl')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs max-w-[220px]">{t('console.importCurlTip')}</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={beautify} className="gap-1.5 h-9">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('console.beautify')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs max-w-[220px]">{t('console.beautifyTip')}</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" disabled={!conn} onClick={handleValidate} className="gap-1.5 h-9">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('console.validate')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs max-w-[220px]">{t('console.validateTip')}</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" disabled={!conn || running} onClick={runAll} className="gap-1.5 h-9">
                  <PlayCircle className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('console.runAll')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs max-w-[220px]">{t('console.runAllTip')}</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" disabled={!conn || running} onClick={runUnderCursor} className="gap-1.5 h-9">
                  {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  <span className="text-xs">{t('console.run')}</span>
                  <span className="text-[10px] opacity-70 ml-0.5">⌘↵</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs max-w-[220px]">{t('console.runTip', { target: conn?.name ?? t('console.theConnection') })}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {validateMsg && (
          <div className="px-4 pb-2 -mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ChevronDown className="h-3 w-3 rotate-[-90deg]" />
            <span className="font-mono">{validateMsg}</span>
          </div>
        )}
      </div>

      {/* Body: optional left panel + editor/result split */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {leftMode === 'cheatsheet' && (
          <ESCheatsheet onInsert={insertSnippet} onClose={() => setLeftMode('none')} />
        )}
        {leftMode === 'indices' && conn && (
          <ESIndexBrowser
            connId={conn.id}
            scope={effectiveScope}
            onClose={() => setLeftMode('none')}
            onQueryIndex={queryIndex}
          />
        )}
        {leftMode === 'saved' && conn && (
          <ESSavedQueries
            connId={conn.id}
            getCurrentText={getCurrentText}
            onOpen={openSaved}
            onInsert={(text) => insertSnippet(text.replace(/\s*$/, ''))}
            onClose={() => setLeftMode('none')}
            focusNonce={saveFocusNonce}
          />
        )}

        <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex flex-col overflow-hidden" style={{ flex: `0 0 ${splitRatio}%` }}>
            <CodeEditor
              height="100%"
              language={KIBANA_LANG}
              path={`es-console-${tab.id}.kibana-es`}
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              value={query}
              onChange={(v) => updateTab(tab.id, { esQuery: v ?? '' })}
              onMount={handleEditorMount}
              options={{
                fontSize: 13,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                tabSize: 2,
                automaticLayout: true,
                padding: { top: 12 },
                suggestOnTriggerCharacters: true,
                quickSuggestions: { other: true, comments: false, strings: true },
              }}
            />
          </div>

          <div className="h-1 cursor-row-resize bg-border hover:bg-primary/40 shrink-0" onMouseDown={onSplitDown} />

          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {runs.length > 1 && (
              <div className="flex items-center gap-1 px-2 py-1 border-b text-[11px] shrink-0 bg-muted/20 overflow-x-auto">
                <span className="text-muted-foreground mr-1 shrink-0">{t('console.requests')}</span>
                {runs.map((r, i) => (
                  <Button
                    key={i}
                    size="sm"
                    variant="ghost"
                    onClick={() => setActiveRunIdx(i)}
                    className={cn('h-6 text-[11px] gap-1.5 shrink-0', i === activeRunIdx && 'bg-accent')}
                  >
                    <span className={cn('inline-block h-1.5 w-1.5 rounded-full', r.ok ? 'bg-emerald-500' : 'bg-destructive')} />
                    <span className="font-mono">{r.method} {shortPath(r.path)}</span>
                  </Button>
                ))}
              </div>
            )}
            <div className="flex-1 min-h-0">
              {running ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t('console.running')}
                </div>
              ) : activeRun ? (
                activeRun.error && activeRun.body == null ? (
                  <ESErrorPanel method={activeRun.method} path={activeRun.path} status={activeRun.status} message={activeRun.error} />
                ) : (
                  <ESResultViewer body={activeRun.body} status={activeRun.status} tookMs={activeRun.tookMs} />
                )
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground px-4 text-center">
                  {conn
                    ? t('console.emptyWithConn')
                    : t('console.emptyNoConn')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-sm">{t('console.importCurl')}</DialogTitle>
          </DialogHeader>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={t('console.importCurlPlaceholder')}
            className="w-full h-40 rounded-md border bg-background p-2 font-mono text-xs resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setImportOpen(false)}>{t('common:cancel')}</Button>
            <Button size="sm" disabled={!importText.trim()} onClick={handleImportCurl}>{t('console.appendRequest')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClusterHeader({
  cluster, loading, error, hasConn, onRefresh,
}: {
  cluster: ClusterResult | null;
  loading: boolean;
  error: string;
  hasConn: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation('es');
  const info = cluster?.info;
  return (
    <div className="px-4 pt-3 pb-2 flex items-center gap-3">
      {info ? (
        <>
          <span className={cn('inline-block h-2.5 w-2.5 rounded-full shrink-0', healthDot(info.healthStatus))} title={t('console.healthTitle', { status: info.healthStatus })} />
          <span className="text-sm font-medium truncate">{info.clusterName || info.name || t('console.clusterFallback')}</span>
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0">
            {info.flavor || 'elasticsearch'} {info.version}
          </Badge>
          <span className="text-[11px] text-muted-foreground shrink-0">
            {info.numberOfNodes === 1
              ? t('console.nodeCountOne', { count: info.numberOfNodes })
              : t('console.nodeCountOther', { count: info.numberOfNodes })}
            {info.numberOfDataNodes ? t('console.dataNodesSuffix', { count: info.numberOfDataNodes }) : ''}
          </span>
          <span className="text-[11px] text-muted-foreground shrink-0">
            · <span className="font-mono text-foreground/80">{info.activeShards}</span> {t('console.shards')}
            {info.unassignedShards > 0 && <span className="text-amber-500"> · {t('console.unassigned', { count: info.unassignedShards })}</span>}
            {info.relocatingShards > 0 && <span className="text-sky-500"> · {t('console.relocating', { count: info.relocatingShards })}</span>}
          </span>
        </>
      ) : error ? (
        <span className="text-[11px] text-destructive flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground">
          {hasConn ? (loading ? t('console.readingCluster') : t('console.clusterUnavailable')) : t('console.noConnSelected')}
        </span>
      )}
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 ml-auto shrink-0"
        disabled={!hasConn || loading}
        onClick={onRefresh}
        title={t('console.refreshCluster')}
      >
        <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
      </Button>
    </div>
  );
}

function healthDot(health: string): string {
  if (health === 'green') return 'bg-emerald-500';
  if (health === 'yellow') return 'bg-amber-500';
  if (health === 'red') return 'bg-destructive';
  return 'bg-muted-foreground/40';
}

function shortPath(path: string): string {
  return path.length > 28 ? path.slice(0, 27) + '…' : path;
}

function prettyIfJson(s: string): string {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string; body?: { error?: unknown } } } };
    const d = e.response?.data;
    if (d?.error) return typeof d.error === 'string' ? d.error : JSON.stringify(d.error);
    if (d?.body?.error) return JSON.stringify(d.body.error);
  }
  return fallback;
}

function statusOf(err: unknown): number {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { status?: number; data?: { status?: number } } };
    return e.response?.data?.status ?? e.response?.status ?? 0;
  }
  return 0;
}

function upstreamBody(err: unknown): unknown {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { body?: unknown } } };
    return e.response?.data?.body ?? undefined;
  }
  return undefined;
}

// Split an error message into the text before an embedded JSON value, the
// value itself, and any trailing text — e.g. the BE's
// `upstream status 400: {"error":{…},"status":400}` or a Kibana proxy error.
// Tries each `{`/`[` from the left against closers from the right; the first
// parse that succeeds wins. Error strings are short, so this stays cheap.
function splitJson(text: string): { before: string; json: unknown; after: string } {
  const none = { before: text.trim(), json: undefined, after: '' };
  let tries = 0;
  for (let i = 0; i < text.length && tries < 8; i++) {
    const open = text[i];
    if (open !== '{' && open !== '[') continue;
    tries++;
    const close = open === '{' ? '}' : ']';
    for (let j = text.lastIndexOf(close); j > i; j = text.lastIndexOf(close, j - 1)) {
      try {
        const v = JSON.parse(text.slice(i, j + 1));
        if (v && typeof v === 'object') return { before: text.slice(0, i).trim(), json: v, after: text.slice(j + 1).trim() };
      } catch { /* try a shorter span */ }
    }
  }
  return none;
}

// ESErrorPanel — a failed request without an ES response body (transport /
// TLS / Kibana-proxy errors). The request line stays on top; any JSON inside
// the message is shown pretty-printed in a JSON viewer (Kibana-style), with the
// surrounding text kept above and below it.
function ESErrorPanel({ method, path, status, message }: { method: string; path: string; status: number; message: string }) {
  const { theme } = useThemeStore();
  const { before, json, after } = useMemo(() => splitJson(message), [message]);
  const pretty = useMemo(() => (json !== undefined ? JSON.stringify(json, null, 2) : ''), [json]);
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b text-[11px] text-muted-foreground bg-destructive/5 shrink-0">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
        {status > 0 && <span className="font-mono text-foreground">{status}</span>}
        <span className="font-mono truncate">{method} {path}</span>
      </div>
      {before && (
        <p className="px-3 pt-2 pb-1 flex items-start gap-1.5 text-xs text-destructive font-mono whitespace-pre-wrap break-words shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>{before}</span>
        </p>
      )}
      {json !== undefined && (
        <div className="flex-1 min-h-0">
          <CodeEditor
            height="100%"
            language="json"
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={pretty}
            options={{
              readOnly: true,
              fontSize: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
              padding: { top: 8 },
            }}
          />
        </div>
      )}
      {after && (
        <p className="px-3 pt-1 pb-2 text-xs text-destructive font-mono whitespace-pre-wrap break-words shrink-0">{after}</p>
      )}
    </div>
  );
}
