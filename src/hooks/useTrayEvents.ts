// Desktop-only: wire the menu-bar tray menu to the app.
//
// The Rust shell (src-tauri/src/lib.rs) shows a tray icon whose items emit
// events the app listens for here — the window is already shown/focused by the
// Rust side before the event fires:
//   • tray://new-request   → open a fresh request tab
//   • tray://open-settings → open Settings
//   • tray://check-updates → run an update check + open Settings → Updates
// The tray menu is built with English defaults; we push the app's translated
// labels down via the `set_tray_labels` command on mount AND whenever the
// language changes, so the menu follows Settings → Language. Quit / Show are
// handled entirely in Rust. No-op off the desktop shell.

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isDesktop } from '@/lib/platform';
import { useRequestStore } from '@/stores/requestStore';
import { useUpdateStore } from '@/stores/updateStore';
import { useSettingsUIStore } from '@/stores/settingsUIStore';
import { confirmDialog } from '@/components/ui/confirm';

export function useTrayEvents() {
  const { t, i18n } = useTranslation('app');

  // Menu-action listeners — set up once.
  useEffect(() => {
    if (!isDesktop()) return;
    const unlisteners: Array<() => void> = [];
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisteners.push(
          await listen('tray://new-request', () => {
            useRequestStore.getState().addTab();
          }),
        );
        unlisteners.push(
          await listen('tray://open-settings', () => {
            useSettingsUIStore.getState().openSettings();
          }),
        );
        unlisteners.push(
          await listen('tray://check-updates', () => {
            void useUpdateStore.getState().check();
            useSettingsUIStore.getState().openSettings('updates');
          }),
        );
        // Cmd+Q asks for confirmation: the Rust side prevented the exit and
        // emitted this; show the themed confirm, then quit for real if accepted.
        unlisteners.push(
          await listen('app://confirm-quit', async () => {
            const ok = await confirmDialog({
              title: t('quitConfirm.title'),
              description: t('quitConfirm.description'),
              confirmLabel: t('quitConfirm.confirm'),
              destructive: true,
            });
            if (ok) {
              try {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('confirm_quit');
              } catch {
                // Not the shell / command unavailable — ignore.
              }
            }
          }),
        );
      } catch {
        // Not the Tauri shell — ignore.
      }
    })();
    return () => {
      unlisteners.forEach((u) => u());
    };
    // Listeners register once; the quit-confirm strings are captured at mount
    // (acceptable — language rarely flips mid-session before a Cmd+Q).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push localized labels on mount + on every language change.
  useEffect(() => {
    if (!isDesktop()) return;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_tray_labels', {
          labels: {
            show: t('tray.show'),
            new_request: t('tray.newRequest'),
            settings: t('tray.settings'),
            check_updates: t('tray.checkUpdates'),
            quit: t('tray.quit'),
          },
        });
      } catch {
        // Not the Tauri shell (or command unavailable) — ignore.
      }
    })();
  }, [t, i18n.language]);
}
