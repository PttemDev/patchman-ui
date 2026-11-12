import { useEffect } from 'react';
import { isDesktop } from '@/lib/platform';
import { useUpdateStore } from '@/stores/updateStore';

const HOUR_MS = 60 * 60 * 1000;

// Desktop-only background update poll. Checks shortly after startup, then once
// an hour, plus on window focus (throttled to once/hour) — so an app that's
// left running for days still surfaces a new version instead of waiting for
// the user to open Settings → Updates. No-op on the web build.
export function useUpdateChecker() {
  useEffect(() => {
    if (!isDesktop()) return;
    const check = () => void useUpdateStore.getState().check();
    // Delay the first check so it doesn't compete with startup work.
    const startup = window.setTimeout(check, 8000);
    const interval = window.setInterval(check, HOUR_MS);
    // A long-suspended machine won't have fired the interval; catch up on
    // focus, but no more than hourly.
    const onFocus = () => {
      const last = useUpdateStore.getState().lastChecked;
      if (last === null || Date.now() - last > HOUR_MS) check();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(startup);
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
}
