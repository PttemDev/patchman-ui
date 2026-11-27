import { isDesktop } from '@/lib/platform';

// System notifications: the Tauri notification plugin in the desktop app
// (real macOS / Windows / Linux notifications), the web Notification API in
// a browser. Permission is asked once, on first use; a refusal is silent.
let desktopAllowed: boolean | null = null;

export async function notifySystem(title: string, body?: string): Promise<boolean> {
  try {
    if (isDesktop()) {
      const n = await import('@tauri-apps/plugin-notification');
      if (desktopAllowed === null) {
        desktopAllowed = await n.isPermissionGranted();
        if (!desktopAllowed) desktopAllowed = (await n.requestPermission()) === 'granted';
      }
      if (!desktopAllowed) return false;
      n.sendNotification({ title, body });
      return true;
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, tag: 'patchman' });
      return true;
    }
  } catch {
    /* no notification support here */
  }
  return false;
}

/** Desktop: the system decides (no in-app prompt needed); web: the browser permission. */
export function systemNotifyPermission(): 'granted' | 'default' | 'denied' | 'unsupported' {
  if (isDesktop()) return 'granted';
  return 'Notification' in window ? Notification.permission : 'unsupported';
}
