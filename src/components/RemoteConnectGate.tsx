// Backend connect gate (desktop only).
//
// Blocks the app in two situations:
//  • 'setup' — a generic prebuilt app with no reachable backend. The built-in
//    URL comes from the build's VITE_API_URL, which an open-source build leaves
//    unset (→ relative "/api", unreachable from tauri://localhost) and no remote
//    has been chosen. Ask for the backend URL (or offer offline mode).
//  • 'incompatible' — the active backend's API version isn't compatible with
//    this app and there is no known-compatible remote to fall back to. Ask the
//    user to connect a compatible backend (or go offline / update the app).
//
// Two ways past the setup case: paste a URL here, or receive a
// `patchman://connect?backend=…` deep link from the backend's download page
// (see useRemoteConnectDeepLink). A build that bakes VITE_API_URL (the hosted
// tenant build) never sees the setup screen.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, AlertTriangle } from 'lucide-react';
import { isDesktop } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PatchmanLogo } from '@/components/PatchmanLogo';
import { useAuthStore } from '@/stores/authStore';
import {
  useRemoteStore,
  BUILTIN_REMOTE_ID,
  builtinRemoteUrl,
  normalizeRemoteUrl,
  checkRemote,
  cacheServerConfig,
} from '@/stores/remoteStore';

export type BackendGateReason = 'setup' | 'incompatible';

/**
 * Whether (and why) the desktop backend gate should block the app. Reactive to
 * remote + auth state.
 * - 'incompatible' fires regardless of auth (an app update can leave a signed-in
 *   user pointed at a now-incompatible backend).
 * - 'setup' only when unauthenticated and the active URL can't reach a backend.
 */
export function useBackendGate(): { show: boolean; reason: BackendGateReason } {
  const activeId = useRemoteStore((s) => s.activeId);
  const remotes = useRemoteStore((s) => s.remotes);
  const blocked = useRemoteStore((s) => s.blockedIncompatible);
  const mode = useAuthStore((s) => s.mode);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isDesktop()) return { show: false, reason: 'setup' };
  if (mode === 'local') return { show: false, reason: 'setup' }; // opted into offline mode
  if (blocked) return { show: true, reason: 'incompatible' }; // even when signed in
  if (isAuthenticated) return { show: false, reason: 'setup' };

  const activeUrl =
    activeId === BUILTIN_REMOTE_ID
      ? builtinRemoteUrl()
      : remotes.find((r) => r.id === activeId)?.url ?? builtinRemoteUrl();
  // A relative URL can never reach a backend from tauri://localhost.
  return { show: activeUrl.startsWith('/'), reason: 'setup' };
}

export function RemoteConnectGate({ reason = 'setup' }: { reason?: BackendGateReason }) {
  const { t } = useTranslation('app');
  const upsertRemote = useRemoteStore((s) => s.upsertRemote);
  const setActive = useRemoteStore((s) => s.setActive);
  const enterLocalMode = useAuthStore((s) => s.enterLocalMode);

  const [url, setUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  async function handleConnect() {
    const normalized = normalizeRemoteUrl(url);
    if (!normalized) {
      setErr(t('connect.invalidUrl'));
      return;
    }
    setErr(null);
    setConnecting(true);
    // Full validation: reachable AND a compatible PatchMan backend.
    const outcome = await checkRemote(normalized);
    setConnecting(false);
    if (outcome.verdict === 'unreachable') {
      setErr(t('connect.unreachable'));
      return;
    }
    if (outcome.verdict === 'not_patchman') {
      setErr(t('connect.notPatchman'));
      return;
    }
    if (outcome.verdict === 'incompatible') {
      setErr(outcome.reason === 'app_too_old' ? t('connect.incompatibleAppOld') : t('connect.incompatibleBackendOld'));
      return;
    }
    // Cache the tenant config so the login screen shows the right values.
    cacheServerConfig(normalized, outcome.cfg);
    const id = upsertRemote(outcome.cfg.name || '', normalized, { compat: 'ok', apiVersion: outcome.cfg.apiVersion });
    if (!id) {
      setErr(t('connect.invalidUrl'));
      return;
    }
    // The incompatible-block gate can be shown to a SIGNED-IN user (an app
    // update left their only backend incompatible). Switching backends
    // invalidates that JWT, so sign out + reload for a clean re-init. In the
    // first-run 'setup' case the user isn't signed in, so neither happens.
    const { isAuthenticated, mode } = useAuthStore.getState();
    const wasAuthedSynced = isAuthenticated && mode === 'synced';
    if (wasAuthedSynced) {
      useAuthStore.getState().logout();
      localStorage.removeItem('patchman_act_as_user');
      localStorage.removeItem('patchman_act_as_user_name');
    }
    // Point the app at the new backend; the gate re-evaluates and hands off to
    // the login route. setActive also clears the incompatible block.
    setActive(id);
    if (wasAuthedSynced) window.location.reload();
  }

  const incompatible = reason === 'incompatible';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          {incompatible ? (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
          ) : (
            <PatchmanLogo className="h-10 w-10" />
          )}
          <div>
            <h1 className="text-xl font-semibold">{incompatible ? t('connect.incompatibleTitle') : t('connect.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {incompatible ? t('connect.incompatibleDescription') : t('connect.description')}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Cloud className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={url}
              onChange={(e) => { setUrl(e.target.value); setErr(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
              placeholder={t('connect.urlPlaceholder')}
              className="pl-9 font-mono text-sm"
            />
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
          <Button className="w-full" onClick={handleConnect} disabled={!url.trim() || connecting}>
            {connecting ? t('connect.connecting') : t('connect.connectButton')}
          </Button>
        </div>

        <div className="border-t pt-4 text-center">
          <Button variant="ghost" size="sm" onClick={enterLocalMode} className="text-muted-foreground">
            {t('connect.offlineButton')}
          </Button>
          <p className="mt-1 text-[11px] text-muted-foreground">{t('connect.offlineHint')}</p>
        </div>
      </div>
    </div>
  );
}
