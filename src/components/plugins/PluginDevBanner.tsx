import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, Loader2 } from 'lucide-react';
import { isDesktop } from '@/lib/platform';
import { restartPluginDevMode } from '@/lib/plugins/devMode';
import { usePluginStore } from '@/stores/pluginStore';
import { errorMessage } from './util';

// Always-visible strip while the desktop runs in plugin developer mode
// (RFC invariant 5: dev sideload is a separate, visible mode).
export function PluginDevBanner() {
  const { t } = useTranslation('plugins');
  const devInstall = usePluginStore((s) => s.devInstall);
  const loaded = usePluginStore((s) => s.loaded);
  const fetchPlugins = usePluginStore((s) => s.fetchPlugins);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (isDesktop() && !loaded) void fetchPlugins();
  }, [loaded, fetchPlugins]);

  if (!isDesktop() || !devInstall) return null;

  const leave = async () => {
    setBusy(true);
    setErr('');
    try {
      await restartPluginDevMode(false);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs">
      <FlaskConical className="h-3.5 w-3.5 shrink-0 text-amber-600" />
      <span className="font-medium">{t('devMode.bannerTitle')}</span>
      <span className="truncate text-muted-foreground">{t('devMode.bannerBody')}</span>
      {err && <span className="truncate text-destructive">{err}</span>}
      <button
        type="button"
        onClick={leave}
        disabled={busy}
        className="ml-auto flex shrink-0 items-center gap-1 rounded border border-amber-500/50 px-2 py-0.5 hover:bg-amber-500/20 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        {t('devMode.leave')}
      </button>
    </div>
  );
}
