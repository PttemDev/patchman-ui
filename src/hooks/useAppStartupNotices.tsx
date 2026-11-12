import { useEffect, useRef } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { getAppVersion } from '@/lib/version';
import { checkForUpdate } from '@/lib/updater';
import { useSettingsUIStore } from '@/stores/settingsUIStore';

const LAST_SEEN_VERSION_KEY = 'patchman_last_seen_version';

export function useAppStartupNotices() {
  const { toast } = useToast();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const current = getAppVersion();

    try {
      const lastSeen = localStorage.getItem(LAST_SEEN_VERSION_KEY);
      if (lastSeen && lastSeen !== current) {
        toast({
          title: `Updated to v${current}`,
          description: "See what's new in this release.",
          duration: 12000,
          action: (
            <ToastAction
              altText="View changelog"
              onClick={() => useSettingsUIStore.getState().openSettings('changelog')}
            >
              View changelog
            </ToastAction>
          ),
        });
      }
      if (lastSeen !== current) {
        localStorage.setItem(LAST_SEEN_VERSION_KEY, current);
      }
    } catch { /* localStorage unavailable — silent */ }

    (async () => {
      try {
        const handle = await checkForUpdate();
        if (!handle) return;
        toast({
          title: `Update available: v${handle.info.version}`,
          description: `You're on v${handle.info.currentVersion}.`,
          duration: 12000,
          action: (
            <ToastAction
              altText="Open updates"
              onClick={() => useSettingsUIStore.getState().openSettings('updates')}
            >
              Update
            </ToastAction>
          ),
        });
      } catch { /* silent — updater failures shouldn't noise the UI on every launch */ }
    })();
  }, [toast]);
}
