import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, BadgeCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { pluginAPI, type InstallPreview } from '@/lib/plugins/pluginApi';
import { usePluginStore } from '@/stores/pluginStore';
import { errorMessage } from './util';

// Install a signed plugin from a GitHub / GitLab folder link or a local path
// (RFC §18): preview first (who signed it, what it may do, what an update
// adds), then install with step-up. Unsigned packages are refused here.

export function PluginPreviewCard({ p, onInstall, busy }: { p: InstallPreview; onInstall: () => void; busy: boolean }) {
  const { t } = useTranslation('plugins');
  const isUpdate = Boolean(p.installedVersion);
  const same = p.installedVersion === p.version;
  const writes = Object.entries(p.ops).filter(([, o]) => o.write).map(([n]) => n);
  const sensitive = Object.entries(p.ops).filter(([, o]) => o.sensitive).map(([n]) => n);
  return (
    <div className="space-y-2 rounded-md border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{p.name}</span>
        <span className="text-muted-foreground">{isUpdate ? `${p.installedVersion} → ${p.version}` : p.version}</span>
        <span className="flex items-center gap-1 text-emerald-600">
          <BadgeCheck className="h-3.5 w-3.5" />
          {t('install.signedBy', { name: p.signerName })}
        </span>
      </div>
      <p className="font-mono text-[11px] text-muted-foreground">{p.id} · {p.publisher}</p>
      {p.description && <p>{p.description}</p>}
      <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1 text-[11px]">
        <dt className="text-muted-foreground">{t('settings.net')}</dt>
        <dd className="break-all font-mono">{(p.permissions.net ?? []).map((r) => `${r.host ?? `{${r.from}}`}:${r.ports?.join(',') ?? `{${r.portsFrom}}`}${r.private ? ` (${t('settings.private')})` : ''}`).join(' · ') || t('settings.noNet')}</dd>
        <dt className="text-muted-foreground">{t('settings.secrets')}</dt>
        <dd className="font-mono">{(p.connection.secretFields ?? []).join(', ') || '—'}</dd>
        <dt className="text-muted-foreground">{t('settings.writeOps')}</dt>
        <dd className="font-mono">{writes.join(', ') || '—'}</dd>
        <dt className="text-muted-foreground">{t('settings.sensitiveOps')}</dt>
        <dd className="font-mono">{sensitive.join(', ') || '—'}</dd>
        <dt className="text-muted-foreground">{t('settings.mcpTools')}</dt>
        <dd className="break-all font-mono">{(p.mcpTools ?? []).join(', ') || '—'}</dd>
        <dt className="text-muted-foreground">{t('install.customUI')}</dt>
        <dd>{p.hasUI ? t('install.yes') : t('install.no')}</dd>
      </dl>
      {p.addedPermissions.length > 0 && (
        <div className="flex items-start gap-2 rounded bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-all">{t('install.added', { list: p.addedPermissions.join(', ') })}</span>
        </div>
      )}
      {p.downgrade ? (
        <p className="text-destructive">{t('install.downgrade', { installed: p.installedVersion })}</p>
      ) : same ? (
        <p className="text-muted-foreground">{t('install.upToDate')}</p>
      ) : (
        <Button size="sm" onClick={onInstall} disabled={busy}>
          {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {isUpdate ? t('install.update', { version: p.version }) : t('install.install')}
        </Button>
      )}
    </div>
  );
}

export function PluginInstallBox() {
  const { t } = useTranslation('plugins');
  const fetchPlugins = usePluginStore((s) => s.fetchPlugins);
  const [source, setSource] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const doPreview = async () => {
    if (!source.trim()) return;
    setBusy(true);
    setNotice(null);
    setPreview(null);
    try {
      setPreview(await pluginAPI.preview(source.trim(), token));
    } catch (err) {
      setNotice({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const doInstall = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await pluginAPI.install(source.trim(), token);
      setNotice({ ok: true, text: t('settings.installed', { name: r.data.name, version: r.data.version }) });
      setPreview(null);
      setSource('');
      setToken('');
      await fetchPlugins();
    } catch (err) {
      setNotice({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-xs font-medium">{t('install.title')}</p>
      <p className="text-[11px] text-muted-foreground">{t('install.hint')}</p>
      <div className="flex gap-2">
        <Input
          value={source}
          onChange={(e) => { setSource(e.target.value); setPreview(null); }}
          placeholder="https://github.com/owner/repo/tree/main/my-plugin"
          className="font-mono text-xs"
        />
        <Button size="sm" variant="outline" onClick={doPreview} disabled={busy || !source.trim()}>
          {busy && !preview && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          {t('install.preview')}
        </Button>
      </div>
      {showToken ? (
        <Input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t('install.tokenPlaceholder')}
          className="text-xs"
        />
      ) : (
        <button type="button" className="text-[11px] text-muted-foreground underline" onClick={() => setShowToken(true)}>
          {t('install.privateRepo')}
        </button>
      )}
      {preview && <PluginPreviewCard p={preview} onInstall={doInstall} busy={busy} />}
      {notice && <p className={`break-all text-xs ${notice.ok ? 'text-emerald-600' : 'text-destructive'}`}>{notice.text}</p>}
    </div>
  );
}
