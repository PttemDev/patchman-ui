// Desktop app lock + step-up ("sudo") client — DESKTOP_SECURITY_RFC L4/L6/L7.
//
// The shell (src-tauri/src/security.rs) owns the state and the Touch ID /
// password prompt; this mirrors it for the UI and asks for step-up before
// sensitive calls. On the web build everything here is a no-op.

import { create } from 'zustand';
import { isDesktop } from './platform';

export interface SecuritySettings {
  lockEnabled: boolean;
  idleMinutes: number;
  lockOnSleep: boolean;
  lockOnScreenLock: boolean;
  blockMcpWhileLocked: boolean;
  sudoEnabled: boolean;
  sudoMinutes: number;
}

export interface SecuritySnapshot {
  settings: SecuritySettings;
  locked: boolean;
  sudoUntil: number;
  authAvailable: boolean;
}

interface SecurityState {
  snap: SecuritySnapshot | null;
  set: (s: SecuritySnapshot) => void;
}

export const useSecurityStore = create<SecurityState>((set) => ({
  snap: null,
  set: (snap) => set({ snap }),
}));

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

let started = false;

/** Loads the state and follows the shell's updates. Idempotent. */
export async function startSecurityClient(): Promise<void> {
  if (started || !isDesktop()) return;
  started = true;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<SecuritySnapshot>('security://state', (e) => useSecurityStore.getState().set(e.payload));
    useSecurityStore.getState().set(await invoke<SecuritySnapshot>('security_state'));
  } catch (err) {
    console.warn('[security] unavailable', err);
  }
  installActivityTracker();
}

export async function unlockApp(): Promise<void> {
  useSecurityStore.getState().set(await invoke<SecuritySnapshot>('security_unlock'));
}

export async function lockApp(): Promise<void> {
  await invoke('security_lock');
}

export async function updateSecuritySettings(settings: SecuritySettings): Promise<SecuritySnapshot> {
  const snap = await invoke<SecuritySnapshot>('security_update', { settings });
  useSecurityStore.getState().set(snap);
  return snap;
}

/** Refreshes the mirrored state (e.g. after the BE answered 423). */
export async function refreshSecurity(): Promise<void> {
  if (!isDesktop()) return;
  try { useSecurityStore.getState().set(await invoke<SecuritySnapshot>('security_state')); } catch { /* ignore */ }
}

let inflight: Promise<void> | null = null;

/**
 * Makes sure a fresh step-up exists before a sensitive action; the shell
 * prompts for Touch ID / password only when the window has lapsed. Throws
 * when the user cancels. No-op on the web build or with step-up disabled.
 */
export async function ensureStepUp(reason = 'confirm a sensitive action in PatchMan'): Promise<void> {
  if (!isDesktop()) return;
  const snap = useSecurityStore.getState().snap;
  if (snap && (!snap.settings.sudoEnabled || !snap.authAvailable || snap.sudoUntil > Date.now() / 1000 + 2)) return;
  inflight ??= invoke<SecuritySnapshot>('security_sudo', { reason })
    .then((s) => useSecurityStore.getState().set(s))
    .finally(() => { inflight = null; });
  return inflight;
}

// Sensitive calls (mirrors the BE's IsSensitiveRoute). Matched on the path's
// tail so a remote BE under a path prefix is covered too.
const SENSITIVE: Array<[string, RegExp]> = [
  ['POST', /\/api\/[a-z0-9-]+-connections\/[^/]+\/reveal-secret$/],
  ['POST', /\/api\/db-connections\/[^/]+\/reveal-password$/],
  ['POST', /\/api\/llm-providers\/[^/]+\/reveal-api-key$/],
  ['GET', /\/api\/git\/connections\/[^/]+\/secret$/],
  ['GET', /\/api\/environments\/[^/]+\/variables\/[^/]+\/reveal$/],
  ['GET', /\/api\/k8s\/[^/]+\/(exec|local-shell)$/],
  ['GET', /\/api\/ai\/claude-shell$/],
  ['POST', /\/api\/k8s\/[^/]+\/(apply|scale|rollout-restart|cordon|drain|cronjob\/trigger|port-forward)$/],
  ['DELETE', /\/api\/k8s\/[^/]+\/resource$/],
  ['POST', /\/api\/git\/repos\/[^/]+\/branches\/force-delete$/],
  ['POST', /\/api\/git\/repos\/[^/]+\/remote-branches\/delete$/],
  ['POST', /\/api\/git\/repos\/[^/]+\/push-to\/force$/],
  ['POST', /\/api\/git\/connections\/[^/]+\/merge_request_merge$/],
  // Plugins (RFC §15–16).
  ['POST', /\/api\/plugins\/dev-install$/],
  ['POST', /\/api\/plugins\/install$/],
  ['POST', /\/api\/plugins\/trusted-keys$/],
  ['DELETE', /\/api\/plugins\/trusted-keys\/[^/]+$/],
  ['DELETE', /\/api\/plugins\/[^/]+$/],
  ['POST', /\/api\/plugin-connections\/[^/]+\/[^/]+\/reveal-secret$/],
];

// Dynamic rules (a plugin's sensitive ops come and go with installs).
const matchers: Array<(method: string, path: string) => boolean> = [];

export function registerSensitiveMatcher(fn: (method: string, path: string) => boolean): void {
  matchers.push(fn);
}

export function isSensitiveRequest(method: string, url: string): boolean {
  let path = url;
  try { path = new URL(url, window.location.href).pathname; } catch { /* keep raw */ }
  const m = method.toUpperCase();
  return SENSITIVE.some(([sm, re]) => sm === m && re.test(path)) || matchers.some((fn) => fn(m, path));
}

// Activity → shell, throttled, so the idle timer only fires when the user is
// really away.
function installActivityTracker(): void {
  let last = 0;
  const ping = () => {
    const now = Date.now();
    if (now - last < 30_000) return;
    last = now;
    void invoke('security_activity').catch(() => {});
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'mousemove']) {
    window.addEventListener(ev, ping, { passive: true, capture: true });
  }
  ping();
}
