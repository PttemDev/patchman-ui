// Desktop auto-updater UI. Hidden for the web build — there's nothing to
// update when the bundle reloads on every page load.
//
// Flow: check → show "new version available" card → user clicks Download →
// downloadAndInstall runs through the Tauri plugin (verifying minisign
// signature against the pubkey baked into tauri.conf.json) → relaunch.

import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { CheckCircle2, Download, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { isDesktop } from '@/lib/platform';
import { getAppVersion } from '@/lib/version';
import { checkForUpdate, relaunchApp, type UpdateInfo } from '@/lib/updater';
import { Button } from '@/components/ui/button';

type Status =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; info: UpdateInfo; download: () => Promise<void> }
  | { kind: 'downloading'; info: UpdateInfo; downloaded: number; total?: number }
  | { kind: 'ready'; info: UpdateInfo }
  | { kind: 'error'; message: string };

export function UpdatesSection() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const currentVersion = getAppVersion();

  if (!isDesktop()) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('updates.heading')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('updates.webOnly')}
          </p>
        </div>
      </div>
    );
  }

  const handleCheck = async () => {
    setStatus({ kind: 'checking' });
    try {
      const handle = await checkForUpdate();
      if (!handle) {
        setStatus({ kind: 'up-to-date' });
        return;
      }
      setStatus({
        kind: 'available',
        info: handle.info,
        download: async () => {
          setStatus({ kind: 'downloading', info: handle.info, downloaded: 0 });
          try {
            await handle.downloadAndInstall((downloaded, total) => {
              setStatus({ kind: 'downloading', info: handle.info, downloaded, total });
            });
            setStatus({ kind: 'ready', info: handle.info });
          } catch (err) {
            setStatus({ kind: 'error', message: (err as Error)?.message ?? String(err) });
          }
        },
      });
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error)?.message ?? String(err) });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('updates.heading')}</h2>
        <p className="text-sm text-muted-foreground">
          <Trans
            t={t}
            i18nKey="updates.currentVersion"
            values={{ version: currentVersion }}
            components={{ mono: <span className="font-mono" /> }}
          />
        </p>
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        {status.kind === 'idle' && (
          <Button onClick={handleCheck} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            {t('updates.checkForUpdates')}
          </Button>
        )}

        {status.kind === 'checking' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('updates.checking')}
          </div>
        )}

        {status.kind === 'up-to-date' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              {t('updates.upToDate')}
            </div>
            <Button variant="outline" size="sm" onClick={handleCheck} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              {t('updates.checkAgain')}
            </Button>
          </div>
        )}

        {status.kind === 'available' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <Download className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="space-y-1 flex-1 min-w-0">
                <div className="text-sm">
                  <Trans
                    t={t}
                    i18nKey="updates.versionAvailable"
                    values={{ version: status.info.version }}
                    components={{ mono: <span className="font-mono font-semibold" /> }}
                  />
                </div>
                {status.info.body && (
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans">
                    {status.info.body}
                  </pre>
                )}
              </div>
            </div>
            <Button onClick={status.download} className="gap-2">
              <Download className="h-4 w-4" />
              {t('updates.downloadInstall')}
            </Button>
          </div>
        )}

        {status.kind === 'downloading' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('updates.downloading', { version: status.info.version })}
            </div>
            {status.total ? (
              <>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${Math.min(100, (status.downloaded / status.total) * 100)}%` }}
                  />
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  {formatBytes(status.downloaded)} / {formatBytes(status.total)}
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground font-mono">
                {t('updates.downloaded', { size: formatBytes(status.downloaded) })}
              </div>
            )}
          </div>
        )}

        {status.kind === 'ready' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              {t('updates.installedRelaunch', { version: status.info.version })}
            </div>
            <Button onClick={() => relaunchApp()} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              {t('updates.relaunchNow')}
            </Button>
          </div>
        )}

        {status.kind === 'error' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="break-words">{status.message}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleCheck} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              {t('updates.tryAgain')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
