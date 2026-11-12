// A slim, dismissible banner for one-off backend notices — currently only the
// "we auto-switched you off an incompatible backend" case. Rendered at the App
// root above the routes so it's visible on login and inside the app alike.

import { useTranslation } from 'react-i18next';
import { AlertTriangle, X } from 'lucide-react';
import { useRemoteStore } from '@/stores/remoteStore';

export function RemoteNoticeBanner() {
  const { t } = useTranslation('app');
  const notice = useRemoteStore((s) => s.notice);
  const setNotice = useRemoteStore((s) => s.setNotice);
  if (!notice) return null;

  const text =
    notice.kind === 'switched'
      ? t('connect.switchedNotice', { from: notice.fromLabel, to: notice.toLabel })
      : notice.reason === 'app_too_old'
        ? t('connect.incompatibleAppOld')
        : t('connect.incompatibleBackendOld');

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/95 px-4 py-2 text-xs text-amber-950 shadow-sm backdrop-blur dark:bg-amber-500/20 dark:text-amber-200">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        onClick={() => setNotice(null)}
        aria-label={t('connect.dismiss')}
        className="shrink-0 rounded p-0.5 hover:bg-amber-500/20"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
