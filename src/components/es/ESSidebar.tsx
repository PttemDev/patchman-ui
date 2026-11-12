import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  Plus,
  RefreshCw,
  MoreHorizontal,
  Edit3,
  Trash2,
  Share2,
  MonitorSmartphone,
  Cloud,
  ChevronRight,
  ChevronDown,
  Loader2,
  Tags,
} from 'lucide-react';
import {
  DropdownMenu,
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
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useESConnectionStore, scopeForEs } from '@/stores/esConnectionStore';
import { dualWrite } from '@/stores/dbConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import { esConnectionAPI, esAPI, type DBScope } from '@/services/api';
import { cn } from '@/lib/utils';
import type { ESConnection, IndexRow, AliasRow } from '@/types';
import { groupAliases, healthDot, formatCount, type AliasGroup } from './esRow';
import { ESConnectionDialog } from './ESConnectionDialog';
import { createSidebarDialogStore } from '@/stores/sidebarDialogStore';

const useESConnectionSidebarUI = createSidebarDialogStore<ESConnection>();

// ESHeaderActions — Refresh + New in the shared panel header, replacing the in-body
// connections sub-header row.
export function ESHeaderActions() {
  const { t } = useTranslation('es');
  const fetchConnections = useESConnectionStore((s) => s.fetchConnections);
  const openAdd = useESConnectionSidebarUI((s) => s.openAdd);
  return (
    <div className="flex items-center gap-0.5">
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => fetchConnections()} title={t('common:refresh')}>
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={openAdd} title={t('sidebar.newConnection')}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
import { ESShareDialog } from './ESShareDialog';

// ESSidebar mirrors RedisSidebar: a list of Elasticsearch connections.
// Clicking a connection opens a Kibana-style console tab (type 'es'); the
// 3-dot menu exposes edit / share / delete. New / Refresh live in the header.
// The console itself (query editor + result viewer) is the tab panel, not the
// sidebar tree.
export function ESSidebar() {
  const { t } = useTranslation('es');
  const { connections, loading, loaded, fetchConnections, removeLocal } = useESConnectionStore();
  const addTab = useRequestStore((s) => s.addTab);

  const dialogOpen = useESConnectionSidebarUI((s) => s.dialogOpen);
  const editing = useESConnectionSidebarUI((s) => s.editing);
  const openEdit = useESConnectionSidebarUI((s) => s.openEdit);
  const openAdd = useESConnectionSidebarUI((s) => s.openAdd);
  const setDialogOpen = useESConnectionSidebarUI((s) => s.setDialogOpen);
  const [sharing, setSharing] = useState<ESConnection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ESConnection | null>(null);

  // Expandable index/alias tree per connection (like the DB sidebar's table
  // tree): lazy-loaded via _cat/indices + _cat/aliases on first expand. Each
  // connection carries its own filter + section-open state (several can be
  // expanded at once, so a single shared value would be a bug).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [indicesByConn, setIndicesByConn] = useState<Record<string, IndexRow[]>>({});
  const [aliasesByConn, setAliasesByConn] = useState<Record<string, AliasGroup[]>>({});
  const [loadingIdx, setLoadingIdx] = useState<Record<string, boolean>>({});
  const [filterByConn, setFilterByConn] = useState<Record<string, string>>({});
  const [closedIdx, setClosedIdx] = useState<Record<string, boolean>>({});
  const [closedAlias, setClosedAlias] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const loadTree = useCallback(async (conn: ESConnection) => {
    setLoadingIdx((m) => ({ ...m, [conn.id]: true }));
    const scope = scopeForEs(connections, conn.id);
    try {
      // Aliases 404 on backends older than 1.36.0 (settled-rejected → []); the
      // Indexes list still renders. Load both so neither blocks the other.
      const [ir, ar] = await Promise.allSettled([
        esAPI.indices(conn.id, scope),
        esAPI.aliases(conn.id, scope),
      ]);
      const idx = ir.status === 'fulfilled'
        ? ((ir.value.data as IndexRow[]) ?? []).slice().sort((a, b) => a.index.localeCompare(b.index))
        : [];
      const ali = ar.status === 'fulfilled'
        ? groupAliases((ar.value.data as AliasRow[]) ?? [])
        : [];
      setIndicesByConn((m) => ({ ...m, [conn.id]: idx }));
      setAliasesByConn((m) => ({ ...m, [conn.id]: ali }));
    } catch {
      setIndicesByConn((m) => ({ ...m, [conn.id]: m[conn.id] ?? [] }));
      setAliasesByConn((m) => ({ ...m, [conn.id]: m[conn.id] ?? [] }));
    } finally {
      setLoadingIdx((m) => ({ ...m, [conn.id]: false }));
    }
  }, [connections]);

  const toggleExpand = useCallback((conn: ESConnection) => {
    const next = !expanded[conn.id];
    setExpanded((m) => ({ ...m, [conn.id]: next }));
    if (next && (indicesByConn[conn.id] === undefined || aliasesByConn[conn.id] === undefined)) {
      void loadTree(conn);
    }
  }, [expanded, indicesByConn, aliasesByConn, loadTree]);

  const openIndexTab = useCallback((conn: ESConnection, index: string) => {
    const q = `GET ${index}/_search\n{\n  "query": {\n    "match_all": {}\n  },\n  "size": 20\n}`;
    addTab({
      type: 'es',
      name: `ES · ${index}`,
      method: 'GET',
      url: '',
      esConnectionId: conn.id,
      esIndex: index,
      esQuery: q,
    }, true);
  }, [addTab]);

  const openConnTab = useCallback((conn: ESConnection) => {
    addTab({
      type: 'es',
      name: `ES · ${conn.name}`,
      method: 'GET',
      url: '',
      esConnectionId: conn.id,
    }, true);
  }, [addTab]);

  const handleDeleteConnection = useCallback(async () => {
    if (!confirmDelete) return;
    const scopes: DBScope[] = confirmDelete.availableScopes && confirmDelete.availableScopes.length > 0
      ? (confirmDelete.availableScopes as DBScope[])
      : [confirmDelete.scope ?? 'remote'];
    await dualWrite((s) => esConnectionAPI.delete(confirmDelete.id, s), scopes);
    removeLocal(confirmDelete.id);
    setConfirmDelete(null);
  }, [confirmDelete, removeLocal]);

  return (
    <>
      <div className="p-2 space-y-3">
        {connections.length === 0 && (loading || !loaded) ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center gap-1 px-4 text-center">
            <Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground/60 mb-2" />
            <p className="text-xs text-muted-foreground">{t('sidebar.loading')}</p>
          </div>
        ) : connections.length === 0 ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center gap-1 px-4 text-center">
            <Search className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground">{t('sidebar.empty')}</p>
            <Button size="sm" className="mt-2 h-7 text-xs" onClick={openAdd}>
              {t('sidebar.addFirst')}
            </Button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {connections.map((conn) => (
              <div key={conn.id}>
              <div className="group flex items-center rounded hover:bg-accent/40 transition-colors">
                <button
                  type="button"
                  onClick={() => toggleExpand(conn)}
                  className="p-1 shrink-0 text-muted-foreground hover:text-foreground"
                  title={t('sidebar.showIndices')}
                >
                  {expanded[conn.id] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
                <button
                  type="button"
                  onClick={() => openConnTab(conn)}
                  className="flex-1 min-w-0 flex items-center gap-1.5 px-1 py-1 text-left"
                  title={conn.nodes || conn.cloudId}
                >
                  <Search className={cn('h-3.5 w-3.5 shrink-0', conn.shared ? 'text-green-500' : 'text-yellow-500')} />
                  <span className="text-sm truncate">{conn.name}</span>
                  <Badge variant="secondary" className="text-[8px] px-1 py-0 shrink-0">{conn.flavor}</Badge>
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
                      {conn.grantRole === 'write' ? t('roles.write') : t('roles.readOnly')}
                    </span>
                  )}
                </button>
                {!conn.shared && (
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
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => openEdit(conn)}>
                        <Edit3 className="h-3.5 w-3.5 mr-2" /> {t('common:edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSharing(conn)}>
                        <Share2 className="h-3.5 w-3.5 mr-2" /> {t('sidebar.share')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setConfirmDelete(conn)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> {t('common:delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {expanded[conn.id] && (() => {
                const q = (filterByConn[conn.id] ?? '').trim().toLowerCase();
                const allIdx = indicesByConn[conn.id] ?? [];
                const allAlias = aliasesByConn[conn.id] ?? [];
                const idx = q ? allIdx.filter((ix) => ix.index.toLowerCase().includes(q)) : allIdx;
                const alias = q
                  ? allAlias.filter((a) => a.alias.toLowerCase().includes(q) || a.indices.some((i) => i.toLowerCase().includes(q)))
                  : allAlias;
                return (
                  <div className="ml-3 border-l border-border/60 pl-1 py-1 space-y-1">
                    {/* Filter both listings by index / alias name. */}
                    <div className="relative px-1">
                      <Search className="h-3 w-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                      <Input
                        value={filterByConn[conn.id] ?? ''}
                        onChange={(e) => setFilterByConn((m) => ({ ...m, [conn.id]: e.target.value }))}
                        placeholder={t('sidebar.filterIndicesAliases')}
                        className="h-6 text-[11px] pl-6"
                      />
                    </div>

                    {loadingIdx[conn.id] ? (
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> {t('sidebar.loadingIndices')}
                      </div>
                    ) : (
                      <>
                        {/* ── Indexes ──────────────────────────────── */}
                        <SubHeader
                          label={t('indexBrowser.sectionIndexes')}
                          count={idx.length}
                          open={!closedIdx[conn.id]}
                          onToggle={() => setClosedIdx((m) => ({ ...m, [conn.id]: !m[conn.id] }))}
                        />
                        {!closedIdx[conn.id] && (
                          idx.length === 0 ? (
                            <div className="px-2 py-1 text-[10px] text-muted-foreground/70">{t('sidebar.noIndices')}</div>
                          ) : (
                            idx.map((ix) => (
                              <button
                                key={ix.index}
                                type="button"
                                onClick={() => openIndexTab(conn, ix.index)}
                                className="w-full flex items-center gap-1.5 px-2 py-0.5 rounded text-left hover:bg-accent/40"
                                title={t('indexBrowser.rowTitle', { docs: ix.docsCount.toLocaleString(), store: ix.storeSize, pri: ix.priShards, rep: ix.repShards })}
                              >
                                <span className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', healthDot(ix.health))} />
                                <span className="text-xs font-mono truncate">{ix.index}</span>
                                <span className="ml-auto text-[9px] text-muted-foreground/70 shrink-0">{formatCount(ix.docsCount)}</span>
                              </button>
                            ))
                          )
                        )}

                        {/* ── Aliases ──────────────────────────────── */}
                        <SubHeader
                          label={t('indexBrowser.sectionAliases')}
                          count={alias.length}
                          open={!closedAlias[conn.id]}
                          onToggle={() => setClosedAlias((m) => ({ ...m, [conn.id]: !m[conn.id] }))}
                        />
                        {!closedAlias[conn.id] && (
                          alias.length === 0 ? (
                            <div className="px-2 py-1 text-[10px] text-muted-foreground/70">{t('indexBrowser.aliasesNone')}</div>
                          ) : (
                            alias.map((a) => (
                              <button
                                key={a.alias}
                                type="button"
                                onClick={() => openIndexTab(conn, a.alias)}
                                className="w-full flex flex-col gap-0.5 px-2 py-0.5 rounded text-left hover:bg-accent/40"
                                title={`${a.alias} → ${a.indices.join(', ')}`}
                              >
                                <div className="flex items-center gap-1.5">
                                  <Tags className="h-3 w-3 shrink-0 text-violet-400" />
                                  <span className="text-xs font-mono truncate">{a.alias}</span>
                                  <span className="ml-auto flex items-center gap-0.5 shrink-0">
                                    {a.write && (
                                      <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-emerald-500/15 text-emerald-500">{t('indexBrowser.aliasWrite')}</Badge>
                                    )}
                                    {a.filtered && (
                                      <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-amber-500/15 text-amber-500">{t('indexBrowser.aliasFiltered')}</Badge>
                                    )}
                                    {a.routing && (
                                      <Badge variant="secondary" className="text-[8px] px-1 py-0 bg-sky-500/15 text-sky-500">{t('indexBrowser.aliasRouting')}</Badge>
                                    )}
                                  </span>
                                </div>
                                <span className="pl-4 text-[9px] text-muted-foreground/60 truncate">→ {a.indices.join(', ')}</span>
                              </button>
                            ))
                          )
                        )}
                      </>
                    )}
                  </div>
                );
              })()}
              </div>
            ))}
          </div>
        )}
      </div>

      <ESConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => fetchConnections()}
      />
      {sharing && (
        <ESShareDialog
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
              onClick={handleDeleteConnection}
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

// Collapsible sub-section header inside an expanded connection (Indexes /
// Aliases). Smaller than the console browser's SectionHeader — it lives in the
// narrow sidebar tree, not a roomy panel.
function SubHeader({ label, count, open, onToggle }: { label: string; count: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground"
    >
      <ChevronDown className={cn('h-2.5 w-2.5 shrink-0 transition-transform', !open && '-rotate-90')} />
      {label}
      <span className="text-muted-foreground/40">· {count}</span>
    </button>
  );
}
