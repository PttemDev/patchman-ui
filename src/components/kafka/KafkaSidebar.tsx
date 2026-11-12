import { useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Radio,
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Edit3,
  Trash2,
  Share2,
  Hash,
  Users,
  Eye,
  Settings2,
  Split,
  Send,
  Loader2,
  MonitorSmartphone,
  Cloud,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useKafkaConnectionStore, scopeForKafka } from '@/stores/kafkaConnectionStore';
import { dualWrite } from '@/stores/dbConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import { kafkaAPI, kafkaConnectionAPI, type DBScope } from '@/services/api';
import { cn } from '@/lib/utils';
import type { KafkaConnection, KafkaGroupSummary, KafkaTopicSummary, KafkaGroupDetail } from '@/types';
import { KafkaConnectionDialog } from './KafkaConnectionDialog';
import { useKafkaConnectionSidebarUI } from './kafkaSidebarUI';

// KafkaHeaderActions — Refresh + New in the shared panel header, replacing the in-body
// connections sub-header row.
export function KafkaHeaderActions() {
  const { t } = useTranslation('kafka');
  const fetchConnections = useKafkaConnectionStore((s) => s.fetchConnections);
  const openAdd = useKafkaConnectionSidebarUI((s) => s.openAdd);
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
import { KafkaShareDialog } from './KafkaShareDialog';
import { TopicConfigDialog } from './TopicConfigDialog';
import { TopicCreateWizard } from './TopicCreateWizard';

interface Children {
  topics?: KafkaTopicSummary[];
  groups?: KafkaGroupSummary[];
  loading?: boolean;
  error?: string;
}

function canWrite(conn: KafkaConnection): boolean {
  // Owner + write grants may mutate; explicit read-only grants may not.
  return conn.grantRole !== 'read';
}

// KafkaSidebar mirrors DBSidebar: a list of Kafka connections, each of
// which lazy-loads its topics + consumer groups on expand. Topic rows open
// a Kafka tab; right-click exposes peek / config / partitions / publish /
// delete. Connections have edit / share / delete.
export function KafkaSidebar({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation('kafka');
  const { connections, loading, loaded, fetchConnections, removeLocal } = useKafkaConnectionStore();
  const addTab = useRequestStore((s) => s.addTab);
  const { toast } = useToast();

  const dialogOpen = useKafkaConnectionSidebarUI((s) => s.dialogOpen);
  const editing = useKafkaConnectionSidebarUI((s) => s.editing);
  const openEdit = useKafkaConnectionSidebarUI((s) => s.openEdit);
  const openAdd = useKafkaConnectionSidebarUI((s) => s.openAdd);
  const setDialogOpen = useKafkaConnectionSidebarUI((s) => s.setDialogOpen);
  const [sharing, setSharing] = useState<KafkaConnection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<KafkaConnection | null>(null);
  const [wizardConn, setWizardConn] = useState<KafkaConnection | null>(null);
  const [configState, setConfigState] = useState<{ conn: KafkaConnection; topic: string } | null>(null);
  const [addPartState, setAddPartState] = useState<{ conn: KafkaConnection; topic: string; current: number } | null>(null);
  const [deleteTopicState, setDeleteTopicState] = useState<{ conn: KafkaConnection; topic: string } | null>(null);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [topicsOpen, setTopicsOpen] = useState<Record<string, boolean>>({});
  const [groupsOpen, setGroupsOpen] = useState<Record<string, boolean>>({});
  const [children, setChildren] = useState<Record<string, Children>>({});

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const loadChildren = useCallback(async (conn: KafkaConnection) => {
    const scope = scopeForKafka(connections, conn.id);
    setChildren((m) => ({ ...m, [conn.id]: { ...m[conn.id], loading: true, error: undefined } }));
    const [topicsRes, groupsRes] = await Promise.allSettled([
      kafkaAPI.topics(conn.id, scope),
      kafkaAPI.groups(conn.id, scope),
    ]);
    setChildren((m) => {
      const prev = m[conn.id] ?? {};
      const next: Children = { ...prev, loading: false };
      if (topicsRes.status === 'fulfilled') {
        next.topics = ((topicsRes.value.data as KafkaTopicSummary[]) ?? [])
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name));
      } else {
        next.error = extractErr(topicsRes.reason, 'Failed to load topics');
      }
      if (groupsRes.status === 'fulfilled') {
        next.groups = ((groupsRes.value.data as KafkaGroupSummary[]) ?? [])
          .slice()
          .sort((a, b) => a.group.localeCompare(b.group));
      }
      return { ...m, [conn.id]: next };
    });
  }, [connections]);

  const toggleExpand = useCallback((conn: KafkaConnection) => {
    const next = !expanded[conn.id];
    setExpanded((m) => ({ ...m, [conn.id]: next }));
    if (next) {
      setTopicsOpen((m) => (conn.id in m ? m : { ...m, [conn.id]: true }));
      setGroupsOpen((m) => (conn.id in m ? m : { ...m, [conn.id]: true }));
      if (!children[conn.id]?.topics) loadChildren(conn);
    }
  }, [expanded, children, loadChildren]);

  const openTopicTab = useCallback((conn: KafkaConnection, topic: string) => {
    addTab({
      type: 'kafka',
      name: `Kafka · ${topic}`,
      method: 'GET',
      url: '',
      kafkaConnectionId: conn.id,
      kafkaTopic: topic,
    }, true);
  }, [addTab]);

  const handleDeleteConnection = useCallback(async () => {
    if (!confirmDelete) return;
    const scopes: DBScope[] = confirmDelete.availableScopes && confirmDelete.availableScopes.length > 0
      ? (confirmDelete.availableScopes as DBScope[])
      : [confirmDelete.scope ?? 'remote'];
    await dualWrite((s) => kafkaConnectionAPI.delete(confirmDelete.id, s), scopes);
    removeLocal(confirmDelete.id);
    setConfirmDelete(null);
  }, [confirmDelete, removeLocal]);

  const handleDeleteTopic = useCallback(async () => {
    if (!deleteTopicState) return;
    const { conn, topic } = deleteTopicState;
    const scope = scopeForKafka(connections, conn.id);
    try {
      await kafkaAPI.deleteTopic(conn.id, topic, scope);
      toast({ title: t('sidebar.topicDeleted'), description: topic });
      await loadChildren(conn);
    } catch (err) {
      toast({ title: t('sidebar.deleteFailed'), description: extractErr(err, t('sidebar.couldNotDeleteTopic')), variant: 'destructive' });
    }
    setDeleteTopicState(null);
  }, [deleteTopicState, connections, toast, loadChildren, t]);

  return (
    <>
      <div className={embedded ? 'px-2 pb-1 space-y-3' : 'p-2 space-y-3'}>
        {connections.length === 0 && (loading || !loaded) ? (
          <div className={cn('flex flex-col items-center justify-center gap-1 px-4 text-center', embedded ? 'py-3' : 'min-h-[60vh]')}>
            <Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground/60 mb-2" />
            <p className="text-xs text-muted-foreground">{t('sidebar.loading')}</p>
          </div>
        ) : connections.length === 0 && embedded ? (
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px] text-muted-foreground">
            <span>{t('sidebar.empty')}</span>
            <Button size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={openAdd}>{t('sidebar.addFirst')}</Button>
          </div>
        ) : connections.length === 0 ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center gap-1 px-4 text-center">
            <Radio className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground">{t('sidebar.empty')}</p>
            <Button size="sm" className="mt-2 h-7 text-xs" onClick={openAdd}>
              {t('sidebar.addFirst')}
            </Button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {connections.map((conn) => {
              const child = children[conn.id] ?? {};
              const scope = scopeForKafka(connections, conn.id);
              const writable = canWrite(conn);
              return (
                <div key={conn.id}>
                  <div className="group flex items-center rounded hover:bg-accent/40 transition-colors">
                    <button
                      type="button"
                      onClick={() => toggleExpand(conn)}
                      className="shrink-0 p-1 cursor-pointer"
                      title={t('sidebar.topicsAndGroups')}
                    >
                      {expanded[conn.id]
                        ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleExpand(conn)}
                      className="flex-1 min-w-0 flex items-center gap-1.5 px-1 py-1 text-left"
                      title={conn.bootstrapServers}
                    >
                      <Radio className={cn('h-3.5 w-3.5 shrink-0', conn.shared ? 'text-green-500' : 'text-primary')} />
                      <span className="text-sm truncate">{conn.name}</span>
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

                  {expanded[conn.id] && (
                    <div className="pl-5 py-0.5 space-y-1">
                      {child.loading && !child.topics ? (
                        <p className="text-[10px] italic text-muted-foreground px-2 py-1 flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin" /> {t('common:loading')}
                        </p>
                      ) : child.error ? (
                        <p className="text-[10px] italic text-destructive px-2 py-0.5">{child.error}</p>
                      ) : (
                        <>
                          {/* Topics */}
                          <div>
                            <div className="group/sub flex items-center gap-1 px-1.5 py-0.5">
                              <button
                                type="button"
                                onClick={() => setTopicsOpen((m) => ({ ...m, [conn.id]: !m[conn.id] }))}
                                className="flex items-center gap-1 flex-1 min-w-0 text-left cursor-pointer"
                              >
                                {topicsOpen[conn.id]
                                  ? <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
                                  : <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />}
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  {t('sidebar.topics')}
                                </span>
                                <span className="text-[9px] text-muted-foreground/70">
                                  {child.topics?.length ?? ''}
                                </span>
                              </button>
                              {writable && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setWizardConn(conn); }}
                                  className="opacity-0 group-hover/sub:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                                  title={t('sidebar.createTopic')}
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                            {topicsOpen[conn.id] && (
                              <div className="pl-3">
                                {(child.topics ?? []).length === 0 ? (
                                  <p className="text-[10px] italic text-muted-foreground px-2 py-0.5">{t('sidebar.noTopics')}</p>
                                ) : (
                                  (child.topics ?? []).map((topic) => (
                                    <ContextMenu key={topic.name}>
                                      <ContextMenuTrigger asChild>
                                        <button
                                          type="button"
                                          onClick={() => openTopicTab(conn, topic.name)}
                                          className="w-full flex items-center gap-1 px-2 py-0.5 text-xs text-left hover:bg-accent/40 rounded text-muted-foreground hover:text-foreground"
                                          title={t('sidebar.topicTooltip', { name: topic.name, partitions: topic.partitions, rf: topic.replicationFactor })}
                                        >
                                          <Hash className="h-2.5 w-2.5 shrink-0" />
                                          <span className="truncate">{topic.name}</span>
                                          {topic.internal && (
                                            <span className="text-[8px] px-1 rounded bg-accent/60 text-muted-foreground/70 shrink-0">
                                              {t('sidebar.internal')}
                                            </span>
                                          )}
                                          <span className="text-[9px] text-muted-foreground/70 ml-auto shrink-0">
                                            {topic.partitions}p
                                          </span>
                                        </button>
                                      </ContextMenuTrigger>
                                      <ContextMenuContent className="w-48">
                                        <ContextMenuItem onClick={() => openTopicTab(conn, topic.name)}>
                                          <Eye className="h-3.5 w-3.5 mr-2" /> {t('sidebar.peekMessages')}
                                        </ContextMenuItem>
                                        <ContextMenuItem onClick={() => setConfigState({ conn, topic: topic.name })}>
                                          <Settings2 className="h-3.5 w-3.5 mr-2" /> {t('sidebar.editConfig')}
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          disabled={!writable}
                                          onClick={() => setAddPartState({ conn, topic: topic.name, current: topic.partitions })}
                                        >
                                          <Split className="h-3.5 w-3.5 mr-2" /> {t('sidebar.addPartitionsMenu')}
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          disabled={!writable}
                                          onClick={() => openTopicTab(conn, topic.name)}
                                        >
                                          <Send className="h-3.5 w-3.5 mr-2" /> {t('sidebar.publishMenu')}
                                        </ContextMenuItem>
                                        <ContextMenuSeparator />
                                        <ContextMenuItem
                                          disabled={!writable}
                                          className="text-destructive focus:text-destructive"
                                          onClick={() => setDeleteTopicState({ conn, topic: topic.name })}
                                        >
                                          <Trash2 className="h-3.5 w-3.5 mr-2" /> {t('sidebar.deleteTopicMenu')}
                                        </ContextMenuItem>
                                      </ContextMenuContent>
                                    </ContextMenu>
                                  ))
                                )}
                              </div>
                            )}
                          </div>

                          {/* Consumer groups */}
                          <div>
                            <button
                              type="button"
                              onClick={() => setGroupsOpen((m) => ({ ...m, [conn.id]: !m[conn.id] }))}
                              className="w-full flex items-center gap-1 px-1.5 py-0.5 text-left cursor-pointer"
                            >
                              {groupsOpen[conn.id]
                                ? <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
                                : <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />}
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {t('sidebar.consumerGroups')}
                              </span>
                              <span className="text-[9px] text-muted-foreground/70">
                                {child.groups?.length ?? ''}
                              </span>
                            </button>
                            {groupsOpen[conn.id] && (
                              <div className="pl-3">
                                {(child.groups ?? []).length === 0 ? (
                                  <p className="text-[10px] italic text-muted-foreground px-2 py-0.5">{t('sidebar.noGroups')}</p>
                                ) : (
                                  (child.groups ?? []).map((g) => (
                                    <GroupRow key={g.group} conn={conn} group={g} scope={scope} />
                                  ))
                                )}
                              </div>
                            )}
                          </div>
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

      <KafkaConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => fetchConnections()}
      />
      {sharing && (
        <KafkaShareDialog
          open={!!sharing}
          onOpenChange={(o) => { if (!o) setSharing(null); }}
          connection={sharing}
        />
      )}
      {wizardConn && (
        <TopicCreateWizard
          open={!!wizardConn}
          onOpenChange={(o) => { if (!o) setWizardConn(null); }}
          connection={wizardConn}
          onCreated={() => loadChildren(wizardConn)}
        />
      )}
      {configState && (
        <TopicConfigDialog
          open={!!configState}
          onOpenChange={(o) => { if (!o) setConfigState(null); }}
          connection={configState.conn}
          topic={configState.topic}
        />
      )}

      <AddPartitionsDialog
        state={addPartState}
        onClose={() => setAddPartState(null)}
        onDone={(conn) => loadChildren(conn)}
      />

      <AlertDialog open={!!deleteTopicState} onOpenChange={(o) => { if (!o) setDeleteTopicState(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.deleteTopicTitle', { topic: deleteTopicState?.topic })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sidebar.deleteTopicDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTopic}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t('sidebar.deleteTopicAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sidebar.deleteConnTitle', { name: confirmDelete?.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('sidebar.deleteConnDescription')}
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

// GroupRow — a consumer group with a click-to-open popover showing per-
// partition lag. Detail loads lazily the first time the popover opens.
function GroupRow({ conn, group, scope }: { conn: KafkaConnection; group: KafkaGroupSummary; scope: DBScope }) {
  const { t } = useTranslation('kafka');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<KafkaGroupDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next && !detail && !loading) {
      setLoading(true);
      setError('');
      kafkaAPI.groupDetail(conn.id, group.group, scope)
        .then((res) => setDetail(res.data as KafkaGroupDetail))
        .catch((err) => setError(extractErr(err, t('sidebar.loadGroupFailed'))))
        .finally(() => setLoading(false));
    }
  }, [detail, loading, conn.id, group.group, scope, t]);

  const totalLag = detail?.offsets.reduce((sum, o) => sum + (o.lag || 0), 0) ?? null;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-1 px-2 py-0.5 text-xs text-left hover:bg-accent/40 rounded text-muted-foreground hover:text-foreground"
          title={t('sidebar.groupTitle', { group: group.group, state: group.state })}
        >
          <Users className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{group.group}</span>
          <span className="text-[9px] text-muted-foreground/70 ml-auto shrink-0">{group.state}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-[360px] p-0">
        <div className="px-3 py-2 border-b">
          <div className="font-mono text-xs truncate">{group.group}</div>
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
            <Badge variant="secondary" className="text-[9px]">{group.state}</Badge>
            <span>{t(group.members === 1 ? 'sidebar.memberCountOne' : 'sidebar.memberCountOther', { count: group.members })}</span>
            {totalLag != null && <span>· {t('sidebar.totalLag', { lag: totalLag.toLocaleString() })}</span>}
          </div>
        </div>
        <div className="max-h-[280px] overflow-auto p-2">
          {loading ? (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> {t('sidebar.loadingOffsets')}
            </p>
          ) : error ? (
            <p className="text-[11px] text-destructive py-2">{error}</p>
          ) : !detail || detail.offsets.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic py-2">{t('sidebar.noCommittedOffsets')}</p>
          ) : (
            <table className="w-full text-[11px] font-mono">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="font-medium py-1 pr-2">{t('sidebar.colTopic')}</th>
                  <th className="font-medium py-1 px-1 text-right">{t('sidebar.colPart')}</th>
                  <th className="font-medium py-1 px-1 text-right">{t('sidebar.colCommitted')}</th>
                  <th className="font-medium py-1 px-1 text-right">{t('sidebar.colEnd')}</th>
                  <th className="font-medium py-1 pl-1 text-right">{t('sidebar.colLag')}</th>
                </tr>
              </thead>
              <tbody>
                {detail.offsets.map((o) => (
                  <tr key={`${o.topic}:${o.partition}`} className="border-t border-border/50">
                    <td className="py-0.5 pr-2 truncate max-w-[120px]" title={o.topic}>{o.topic}</td>
                    <td className="py-0.5 px-1 text-right">{o.partition}</td>
                    <td className="py-0.5 px-1 text-right">{o.committed}</td>
                    <td className="py-0.5 px-1 text-right">{o.end}</td>
                    <td className={cn('py-0.5 pl-1 text-right', o.lag > 0 && 'text-amber-500')}>{o.lag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// AddPartitionsDialog — bump a topic's partition count. Kafka only allows
// increases, so the new total must exceed the current count.
function AddPartitionsDialog({
  state, onClose, onDone,
}: {
  state: { conn: KafkaConnection; topic: string; current: number } | null;
  onClose: () => void;
  onDone: (conn: KafkaConnection) => void;
}) {
  const { t } = useTranslation('kafka');
  const connections = useKafkaConnectionStore((s) => s.connections);
  const { toast } = useToast();
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (state) {
      setTotal(state.current + 1);
      setError('');
    }
  }, [state]);

  const handleConfirm = async () => {
    if (!state) return;
    if (total <= state.current) {
      setError(t('sidebar.errNewTotalTooSmall', { current: state.current }));
      return;
    }
    setBusy(true);
    setError('');
    const scope = scopeForKafka(connections, state.conn.id);
    try {
      await kafkaAPI.addPartitions(state.conn.id, state.topic, total, scope);
      toast({ title: t('sidebar.partitionsAdded'), description: t('sidebar.partitionsAddedDesc', { topic: state.topic, total }) });
      onDone(state.conn);
      onClose();
    } catch (err) {
      setError(extractErr(err, t('sidebar.addPartitionsFailed')));
    }
    setBusy(false);
  };

  return (
    <Dialog open={!!state} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('sidebar.addPartitionsTitle')}</DialogTitle>
          <DialogDescription>
            <Trans
              t={t}
              i18nKey="sidebar.addPartitionsDescription"
              values={{ topic: state?.topic ?? '', current: state?.current ?? 0 }}
              components={{ mono: <span className="font-mono" /> }}
            />
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs">{t('sidebar.newTotalPartitions')}</Label>
          <Input
            type="number"
            min={(state?.current ?? 0) + 1}
            value={total}
            onChange={(e) => setTotal(parseInt(e.target.value, 10) || 0)}
            className="h-8 text-xs"
          />
          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common:cancel')}</Button>
          <Button onClick={handleConfirm} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t('sidebar.addPartitionsTitle')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}
