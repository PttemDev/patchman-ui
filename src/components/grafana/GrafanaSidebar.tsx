import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, RefreshCw, MoreHorizontal, Edit3, Trash2, Share2, MonitorSmartphone, Cloud, ChevronRight,
  ChevronDown, Loader2, LayoutDashboard, Folder, FolderOpen, Search, Compass, ExternalLink, AlertTriangle,
  KeyRound, Star, Globe,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useGrafanaConnectionStore } from '@/stores/grafanaConnectionStore';
import { dualWrite } from '@/stores/dbConnectionStore';
import { grafanaConnectionAPI, type DBScope } from '@/services/api';
import { cn } from '@/lib/utils';
import type { GrafanaConnection, GrafanaSearchHit } from '@/types';
import { GrafanaConnectionDialog } from './GrafanaConnectionDialog';
import { GrafanaShareDialog } from './GrafanaShareDialog';
import { openGrafanaTab, grafanaLink } from './useOpenGrafana';
import { useGrafanaSidebarUI } from './grafanaSidebarUI';

export function GrafanaHeaderActions() {
  const { t } = useTranslation('grafana');
  const fetchConnections = useGrafanaConnectionStore((s) => s.fetchConnections);
  const openAdd = useGrafanaSidebarUI((s) => s.openAdd);
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

interface FolderNode {
  uid: string;
  title: string;
  folders: FolderNode[];
  dashboards: GrafanaSearchHit[];
}

/** Folder tree from flat /api/search hits (folderUid = parent). */
function buildTree(folders: GrafanaSearchHit[], dashboards: GrafanaSearchHit[]): FolderNode {
  const root: FolderNode = { uid: '', title: '', folders: [], dashboards: [] };
  const nodes = new Map<string, FolderNode>();
  for (const f of folders) nodes.set(f.uid, { uid: f.uid, title: f.title, folders: [], dashboards: [] });
  for (const f of folders) {
    const node = nodes.get(f.uid)!;
    const parent = (f.folderUid && nodes.get(f.folderUid)) || root;
    if (parent !== node) parent.folders.push(node);
  }
  for (const d of dashboards) ((d.folderUid && nodes.get(d.folderUid)) || root).dashboards.push(d);
  const sort = (n: FolderNode) => {
    n.folders.sort((a, b) => a.title.localeCompare(b.title));
    n.dashboards.sort((a, b) => a.title.localeCompare(b.title));
    n.folders.forEach(sort);
  };
  sort(root);
  return root;
}

function folderPath(uid: string | undefined, folders: GrafanaSearchHit[]): string {
  const byUid = new Map(folders.map((f) => [f.uid, f]));
  const parts: string[] = [];
  let cur = uid ? byUid.get(uid) : undefined;
  for (let i = 0; cur && i < 20; i++) {
    parts.unshift(cur.title);
    cur = cur.folderUid ? byUid.get(cur.folderUid) : undefined;
  }
  return parts.join(' / ');
}

/** embedded: shown as one group of the Dashboards rail — compact empty state. */
export function GrafanaSidebar({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation('grafana');
  const { connections, loading, loaded, fetchConnections, removeLocal, trees, treeErrors, loadTree } = useGrafanaConnectionStore();
  const dialogOpen = useGrafanaSidebarUI((s) => s.dialogOpen);
  const editing = useGrafanaSidebarUI((s) => s.editing);
  const openEdit = useGrafanaSidebarUI((s) => s.openEdit);
  const openAdd = useGrafanaSidebarUI((s) => s.openAdd);
  const setDialogOpen = useGrafanaSidebarUI((s) => s.setDialogOpen);
  const [sharing, setSharing] = useState<GrafanaConnection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GrafanaConnection | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<Record<string, string>>({});
  const [loadingTree, setLoadingTree] = useState<Record<string, boolean>>({});

  useEffect(() => { void fetchConnections(); }, [fetchConnections]);

  const refreshTree = useCallback(async (connId: string, force = false) => {
    setLoadingTree((m) => ({ ...m, [connId]: true }));
    await loadTree(connId, force);
    setLoadingTree((m) => ({ ...m, [connId]: false }));
  }, [loadTree]);

  const toggle = (conn: GrafanaConnection) => {
    const next = !expanded[conn.id];
    setExpanded((m) => ({ ...m, [conn.id]: next }));
    if (next) void refreshTree(conn.id);
  };

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const scopes: DBScope[] = confirmDelete.availableScopes?.length
      ? (confirmDelete.availableScopes as DBScope[])
      : [confirmDelete.scope ?? 'remote'];
    await dualWrite((s) => grafanaConnectionAPI.delete(confirmDelete.id, s), scopes);
    removeLocal(confirmDelete.id);
    setConfirmDelete(null);
  }, [confirmDelete, removeLocal]);

  return (
    <>
      <div className={embedded ? 'px-2 pb-1 space-y-3' : 'p-2 space-y-3'}>
        {embedded && connections.length === 0 ? (
          <p className="px-2 py-1 text-[11px] text-muted-foreground/80">
            {loading || !loaded ? t('sidebar.loading') : t('sidebar.empty')}
          </p>
        ) : connections.length === 0 && (loading || !loaded) ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center gap-1 px-4 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/60 mb-2" />
            <p className="text-xs text-muted-foreground">{t('sidebar.loading')}</p>
          </div>
        ) : connections.length === 0 ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center gap-1 px-4 text-center">
            <LayoutDashboard className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground">{t('sidebar.empty')}</p>
            <p className="text-[11px] text-muted-foreground/70 max-w-[240px]">{t('sidebar.emptyHint')}</p>
            <Button size="sm" className="mt-2 h-7 text-xs" onClick={openAdd}>{t('sidebar.addFirst')}</Button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {connections.map((conn) => {
              const tree = trees[conn.id];
              const err = treeErrors[conn.id];
              const q = (filter[conn.id] ?? '').trim().toLowerCase();
              return (
                <div key={conn.id}>
                  <div className="group flex items-center rounded hover:bg-accent/40 transition-colors">
                    <button type="button" onClick={() => toggle(conn)} className="p-1 shrink-0 text-muted-foreground hover:text-foreground">
                      {expanded[conn.id] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </button>
                    <button type="button" onClick={() => toggle(conn)} className="flex-1 min-w-0 flex items-center gap-1.5 px-1 py-1 text-left" title={conn.url}>
                      <LayoutDashboard className={cn('h-3.5 w-3.5 shrink-0', conn.shared ? 'text-green-500' : 'text-orange-500')} />
                      <span className="text-sm truncate">{conn.name}</span>
                      {conn.authKind === 'session' && (
                        <Badge variant="secondary" className="text-[8px] px-1 py-0 shrink-0" title={t('sidebar.sessionBadgeHint')}>
                          <KeyRound className="h-2 w-2 mr-0.5" />{t('sidebar.sessionBadge')}
                        </Badge>
                      )}
                      <span className="flex items-center gap-0.5 shrink-0">
                        <MonitorSmartphone className={cn('h-2.5 w-2.5', (conn.availableScopes ?? [conn.scope]).includes('local') ? 'text-emerald-500/80' : 'text-muted-foreground/30')} />
                        <Cloud className={cn('h-2.5 w-2.5', (conn.availableScopes ?? [conn.scope]).includes('remote') ? 'text-sky-500/80' : 'text-muted-foreground/30')} />
                      </span>
                      {conn.shared && (
                        <span className="text-[9px] text-muted-foreground/70 ml-auto">
                          {conn.grantRole === 'write' ? t('roles.write') : t('roles.read')}
                        </span>
                      )}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => openGrafanaTab({ connId: conn.id, view: 'explore', title: `${t('explore.title')} · ${conn.name}` })}>
                          <Compass className="h-3.5 w-3.5 mr-2" /> {t('sidebar.explore')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => window.open(grafanaLink(conn.url, '/'), '_blank', 'noopener')}>
                          <ExternalLink className="h-3.5 w-3.5 mr-2" /> {t('sidebar.openInGrafana')}
                        </DropdownMenuItem>
                        {!conn.shared && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => openEdit(conn)}>
                              <Edit3 className="h-3.5 w-3.5 mr-2" /> {t('common:edit')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setSharing(conn)}>
                              <Share2 className="h-3.5 w-3.5 mr-2" /> {t('sidebar.share')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setConfirmDelete(conn)} className="text-destructive focus:text-destructive">
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> {t('common:delete')}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {expanded[conn.id] && (
                    <div className="ml-3 border-l border-border/60 pl-1 py-1 space-y-0.5">
                      <div className="relative px-1 pb-0.5">
                        <Search className="h-3 w-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                        <Input
                          value={filter[conn.id] ?? ''}
                          onChange={(e) => setFilter((m) => ({ ...m, [conn.id]: e.target.value }))}
                          placeholder={t('sidebar.filterDashboards')}
                          className="h-6 text-[11px] pl-6"
                        />
                      </div>
                      {!tree?.publicOnly && (
                        <button
                          type="button"
                          onClick={() => openGrafanaTab({ connId: conn.id, view: 'explore', title: `${t('explore.title')} · ${conn.name}` })}
                          className="w-full flex items-center gap-1.5 px-2 py-0.5 rounded text-left hover:bg-accent/40"
                        >
                          <Compass className="h-3 w-3 shrink-0 text-sky-500" />
                          <span className="text-xs">{t('sidebar.explore')}</span>
                        </button>
                      )}
                      {(conn.options?.publicDashboards ?? [])
                        .filter((p) => !q || (p.title ?? '').toLowerCase().includes(q))
                        .map((p) => (
                          <button
                            key={p.token}
                            type="button"
                            onClick={() => openGrafanaTab({ connId: conn.id, view: 'dashboard', publicToken: p.token, title: p.title || t('sidebar.publicDashboard') })}
                            className="w-full flex items-center gap-1.5 px-2 py-0.5 rounded text-left hover:bg-accent/40"
                            title={t('sidebar.publicDashboardHint')}
                          >
                            <Globe className="h-3 w-3 shrink-0 text-emerald-500" />
                            <span className="text-xs truncate">{p.title || `${t('sidebar.publicDashboard')} · ${p.token.slice(0, 8)}`}</span>
                          </button>
                        ))}
                      {tree?.publicOnly ? (
                        <div className="px-2 py-1 text-[10px] text-muted-foreground/70">{t('sidebar.publicOnly')}</div>
                      ) : err ? (
                        <div className="mx-1 my-1 rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive flex gap-1.5">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="break-words">{err}</div>
                            <div className="mt-1 flex gap-2">
                              <button type="button" className="underline" onClick={() => refreshTree(conn.id, true)}>{t('common:retry')}</button>
                              {!conn.shared && <button type="button" className="underline" onClick={() => openEdit(conn)}>{t('sidebar.editCredentials')}</button>}
                            </div>
                          </div>
                        </div>
                      ) : !tree || loadingTree[conn.id] && !tree ? (
                        <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> {t('sidebar.loadingDashboards')}
                        </div>
                      ) : q ? (
                        <FlatMatches conn={conn} hits={tree.dashboards.filter((d) => d.title.toLowerCase().includes(q) || (d.tags ?? []).some((tg) => tg.toLowerCase().includes(q)))} folders={tree.folders} />
                      ) : (
                        <FolderView
                          conn={conn}
                          node={buildTree(tree.folders, tree.dashboards)}
                          depth={0}
                          open={openFolders}
                          onToggle={(uid) => setOpenFolders((m) => ({ ...m, [`${conn.id}:${uid}`]: !m[`${conn.id}:${uid}`] }))}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <GrafanaConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} onSaved={() => fetchConnections()} />
      {sharing && (
        <GrafanaShareDialog open={!!sharing} onOpenChange={(o) => { if (!o) setSharing(null); }} connection={sharing} />
      )}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.deleteTitle', { name: confirmDelete?.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('sidebar.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">
              {t('common:delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DashboardRow({ conn, hit, sub }: { conn: GrafanaConnection; hit: GrafanaSearchHit; sub?: string }) {
  return (
    <button
      type="button"
      onClick={() => openGrafanaTab({ connId: conn.id, view: 'dashboard', uid: hit.uid, title: hit.title })}
      className="w-full flex flex-col px-2 py-0.5 rounded text-left hover:bg-accent/40"
      title={hit.tags?.length ? `${hit.title} · ${hit.tags.join(', ')}` : hit.title}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <LayoutDashboard className="h-3 w-3 shrink-0 text-orange-400" />
        <span className="text-xs truncate">{hit.title}</span>
        {hit.isStarred && <Star className="h-2.5 w-2.5 shrink-0 text-yellow-500 fill-yellow-500" />}
      </span>
      {sub && <span className="pl-[18px] text-[9px] text-muted-foreground/60 truncate">{sub}</span>}
    </button>
  );
}

function FlatMatches({ conn, hits, folders }: { conn: GrafanaConnection; hits: GrafanaSearchHit[]; folders: GrafanaSearchHit[] }) {
  const { t } = useTranslation('grafana');
  if (hits.length === 0) return <div className="px-2 py-1 text-[10px] text-muted-foreground/70">{t('sidebar.noMatches')}</div>;
  return (
    <>
      {hits.slice(0, 300).map((h) => (
        <DashboardRow key={h.uid} conn={conn} hit={h} sub={folderPath(h.folderUid, folders) || t('sidebar.general')} />
      ))}
    </>
  );
}

function FolderView({ conn, node, depth, open, onToggle }: {
  conn: GrafanaConnection;
  node: FolderNode;
  depth: number;
  open: Record<string, boolean>;
  onToggle: (uid: string) => void;
}) {
  const { t } = useTranslation('grafana');
  const empty = useMemo(() => node.folders.length === 0 && node.dashboards.length === 0, [node]);
  if (depth === 0 && empty) {
    return <div className="px-2 py-1 text-[10px] text-muted-foreground/70">{t('sidebar.noDashboards')}</div>;
  }
  return (
    <>
      {node.folders.map((f) => {
        const isOpen = !!open[`${conn.id}:${f.uid}`];
        return (
          <div key={f.uid}>
            <button
              type="button"
              onClick={() => onToggle(f.uid)}
              className="w-full flex items-center gap-1.5 px-2 py-0.5 rounded text-left hover:bg-accent/40"
            >
              {isOpen ? <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" /> : <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <span className="text-xs truncate">{f.title}</span>
              <span className="ml-auto text-[9px] text-muted-foreground/50">{countDashboards(f)}</span>
            </button>
            {isOpen && (
              <div className="ml-2.5 border-l border-border/40 pl-1">
                <FolderView conn={conn} node={f} depth={depth + 1} open={open} onToggle={onToggle} />
              </div>
            )}
          </div>
        );
      })}
      {node.dashboards.map((d) => <DashboardRow key={d.uid} conn={conn} hit={d} />)}
    </>
  );
}

function countDashboards(n: FolderNode): number {
  return n.dashboards.length + n.folders.reduce((a, f) => a + countDashboards(f), 0);
}
