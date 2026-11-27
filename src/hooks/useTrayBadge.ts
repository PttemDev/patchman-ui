import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isDesktop } from '@/lib/platform';
import { useQAInboxStore } from '@/stores/qaInboxStore';
import { useUpdateStore } from '@/stores/updateStore';

// Desktop: mirrors the QA Inbox count and a pending app update onto the
// menu-bar tray (title "3 ↑", tooltip, menu) and the Dock badge via the
// shell's set_tray_badge command. Mounted once in App, so an update shows
// even before sign-in.
export function useTrayBadge() {
  const { t, i18n } = useTranslation('app');
  const count = useQAInboxStore((s) => s.inbox?.items.length ?? 0);
  const update = useUpdateStore((s) => s.available);
  useEffect(() => {
    if (!isDesktop()) return;
    const parts = ['PatchMan'];
    if (count > 0) parts.push(t('tray.badge.inbox', { count }));
    if (update) parts.push(t('tray.badge.update'));
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_tray_badge', {
          badge: {
            count,
            update,
            inboxLabel: t('tray.qaInbox'),
            updateLabel: t('tray.installUpdate'),
            checkUpdatesLabel: t('tray.checkUpdates'),
            tooltip: parts.join(' — '),
          },
        });
      } catch {
        /* older shell without the command */
      }
    })();
  }, [count, update, t, i18n.language]);
}
