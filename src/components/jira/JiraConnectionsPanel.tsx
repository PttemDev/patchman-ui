import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Loader2, Pencil, Plus, Server, Share2, Ticket, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { jiraAPI, type DBScope } from '@/services/api';
import { useJiraConnectionStore } from '@/stores/jiraConnectionStore';
import { availableDBScopes, dualWrite } from '@/stores/dbConnectionStore';
import { isDesktop } from '@/lib/platform';
import type { JiraConnection } from '@/types';
import { JiraConnectionDialog } from './JiraConnectionDialog';
import { JiraShareDialog } from './JiraShareDialog';
import { jiraErr } from './jiraUtil';

// The Jira connection list with add / edit / delete / share. Shown in
// Settings → Jira; exported so the QA Hub's settings can show the same list
// (CR_QA_P0_PLAN.md P0.b).
export function JiraConnectionsPanel() {
  const { t } = useTranslation('jira');
  const { toast } = useToast();
  const { connections, loading, loaded, fetchConnections, removeLocal } = useJiraConnectionStore();
  const [editing, setEditing] = useState<JiraConnection | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sharing, setSharing] = useState<JiraConnection | null>(null);
  const [busy, setBusy] = useState('');

  useEffect(() => { void fetchConnections(); }, [fetchConnections]);

  const openNew = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (c: JiraConnection) => { setEditing(c); setDialogOpen(true); };

  const del = async (c: JiraConnection) => {
    if (!(await confirmDialog({ title: t('panel.deleteTitle', { name: c.name }), description: t('panel.deleteBody'), destructive: true }))) return;
    setBusy(c.id);
    const scopes: DBScope[] = c.availableScopes?.length ? (c.availableScopes as DBScope[]) : availableDBScopes();
    const results = await dualWrite((s) => jiraAPI.delete(c.id, s), scopes);
    setBusy('');
    if (results.every((r) => !r.ok)) {
      toast({ title: t('panel.deleteFailed'), description: jiraErr(results[0]?.error, ''), variant: 'destructive' });
      return;
    }
    removeLocal(c.id);
  };

  return (
    <div className="max-w-xl space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Ticket className="h-4 w-4 text-sky-500" />
        <div className="text-sm font-medium">{t('panel.title')}</div>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-xs" onClick={openNew}>
          <Plus className="h-3.5 w-3.5" />{t('panel.add')}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t('panel.hint')}</p>
      <div className="space-y-1.5">
        {connections.map((c) => {
          const owner = !c.shared;
          return (
            <div key={c.id} className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs">
              {c.flavor === 'datacenter' ? <Server className="h-4 w-4 text-indigo-500" /> : <Cloud className="h-4 w-4 text-sky-500" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{c.name}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {c.flavor === 'datacenter' ? t('dialog.datacenter') : t('dialog.cloud')} · {c.baseUrl}
                  {c.options?.acFieldId ? ` · ${t('panel.acField', { id: c.options.acFieldId })}` : ` · ${t('panel.noAcField')}`}
                </div>
              </div>
              {c.shared && <Badge variant="secondary" className="text-[9px]">{t('panel.sharedBy', { name: c.ownerName || '—' })}</Badge>}
              {c.scope === 'local' && isDesktop() && <Badge variant="outline" className="text-[9px]">{t('panel.thisComputer')}</Badge>}
              {owner && (
                <>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEdit(c)} aria-label={t('panel.edit')} title={t('panel.edit')}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSharing(c)} aria-label={t('panel.share')} title={t('panel.share')}>
                    <Share2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" disabled={busy === c.id} onClick={() => void del(c)} aria-label={t('common:delete')} title={t('common:delete')}>
                    {busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </>
              )}
            </div>
          );
        })}
        {loaded && !loading && connections.length === 0 && <p className="text-xs text-muted-foreground">{t('panel.none')}</p>}
      </div>

      <JiraConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
      {sharing && <JiraShareDialog open={!!sharing} onOpenChange={(o) => { if (!o) setSharing(null); }} connection={sharing} />}
    </div>
  );
}
