import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, Loader2, Puzzle, ShieldAlert, Trash2 } from 'lucide-react';
import { isDesktop } from '@/lib/platform';
import { restartPluginDevMode } from '@/lib/plugins/devMode';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { confirmDialog } from '@/components/ui/confirm';
import { pluginAPI, type PluginInfo, type PluginNetRule } from '@/lib/plugins/pluginApi';
import { usePluginStore } from '@/stores/pluginStore';
import { errorMessage } from '@/components/plugins/util';
import { PluginInstallBox, PluginPreviewCard } from '@/components/plugins/PluginInstallBox';
import { TrustedKeysPanel } from '@/components/plugins/TrustedKeysPanel';
import type { InstallPreview } from '@/lib/plugins/pluginApi';

// Settings > Plugins (RFC §16 P4b): installed plugins with what each may do,
// enable/disable, uninstall and — in developer mode only — install from a
// local folder. Install, uninstall and reveal ask for step-up on desktop.

function netLabel(r: PluginNetRule, privateLabel: string): string {
  const host = r.host ?? `{${r.from}}`;
  const ports = r.ports?.join(',') ?? `{${r.portsFrom}}`;
  return `${host}:${ports}${r.private ? ` (${privateLabel})` : ''}`;
}

export function PluginsSection() {
  const { t } = useTranslation('plugins');
  const plugins = usePluginStore((s) => s.plugins);
  const devInstall = usePluginStore((s) => s.devInstall);
  const manage = usePluginStore((s) => s.manage);
  const loaded = usePluginStore((s) => s.loaded);
  const error = usePluginStore((s) => s.error);
  const fetchPlugins = usePluginStore((s) => s.fetchPlugins);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void fetchPlugins();
  }, [fetchPlugins]);

  const install = async () => {
    if (!path.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await pluginAPI.devInstall(path.trim());
      const added = r.addedPermissions ?? [];
      setNotice({
        ok: true,
        text: r.reinstall
          ? added.length > 0
            ? t('settings.reinstalledWider', { name: r.data.name, version: r.data.version, added: added.join(', ') })
            : t('settings.reinstalled', { name: r.data.name, version: r.data.version })
          : t('settings.installed', { name: r.data.name, version: r.data.version }),
      });
      await fetchPlugins();
    } catch (err) {
      setNotice({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t('settings.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('settings.intro')}</p>
      </div>

      {manage && <PluginInstallBox />}
      {manage && <TrustedKeysPanel />}

      {manage && !devInstall && isDesktop() && <DevModeBox />}

      {devInstall && (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-xs font-medium">{t('settings.devTitle')}</p>
          <p className="text-[11px] text-muted-foreground">{t('settings.devHint')}</p>
          <div className="flex gap-2">
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/me/my-plugin" className="font-mono text-xs" />
            <Button size="sm" onClick={install} disabled={busy || !path.trim()}>
              {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {t('settings.install')}
            </Button>
          </div>
        </div>
      )}
      {notice && <p className={`break-all text-xs ${notice.ok ? 'text-emerald-600' : 'text-destructive'}`}>{notice.text}</p>}
      {error && <p className="text-xs text-destructive">{t('sidebar.loadError', { error })}</p>}
      {loaded && plugins.length === 0 && !error && <p className="text-xs text-muted-foreground">{t('settings.none')}</p>}

      {plugins.map((p) => (
        <PluginCard key={p.id} plugin={p} canManage={manage} onChanged={fetchPlugins} />
      ))}
    </div>
  );
}

// Restart into plugin developer mode for one session (Touch ID first).
function DevModeBox() {
  const { t } = useTranslation('plugins');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const start = async () => {
    const ok = await confirmDialog({
      title: t('devMode.confirmTitle'),
      description: t('devMode.confirmBody'),
      confirmLabel: t('devMode.restart'),
    });
    if (!ok) return;
    setBusy(true);
    setErr('');
    try {
      await restartPluginDevMode(true);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
        {t('devMode.title')}
      </p>
      <p className="text-[11px] text-muted-foreground">{t('devMode.hint')}</p>
      <Button size="sm" variant="outline" onClick={start} disabled={busy}>
        {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {t('devMode.restart')}
      </Button>
      {err && <p className="break-all text-xs text-destructive">{err}</p>}
    </div>
  );
}

function PluginCard({ plugin, canManage, onChanged }: { plugin: PluginInfo; canManage: boolean; onChanged: () => Promise<void> }) {
  const { t } = useTranslation('plugins');
  const [err, setErr] = useState('');
  const [update, setUpdate] = useState<InstallPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [token, setToken] = useState('');
  const ops = Object.entries(plugin.ops);

  const checkUpdate = async () => {
    if (!plugin.sourcePath) return;
    setErr('');
    setChecking(true);
    try {
      setUpdate(await pluginAPI.preview(plugin.sourcePath, token));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };
  const applyUpdate = async () => {
    if (!plugin.sourcePath) return;
    setUpdating(true);
    setErr('');
    try {
      await pluginAPI.install(plugin.sourcePath, token);
      setUpdate(null);
      await onChanged();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setUpdating(false);
    }
  };
  const writes = ops.filter(([, o]) => o.write).map(([n]) => n);
  const sensitive = ops.filter(([, o]) => o.sensitive).map(([n]) => n);

  const toggle = async (enabled: boolean) => {
    setErr('');
    try {
      await pluginAPI.setEnabled(plugin.id, enabled);
      await onChanged();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const uninstall = async () => {
    const ok = await confirmDialog({
      title: t('settings.uninstallTitle', { name: plugin.name }),
      description: t('settings.uninstallBody'),
      confirmLabel: t('settings.uninstall'),
      destructive: true,
    });
    if (!ok) return;
    setErr('');
    try {
      await pluginAPI.uninstall(plugin.id);
      usePluginStore.setState((s) => {
        const next = { ...s.connections };
        delete next[plugin.id];
        return { connections: next };
      });
      await onChanged();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <Puzzle className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{plugin.name}</span>
            <span className="text-xs text-muted-foreground">{plugin.version}</span>
            {plugin.source === 'dev' && <Badge variant="outline" className="border-amber-500/50 text-[10px] text-amber-600">{t('settings.devBadge')}</Badge>}
            {plugin.source === 'signed' && <Badge variant="outline" className="border-emerald-500/50 text-[10px] text-emerald-600">{t('settings.signedBadge', { key: plugin.signer })}</Badge>}
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{plugin.id} · {plugin.publisher}</p>
          {plugin.description && <p className="mt-1 text-xs">{plugin.description}</p>}
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Switch checked={plugin.enabled} onCheckedChange={toggle} aria-label={t('settings.enabled')} />
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={uninstall} aria-label={t('settings.uninstall')}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1 text-[11px]">
        <dt className="text-muted-foreground">{t('settings.net')}</dt>
        <dd className="break-all font-mono">{(plugin.permissions.net ?? []).map((r) => netLabel(r, t('settings.private'))).join(' · ') || t('settings.noNet')}</dd>
        <dt className="text-muted-foreground">{t('settings.secrets')}</dt>
        <dd className="font-mono">{(plugin.connection.secretFields ?? []).join(', ') || '—'}</dd>
        <dt className="text-muted-foreground">{t('settings.writeOps')}</dt>
        <dd className="font-mono">{writes.join(', ') || '—'}</dd>
        <dt className="text-muted-foreground">{t('settings.sensitiveOps')}</dt>
        <dd className="flex items-center gap-1 font-mono">
          {sensitive.length > 0 && <ShieldAlert className="h-3 w-3 text-destructive" />}
          {sensitive.join(', ') || '—'}
        </dd>
        <dt className="text-muted-foreground">{t('settings.mcpTools')}</dt>
        <dd className="break-all font-mono">{(plugin.mcpTools ?? []).join(', ') || '—'}</dd>
        <dt className="text-muted-foreground">{t('settings.limits')}</dt>
        <dd>{t('settings.limitsValue', { mem: plugin.limits.memoryMB, sec: plugin.limits.timeoutSeconds, conc: plugin.limits.concurrency })}</dd>
      </dl>
      {plugin.source === 'signed' && plugin.sourcePath && canManage && (
        <div className="space-y-2">
          <p className="break-all font-mono text-[11px] text-muted-foreground">{plugin.sourcePath}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={checkUpdate} disabled={checking}>
              {checking && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {t('install.checkUpdate')}
            </Button>
            <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t('install.tokenPlaceholder')} className="h-8 max-w-56 text-xs" />
          </div>
          {update && <PluginPreviewCard p={update} onInstall={applyUpdate} busy={updating} />}
        </div>
      )}
      {err && <p className="break-all text-xs text-destructive">{err}</p>}
    </div>
  );
}
