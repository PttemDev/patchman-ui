import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  RefreshCw,
  MoreHorizontal,
  Edit3,
  Trash2,
  Share2,
  MonitorSmartphone,
  Cloud,
  Loader2,
  Download,
  Copy,
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
import { K8sIcon } from '@/components/icons/K8sIcon';
import { useK8sConnectionStore, scopeForK8s } from '@/stores/k8sConnectionStore';
import { dualWrite } from '@/stores/dbConnectionStore';
import { useRequestStore } from '@/stores/requestStore';
import { k8sConnectionAPI, type DBScope } from '@/services/api';
import { cn } from '@/lib/utils';
import { downloadText } from '@/lib/downloadText';
import { useToast } from '@/components/ui/use-toast';
import type { K8sConnection } from '@/types';
import { K8sConnectionDialog } from './K8sConnectionDialog';
import { createSidebarDialogStore } from '@/stores/sidebarDialogStore';

const useK8sConnectionSidebarUI = createSidebarDialogStore<K8sConnection>();

// K8sHeaderActions — Refresh + New in the shared panel header, replacing the in-body
// connections sub-header row.
export function K8sHeaderActions() {
  const { t } = useTranslation('k8s');
  const fetchConnections = useK8sConnectionStore((s) => s.fetchConnections);
  const openAdd = useK8sConnectionSidebarUI((s) => s.openAdd);
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
import { K8sShareDialog } from './K8sShareDialog';

// K8sSidebar mirrors ESSidebar: a list of Kubernetes connections. Clicking a
// connection opens the cluster-explorer tab (type 'k8s'), seeded with the
// connection's default context; the 3-dot menu exposes edit / share / delete.
// New / Refresh live in the header. The explorer itself (kind nav + resource
// table + detail drawer) is the tab panel, not the sidebar tree.
export function K8sSidebar() {
  const { t } = useTranslation('k8s');
  const { connections, loading, loaded, fetchConnections, removeLocal } = useK8sConnectionStore();
  const addTab = useRequestStore((s) => s.addTab);

  const dialogOpen = useK8sConnectionSidebarUI((s) => s.dialogOpen);
  const editing = useK8sConnectionSidebarUI((s) => s.editing);
  const openEdit = useK8sConnectionSidebarUI((s) => s.openEdit);
  const openAdd = useK8sConnectionSidebarUI((s) => s.openAdd);
  const setDialogOpen = useK8sConnectionSidebarUI((s) => s.setDialogOpen);
  const [sharing, setSharing] = useState<K8sConnection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<K8sConnection | null>(null);
  const { toast } = useToast();

  // Owner-only (the BE refuses anyone else; the menu only shows for own
  // connections). Audited BE-side as revealed_secret.
  const withKubeconfig = useCallback(async (conn: K8sConnection, use: (kubeconfig: string) => Promise<void> | void) => {
    try {
      const res = await k8sConnectionAPI.revealSecret(conn.id, scopeForK8s(connections, conn.id));
      const kubeconfig = (res.data as { kubeconfig?: string })?.kubeconfig ?? '';
      if (!kubeconfig) throw new Error(t('sidebar.kubeconfigEmpty'));
      await use(kubeconfig);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      toast({ title: t('sidebar.kubeconfigFailed'), description: e.response?.data?.error ?? e.message, variant: 'destructive' });
    }
  }, [connections, t, toast]);
  const downloadKubeconfig = (conn: K8sConnection) => withKubeconfig(conn, (k) => {
    downloadText(`${conn.name.replace(/[^\w.-]+/g, '_') || 'kubeconfig'}.kubeconfig.yaml`, k, 'application/yaml;charset=utf-8');
  });
  const copyKubeconfig = (conn: K8sConnection) => withKubeconfig(conn, async (k) => {
    await navigator.clipboard.writeText(k);
    toast({ title: t('sidebar.kubeconfigCopied') });
  });

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const openConnTab = useCallback((conn: K8sConnection) => {
    addTab({
      type: 'k8s',
      name: `K8s · ${conn.name}`,
      method: 'GET',
      url: '',
      k8sConnectionId: conn.id,
      k8sContext: conn.defaultContext,
    }, true);
  }, [addTab]);

  const handleDeleteConnection = useCallback(async () => {
    if (!confirmDelete) return;
    const scopes: DBScope[] = confirmDelete.availableScopes && confirmDelete.availableScopes.length > 0
      ? (confirmDelete.availableScopes as DBScope[])
      : [confirmDelete.scope ?? 'remote'];
    await dualWrite((s) => k8sConnectionAPI.delete(confirmDelete.id, s), scopes);
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
            <K8sIcon className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground">{t('sidebar.empty')}</p>
            <Button size="sm" className="mt-2 h-7 text-xs" onClick={openAdd}>
              {t('sidebar.addFirst')}
            </Button>
          </div>
        ) : (
          <div className="space-y-0.5">
            {connections.map((conn) => (
              <div key={conn.id} className="group flex items-center rounded hover:bg-accent/40 transition-colors">
                <button
                  type="button"
                  onClick={() => openConnTab(conn)}
                  className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 text-left"
                  title={conn.defaultContext}
                >
                  <K8sIcon className={cn('h-3.5 w-3.5 shrink-0', conn.shared ? 'text-green-500' : 'text-blue-500')} />
                  <span className="text-sm truncate">{conn.name}</span>
                  {conn.defaultContext && (
                    <Badge variant="secondary" className="text-[8px] px-1 py-0 shrink-0 max-w-[70px] truncate">
                      {conn.defaultContext}
                    </Badge>
                  )}
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
                      {conn.hasKubeconfig && (
                        <>
                          <DropdownMenuItem onClick={() => void downloadKubeconfig(conn)}>
                            <Download className="h-3.5 w-3.5 mr-2" /> {t('sidebar.downloadKubeconfig')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void copyKubeconfig(conn)}>
                            <Copy className="h-3.5 w-3.5 mr-2" /> {t('sidebar.copyKubeconfig')}
                          </DropdownMenuItem>
                        </>
                      )}
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

      <K8sConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={() => fetchConnections()}
      />
      {sharing && (
        <K8sShareDialog
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
