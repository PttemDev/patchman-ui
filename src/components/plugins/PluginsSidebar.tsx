import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Pencil, Plus, Puzzle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/use-toast';
import { pluginAPI, type PluginConnection, type PluginInfo } from '@/lib/plugins/pluginApi';
import { usePluginStore } from '@/stores/pluginStore';
import { useRequestStore } from '@/stores/requestStore';
import { useSettingsUIStore } from '@/stores/settingsUIStore';
import { PluginConnectionDialog } from './PluginConnectionDialog';
import { errorMessage } from './util';

// The "Plugins" rail: every enabled plugin with its connections. Clicking a
// connection opens a `type: 'plugin'` tab on it.
export function PluginsSidebar() {
  const { t } = useTranslation('plugins');
  const plugins = usePluginStore((s) => s.plugins);
  const loaded = usePluginStore((s) => s.loaded);
  const error = usePluginStore((s) => s.error);
  const fetchPlugins = usePluginStore((s) => s.fetchPlugins);
  const openSettings = useSettingsUIStore((s) => s.openSettings);

  useEffect(() => {
    void fetchPlugins();
  }, [fetchPlugins]);

  const enabled = plugins.filter((p) => p.enabled);
  return (
    <div className="flex h-full flex-col overflow-y-auto p-2 text-sm">
      {loaded && enabled.length === 0 && (
        <div className="space-y-2 p-3 text-xs text-muted-foreground">
          <p>{error ? t('sidebar.loadError', { error }) : t('sidebar.empty')}</p>
          <Button size="sm" variant="outline" onClick={() => openSettings('plugins')}>{t('sidebar.manage')}</Button>
        </div>
      )}
      {enabled.map((p) => (
        <PluginSection key={p.id} plugin={p} />
      ))}
    </div>
  );
}

function PluginSection({ plugin }: { plugin: PluginInfo }) {
  const { t } = useTranslation('plugins');
  const { toast } = useToast();
  const [open, setOpen] = useState(true);
  const [dialog, setDialog] = useState<{ editing: PluginConnection | null } | null>(null);
  const conns = usePluginStore((s) => s.connections[plugin.id]);
  const fetchConnections = usePluginStore((s) => s.fetchConnections);
  const removeConnection = usePluginStore((s) => s.removeConnection);
  const addTab = useRequestStore((s) => s.addTab);

  useEffect(() => {
    void fetchConnections(plugin.id);
  }, [plugin.id, fetchConnections]);

  const openTab = (c: PluginConnection) =>
    addTab({ type: 'plugin', name: `${plugin.name} · ${c.name}`, method: 'GET', url: '', pluginId: plugin.id, pluginConnectionId: c.id }, true);

  const remove = async (c: PluginConnection) => {
    const ok = await confirmDialog({ title: t('sidebar.deleteTitle', { name: c.name }), description: t('sidebar.deleteBody'), destructive: true });
    if (!ok) return;
    try {
      await pluginAPI.deleteConnection(plugin.id, c.id);
      removeConnection(plugin.id, c.id);
    } catch (err) {
      toast({ title: t('sidebar.deleteFailed'), description: errorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <div className="mb-2">
      <div className="group flex items-center gap-1 rounded px-1 py-1 hover:bg-accent/40">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Puzzle className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate font-medium">{plugin.name}</span>
        </button>
        <button type="button" aria-label={t('sidebar.addConnection')} title={t('sidebar.addConnection')} onClick={() => setDialog({ editing: null })} className="rounded p-0.5 hover:bg-accent">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <ul className="ml-5">
          {(conns ?? []).length === 0 && <li className="px-1 py-1 text-xs text-muted-foreground">{t('sidebar.noConnections')}</li>}
          {(conns ?? []).map((c) => (
            <li key={c.id} className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent/40">
              <button type="button" className="min-w-0 flex-1 truncate text-left text-xs" onClick={() => openTab(c)}>
                {c.name}
                {c.shared && <span className="ml-1 text-muted-foreground">({c.ownerName})</span>}
              </button>
              {!c.shared && (
                <>
                  <button type="button" aria-label={t('sidebar.edit')} className="hidden rounded p-0.5 hover:bg-accent group-hover:block" onClick={() => setDialog({ editing: c })}>
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button type="button" aria-label={t('sidebar.delete')} className="hidden rounded p-0.5 hover:bg-accent group-hover:block" onClick={() => remove(c)}>
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {dialog && (
        <PluginConnectionDialog plugin={plugin} open onOpenChange={(o) => !o && setDialog(null)} editing={dialog.editing} />
      )}
    </div>
  );
}
