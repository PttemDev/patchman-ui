// Forwards FE crash reports to the BE's /errors/report endpoint, which in
// turn proxies them to Slack via an admin-controlled toggle. The reporter
// itself is fire-and-forget — a failed report must never surface to the
// user (the user is already looking at an error dialog).
//
// Three error sources feed into this:
//   - 'boundary'  : React render-time crash caught by ErrorBoundary
//   - 'rejection' : window.onunhandledrejection
//   - 'window'    : window.onerror
// Plus 'manual' for the admin "Test integration" path (the BE bypasses
// its toggle for that source).
//
// Dedupe is local to this module so a flapping render error doesn't fire
// the same payload N times in one session — the BE has its own dedupe
// over the Slack post, but pre-empting at the source saves the network
// round-trip.

import { errorReportAPI, type CrashReportPayload } from '@/services/api';
import { getAppVersion } from '@/lib/version';
import { isDesktop } from '@/lib/platform';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore, resolveWorkspaceFilter } from '@/stores/workspaceStore';
import { useRequestStore } from '@/stores/requestStore';

export type ReportSource = 'boundary' | 'rejection' | 'window' | 'manual';

interface ReportInput {
  source: ReportSource;
  message: string;
  stack?: string;
  componentStack?: string;
  /** Route the user was on when the error fired. */
  route?: string;
}

const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes — matches BE
const DEDUPE_CAP = 64;
const seen = new Map<string, number>();

function signature(input: ReportInput, userId: string | undefined): string {
  // First non-empty stack frame is the throw site. Including it lets us
  // distinguish "same message, different origin" from "literally the
  // same crash repeating".
  const firstFrame = (input.stack || '').split('\n').find((l) => l.trim().length > 0) || '';
  return `${userId || 'anon'}::${input.source}::${input.message}::${firstFrame}`.slice(0, 512);
}

function allow(sig: string, now: number): boolean {
  const last = seen.get(sig);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false;
  seen.set(sig, now);
  if (seen.size > DEDUPE_CAP) {
    const cutoff = now - DEDUPE_WINDOW_MS;
    for (const [k, t] of seen) {
      if (t < cutoff) seen.delete(k);
    }
  }
  return true;
}

function osInfo(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  // userAgent is enough for both web and desktop. The native OS info via
  // @tauri-apps/api/os is async — we'd have to plumb a one-time bootstrap
  // to cache it. Skipping for now keeps reporter sync and reliable.
  return navigator.userAgent;
}

/**
 * Fire-and-forget crash report. Safe to call from anywhere; never throws,
 * never returns a meaningful value. Caller should not await this.
 */
export function reportCrash(input: ReportInput): void {
  const now = Date.now();
  const auth = useAuthStore.getState();
  const sig = signature(input, auth.user?.id);
  if (!allow(sig, now)) return;

  // Pull workspace + active tab name lazily so the reporter never throws
  // if a store is mid-init. Each access is wrapped because store getState
  // can't realistically fail but a malformed persisted state could.
  let workspaceId: string | undefined;
  let workspaceName: string | undefined;
  try {
    const ws = useWorkspaceStore.getState();
    workspaceId = resolveWorkspaceFilter(ws.activeWorkspaceId);
    if (workspaceId) {
      workspaceName = ws.workspaces.find((w) => w.id === workspaceId)?.name;
    }
  } catch {
    /* noop */
  }

  let tabName: string | undefined;
  try {
    const rs = useRequestStore.getState();
    const active = rs.tabs.find((t) => t.id === rs.activeTabId);
    if (active) {
      tabName = `${active.method || ''} ${active.url || active.name || ''}`.trim();
    }
  } catch {
    /* noop */
  }

  const payload: CrashReportPayload = {
    source: input.source,
    message: input.message,
    stack: input.stack,
    componentStack: input.componentStack,
    appName: 'patchman-ui',
    appVersion: getAppVersion(),
    buildEnv: import.meta.env.MODE,
    buildCommit: typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'unknown',
    platform: isDesktop() ? 'desktop' : 'web',
    osInfo: osInfo(),
    route: input.route,
    tabName,
    workspaceId,
    workspaceName,
  };

  // No await — the BE responds 204 anyway, and we don't want a slow
  // network to delay the error dialog showing.
  errorReportAPI.send(payload).catch(() => {
    // Surfacing the error here would loop us back into the error
    // listeners. Silent drop is intentional.
  });
}
