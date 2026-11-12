import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {type Monaco} from '@monaco-editor/react';
import { CodeEditor } from '@/components/ui/CodeEditor';
import type * as MonacoType from 'monaco-editor';
import {
  Database as DBIcon,
  Play,
  Square,
  Loader2,
  Save,
  RefreshCw,
  AlertTriangle,
  Timer,
  History,
  Repeat,
  BookOpen,
  Wand2,
  Zap,
  Cloud,
  ChevronDown,
} from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import { useDBConnectionStore, availableDBScopes } from '@/stores/dbConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import type { DBScope } from '@/services/api';
import { dbQueryAPI, dbSavedQueryAPI } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Tab, DBKind, DBQueryResult } from '@/types';
import { DB_KIND_FAMILY } from '@/types';
import { DBResultPanel } from './DBResultPanel';
import { DBQueryParamsBar } from './DBQueryParamsBar';
import { DBSaveQueryDialog, type SaveQueryPayload } from './DBSaveQueryDialog';
import { DBExamplesDialog } from './DBExamplesDialog';
import { formatQuery } from './queryFormatter';
import { registerDBCompletion } from './monacoDBCompletion';
import { pushFilterClause, quoteIdent, quoteQualified, substituteQueryParams } from './queryParamUtils';
import { useDBLocalSavedQueriesStore } from '@/stores/dbLocalSavedQueriesStore';
import { useDBRemoteSavedQueriesStore } from '@/stores/dbRemoteSavedQueriesStore';
import { useAuthStore } from '@/stores/authStore';

interface DBQueryPanelProps {
  tab: Tab;
}

const defaultRowLimit = 500;
const REFRESH_OPTIONS: Array<{ label: string; sec: number }> = [
  { label: 'Off', sec: 0 },
  { label: '5s', sec: 5 },
  { label: '15s', sec: 15 },
  { label: '30s', sec: 30 },
  { label: '1m', sec: 60 },
  { label: '5m', sec: 300 },
];

// DBQueryPanel renders the DB-tab body: connection picker + toolbar
// on top, optional params bar, Monaco editor, then the result panel
// below a resizable split.
export function DBQueryPanel({ tab }: DBQueryPanelProps) {
  const { t } = useTranslation('dbquery');
  const { theme } = useThemeStore();
  const { connections, schemas, fetchConnections, loadSchema } = useDBConnectionStore();
  const updateTab = useRequestStore((s) => s.updateTab);
  const addTab = useRequestStore((s) => s.addTab);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const dataSource = useAuthStore((s) => s.dataSource);
  const addLocalSaved = useDBLocalSavedQueriesStore((s) => s.add);
  const localQueries = useDBLocalSavedQueriesStore((s) => s.queries);
  const addRemoteSaved = useDBRemoteSavedQueriesStore((s) => s.add);
  const remoteSavedByConn = useDBRemoteSavedQueriesStore((s) => s.byConn);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);

  useEffect(() => {
    if (connections.length === 0) fetchConnections();
  }, [connections.length, fetchConnections]);

  const conn = useMemo(
    () => connections.find((c) => c.id === tab.dbConnectionId) ?? null,
    [connections, tab.dbConnectionId],
  );

  // Effective execution scope: per-tab override wins over the
  // connection's home scope. Both BEs run the same Go binary, so a
  // power user on desktop can experiment with routing the same query
  // through either side.
  const scopes = availableDBScopes();
  const canPickExecScope = scopes.length > 1;
  const effectiveScope: DBScope = tab.dbExecScope ?? conn?.scope ?? (scopes.includes('remote') ? 'remote' : 'local');

  // Existing folders for the current connection — feeds the combobox
  // in the save dialog so the user can pick rather than retype.
  const existingFolders = useMemo(() => {
    if (!conn) return [];
    const set = new Set<string>();
    for (const q of remoteSavedByConn[conn.id] ?? []) {
      if (q.folder) set.add(q.folder);
    }
    for (const q of localQueries) {
      if (q.connectionId === conn.id && q.folder) set.add(q.folder);
    }
    return [...set].sort();
  }, [conn, remoteSavedByConn, localQueries]);

  // Resizable split persistence.
  const [splitRatio, setSplitRatio] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem('patchman_db_split_ratio') || '');
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
      try { localStorage.setItem('patchman_db_split_ratio', String(pct)); } catch { /* ignore */ }
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

  const [running, setRunning] = useState(false);
  const queryIdRef = useRef<string>('');
  // The HTTP abort controller for the in-flight execute call. Cancel
  // calls both this (so the FE stops waiting immediately) and the BE
  // /cancel endpoint (best-effort — the BE may not have registered the
  // query yet, in which case the abort alone is what stops "Running…").
  const abortRef = useRef<AbortController | null>(null);

  // Live elapsed timer — ticks once a second while a query is running.
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAt = useRef<number>(0);
  useEffect(() => {
    if (!running) return;
    startedAt.current = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 100);
    return () => clearInterval(id);
  }, [running]);

  const handleQueryChange = useCallback(
    (value: string | undefined) => updateTab(tab.id, { dbQuery: value ?? '' }),
    [tab.id, updateTab],
  );

  const handleConnectionChange = useCallback(
    (value: string) => {
      updateTab(tab.id, { dbConnectionId: value });
      loadSchema(value).catch(() => { /* ignore */ });
    },
    [tab.id, updateTab, loadSchema],
  );

  const runOnce = useCallback(async () => {
    if (!conn || running) return;
    const raw = tab.dbQuery ?? '';
    if (!raw.trim()) return;
    const query = substituteQueryParams(raw, tab.dbParams ?? {});
    setRunning(true);
    updateTab(tab.id, { dbError: '', dbResult: null });
    const queryId = crypto.randomUUID();
    queryIdRef.current = queryId;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await dbQueryAPI.execute({
        connectionId: conn.id,
        query,
        limit: tab.dbLimit ?? defaultRowLimit,
        queryId,
      }, controller.signal, effectiveScope);
      const data = res.data as DBQueryResult | { results: DBQueryResult[] };
      let primary: DBQueryResult;
      let allResults: DBQueryResult[] | undefined;
      if ('results' in (data as { results?: DBQueryResult[] }) && Array.isArray((data as { results: DBQueryResult[] }).results)) {
        allResults = (data as { results: DBQueryResult[] }).results;
        primary = allResults[0];
      } else {
        primary = data as DBQueryResult;
        // Single-statement response: still set an explicit one-element list so
        // a previous multi-statement run's dbStmtResults is REPLACED, not left
        // stale. (updateTab drops `undefined`, so we can't clear by omission —
        // that's what left an idle #1/#2 tab after commenting a statement out.)
        allResults = [primary];
      }
      const history = [primary, ...(tab.dbHistory ?? [])].slice(0, 5);
      updateTab(tab.id, {
        dbResult: primary,
        dbError: '',
        dbStmtResults: allResults,
        dbStmtIdx: 0,
        dbHistory: history,
      });
    } catch (err) {
      if (isAbortError(err)) {
        updateTab(tab.id, { dbError: t('panel.cancelled'), dbResult: null });
      } else {
        const msg = extractErr(err, t('panel.queryFailed'));
        updateTab(tab.id, { dbError: msg, dbResult: null });
      }
    } finally {
      setRunning(false);
      queryIdRef.current = '';
      abortRef.current = null;
    }
    // `t` intentionally excluded — this is a load-shaped callback; a stale `t`
    // still renders the current language and re-adding it would reset state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, effectiveScope, running, tab.dbQuery, tab.dbLimit, tab.dbParams, tab.id, tab.dbHistory, updateTab]);

  const cancel = useCallback(() => {
    // Best-effort BE cancel — the BE may not have registered the query
    // yet (still resolving the connection / decrypting the password),
    // in which case it'll 404. That's expected; the abort below is what
    // actually unblocks the FE.
    const id = queryIdRef.current;
    if (id) {
      // Send the cancel to the BE that owns the connection — the prod
      // BE has never heard of a local-scope query and vice versa.
      dbQueryAPI.cancel(id, effectiveScope).catch(() => { /* ignore */ });
    }
    abortRef.current?.abort();
  }, [effectiveScope]);

  // Auto-refresh loop — re-runs runOnce at the configured cadence.
  const runRef = useRef(runOnce);
  useEffect(() => { runRef.current = runOnce; }, [runOnce]);
  useEffect(() => {
    const sec = tab.dbAutoRefresh ?? 0;
    if (!sec || !conn) return;
    const id = setInterval(() => {
      if (!queryIdRef.current) runRef.current();
    }, sec * 1000);
    return () => clearInterval(id);
  }, [tab.dbAutoRefresh, conn]);

  const handleSave = useCallback(() => {
    if (!conn || !(tab.dbQuery ?? '').trim()) return;
    setSaveDialogOpen(true);
  }, [conn, tab.dbQuery]);

  const handleSaveSubmit = useCallback(async (payload: SaveQueryPayload) => {
    if (!conn) return;
    const queryText = tab.dbQuery ?? '';
    if (payload.scope === 'local') {
      addLocalSaved({
        connectionId: conn.id,
        name: payload.name,
        queryText,
        folder: payload.folder,
        tags: '',
      });
      updateTab(tab.id, { name: payload.name });
      return;
    }
    await addRemoteSaved({
      connectionId: conn.id,
      name: payload.name,
      queryText,
      folder: payload.folder,
      tags: '',
    }, conn.scope);
    updateTab(tab.id, { name: payload.name });
  }, [conn, tab.dbQuery, tab.id, addLocalSaved, addRemoteSaved, updateTab]);

  const remoteAvailable = isAuthenticated && dataSource === 'remote';

  const handleRefreshSchema = useCallback(async () => {
    if (!conn) return;
    await loadSchema(conn.id, true);
  }, [conn, loadSchema]);

  const handleBeautify = useCallback(() => {
    if (!conn) return;
    const next = formatQuery(tab.dbQuery ?? '', conn.kind);
    if (next !== (tab.dbQuery ?? '')) {
      updateTab(tab.id, { dbQuery: next });
    }
  }, [conn, tab.dbQuery, tab.id, updateTab]);

  const handleAddFilter = useCallback(
    (col: string, op: '=' | '!=' | 'LIKE' | 'IS NULL' | 'IS NOT NULL', value: unknown) => {
      const family = conn ? DB_KIND_FAMILY[conn.kind] : 'postgres';
      const next = pushFilterClause(tab.dbQuery ?? '', col, op, value, family);
      updateTab(tab.id, { dbQuery: next });
    },
    [conn, tab.dbQuery, tab.id, updateTab],
  );

  // FK navigation — finds the FK metadata for `col` from the cached
  // schema and opens a new DB tab seeded with the lookup query.
  const handleOpenFK = useCallback((col: string, value: unknown) => {
    if (!conn) return;
    const schema = schemas[conn.id];
    if (!schema) return;
    const family = DB_KIND_FAMILY[conn.kind];
    for (const t of schema.tables) {
      const fk = t.foreignKeys?.find((f) => f.column === col);
      if (!fk) continue;
      const target = quoteQualified(fk.targetSchema, fk.targetTable, family);
      // T-SQL uses TOP (before the column list), not a trailing LIMIT.
      const seed = conn.kind === 'sqlserver'
        ? `SELECT TOP 100 * FROM ${target} WHERE ${quoteIdent(fk.targetColumn, family)} = ${sqlLit(value)};`
        : `SELECT * FROM ${target} WHERE ${quoteIdent(fk.targetColumn, family)} = ${sqlLit(value)} LIMIT 100;`;
      addTab({
        type: 'db',
        name: `${conn.kind.toUpperCase()} · ${fk.targetTable}`,
        dbConnectionId: conn.id,
        dbQuery: seed,
        method: 'GET',
        url: '',
      } as Parameters<typeof addTab>[0], true);
      return;
    }
  }, [conn, schemas, addTab]);

  const handlePageChange = useCallback((delta: 1 | -1) => {
    const limit = tab.dbLimit ?? defaultRowLimit;
    const cur = tab.dbPage ?? 0;
    const next = Math.max(0, cur + delta);
    updateTab(tab.id, { dbPage: next });
    // Re-run with new offset. We rely on the runOnce closure picking up
    // dbPage from tab state, which it doesn't directly — so we call a
    // local runner here.
    runWithOffset(next * limit);
  }, [tab.dbLimit, tab.dbPage, tab.id, updateTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const runWithOffset = useCallback(async (offset: number) => {
    if (!conn) return;
    const raw = tab.dbQuery ?? '';
    if (!raw.trim()) return;
    const query = substituteQueryParams(raw, tab.dbParams ?? {});
    setRunning(true);
    updateTab(tab.id, { dbError: '', dbResult: null });
    const queryId = crypto.randomUUID();
    queryIdRef.current = queryId;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await dbQueryAPI.execute({
        connectionId: conn.id,
        query,
        limit: tab.dbLimit ?? defaultRowLimit,
        offset,
        queryId,
      }, controller.signal, effectiveScope);
      const data = res.data as DBQueryResult | { results: DBQueryResult[] };
      let primary: DBQueryResult;
      let allResults: DBQueryResult[] | undefined;
      if ('results' in (data as { results?: DBQueryResult[] }) && Array.isArray((data as { results: DBQueryResult[] }).results)) {
        allResults = (data as { results: DBQueryResult[] }).results;
        primary = allResults[0];
      } else {
        primary = data as DBQueryResult;
        // Single-statement response: still set an explicit one-element list so
        // a previous multi-statement run's dbStmtResults is REPLACED, not left
        // stale. (updateTab drops `undefined`, so we can't clear by omission —
        // that's what left an idle #1/#2 tab after commenting a statement out.)
        allResults = [primary];
      }
      updateTab(tab.id, { dbResult: primary, dbError: '', dbStmtResults: allResults, dbStmtIdx: 0 });
    } catch (err) {
      if (isAbortError(err)) {
        updateTab(tab.id, { dbError: t('panel.cancelled'), dbResult: null });
      } else {
        const msg = extractErr(err, t('panel.queryFailed'));
        updateTab(tab.id, { dbError: msg, dbResult: null });
      }
    } finally {
      setRunning(false);
      queryIdRef.current = '';
      abortRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, effectiveScope, tab.dbQuery, tab.dbLimit, tab.dbParams, tab.id, updateTab]);

  const handleEditorMount = useCallback(
    (editor: MonacoType.editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { runRef.current?.(); });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { saveRef.current?.(); });
      // ⌘⇧F (Mac) / Ctrl+Shift+F (Linux/Win) — same chord VS Code / Monaco
      // use natively for "Format document".
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        () => { beautifyRef.current?.(); },
      );
      if (conn) {
        registerDBCompletion(monaco, conn.id, conn.kind);
        loadSchema(conn.id).catch(() => { /* ignore */ });
      }
    },
    [conn, loadSchema],
  );

  const saveRef = useRef(handleSave);
  const beautifyRef = useRef(handleBeautify);
  useEffect(() => { saveRef.current = handleSave; }, [handleSave]);
  useEffect(() => { beautifyRef.current = handleBeautify; }, [handleBeautify]);

  // Cmd/Ctrl+S — global shortcut dispatches `patchman:save-to-collection`.
  // DBQueryPanel is only mounted when a DB tab is active, so we can
  // unconditionally trigger the save flow when it fires here.
  useEffect(() => {
    const onSave = () => saveRef.current();
    window.addEventListener('patchman:save-to-collection', onSave);
    return () => window.removeEventListener('patchman:save-to-collection', onSave);
  }, []);

  const monacoLang = kindToMonacoLang(conn?.kind);

  // Multi-statement display: choose primary result + tab list.
  const stmtResults = tab.dbStmtResults;
  const stmtIdx = tab.dbStmtIdx ?? 0;
  const activeResult = stmtResults?.[stmtIdx] ?? tab.dbResult ?? null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="shrink-0 border-b">
        <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-wrap">
        <DBIcon className="h-4 w-4 text-muted-foreground" />
        <Select value={tab.dbConnectionId ?? ''} onValueChange={handleConnectionChange}>
          <SelectTrigger className="w-[280px] h-9 text-sm">
            <SelectValue placeholder={t('panel.selectConnection')} />
          </SelectTrigger>
          <SelectContent>
            {connections.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                {t('panel.noConnectionsHint')}
              </div>
            ) : (
              connections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="font-mono text-[10px] mr-2 text-muted-foreground uppercase">{c.kind}</span>
                  {c.name}
                  {c.shared && (
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      · {c.grantRole === 'write' ? t('role.coowner') : t('role.readonly')}
                    </span>
                  )}
                  {c.allowWrite && (
                    <span className="ml-2 text-[10px] text-amber-600 dark:text-amber-400">· {t('badges.rw')}</span>
                  )}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <TooltipProvider delayDuration={200}>
          {running && (
            <div className="flex items-center gap-1 text-[11px] text-amber-500 font-mono mr-1">
              <Timer className="h-3 w-3 animate-pulse" />
              {(elapsedMs / 1000).toFixed(1)}s
            </div>
          )}

          {/* Auto-rerun the query at a fixed cadence */}
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="gap-1.5 h-9">
                    <Repeat className={cn('h-3.5 w-3.5', (tab.dbAutoRefresh ?? 0) > 0 && 'text-emerald-500')} />
                    <span className="text-xs">
                      {(tab.dbAutoRefresh ?? 0) > 0
                        ? t('panel.autoRerunOn', { sec: tab.dbAutoRefresh })
                        : t('panel.autoRerunOff')}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {REFRESH_OPTIONS.map((opt) => (
                    <DropdownMenuItem
                      key={opt.sec}
                      onClick={() => updateTab(tab.id, { dbAutoRefresh: opt.sec })}
                    >
                      {opt.sec === 0 ? t('panel.refreshOff') : opt.label}{(tab.dbAutoRefresh ?? 0) === opt.sec && ' ✓'}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs max-w-[220px]">
                {t('panel.autoRerunTooltip')}
              </p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="ghost" disabled={!conn || running} onClick={handleRefreshSchema} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                <span className="text-xs">{t('panel.schema')}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs max-w-[220px]">
                {t('panel.schemaTooltip')}
              </p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center h-9 rounded-md border bg-background px-2 gap-1.5">
                <span className="text-[11px] text-muted-foreground select-none">{t('panel.rowLimit')}</span>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder={String(defaultRowLimit)}
                  value={tab.dbLimit != null ? String(tab.dbLimit) : ''}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D+/g, '');
                    if (digits === '') {
                      updateTab(tab.id, { dbLimit: undefined });
                      return;
                    }
                    const v = parseInt(digits, 10);
                    if (!Number.isNaN(v)) updateTab(tab.id, { dbLimit: Math.min(v, 100000) });
                  }}
                  className="h-6 w-14 text-xs px-1.5 border-0 shadow-none focus-visible:ring-0 bg-transparent"
                />
                <span className="text-[11px] text-muted-foreground select-none">{t('units.rowsWord')}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs max-w-[220px]">
                {t('panel.rowLimitTooltip', { default: defaultRowLimit })}
              </p>
            </TooltipContent>
          </Tooltip>

          {canPickExecScope && (
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className={cn(
                        'gap-1.5 h-9 border-2',
                        effectiveScope === 'local'
                          ? 'border-amber-500/60 text-amber-500 hover:text-amber-500'
                          : 'border-sky-500/60 text-sky-500 hover:text-sky-500',
                      )}
                    >
                      {effectiveScope === 'local' ? <Zap className="h-3.5 w-3.5" /> : <Cloud className="h-3.5 w-3.5" />}
                      <span className="text-xs font-semibold">
                        {effectiveScope === 'local' ? t('scope.local') : t('scope.remote')}
                      </span>
                      <ChevronDown className="h-3 w-3 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[280px]">
                    <DropdownMenuItem
                      onClick={() => updateTab(tab.id, { dbExecScope: 'local' })}
                      disabled={!(conn?.availableScopes ?? [conn?.scope]).includes('local')}
                      className="flex-col items-start gap-0.5 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Zap className="h-3.5 w-3.5 text-amber-500" />
                        <span className="font-semibold">{t('scope.local')}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground pl-5.5">
                        {(conn?.availableScopes ?? [conn?.scope]).includes('local')
                          ? t('panel.scopeLocalAvail')
                          : t('panel.scopeLocalUnavail')}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => updateTab(tab.id, { dbExecScope: 'remote' })}
                      disabled={!(conn?.availableScopes ?? [conn?.scope]).includes('remote')}
                      className="flex-col items-start gap-0.5 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Cloud className="h-3.5 w-3.5 text-sky-500" />
                        <span className="font-semibold">{t('scope.remote')}</span>
                      </div>
                      <span className="text-[11px] text-muted-foreground pl-5.5">
                        {(conn?.availableScopes ?? [conn?.scope]).includes('remote')
                          ? t('panel.scopeRemoteAvail')
                          : t('panel.scopeRemoteUnavail')}
                      </span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs max-w-[240px]">
                  {t('panel.scopeTooltip')}
                </p>
              </TooltipContent>
            </Tooltip>
          )}

          {running ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="destructive" onClick={cancel} className="gap-1.5">
                  <Square className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('common:cancel')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">{t('panel.cancelTooltip')}</p></TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" disabled={!conn} onClick={runOnce} className="gap-1.5">
                  <Play className="h-3.5 w-3.5" />
                  <span className="text-xs">{t('panel.runQuery')}</span>
                  <span className="text-[10px] opacity-70 ml-0.5">⌘↵</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs max-w-[220px]">
                  {t('panel.runTooltip', {
                    target: conn?.name ?? t('panel.selectedConnection'),
                    via: effectiveScope === 'local' ? t('panel.viaLocal') : t('panel.viaTeam'),
                  })}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>
        </div>

        {/* Secondary row — editor-helper actions that don't need to live with
            the primary Run flow. Wraps below the connection picker so the
            top row stays readable on narrow windows. */}
        <div className="px-4 pb-3 flex items-center gap-1 flex-wrap">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!conn || !(tab.dbQuery ?? '').trim()}
                  onClick={handleBeautify}
                  className="gap-1.5 h-7 text-xs"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  <span>{t('panel.beautify')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs max-w-[220px]">
                  {t('panel.beautifyTooltip')}
                </p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setExamplesOpen(true)}
                  className="gap-1.5 h-7 text-xs"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>{t('panel.examples')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs max-w-[220px]">
                  {t('panel.examplesTooltip')}
                </p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!conn}
                  onClick={handleSave}
                  className="gap-1.5 h-7 text-xs"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{t('panel.saveQuery')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs max-w-[220px]">{t('panel.saveQueryTooltip')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <DBQueryParamsBar
        query={tab.dbQuery ?? ''}
        values={tab.dbParams ?? {}}
        onChange={(next) => updateTab(tab.id, { dbParams: next })}
      />

      <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="flex flex-col overflow-hidden" style={{ flex: `0 0 ${splitRatio}%` }}>
          <CodeEditor
            height="100%"
            language={monacoLang}
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={tab.dbQuery ?? ''}
            onChange={handleQueryChange}
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
              quickSuggestions: { other: true, comments: false, strings: false },
            }}
          />
        </div>

        <div
          className="h-1 cursor-row-resize bg-border hover:bg-primary/40 shrink-0"
          onMouseDown={onSplitDown}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          {tab.dbError ? (
            <div className="p-4 flex items-start gap-2 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <pre className="whitespace-pre-wrap font-mono">{tab.dbError}</pre>
            </div>
          ) : running ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('panel.running')} {(elapsedMs / 1000).toFixed(1)}s
              <Button size="sm" variant="ghost" className="ml-2 h-6 text-xs" onClick={cancel}>
                {t('common:cancel')}
              </Button>
            </div>
          ) : activeResult ? (
            <div className="h-full flex flex-col">
              {stmtResults && stmtResults.length > 1 && (
                <div className="flex items-center gap-1 px-2 py-1 border-b text-[11px] shrink-0 bg-muted/20">
                  <span className="text-muted-foreground mr-1">{t('panel.statements')}</span>
                  {stmtResults.map((r, i) => (
                    <Button
                      key={i}
                      size="sm"
                      variant="ghost"
                      onClick={() => updateTab(tab.id, { dbStmtIdx: i })}
                      className={cn(
                        'h-6 text-[11px] gap-1.5',
                        i === stmtIdx && 'bg-accent',
                      )}
                    >
                      <span className="font-mono">#{i + 1}</span>
                      <Badge variant="secondary" className="text-[9px]">
                        {r.rowCount === 1 ? t('units.rowsOne', { count: r.rowCount }) : t('units.rowsOther', { count: r.rowCount })}
                      </Badge>
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex-1 min-h-0">
                <DBResultPanel
                  result={activeResult}
                  onAddFilter={conn?.kind !== 'mongo' ? handleAddFilter : undefined}
                  onOpenFK={conn?.kind !== 'mongo' ? handleOpenFK : undefined}
                  onPageChange={conn?.kind !== 'mongo' ? handlePageChange : undefined}
                  rowLimit={tab.dbLimit ?? defaultRowLimit}
                />
              </div>
              {(tab.dbHistory?.length ?? 0) > 1 && (
                <RecentRunsStrip
                  history={tab.dbHistory ?? []}
                  current={activeResult}
                  onPick={(r) => updateTab(tab.id, { dbResult: r })}
                />
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              {conn
                ? t('panel.emptyRun')
                : t('panel.emptyPickConnection')}
            </div>
          )}
        </div>
      </div>

      <DBSaveQueryDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        defaultName={tab.name || t('panel.savedQueryDefault')}
        existingFolders={existingFolders}
        onSave={handleSaveSubmit}
        remoteAvailable={remoteAvailable}
        defaultScope={remoteAvailable ? 'remote' : 'local'}
      />
      <DBExamplesDialog
        open={examplesOpen}
        onOpenChange={setExamplesOpen}
        kind={conn?.kind}
        onInsert={(text) => updateTab(tab.id, { dbQuery: text })}
      />
    </div>
  );
}

function RecentRunsStrip({
  history, current, onPick,
}: {
  history: DBQueryResult[];
  current: DBQueryResult;
  onPick: (r: DBQueryResult) => void;
}) {
  const { t } = useTranslation('dbquery');
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-t text-[11px] shrink-0 bg-muted/10">
      <History className="h-3 w-3 text-muted-foreground" />
      <span className="text-muted-foreground mr-1">{t('panel.recentRuns')}</span>
      {history.map((r, i) => (
        <Button
          key={i}
          size="sm"
          variant="ghost"
          onClick={() => onPick(r)}
          className={cn(
            'h-6 text-[11px] gap-1.5',
            r === current && 'bg-accent',
          )}
        >
          <span className="font-mono">{i === 0 ? t('panel.now') : `−${i}`}</span>
          <Badge variant="secondary" className="text-[9px]">{r.rowCount}r · {r.execMs}ms</Badge>
        </Button>
      ))}
    </div>
  );
}

function kindToMonacoLang(k: DBKind | undefined): string {
  if (!k) return 'plaintext';
  if (k === 'mongo') return 'javascript';
  return 'sql';
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: string; message?: string };
  return e.name === 'CanceledError' || e.name === 'AbortError' || e.code === 'ERR_CANCELED';
}

function sqlLit(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}
