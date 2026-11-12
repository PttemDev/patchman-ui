import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, ChevronRight, MoreHorizontal, Edit3, Trash2, Share2, MonitorSmartphone, Cloud, Loader2, Rabbit,
  LayoutDashboard, ListOrdered, Shuffle, Plug, Network, ExternalLink, AlertTriangle, Search, Inbox, Waves, Server,
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
import { useRabbitConnectionStore, scopeForRabbit, rabbitError } from '@/stores/rabbitConnectionStore';
import { dualWrite } from '@/stores/dbConnectionStore';
import { rabbitAPI, rabbitConnectionAPI, type DBScope } from '@/services/api';
import { cn } from '@/lib/utils';
import type { RabbitConnection, RabbitExchange, RabbitPage, RabbitQueue } from '@/types';
import { RabbitConnectionDialog } from './RabbitConnectionDialog';
import { RabbitShareDialog } from './RabbitShareDialog';
import { useRabbitConnectionSidebarUI } from './rabbitSidebarUI';
import { fmtNum, isDeadLetterQueue, openRabbitCluster, openRabbitExchange, openRabbitQueue } from './rabbitUtil';

interface VhostChildren {
  queues?: RabbitQueue[];
  exchanges?: RabbitExchange[];
  loading?: boolean;
  error?: string;
}

interface ConnChildren {
  vhosts?: string[];
  loading?: boolean;
  error?: string;
}

// RabbitSidebar — RabbitMQ connections inside the Messaging rail. A
// connection expands to its vhosts, each to its queues and exchanges
// (loaded on expand, filterable). Rows open the RabbitMQ tabs: the cluster
// view, a queue or an exchange.
export function RabbitSidebar() {
  const { t } = useTranslation('rabbit');
  const { connections, loading, loaded, fetchConnections, removeLocal } = useRabbitConnectionStore();
  const dialogOpen = useRabbitConnectionSidebarUI((s) => s.dialogOpen);
  const editing = useRabbitConnectionSidebarUI((s) => s.editing);
  const openEdit = useRabbitConnectionSidebarUI((s) => s.openEdit);
  const openAdd = useRabbitConnectionSidebarUI((s) => s.openAdd);
  const setDialogOpen = useRabbitConnectionSidebarUI((s) => s.setDialogOpen);
  const [sharing, setSharing] = useState<RabbitConnection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RabbitConnection | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [conns, setConns] = useState<Record<string, ConnChildren>>({});
  const [vhosts, setVhosts] = useState<Record<string, VhostChildren>>({});
  const [openNodes, setOpenNodes] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<Record<string, string>>({});

  useEffect(() => { void fetchConnections(); }, [fetchConnections]);

  const loadConn = useCallback(async (conn: RabbitConnection) => {
    const scope = scopeForRabbit(connections, conn.id);
    setConns((m) => ({ ...m, [conn.id]: { ...m[conn.id], loading: true, error: undefined } }));
    try {
      const res = await rabbitAPI.overview(conn.id, scope);
      const list = ((res.data as { vhosts?: Array<{ name: string }> }).vhosts ?? []).map((v) => v.name).sort();
      setConns((m) => ({ ...m, [conn.id]: { vhosts: list } }));
      // Single vhost: open it right away.
      if (list.length === 1) setOpenNodes((o) => ({ ...o, [`${conn.id}|${list[0]}`]: true }));
      if (list.length === 1) void loadVhost(conn, list[0]);
    } catch (e) {
      setConns((m) => ({ ...m, [conn.id]: { error: rabbitError(e).message } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections]);

  const loadVhost = useCallback(async (conn: RabbitConnection, vhost: string) => {
    const key = `${conn.id}|${vhost}`;
    const scope = scopeForRabbit(useRabbitConnectionStore.getState().connections, conn.id);
    setVhosts((m) => ({ ...m, [key]: { ...m[key], loading: true, error: undefined } }));
    try {
      const [qs, xs] = await Promise.all([
        rabbitAPI.queues(conn.id, { vhost, pageSize: 500, sort: 'name' }, scope),
        rabbitAPI.exchanges(conn.id, { vhost, pageSize: 500, sort: 'name' }, scope),
      ]);
      setVhosts((m) => ({
        ...m,
        [key]: { queues: (qs.data as RabbitPage<RabbitQueue>).items ?? [], exchanges: (xs.data as RabbitPage<RabbitExchange>).items ?? [] },
      }));
    } catch (e) {
      setVhosts((m) => ({ ...m, [key]: { error: rabbitError(e).message } }));
    }
  }, []);

  const toggleConn = (conn: RabbitConnection) => {
    const next = !expanded[conn.id];
    setExpanded((m) => ({ ...m, [conn.id]: next }));
    if (next && !conns[conn.id]?.vhosts) void loadConn(conn);
  };

  const toggleNode = (key: string, onOpen?: () => void) => {
    setOpenNodes((m) => {
      const next = !m[key];
      if (next) onOpen?.();
      return { ...m, [key]: next };
    });
  };

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const scopes: DBScope[] = confirmDelete.availableScopes?.length ? (confirmDelete.availableScopes as DBScope[]) : [confirmDelete.scope ?? 'remote'];
    await dualWrite((s) => rabbitConnectionAPI.delete(confirmDelete.id, s), scopes);
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
              return (
                <div key={conn.id}>
                  <div className="group flex items-center rounded hover:bg-accent/40 transition-colors">
                    <button type="button" onClick={() => toggleConn(conn)} className="p-1 shrink-0 text-muted-foreground hover:text-foreground">
                      {expanded[conn.id] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </button>
                    <button type="button" onClick={() => toggleConn(conn)} onDoubleClick={() => openRabbitCluster(conn.id, conn.name)} className="flex-1 min-w-0 flex items-center gap-1.5 px-1 py-1 text-left" title={conn.url}>
                      <Rabbit className={cn('h-3.5 w-3.5 shrink-0', conn.shared ? 'text-green-500' : 'text-orange-500')} />
                      <span className="text-sm truncate">{conn.name}</span>
                      <span className="flex items-center gap-0.5 shrink-0">
                        <MonitorSmartphone className={cn('h-2.5 w-2.5', (conn.availableScopes ?? [conn.scope]).includes('local') ? 'text-emerald-500/80' : 'text-muted-foreground/30')} />
                        <Cloud className={cn('h-2.5 w-2.5', (conn.availableScopes ?? [conn.scope]).includes('remote') ? 'text-sky-500/80' : 'text-muted-foreground/30')} />
                      </span>
                      {conn.shared && (
                        <span className="text-[9px] text-muted-foreground/70 ml-auto">{conn.grantRole === 'write' ? t('roles.write') : t('roles.read')}</span>
                      )}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity shrink-0">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onClick={() => openRabbitCluster(conn.id, conn.name, 'overview')}><LayoutDashboard className="h-3.5 w-3.5 mr-2" /> {t('section.overview')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openRabbitCluster(conn.id, conn.name, 'queues')}><ListOrdered className="h-3.5 w-3.5 mr-2" /> {t('section.queues')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openRabbitCluster(conn.id, conn.name, 'exchanges')}><Shuffle className="h-3.5 w-3.5 mr-2" /> {t('section.exchanges')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openRabbitCluster(conn.id, conn.name, 'connections')}><Plug className="h-3.5 w-3.5 mr-2" /> {t('section.connections')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openRabbitCluster(conn.id, conn.name, 'topology')}><Network className="h-3.5 w-3.5 mr-2" /> {t('section.topology')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => window.open(conn.url.replace(/\/+$/, ''), '_blank', 'noopener')}><ExternalLink className="h-3.5 w-3.5 mr-2" /> {t('sidebar.openManagement')}</DropdownMenuItem>
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
                      <div className="relative px-1 pb-0.5">
                        <Search className="h-3 w-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                        <Input
                          value={filter[conn.id] ?? ''}
                          onChange={(e) => setFilter((m) => ({ ...m, [conn.id]: e.target.value }))}
                          placeholder={t('sidebar.filter')}
                          className="h-6 text-[11px] pl-6"
                        />
                      </div>
                      <Row icon={<LayoutDashboard className="h-3 w-3 text-sky-500" />} label={t('section.overview')} onClick={() => openRabbitCluster(conn.id, conn.name, 'overview')} />
                      {cc?.loading && !cc.vhosts ? (
                        <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {t('sidebar.loading')}</div>
                      ) : cc?.error ? (
                        <ErrorBox message={cc.error} onRetry={() => loadConn(conn)} onEdit={conn.shared ? undefined : () => openEdit(conn)} />
                      ) : (cc?.vhosts ?? []).map((vh) => {
                        const vkey = `${conn.id}|${vh}`;
                        const vc = vhosts[vkey];
                        const qOpen = openNodes[`${vkey}|q`] ?? true;
                        const xOpen = openNodes[`${vkey}|x`] ?? false;
                        const queues = (vc?.queues ?? []).filter((x) => !q || x.name.toLowerCase().includes(q));
                        const exchanges = (vc?.exchanges ?? []).filter((x) => !q || x.name.toLowerCase().includes(q) || (!x.name && 'default'.includes(q)));
                        return (
                          <div key={vh}>
                            <button
                              type="button"
                              onClick={() => toggleNode(vkey, () => { if (!vc?.queues) void loadVhost(conn, vh); })}
                              className="w-full flex items-center gap-1.5 px-2 py-0.5 rounded text-left hover:bg-accent/40"
                              title={t('sidebar.vhost')}
                            >
                              {openNodes[vkey] ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                              <Server className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <span className="text-xs font-mono truncate">{vh}</span>
                            </button>
                            {openNodes[vkey] && (
                              <div className="ml-2.5 border-l border-border/40 pl-1">
                                {vc?.loading && !vc.queues ? (
                                  <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> {t('sidebar.loading')}</div>
                                ) : vc?.error ? (
                                  <ErrorBox message={vc.error} onRetry={() => loadVhost(conn, vh)} />
                                ) : (
                                  <>
                                    <GroupRow open={qOpen} label={t('section.queues')} count={queues.length} onClick={() => setOpenNodes((m) => ({ ...m, [`${vkey}|q`]: !qOpen }))} />
                                    {qOpen && queues.slice(0, 500).map((x) => <QueueRow key={x.name} conn={conn} queue={x} />)}
                                    <GroupRow open={xOpen} label={t('section.exchanges')} count={exchanges.length} onClick={() => setOpenNodes((m) => ({ ...m, [`${vkey}|x`]: !xOpen }))} />
                                    {xOpen && exchanges.map((x) => (
                                      <Row
                                        key={x.name || '(default)'}
                                        indent
                                        icon={<Shuffle className={cn('h-3 w-3', x.name.startsWith('amq.') || !x.name ? 'text-muted-foreground/50' : 'text-violet-500')} />}
                                        label={x.name || t('exchange.default')}
                                        hint={x.type}
                                        dim={x.name.startsWith('amq.') || !x.name}
                                        onClick={() => openRabbitExchange(conn.id, vh, x.name)}
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
              );
            })}
          </div>
        )}
      </div>

      <RabbitConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} onSaved={() => fetchConnections()} />
      {sharing && <RabbitShareDialog open={!!sharing} onOpenChange={(o) => { if (!o) setSharing(null); }} connection={sharing} />}
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

function Row({ icon, label, hint, dim, indent, onClick }: { icon: React.ReactNode; label: string; hint?: string; dim?: boolean; indent?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn('w-full flex items-center gap-1.5 py-0.5 rounded text-left hover:bg-accent/40', indent ? 'pl-5 pr-2' : 'px-2')} title={label}>
      <span className="shrink-0">{icon}</span>
      <span className={cn('text-xs truncate', dim && 'text-muted-foreground')}>{label}</span>
      {hint && <span className="ml-auto text-[9px] text-muted-foreground/60 shrink-0">{hint}</span>}
    </button>
  );
}

function GroupRow({ open, label, count, onClick }: { open: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-1.5 px-2 py-0.5 rounded text-left hover:bg-accent/40">
      {open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span className="ml-auto text-[9px] text-muted-foreground/60">{count}</span>
    </button>
  );
}

function QueueRow({ conn, queue }: { conn: RabbitConnection; queue: RabbitQueue }) {
  const { t } = useTranslation('rabbit');
  const msgs = queue.messages ?? 0;
  const stuck = queue.type !== 'stream' && msgs > 0 && (queue.consumers ?? 0) === 0;
  const dlq = isDeadLetterQueue(queue);
  const Icon = queue.type === 'stream' ? Waves : Inbox;
  return (
    <button
      type="button"
      onClick={() => openRabbitQueue(conn.id, queue.vhost, queue.name)}
      className="w-full flex items-center gap-1.5 pl-5 pr-2 py-0.5 rounded text-left hover:bg-accent/40"
      title={`${queue.name} · ${queue.type ?? 'classic'} · ${t('queue.ready')} ${queue.messages_ready ?? 0} · ${t('queue.unacked')} ${queue.messages_unacknowledged ?? 0} · ${t('queue.consumers')} ${queue.consumers ?? 0}`}
    >
      <Icon className={cn('h-3 w-3 shrink-0', queue.type === 'quorum' ? 'text-emerald-500' : queue.type === 'stream' ? 'text-sky-500' : 'text-orange-400')} />
      <span className="text-xs truncate">{queue.name}</span>
      {msgs > 0 && (
        <span
          className={cn(
            'ml-auto rounded px-1 text-[9px] font-mono tabular-nums shrink-0',
            dlq ? 'bg-destructive/15 text-destructive' : stuck ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground',
          )}
        >
          {fmtNum(msgs)}
        </span>
      )}
    </button>
  );
}

function ErrorBox({ message, onRetry, onEdit }: { message: string; onRetry: () => void; onEdit?: () => void }) {
  const { t } = useTranslation('rabbit');
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

