import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Database as DBIcon,
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Edit3,
  Copy,
  Trash2,
  Share2,
  Table2,
  FileCode2,
  MonitorSmartphone,
  Cloud,
  Search,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useDBConnectionStore, dualWrite, describePartialWrite } from '@/stores/dbConnectionStore';
import type { DBScope } from '@/services/api';
import { useToast } from '@/components/ui/use-toast';
import { useRequestStore } from '@/stores/requestStore';
import {
  useDBLocalSavedQueriesStore,
} from '@/stores/dbLocalSavedQueriesStore';
import { useDBRemoteSavedQueriesStore } from '@/stores/dbRemoteSavedQueriesStore';
import { dbConnectionAPI } from '@/services/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { DBConnection, DBKind, SavedDBQuery } from '@/types';
import { DB_KIND_LABEL } from '@/types';
import { DBConnectionDialog } from './DBConnectionDialog';
import { createSidebarDialogStore } from '@/stores/sidebarDialogStore';

const useDBConnectionSidebarUI = createSidebarDialogStore<DBConnection>();

// DBHeaderActions — Refresh + New in the shared panel header, replacing the in-body
// connections sub-header row.
export function DBHeaderActions() {
  const { t } = useTranslation('dbquery');
  const fetchConnections = useDBConnectionStore((s) => s.fetchConnections);
  const openAdd = useDBConnectionSidebarUI((s) => s.openAdd);
  const [busy, setBusy] = useState(false);
  // Reload the list, then re-introspect every connection whose tables are
  // already loaded, so new tables / collections show up too.
  const refresh = async () => {
    setBusy(true);
    try {
      await fetchConnections();
      const { schemas, connections, loadSchema } = useDBConnectionStore.getState();
      const live = new Set(connections.map((c) => c.id));
      await Promise.allSettled(Object.keys(schemas).filter((id) => live.has(id)).map((id) => loadSchema(id, true)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-0.5">
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={refresh} disabled={busy} title={t('common:refresh')}>
        <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={openAdd} title={t('sidebar.newConnection')}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
import { DBShareDialog } from './DBShareDialog';

// DBSidebar renders the new sidebar tab content: a list of connections
// (grouped by kind) plus saved queries per connection. Clicking a
// connection opens a new DB tab with that connection preselected;
// clicking a saved query opens the tab with that query text seeded.
export function DBSidebar() {
  const { t } = useTranslation('dbquery');
  const { connections, schemas, fetchConnections, loadSchema, removeLocal, setAllowWrite } = useDBConnectionStore();
  const { toast } = useToast();
  const addTab = useRequestStore((s) => s.addTab);
  const localQueries = useDBLocalSavedQueriesStore((s) => s.queries);
  const removeLocalSaved = useDBLocalSavedQueriesStore((s) => s.remove);
  const savedByConn = useDBRemoteSavedQueriesStore((s) => s.byConn);
  const loadRemoteSaved = useDBRemoteSavedQueriesStore((s) => s.load);
  const removeRemoteSaved = useDBRemoteSavedQueriesStore((s) => s.remove);

  const dialogOpen = useDBConnectionSidebarUI((s) => s.dialogOpen);
  const editing = useDBConnectionSidebarUI((s) => s.editing);
  const template = useDBConnectionSidebarUI((s) => s.template);
  const openEdit = useDBConnectionSidebarUI((s) => s.openEdit);
  const openCopy = useDBConnectionSidebarUI((s) => s.openCopy);
  const openAdd = useDBConnectionSidebarUI((s) => s.openAdd);
  const setDialogOpen = useDBConnectionSidebarUI((s) => s.setDialogOpen);
  const [confirmDelete, setConfirmDelete] = useState<DBConnection | null>(null);
  const [sharing, setSharing] = useState<DBConnection | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Per-connection sub-group collapse state: tables and saved queries
  // are independently toggleable so a noisy schema doesn't bury the
  // saved-query list.
  const [tablesOpen, setTablesOpen] = useState<Record<string, boolean>>({});
  const [savedOpen, setSavedOpen] = useState<Record<string, boolean>>({});
  const [schemaLoading, setSchemaLoading] = useState<Record<string, boolean>>({});
  // Per-table column-list collapse, keyed by `${connId}::${schema}.${name}`.
  const [tableOpen, setTableOpen] = useState<Record<string, boolean>>({});
  // Per-database collapse — keyed by `${connId}::${dbName}`. Default open
  // the first time the sidebar sees a DB so the user gets an
  // out-of-the-box overview.
  const [dbGroupOpen, setDbGroupOpen] = useState<Record<string, boolean>>({});
  // Per-connection table/collection name filter and per-table column/field
  // filter — keyed by conn.id and tKey respectively. Cheap inline `.filter`,
  // the input shown only once a connection/table crosses ~8 entries.
  const [tableFilter, setTableFilter] = useState<Record<string, string>>({});
  const [columnFilter, setColumnFilter] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    // Dual-write delete: remove the connection from EVERY backend it
    // currently lives on so a stale row doesn't linger in the local
    // sidecar after a remote-only delete (or vice versa). Honors the
    // dual-write rule used by all connection stores.
    const scopes: DBScope[] = confirmDelete.availableScopes && confirmDelete.availableScopes.length > 0
      ? (confirmDelete.availableScopes as DBScope[])
      : [confirmDelete.scope ?? 'remote'];
    await dualWrite((s) => dbConnectionAPI.delete(confirmDelete.id, s), scopes);
    removeLocal(confirmDelete.id);
    setConfirmDelete(null);
  }, [confirmDelete, removeLocal]);

  // Flip the connection's read-write master switch (⋯ menu). Dual-writes
  // through the store to every backend the connection lives on and surfaces
  // a partial-write toast if only some backends accepted the change.
  const toggleAllowWrite = useCallback(async (conn: DBConnection) => {
    const next = !conn.allowWrite;
    const writeScopes: DBScope[] = conn.availableScopes && conn.availableScopes.length > 0
      ? (conn.availableScopes as DBScope[])
      : [conn.scope ?? 'remote'];
    const results = await setAllowWrite(conn.id, next);
    const okScopes = results.filter((r) => r.ok).map((r) => r.scope);
    if (okScopes.length === 0) {
      toast({
        title: t('sidebar.toastModeFailTitle'),
        description: t('sidebar.toastModeFailDesc'),
        variant: 'destructive',
      });
      return;
    }
    const partial = describePartialWrite(results, writeScopes, next ? t('sidebar.enabledRw') : t('sidebar.setReadonly'));
    if (partial) toast(partial);
  }, [setAllowWrite, toast, t]);

  const openTabFor = useCallback(
    (connectionId: string, kind: DBKind, name: string, seedQuery?: string) => {
      addTab(
        {
          type: 'db',
          name: `${kind.toUpperCase()} · ${name}`,
          dbConnectionId: connectionId,
          dbQuery: seedQuery ?? '',
          method: 'GET',
          url: '',
        },
        true,
      );
    },
    [addTab],
  );

  const toggleExpand = useCallback(async (conn: DBConnection) => {
    const next = !expanded[conn.id];
    setExpanded((m) => ({ ...m, [conn.id]: next }));
    if (next) {
      setTablesOpen((m) => (conn.id in m ? m : { ...m, [conn.id]: true }));
      setSavedOpen((m) => (conn.id in m ? m : { ...m, [conn.id]: true }));
      // Saved queries — cache miss triggers a fetch on the connection's BE.
      loadRemoteSaved(conn.id, conn.scope);
      if (!schemas[conn.id]) {
        setSchemaLoading((m) => ({ ...m, [conn.id]: true }));
        try {
          await loadSchema(conn.id);
        } finally {
          setSchemaLoading((m) => ({ ...m, [conn.id]: false }));
        }
      }
    }
  }, [expanded, schemas, loadSchema, loadRemoteSaved]);

  const refreshSchema = useCallback(async (conn: DBConnection) => {
    setSchemaLoading((m) => ({ ...m, [conn.id]: true }));
    try {
      await loadSchema(conn.id, true);
    } finally {
      setSchemaLoading((m) => ({ ...m, [conn.id]: false }));
    }
  }, [loadSchema]);

  const openTableQuery = useCallback((conn: DBConnection, table: { schema?: string; name: string }) => {
    const seed = buildTableSeedQuery(conn.kind, table);
    openTabFor(conn.id, conn.kind, table.name, seed);
  }, [openTabFor]);

  const grouped = groupByKind(connections);

  return (
    <>
      <div className="p-2 space-y-3">
        {connections.length === 0 ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center gap-1 px-4 text-center">
            <DBIcon className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground">{t('sidebar.noConnections')}</p>
            <Button size="sm" className="mt-2 h-7 text-xs" onClick={openAdd}>
              {t('sidebar.addFirst')}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {grouped.map(({ kind, items }) => (
              <div key={kind}>
                <div className="text-[10px] font-semibold uppercase text-muted-foreground/70 px-2 mb-1">
                  {kindLabel(kind)}
                </div>
                <div className="space-y-0.5">
                  {items.map((conn) => {
                    // Owner OR a 'write' co-owner may manage the connection
                    // (edit / share / delete / toggle read-write). A 'read'
                    // grantee sees none of these — matching the BE gate.
                    const canManage = !conn.shared || conn.grantRole === 'write';
                    return (
                    <div key={conn.id}>
                      <div className="group flex items-center rounded hover:bg-accent/40 transition-colors">
                        <button
                          type="button"
                          onClick={() => toggleExpand(conn)}
                          className="shrink-0 p-1 cursor-pointer"
                          title={t('sidebar.savedQueries')}
                        >
                          {expanded[conn.id]
                            ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => openTabFor(conn.id, conn.kind, conn.name)}
                          className="flex-1 min-w-0 flex items-center gap-1.5 px-1 py-1 text-left"
                          title={connectionScopeTooltip(conn, t)}
                        >
                          <DBIcon className={cn('h-3.5 w-3.5 shrink-0', conn.shared ? 'text-green-500' : 'text-primary')} />
                          <span className="text-sm truncate">{conn.name}</span>
                          {/* Permission badge — R (read-only) vs R+W
                              (read-write enabled). Amber-tinted for R+W so a
                              connection that can run writes stands out. */}
                          <span
                            title={conn.allowWrite
                              ? t('sidebar.rwTitle')
                              : t('sidebar.readonlyTitle')}
                            className={cn(
                              'shrink-0 rounded px-1 text-[8px] font-bold leading-[1.4] border cursor-default',
                              conn.allowWrite
                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40'
                                : 'bg-muted text-muted-foreground/60 border-transparent',
                            )}
                          >
                            {conn.allowWrite ? t('badges.rw') : t('badges.r')}
                          </span>
                          {/* Scope badges — both icons when the connection
                              is dual-written, the missing one greyed-out
                              when only one BE accepted the write. */}
                          <span className="flex items-center gap-0.5 shrink-0">
                            <MonitorSmartphone
                              className={cn(
                                'h-2.5 w-2.5',
                                (conn.availableScopes ?? [conn.scope]).includes('local')
                                  ? 'text-emerald-500/80'
                                  : 'text-muted-foreground/30',
                              )}
                            />
                            <Cloud
                              className={cn(
                                'h-2.5 w-2.5',
                                (conn.availableScopes ?? [conn.scope]).includes('remote')
                                  ? 'text-sky-500/80'
                                  : 'text-muted-foreground/30',
                              )}
                            />
                          </span>
                          {conn.shared && (
                            <span className="text-[9px] text-muted-foreground/70 ml-auto">
                              {conn.grantRole === 'write' ? t('role.coowner') : t('role.readonly')}
                            </span>
                          )}
                        </button>
                        {canManage && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => openEdit(conn)}>
                                <Edit3 className="h-3.5 w-3.5 mr-2" />
                                {t('common:edit')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openCopy(conn)}>
                                <Copy className="h-3.5 w-3.5 mr-2" />
                                {t('sidebar.duplicate')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setSharing(conn)}>
                                <Share2 className="h-3.5 w-3.5 mr-2" />
                                {t('sidebar.share')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {/* Read-write master switch. Checkbox semantics;
                                  keep the menu open on toggle. Owner/co-owner
                                  only (this whole menu is canManage-gated). */}
                              <DropdownMenuCheckboxItem
                                checked={!!conn.allowWrite}
                                onCheckedChange={() => toggleAllowWrite(conn)}
                                onSelect={(e) => e.preventDefault()}
                              >
                                {t('sidebar.rwMode')}
                              </DropdownMenuCheckboxItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setConfirmDelete(conn)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                {t('common:delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                      {expanded[conn.id] && (
                        <div className="pl-5 py-0.5 space-y-1">
                          {/* Tables */}
                          <div>
                            <div className="group/sub flex items-center gap-1 px-1.5 py-0.5">
                              <button
                                type="button"
                                onClick={() => setTablesOpen((m) => ({ ...m, [conn.id]: !m[conn.id] }))}
                                className="flex items-center gap-1 flex-1 min-w-0 text-left cursor-pointer"
                              >
                                {tablesOpen[conn.id]
                                  ? <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
                                  : <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />}
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  {conn.kind === 'mongo' ? t('sidebar.collections') : t('sidebar.tables')}
                                </span>
                                <span className="text-[9px] text-muted-foreground/70">
                                  {schemas[conn.id]?.tables.length ?? ''}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); refreshSchema(conn); }}
                                className="opacity-0 group-hover/sub:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                                title={t('sidebar.refreshSchema')}
                              >
                                <RefreshCw className={cn('h-2.5 w-2.5', schemaLoading[conn.id] && 'animate-spin')} />
                              </button>
                            </div>
                            {tablesOpen[conn.id] && (() => {
                              const allTables = schemas[conn.id]?.tables ?? [];
                              const tableFilterQ = (tableFilter[conn.id] ?? '').trim().toLowerCase();
                              // Filter by table name OR schema BEFORE grouping so
                              // the DB group headers + counts reflect the filter.
                              const filteredTables = tableFilterQ
                                ? allTables.filter((t) =>
                                    t.name.toLowerCase().includes(tableFilterQ) ||
                                    (t.schema ?? '').toLowerCase().includes(tableFilterQ))
                                : allTables;
                              const groups = groupTablesByDB(filteredTables);
                              return (
                              <div className="pl-3">
                                {(allTables.length > 8 || !!tableFilterQ) && (
                                  <div className="relative px-1 py-0.5">
                                    <Search className="pointer-events-none absolute left-2 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-muted-foreground/60" />
                                    <input
                                      type="text"
                                      value={tableFilter[conn.id] ?? ''}
                                      onChange={(e) => setTableFilter((m) => ({ ...m, [conn.id]: e.target.value }))}
                                      placeholder={conn.kind === 'mongo' ? t('sidebar.filterCollections') : t('sidebar.filterTables')}
                                      className="h-6 w-full rounded border border-input bg-transparent pl-6 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    />
                                  </div>
                                )}
                                {schemaLoading[conn.id] && !schemas[conn.id] ? (
                                  <p className="text-[10px] italic text-muted-foreground px-2 py-0.5">{t('common:loading')}</p>
                                ) : allTables.length === 0 ? (
                                  <p className="text-[10px] italic text-muted-foreground px-2 py-0.5">
                                    {schemas[conn.id] ? t('sidebar.emptySchema') : t('sidebar.expandToLoad')}
                                  </p>
                                ) : filteredTables.length === 0 ? (
                                  <p className="text-[10px] italic text-muted-foreground px-2 py-0.5">
                                    {conn.kind === 'mongo' ? t('sidebar.noMatchCollections') : t('sidebar.noMatchTables')}
                                  </p>
                                ) : (
                                  groups.flatMap((group) => {
                                    // Mongo: always show the DB header so the user sees the
                                    // DB → collection hierarchy explicitly, even if only one
                                    // DB is in scope. SQL: only group when multiple distinct
                                    // schemas show up (the common single-`public` case stays flat).
                                    const showHeader =
                                      group.db !== '' &&
                                      (conn.kind === 'mongo' || groups.length > 1);
                                    const gKey = `${conn.id}::${group.db}`;
                                    // While filtering, force groups open so matches
                                    // inside a collapsed DB group still surface.
                                    const groupOpen = showHeader ? (tableFilterQ ? true : (dbGroupOpen[gKey] !== false)) : true;
                                    const header = showHeader ? (
                                      <button
                                        key={gKey + '__h'}
                                        type="button"
                                        onClick={() => setDbGroupOpen((m) => ({ ...m, [gKey]: m[gKey] === false ? true : false }))}
                                        className="w-full flex items-center gap-1 px-1 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                                      >
                                        {groupOpen
                                          ? <ChevronDown className="h-2.5 w-2.5" />
                                          : <ChevronRight className="h-2.5 w-2.5" />}
                                        <DBIcon className="h-2.5 w-2.5" />
                                        <span className="truncate">{group.db}</span>
                                        <span className="ml-auto text-muted-foreground/60 normal-case">
                                          {group.tables.length}
                                        </span>
                                      </button>
                                    ) : null;
                                    const rows = !groupOpen
                                      ? []
                                      : group.tables.map((tbl) => {
                                          const label = tbl.schema && tbl.schema !== 'public' ? `${tbl.schema}.${tbl.name}` : tbl.name;
                                          const showInLabel = !showHeader;
                                          const display = showInLabel ? label : tbl.name;
                                          const tKey = `${conn.id}::${tbl.schema ?? ''}.${tbl.name}`;
                                          const open = tableOpen[tKey];
                                          // BE serializes nil slices as JSON null — Mongo collections
                                          // we couldn't sample (Find error, insufficient privs) ship
                                          // with `columns: null`. Coerce to [] so .length / .map
                                          // don't crash the whole sidebar.
                                          const cols = tbl.columns ?? [];
                                          return (
                                            <div key={tKey} className={showHeader ? 'pl-3' : ''}>
                                              <div className="flex items-center rounded hover:bg-accent/40">
                                                <button
                                                  type="button"
                                                  onClick={() => setTableOpen((m) => ({ ...m, [tKey]: !m[tKey] }))}
                                                  className="shrink-0 p-0.5 cursor-pointer text-muted-foreground"
                                                  title={open ? t('sidebar.hideColumns') : t('sidebar.showColumns')}
                                                >
                                                  {open
                                                    ? <ChevronDown className="h-2.5 w-2.5" />
                                                    : <ChevronRight className="h-2.5 w-2.5" />}
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => openTableQuery(conn, tbl)}
                                                  className="flex-1 min-w-0 flex items-center gap-1 px-1 py-0.5 text-xs text-left text-muted-foreground hover:text-foreground"
                                                  title={`${label} (${conn.kind === 'mongo'
                                                    ? (cols.length === 1 ? t('units.fieldsOne', { count: cols.length }) : t('units.fieldsOther', { count: cols.length }))
                                                    : (cols.length === 1 ? t('units.colsOne', { count: cols.length }) : t('units.colsOther', { count: cols.length }))})`}
                                                >
                                                  <Table2 className="h-2.5 w-2.5 shrink-0" />
                                                  <span className="truncate">{display}</span>
                                                  <span className="text-[9px] text-muted-foreground/70 ml-auto shrink-0">
                                                    {cols.length}
                                                  </span>
                                                </button>
                                              </div>
                                              {open && (() => {
                                                const colFilterQ = (columnFilter[tKey] ?? '').trim().toLowerCase();
                                                // Match on column/field name OR its type.
                                                const filteredCols = colFilterQ
                                                  ? cols.filter((c) =>
                                                      c.name.toLowerCase().includes(colFilterQ) ||
                                                      c.type.toLowerCase().includes(colFilterQ))
                                                  : cols;
                                                return (
                                                <div className="pl-5">
                                                  {(cols.length > 8 || !!colFilterQ) && (
                                                    <div className="relative px-1 py-0.5">
                                                      <Search className="pointer-events-none absolute left-2 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-muted-foreground/60" />
                                                      <input
                                                        type="text"
                                                        value={columnFilter[tKey] ?? ''}
                                                        onChange={(e) => setColumnFilter((m) => ({ ...m, [tKey]: e.target.value }))}
                                                        placeholder={conn.kind === 'mongo' ? t('sidebar.filterFields') : t('sidebar.filterColumns')}
                                                        className="h-6 w-full rounded border border-input bg-transparent pl-6 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                      />
                                                    </div>
                                                  )}
                                                  {cols.length === 0 ? (
                                                    <p className="text-[10px] italic text-muted-foreground px-2 py-0.5">
                                                      {t('sidebar.noColumns')}
                                                    </p>
                                                  ) : filteredCols.length === 0 ? (
                                                    <p className="text-[10px] italic text-muted-foreground px-2 py-0.5">
                                                      {t('sidebar.noMatchColumns')}
                                                    </p>
                                                  ) : (
                                                    filteredCols.map((c) => (
                                                      <div
                                                        key={`${tKey}::${c.name}`}
                                                        className="flex items-center gap-1.5 px-2 py-px text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-accent/30 rounded"
                                                        title={`${c.name} · ${c.type || t('sidebar.unknownType')}`}
                                                      >
                                                        <span className="truncate flex-1">{c.name}</span>
                                                        <span className="text-[9px] text-muted-foreground/60 shrink-0 truncate max-w-[90px]">
                                                          {c.type || (conn.kind === 'mongo' ? t('sidebar.fieldType') : '?')}
                                                        </span>
                                                      </div>
                                                    ))
                                                  )}
                                                </div>
                                                );
                                              })()}
                                            </div>
                                          );
                                        });
                                    return header ? [header, ...rows] : rows;
                                  })
                                )}
                              </div>
                              );
                            })()}
                          </div>
                          {/* Saved queries */}
                          <div>
                            <button
                              type="button"
                              onClick={() => setSavedOpen((m) => ({ ...m, [conn.id]: !m[conn.id] }))}
                              className="w-full flex items-center gap-1 px-1.5 py-0.5 text-left cursor-pointer"
                            >
                              {savedOpen[conn.id]
                                ? <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
                                : <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />}
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {t('sidebar.savedQueries')}
                              </span>
                              <span className="text-[9px] text-muted-foreground/70">
                                {mergedSavedQueries(savedByConn[conn.id] ?? [], localQueries, conn.id).length || ''}
                              </span>
                            </button>
                            {savedOpen[conn.id] && (
                              <div className="pl-3">
                                {mergedSavedQueries(savedByConn[conn.id] ?? [], localQueries, conn.id).length === 0 ? (
                                  <p className="text-[10px] italic text-muted-foreground px-2 py-0.5">
                                    {t('sidebar.noSavedQueries')}
                                  </p>
                                ) : (
                                  renderGroupedSavedQueries(
                                    mergedSavedQueries(savedByConn[conn.id] ?? [], localQueries, conn.id),
                                    conn,
                                    openTabFor,
                                    async (q) => {
                                      if (q.kind === 'local') {
                                        removeLocalSaved(q.id);
                                      } else {
                                        await removeRemoteSaved(conn.id, q.id, conn.scope);
                                      }
                                    },
                                    t,
                                  )
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <DBConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        template={template}
        onSaved={() => fetchConnections()}
      />
      {sharing && (
        <DBShareDialog
          open={!!sharing}
          onOpenChange={(o) => { if (!o) setSharing(null); }}
          connection={sharing}
        />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.deleteTitle', { name: confirmDelete?.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sidebar.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t('common:delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function groupByKind(conns: DBConnection[]): { kind: DBKind; items: DBConnection[] }[] {
  const order: DBKind[] = [
    'postgres', 'cockroachdb', 'yugabytedb', 'redshift',
    'mysql', 'mariadb', 'tidb', 'sqlserver', 'mongo',
  ];
  const map = new Map<DBKind, DBConnection[]>();
  conns.forEach((c) => {
    if (!map.has(c.kind)) map.set(c.kind, []);
    map.get(c.kind)!.push(c);
  });
  // Emit known kinds in a stable order, then any kind not in `order` — so a
  // newly-added engine is never silently dropped from the sidebar (the bug
  // that hid SQL Server and every wire-compatible variant before 1.35.1).
  const seen = new Set(order);
  const tail = [...map.keys()].filter((k) => !seen.has(k));
  return [...order, ...tail]
    .filter((k) => map.has(k))
    .map((k) => ({ kind: k, items: map.get(k)! }));
}

function kindLabel(k: DBKind): string {
  return DB_KIND_LABEL[k] ?? k;
}

interface MergedSavedQuery {
  id: string;
  name: string;
  queryText: string;
  folder: string;
  tags: string;
  kind: 'local' | 'remote';
}

function mergedSavedQueries(
  remote: SavedDBQuery[],
  local: { id: string; connectionId: string; name: string; queryText: string; folder: string; tags: string }[],
  connectionId: string,
): MergedSavedQuery[] {
  const out: MergedSavedQuery[] = [];
  for (const r of remote) {
    out.push({
      id: r.id,
      name: r.name,
      queryText: r.queryText,
      folder: r.folder ?? '',
      tags: r.tags ?? '',
      kind: 'remote',
    });
  }
  for (const l of local) {
    if (l.connectionId !== connectionId) continue;
    out.push({
      id: l.id,
      name: l.name,
      queryText: l.queryText,
      folder: l.folder ?? '',
      tags: l.tags ?? '',
      kind: 'local',
    });
  }
  return out;
}

function renderGroupedSavedQueries(
  queries: MergedSavedQuery[],
  conn: DBConnection,
  openTabFor: (id: string, kind: DBKind, name: string, seed?: string) => void,
  onDelete: (q: MergedSavedQuery) => void,
  t: TFunction,
) {
  const grouped = new Map<string, MergedSavedQuery[]>();
  for (const q of queries) {
    const key = q.folder.trim() || '__root__';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(q);
  }
  const folders = [...grouped.keys()].sort((a, b) => {
    if (a === '__root__') return -1;
    if (b === '__root__') return 1;
    return a.localeCompare(b);
  });
  return folders.map((folder) => {
    const items = grouped.get(folder)!;
    const showHeader = folder !== '__root__';
    return (
      <div key={folder}>
        {showHeader && (
          <div className="px-2 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/70">
            {folder}
          </div>
        )}
        {items.map((q) => {
          const tags = q.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
          return (
            <ContextMenu key={q.id}>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  onClick={() => openTabFor(conn.id, conn.kind, q.name, q.queryText)}
                  className="w-full flex items-center gap-1 px-2 py-0.5 text-xs text-left hover:bg-accent/40 rounded text-muted-foreground hover:text-foreground"
                >
                  <FileCode2 className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{q.name}</span>
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="ml-auto shrink-0 inline-flex">
                          {q.kind === 'local' ? (
                            <MonitorSmartphone className="h-2.5 w-2.5 text-emerald-500/80" />
                          ) : (
                            <Cloud className="h-2.5 w-2.5 text-sky-500/80" />
                          )}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p className="text-xs">
                          {q.kind === 'local'
                            ? t('sidebar.savedLocalTip')
                            : t('sidebar.savedRemoteTip')}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {tags.length > 0 && (
                    <span className="flex gap-0.5 shrink-0">
                      {tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="text-[9px] px-1 rounded bg-accent/60 text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onClick={() => navigator.clipboard.writeText(q.queryText).catch(() => {/* ignore */})}
                >
                  {t('sidebar.copyQueryText')}
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(q)}
                >
                  <Trash2 className="h-3 w-3 mr-2" /> {t('common:delete')} {q.kind === 'local' ? t('sidebar.localSuffix') : ''}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    );
  });
}

// groupTablesByDB groups schema tables by their DB / schema field — used
// to render multi-DB Mongo connections as a tree. SQL kinds keep the
// existing `schema.table` flat layout when only one schema (or 'public')
// is present, but get the same grouping when several distinct schemas
// show up (e.g. a Postgres DB with both `public` and `analytics`).
function connectionScopeTooltip(conn: DBConnection, t: TFunction): string {
  const avail = conn.availableScopes ?? (conn.scope ? [conn.scope] : []);
  const has = (s: 'local' | 'remote') => avail.includes(s);
  const parts: string[] = [];
  if (has('local') && has('remote')) {
    parts.push(t('sidebar.scopeBoth'));
  } else if (has('local')) {
    parts.push(t('sidebar.scopeLocalOnly'));
  } else if (has('remote')) {
    parts.push(t('sidebar.scopeRemoteOnly'));
  }
  const primary = conn.scope === 'local' ? t('sidebar.runnerThisDevice') : t('sidebar.runnerServer');
  parts.push(t('sidebar.defaultRunner', { target: primary }));
  if (conn.shared) parts.push(conn.grantRole === 'write' ? t('sidebar.sharedCoowner') : t('sidebar.sharedReadonly'));
  parts.push(conn.allowWrite ? t('sidebar.rwModeOn') : t('sidebar.roModeOff'));
  return parts.join(' ');
}

function groupTablesByDB<T extends { schema?: string; name: string }>(tables: T[]): { db: string; tables: T[] }[] {
  if (tables.length === 0) return [];
  const map = new Map<string, T[]>();
  for (const t of tables) {
    const key = (t.schema ?? '').trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return [...map.entries()]
    .map(([db, ts]) => ({ db, tables: ts }))
    .sort((a, b) => (a.db === '' ? -1 : b.db === '' ? 1 : a.db.localeCompare(b.db)));
}

function buildTableSeedQuery(kind: DBKind, t: { schema?: string; name: string }): string {
  if (kind === 'mongo') {
    // When the introspect placed the collection under a DB (schema),
    // address it via getSiblingDB so the query is portable even if the
    // connection's default DB changes later.
    if (t.schema) {
      return `db.getSiblingDB('${t.schema}').${t.name}.find().limit(100)`;
    }
    return `db.${t.name}.find().limit(100)`;
  }
  if (kind === 'sqlserver') {
    // T-SQL has no LIMIT — it uses TOP, before the column list.
    const qualified = t.schema ? `"${t.schema}"."${t.name}"` : `"${t.name}"`;
    return `SELECT TOP 100 * FROM ${qualified};`;
  }
  const family = kind === 'mysql' || kind === 'mariadb' || kind === 'tidb' ? 'mysql' : 'postgres';
  if (family === 'mysql') {
    const qualified = t.schema ? `\`${t.schema}\`.\`${t.name}\`` : `\`${t.name}\``;
    return `SELECT * FROM ${qualified} LIMIT 100;`;
  }
  // postgres family — qualify with schema unless it's the default `public`
  const qualified = t.schema && t.schema !== 'public'
    ? `"${t.schema}"."${t.name}"`
    : `"${t.name}"`;
  return `SELECT * FROM ${qualified} LIMIT 100;`;
}
