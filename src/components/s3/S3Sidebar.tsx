import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cloud,
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Edit3,
  Trash2,
  Share2,
  Database,
  MonitorSmartphone,
  Loader2,
} from 'lucide-react';
import { useS3ConnectionStore } from '@/stores/s3ConnectionStore';
import { dualWrite } from '@/stores/dbConnectionStore';
import { s3API, s3ConnectionAPI, type DBScope } from '@/services/api';
import { useRequestStore } from '@/stores/requestStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';
import type { S3Bucket, S3Connection } from '@/types';
import { S3ConnectionDialog } from './S3ConnectionDialog';
import { createSidebarDialogStore } from '@/stores/sidebarDialogStore';

const useS3ConnectionSidebarUI = createSidebarDialogStore<S3Connection>();

// S3HeaderActions — Refresh + New in the shared panel header, replacing the in-body
// connections sub-header row.
export function S3HeaderActions() {
  const { t } = useTranslation('s3');
  const fetchConnections = useS3ConnectionStore((s) => s.fetchConnections);
  const openAdd = useS3ConnectionSidebarUI((s) => s.openAdd);
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
import { S3ShareDialog } from './S3ShareDialog';

// S3Sidebar mirrors DBSidebar — a list of object-storage connections with
// a badge for provider + scope. Expanding a connection lazy-loads its
// buckets; clicking a bucket opens an S3 browser tab preselected on it.
export function S3Sidebar() {
  const { t } = useTranslation('s3');
  const { connections, loading, loaded, fetchConnections, removeLocal } = useS3ConnectionStore();
  const addTab = useRequestStore((s) => s.addTab);

  const dialogOpen = useS3ConnectionSidebarUI((s) => s.dialogOpen);
  const editing = useS3ConnectionSidebarUI((s) => s.editing);
  const openEdit = useS3ConnectionSidebarUI((s) => s.openEdit);
  const openAdd = useS3ConnectionSidebarUI((s) => s.openAdd);
  const setDialogOpen = useS3ConnectionSidebarUI((s) => s.setDialogOpen);
  const [confirmDelete, setConfirmDelete] = useState<S3Connection | null>(null);
  const [sharing, setSharing] = useState<S3Connection | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [buckets, setBuckets] = useState<Record<string, S3Bucket[]>>({});
  const [bucketsLoading, setBucketsLoading] = useState<Record<string, boolean>>({});
  const [bucketsError, setBucketsError] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const loadBuckets = useCallback(async (conn: S3Connection) => {
    setBucketsLoading((m) => ({ ...m, [conn.id]: true }));
    setBucketsError((m) => ({ ...m, [conn.id]: '' }));
    try {
      const res = await s3API.buckets(conn.id, conn.scope);
      setBuckets((m) => ({ ...m, [conn.id]: (res.data as S3Bucket[]) ?? [] }));
    } catch (err) {
      setBucketsError((m) => ({ ...m, [conn.id]: extractErr(err, t('sidebar.loadBucketsFailed')) }));
    } finally {
      setBucketsLoading((m) => ({ ...m, [conn.id]: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleExpand = useCallback(async (conn: S3Connection) => {
    const next = !expanded[conn.id];
    setExpanded((m) => ({ ...m, [conn.id]: next }));
    if (next && !buckets[conn.id]) {
      await loadBuckets(conn);
    }
  }, [expanded, buckets, loadBuckets]);

  const openBucketTab = useCallback((conn: S3Connection, bucket: string) => {
    addTab(
      {
        type: 's3',
        name: `S3 · ${bucket}`,
        method: 'GET',
        url: '',
        s3ConnectionId: conn.id,
        s3Bucket: bucket,
        s3Prefix: '',
      },
      true,
    );
  }, [addTab]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const scopes: DBScope[] = confirmDelete.availableScopes && confirmDelete.availableScopes.length > 0
      ? (confirmDelete.availableScopes as DBScope[])
      : [confirmDelete.scope ?? 'remote'];
    await dualWrite((s) => s3ConnectionAPI.delete(confirmDelete.id, s), scopes);
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
            <Cloud className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
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
                    className="shrink-0 p-1 cursor-pointer"
                    title={t('sidebar.buckets')}
                  >
                    {expanded[conn.id]
                      ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleExpand(conn)}
                    className="flex-1 min-w-0 flex items-center gap-1.5 px-1 py-1 text-left"
                    title={conn.name}
                  >
                    <Cloud className={cn('h-3.5 w-3.5 shrink-0', conn.shared ? 'text-green-500' : 'text-primary')} />
                    <span className="text-sm truncate">{conn.name}</span>
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0 uppercase">
                      {conn.provider}
                    </Badge>
                    <span className="flex items-center gap-0.5 shrink-0 ml-auto">
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
                      <span className="text-[9px] text-muted-foreground/70">{t(`roles.${conn.grantRole ?? 'read'}`)}</span>
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
                          <Edit3 className="h-3.5 w-3.5 mr-2" />
                          {t('common:edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSharing(conn)}>
                          <Share2 className="h-3.5 w-3.5 mr-2" />
                          {t('sidebar.share')}
                        </DropdownMenuItem>
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
                  <div className="pl-5 py-0.5">
                    <div className="flex items-center gap-1 px-1.5 py-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('sidebar.buckets')}
                      </span>
                      <span className="text-[9px] text-muted-foreground/70">
                        {buckets[conn.id]?.length ?? ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => loadBuckets(conn)}
                        className="ml-auto text-muted-foreground hover:text-foreground"
                        title={t('sidebar.refreshBuckets')}
                      >
                        <RefreshCw className={cn('h-2.5 w-2.5', bucketsLoading[conn.id] && 'animate-spin')} />
                      </button>
                    </div>
                    <div className="pl-2">
                      {bucketsLoading[conn.id] && !buckets[conn.id] ? (
                        <p className="text-[10px] italic text-muted-foreground px-2 py-0.5">{t('common:loading')}</p>
                      ) : bucketsError[conn.id] ? (
                        <p className="text-[10px] italic text-destructive px-2 py-0.5">{bucketsError[conn.id]}</p>
                      ) : (buckets[conn.id] ?? []).length === 0 ? (
                        <p className="text-[10px] italic text-muted-foreground px-2 py-0.5">{t('sidebar.noBuckets')}</p>
                      ) : (
                        (buckets[conn.id] ?? []).map((b) => (
                          <button
                            key={b.name}
                            type="button"
                            onClick={() => openBucketTab(conn, b.name)}
                            className="w-full flex items-center gap-1.5 px-2 py-0.5 text-xs text-left hover:bg-accent/40 rounded text-muted-foreground hover:text-foreground"
                            title={b.name}
                          >
                            <Database className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{b.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <S3ConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => fetchConnections()}
      />
      {sharing && (
        <S3ShareDialog
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

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}
