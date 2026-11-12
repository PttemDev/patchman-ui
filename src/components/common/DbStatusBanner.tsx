import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDbStatusStore } from '@/stores/dbStatusStore';
import { resetLocalDatabase } from '@/data/db';

export function DbStatusBanner() {
  const { status, message } = useDbStatusStore();
  const [resetting, setResetting] = useState(false);
  const { t } = useTranslation('app');

  if (status === 'ok') return null;

  const handleReset = async () => {
    setResetting(true);
    try {
      await resetLocalDatabase();
    } finally {
      window.location.reload();
    }
  };

  const handleReload = () => {
    window.location.reload();
  };

  let title = '';
  let body = '';
  let tone: 'warning' | 'danger' = 'warning';
  let showReset = false;
  let showReload = false;

  if (status === 'blocked') {
    title = t('dbBanner.blockedTitle');
    body = t('dbBanner.blockedBody');
    tone = 'warning';
    showReload = true;
  } else if (status === 'incompatible') {
    title = t('dbBanner.incompatibleTitle');
    body = t('dbBanner.incompatibleBody');
    tone = 'danger';
    showReset = true;
  } else {
    title = t('dbBanner.openFailedTitle');
    body = t('dbBanner.openFailedBody');
    tone = 'danger';
    showReset = true;
    showReload = true;
  }

  const accent =
    tone === 'danger'
      ? 'border-destructive/50 bg-destructive/5'
      : 'border-amber-500/50 bg-amber-500/5';
  const iconColor = tone === 'danger' ? 'text-destructive' : 'text-amber-500';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div
        className={`max-w-md w-full mx-4 rounded-lg border ${accent} p-6 shadow-lg`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="db-status-title"
      >
        <div className="flex items-start gap-3">
          <div className={iconColor}>
            {tone === 'danger' ? (
              <Database className="h-5 w-5" />
            ) : (
              <AlertTriangle className="h-5 w-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="db-status-title" className="text-base font-semibold">
              {title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            {message && (
              <pre className="mt-3 text-xs bg-muted/50 border rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                {message}
              </pre>
            )}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {showReload && (
            <Button variant="outline" onClick={handleReload} disabled={resetting}>
              <RefreshCw className="h-4 w-4" />
              {t('dbBanner.reloadPage')}
            </Button>
          )}
          {showReset && (
            <Button variant="destructive" onClick={handleReset} disabled={resetting}>
              <Database className="h-4 w-4" />
              {resetting ? t('dbBanner.resetting') : t('dbBanner.resetDb')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
