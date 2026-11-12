import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Edit3, KeyRound, MonitorSmartphone, MoreHorizontal, Share2, Trash2, Waypoints, ExternalLink } from 'lucide-react';
import { observabilityConnectionAPI, type DBScope } from '@/services/api';
import { useObservabilityConnectionStore } from '@/stores/observabilityConnectionStore';
import { dualWrite } from '@/stores/dbConnectionStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import type { ObservabilityConnection } from '@/types';
import { ObservabilityConnectionDialog } from './ObservabilityConnectionDialog';
import { ObservabilityShareDialog } from './ObservabilityShareDialog';
import { ProviderGlyph } from './ProviderGlyph';
import { providerMeta } from './providers';
import { useObservabilitySidebarUI } from './obsSidebarUI';
import { openConnectionMap } from '@/components/servicemap/openServiceMap';

// The APM / observability group of the Dashboards rail: one row per
// connection (provider glyph, local / cloud badges); a click opens its live
// service map.
export function ObservabilitySidebar() {
  const { t } = useTranslation('servicemap');
  const { connections, loading, loaded, fetchConnections, removeLocal } = useObservabilityConnectionStore();
  const dialogOpen = useObservabilitySidebarUI((s) => s.dialogOpen);
  const editing = useObservabilitySidebarUI((s) => s.editing);
  const openEdit = useObservabilitySidebarUI((s) => s.openEdit);
  const setDialogOpen = useObservabilitySidebarUI((s) => s.setDialogOpen);
  const [sharing, setSharing] = useState<ObservabilityConnection | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ObservabilityConnection | null>(null);

  useEffect(() => { void fetchConnections(); }, [fetchConnections]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const scopes: DBScope[] = confirmDelete.availableScopes?.length ? (confirmDelete.availableScopes as DBScope[]) : [confirmDelete.beScope ?? 'remote'];
    await dualWrite((s) => observabilityConnectionAPI.delete(confirmDelete.id, s), scopes);
    removeLocal(confirmDelete.id);
    setConfirmDelete(null);
  }, [confirmDelete, removeLocal]);

  return (
    <>
      <div className="px-2 pb-1 space-y-0.5">
        {connections.length === 0 ? (
          <p className="px-2 py-1 text-[11px] text-muted-foreground/80">{loading || !loaded ? t('sidebar.loading') : t('sidebar.empty')}</p>
        ) : connections.map((conn) => (
          <div key={conn.id} className="group flex items-center rounded hover:bg-accent/40 transition-colors">
            <button type="button" onClick={() => openConnectionMap(conn)} className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 text-left" title={`${providerMeta(conn.provider).title} · ${conn.url}`}>
              <ProviderGlyph provider={conn.provider} className="h-3.5 w-3.5" />
              <span className="text-sm truncate">{conn.name}</span>
              <span className="text-[9px] text-muted-foreground/70 shrink-0">{providerMeta(conn.provider).title}</span>
              {conn.authKind === 'session' && (
                <Badge variant="secondary" className="text-[8px] px-1 py-0 shrink-0"><KeyRound className="h-2 w-2 mr-0.5" />{t('sidebar.sessionBadge')}</Badge>
              )}
              <span className="flex items-center gap-0.5 shrink-0 ml-auto">
                <MonitorSmartphone className={cn('h-2.5 w-2.5', (conn.availableScopes ?? []).includes('local') ? 'text-emerald-500/80' : 'text-muted-foreground/30')} />
                <Cloud className={cn('h-2.5 w-2.5', (conn.availableScopes ?? []).includes('remote') ? 'text-sky-500/80' : 'text-muted-foreground/30')} />
              </span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" aria-label={t('sidebar.actions')}>
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => openConnectionMap(conn)}>
                  <Waypoints className="h-3.5 w-3.5 mr-2" /> {t('sidebar.openMap')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(conn.url, '_blank', 'noopener')}>
                  <ExternalLink className="h-3.5 w-3.5 mr-2" /> {t('sidebar.openSite', { provider: providerMeta(conn.provider).title })}
                </DropdownMenuItem>
                {!conn.shared && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => openEdit(conn)}><Edit3 className="h-3.5 w-3.5 mr-2" /> {t('common:edit')}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSharing(conn)}><Share2 className="h-3.5 w-3.5 mr-2" /> {t('sidebar.share')}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setConfirmDelete(conn)} className="text-destructive focus:text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> {t('common:delete')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>

      <ObservabilityConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} onSaved={() => fetchConnections()} />
      {sharing && <ObservabilityShareDialog open={!!sharing} onOpenChange={(o) => { if (!o) setSharing(null); }} connection={sharing} />}
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
