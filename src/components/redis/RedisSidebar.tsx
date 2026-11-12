import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Database,
  Plus,
  RefreshCw,
  MoreHorizontal,
  Edit3,
  Trash2,
  Share2,
  MonitorSmartphone,
  Cloud,
  Loader2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
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
import { useRedisConnectionStore } from '@/stores/redisConnectionStore';
import { dualWrite, describePartialWrite } from '@/stores/dbConnectionStore';
import { useToast } from '@/components/ui/use-toast';
import { useRequestStore } from '@/stores/requestStore';
import { redisConnectionAPI, type DBScope } from '@/services/api';
import { cn } from '@/lib/utils';
import type { RedisConnection } from '@/types';
import { RedisConnectionDialog } from './RedisConnectionDialog';
import { RedisShareDialog } from './RedisShareDialog';
import { createSidebarDialogStore } from '@/stores/sidebarDialogStore';

const useRedisSidebarUI = createSidebarDialogStore<RedisConnection>();

// RedisHeaderActions — Refresh + New in the shared panel header, replacing the
// in-body "REDIS CONNECTIONS" sub-header row.
export function RedisHeaderActions() {
  const { t } = useTranslation('redis');
  const fetchConnections = useRedisConnectionStore((s) => s.fetchConnections);
  const openAdd = useRedisSidebarUI((s) => s.openAdd);
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

// RedisSidebar mirrors KafkaSidebar: a list of Redis connections. Clicking a
// connection opens a Redis key-browser tab; the 3-dot menu exposes edit /
// share / delete. New / Refresh live in the header. Key browsing itself
// happens in the tab panel (RedisKeyPanel), not the sidebar tree.
export function RedisSidebar() {
  const { t } = useTranslation('redis');
  const { connections, loading, loaded, fetchConnections, removeLocal, setAllowWrite } = useRedisConnectionStore();
  const { toast } = useToast();
  const addTab = useRequestStore((s) => s.addTab);

  const dialogOpen = useRedisSidebarUI((s) => s.dialogOpen);
  const editing = useRedisSidebarUI((s) => s.editing);
  const openEdit = useRedisSidebarUI((s) => s.openEdit);
  const openAdd = useRedisSidebarUI((s) => s.openAdd);
  const setDialogOpen = useRedisSidebarUI((s) => s.setDialogOpen);
  const [sharing, setSharing] = useState<RedisConnection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RedisConnection | null>(null);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const openConnTab = useCallback((conn: RedisConnection) => {
    addTab({
      type: 'redis',
      name: `Redis · ${conn.name}`,
      method: 'GET',
      url: '',
      redisConnectionId: conn.id,
      redisDb: conn.dbIndex ?? 0,
    }, true);
  }, [addTab]);

  const handleDeleteConnection = useCallback(async () => {
    if (!confirmDelete) return;
    const scopes: DBScope[] = confirmDelete.availableScopes && confirmDelete.availableScopes.length > 0
      ? (confirmDelete.availableScopes as DBScope[])
      : [confirmDelete.scope ?? 'remote'];
    await dualWrite((s) => redisConnectionAPI.delete(confirmDelete.id, s), scopes);
    removeLocal(confirmDelete.id);
    setConfirmDelete(null);
  }, [confirmDelete, removeLocal]);

  // Read-write switch (⋯ menu), dual-written like the DB one.
  const toggleAllowWrite = useCallback(async (conn: RedisConnection) => {
    const next = !conn.allowWrite;
    const scopes: DBScope[] = conn.availableScopes && conn.availableScopes.length > 0
      ? (conn.availableScopes as DBScope[])
      : [conn.scope ?? 'remote'];
    const results = await setAllowWrite(conn.id, next);
    if (!results.some((r) => r.ok)) {
      toast({ title: t('sidebar.modeFailTitle'), description: t('sidebar.modeFailDesc'), variant: 'destructive' });
      return;
    }
    const partial = describePartialWrite(results, scopes, next ? t('sidebar.enabledRw') : t('sidebar.setReadonly'));
    if (partial) toast(partial);
  }, [setAllowWrite, toast, t]);

  return (
    <>
      <div>
        {connections.length === 0 && (loading || !loaded) ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center gap-1 px-4 text-center">
            <Loader2 className="h-5 w-5 mx-auto animate-spin text-muted-foreground/60 mb-2" />
            <p className="text-xs text-muted-foreground">{t('sidebar.loading')}</p>
          </div>
        ) : connections.length === 0 ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center gap-1 px-4 text-center">
            <Database className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground">{t('sidebar.empty')}</p>
            <Button size="sm" className="mt-2 h-7 text-xs" onClick={openAdd}>
              {t('sidebar.addFirst')}
            </Button>
          </div>
        ) : (
          <div className="space-y-0.5 p-2">
            {connections.map((conn) => (
              <div key={conn.id} className="group flex items-center rounded hover:bg-accent/40 transition-colors">
                <button
                  type="button"
                  onClick={() => openConnTab(conn)}
                  className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 text-left"
                  title={conn.address}
                >
                  <Database className={cn('h-3.5 w-3.5 shrink-0', conn.shared ? 'text-green-500' : 'text-red-500')} />
                  <span className="text-sm truncate">{conn.name}</span>
                  <span
                    title={conn.allowWrite ? t('sidebar.rwTitle') : t('sidebar.readonlyTitle')}
                    className={cn(
                      'shrink-0 rounded px-1 text-[8px] font-bold leading-[1.4] border cursor-default',
                      conn.allowWrite
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40'
                        : 'bg-muted text-muted-foreground/60 border-transparent',
                    )}
                  >
                    {conn.allowWrite ? 'R+W' : 'R'}
                  </span>
                  <Badge variant="secondary" className="text-[8px] px-1 py-0 shrink-0">{conn.mode}</Badge>
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
                      <DropdownMenuCheckboxItem
                        checked={!!conn.allowWrite}
                        onCheckedChange={() => void toggleAllowWrite(conn)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {t('sidebar.rwMode')}
                      </DropdownMenuCheckboxItem>
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
            ))}
          </div>
        )}
      </div>

      <RedisConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => fetchConnections()}
      />
      {sharing && (
        <RedisShareDialog
          open={!!sharing}
          onOpenChange={(o) => { if (!o) setSharing(null); }}
          connection={sharing}
        />
      )}

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
