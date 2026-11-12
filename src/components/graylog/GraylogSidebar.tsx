import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, ChevronRight, MoreHorizontal, Edit3, Trash2, Share2, MonitorSmartphone, Cloud, Loader2, ScrollText,
  Search, LayoutDashboard, ExternalLink, AlertTriangle, Waves,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGraylogConnectionStore, scopeForGraylog, graylogError } from '@/stores/graylogConnectionStore';
import { dualWrite } from '@/stores/dbConnectionStore';
import { graylogAPI, graylogConnectionAPI, type DBScope } from '@/services/api';
import { cn } from '@/lib/utils';
import type { GraylogConnection } from '@/types';
import { GraylogConnectionDialog } from './GraylogConnectionDialog';
import { GraylogShareDialog } from './GraylogShareDialog';
import { useGraylogSidebarUI } from './graylogSidebarUI';
import { openGraylogDashboards, openGraylogSearch } from './graylogUtil';

interface GraylogStream { id: string; title: string; description?: string; disabled?: boolean; isDefault?: boolean }

interface ConnChildren {
  streams?: GraylogStream[];
  loading?: boolean;
  error?: string;
}

// GraylogSidebar — Graylog connections inside the Dashboards rail. A
// connection expands to "Search all logs", its dashboards & saved searches
// and its streams (loaded on expand, filterable); a stream opens the search
// limited to it.
export function GraylogSidebar() {
  const { t } = useTranslation('graylog');
  const { connections, loading, loaded, fetchConnections, removeLocal } = useGraylogConnectionStore();
  const dialogOpen = useGraylogSidebarUI((s) => s.dialogOpen);
  const editing = useGraylogSidebarUI((s) => s.editing);
  const openEdit = useGraylogSidebarUI((s) => s.openEdit);
  const openAdd = useGraylogSidebarUI((s) => s.openAdd);
  const setDialogOpen = useGraylogSidebarUI((s) => s.setDialogOpen);
  const [sharing, setSharing] = useState<GraylogConnection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GraylogConnection | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [conns, setConns] = useState<Record<string, ConnChildren>>({});
  const [filter, setFilter] = useState<Record<string, string>>({});

  useEffect(() => { void fetchConnections(); }, [fetchConnections]);

  const loadConn = useCallback(async (conn: GraylogConnection) => {
    const scope = scopeForGraylog(useGraylogConnectionStore.getState().connections, conn.id);
    setConns((m) => ({ ...m, [conn.id]: { ...m[conn.id], loading: true, error: undefined } }));
    try {
      const res = await graylogAPI.streams(conn.id, scope);
      setConns((m) => ({ ...m, [conn.id]: { streams: (res.data as GraylogStream[]) ?? [] } }));
    } catch (e) {
      setConns((m) => ({ ...m, [conn.id]: { error: graylogError(e).message } }));
    }
  }, []);

  const toggleConn = (conn: GraylogConnection) => {
    const next = !expanded[conn.id];
    setExpanded((m) => ({ ...m, [conn.id]: next }));
    if (next && !conns[conn.id]?.streams) void loadConn(conn);
  };

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const scopes: DBScope[] = confirmDelete.availableScopes?.length ? (confirmDelete.availableScopes as DBScope[]) : [confirmDelete.scope ?? 'remote'];
    await dualWrite((s) => graylogConnectionAPI.delete(confirmDelete.id, s), scopes);
    removeLocal(confirmDelete.id);
    setConfirmDelete(null);
  }, [confirmDelete, removeLocal]);

  return (
    <>
      <div className="px-2 pb-1">
        {connections.length === 0 && (loading || !loaded) ? (
          <div className="flex items-center gap-1.5 px-2 py-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> {t('sidebar.loading')}
          </div>
        ) : connections.length === 0 ? (
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] text-muted-foreground">
            <span>{t('sidebar.empty')}</span>
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={openAdd}>{t('sidebar.addFirst')}</Button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {connections.map((conn) => {
              const cc = conns[conn.id];
              const q = (filter[conn.id] ?? '').trim().toLowerCase();
              const streams = (cc?.streams ?? []).filter((s) => !q || s.title.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q));
              return (
                <div key={conn.id}>
                  <div className="group flex items-center rounded hover:bg-accent/40 transition-colors">
                    <button type="button" onClick={() => toggleConn(conn)} className="p-1 shrink-0 text-muted-foreground hover:text-foreground">
                      {expanded[conn.id] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </button>
                    <button type="button" onClick={() => toggleConn(conn)} onDoubleClick={() => openGraylogSearch(conn.id, conn.name)} className="flex-1 min-w-0 flex items-center gap-1.5 px-1 py-1 text-left" title={conn.url}>
                      <ScrollText className={cn('h-3.5 w-3.5 shrink-0', conn.shared ? 'text-green-500' : 'text-rose-500')} />
                      <span className="text-sm truncate">{conn.name}</span>
                      <span className="flex items-center gap-0.5 shrink-0">
                        <MonitorSmartphone className={cn('h-2.5 w-2.5', (conn.availableScopes ?? [conn.scope]).includes('local') ? 'text-emerald-500/80' : 'text-muted-foreground/30')} />
                        <Cloud className={cn('h-2.5 w-2.5', (conn.availableScopes ?? [conn.scope]).includes('remote') ? 'text-sky-500/80' : 'text-muted-foreground/30')} />
                      </span>
                      {conn.shared && <span className="text-[9px] text-muted-foreground/70 ml-auto truncate">{conn.ownerName}</span>}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity shrink-0">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onClick={() => openGraylogSearch(conn.id, conn.name)}><Search className="h-3.5 w-3.5 mr-2" /> {t('sidebar.searchAll')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openGraylogDashboards(conn.id, `${conn.name} · ${t('dashboards.kindDashboard')}`)}><LayoutDashboard className="h-3.5 w-3.5 mr-2" /> {t('sidebar.dashboards')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => window.open(conn.url, '_blank', 'noopener')}><ExternalLink className="h-3.5 w-3.5 mr-2" /> {t('sidebar.openGraylog')}</DropdownMenuItem>
                        {!conn.shared && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => openEdit(conn)}><Edit3 className="h-3.5 w-3.5 mr-2" /> {t('common:edit')}</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setSharing(conn)}><Share2 className="h-3.5 w-3.5 mr-2" /> {t('sidebar.share')}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setConfirmDelete(conn)} className="text-destructive focus:text-destructive"><Trash2 className="h-3.5 w-3.5 mr-2" /> {t('common:delete')}</DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {expanded[conn.id] && (
                    <div className="ml-3 border-l border-border/60 pl-1 py-1 space-y-0.5">
                      <Row icon={<Search className="h-3 w-3 text-rose-500" />} label={t('sidebar.searchAll')} onClick={() => openGraylogSearch(conn.id, conn.name, { streams: [] })} />
                      <Row icon={<LayoutDashboard className="h-3 w-3 text-sky-500" />} label={t('sidebar.dashboards')} onClick={() => openGraylogDashboards(conn.id, `${conn.name} · ${t('dashboards.kindDashboard')}`)} />
                      {cc?.loading && !cc.streams ? (
                        <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {t('sidebar.loading')}</div>
                      ) : cc?.error ? (
                        <ErrorBox message={cc.error} onRetry={() => loadConn(conn)} onEdit={conn.shared ? undefined : () => openEdit(conn)} />
                      ) : cc?.streams && (
                        <>
                          <div className="flex items-center gap-1.5 px-2 pt-1">
                            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('sidebar.streams')}</span>
                            <span className="text-[9px] text-muted-foreground/60">{cc.streams.length}</span>
                          </div>
                          {cc.streams.length > 8 && (
                            <div className="relative px-1 pb-0.5">
                              <Search className="h-3 w-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                              <Input
                                value={filter[conn.id] ?? ''}
                                onChange={(e) => setFilter((m) => ({ ...m, [conn.id]: e.target.value }))}
                                placeholder={t('sidebar.filter')}
                                className="h-6 text-[11px] pl-6"
                              />
                            </div>
                          )}
                          {streams.map((s) => (
                            <Row
                              key={s.id}
                              icon={<Waves className={cn('h-3 w-3', s.disabled ? 'text-muted-foreground/40' : 'text-violet-500')} />}
                              label={s.title}
                              hint={s.isDefault ? t('sidebar.defaultStream') : s.disabled ? t('sidebar.paused') : undefined}
                              title={s.description || s.title}
                              dim={s.disabled}
                              onClick={() => openGraylogSearch(conn.id, conn.name, { streams: [s.id] })}
                            />
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <GraylogConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} onSaved={() => fetchConnections()} />
      {sharing && <GraylogShareDialog open={!!sharing} onOpenChange={(o) => { if (!o) setSharing(null); }} connection={sharing} />}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.deleteTitle', { name: confirmDelete?.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('sidebar.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">{t('common:delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Row({ icon, label, hint, title, dim, onClick }: { icon: React.ReactNode; label: string; hint?: string; title?: string; dim?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-1.5 px-2 py-0.5 rounded text-left hover:bg-accent/40" title={title ?? label}>
      <span className="shrink-0">{icon}</span>
      <span className={cn('text-xs truncate', dim && 'text-muted-foreground')}>{label}</span>
      {hint && <span className="ml-auto text-[9px] text-muted-foreground/60 shrink-0">{hint}</span>}
    </button>
  );
}

function ErrorBox({ message, onRetry, onEdit }: { message: string; onRetry: () => void; onEdit?: () => void }) {
  const { t } = useTranslation('graylog');
  return (
    <div className="mx-1 my-1 rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive flex gap-1.5">
      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="break-words">{message}</div>
        <div className="mt-1 flex gap-2">
          <button type="button" className="underline" onClick={onRetry}>{t('common:retry')}</button>
          {onEdit && <button type="button" className="underline" onClick={onEdit}>{t('sidebar.editConnection')}</button>}
        </div>
      </div>
    </div>
  );
}
