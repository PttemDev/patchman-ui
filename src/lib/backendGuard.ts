// Startup backend guard: run once per app launch to keep the app pointed at a
// compatible backend.
//
// It lives here (not in remoteStore) because promotion has to sign the user out
// when it switches backends — the JWT belongs to the old backend — and
// remoteStore must not import authStore (that would make an import cycle with
// api.ts / liveSync.ts). remoteStore owns the primitives (checkRemote,
// recordCompat, setActive, compatMap); this module orchestrates.
//
// What it does for the ACTIVE backend:
//   • success   → cache tenant config + record the 'ok'/'incompatible' verdict
//   • unreachable → keep-last (a previously-'ok' backend stays usable: VPN drop)
//   • incompatible (desktop only) → promote the FIRST known-compatible remote to
//     active (signing out first if needed) and raise a one-off "switched"
//     notice; if there is none, block on the connect gate. Web is never blocked
//     — its backend is the deployment's own.

import { isDesktop } from '@/lib/platform';
import { useAuthStore } from '@/stores/authStore';
import {
  useRemoteStore,
  BUILTIN_REMOTE_ID,
  builtinUrlNormalized,
  activeRemoteInfo,
  checkRemote,
  cacheServerConfig,
  resolveBackendUrl,
} from '@/stores/remoteStore';

function signOutForSwitch(): void {
  const { isAuthenticated, mode } = useAuthStore.getState();
  if (isAuthenticated && mode === 'synced') {
    useAuthStore.getState().logout();
    // logout() doesn't clear impersonation — don't leak it to the new backend.
    localStorage.removeItem('patchman_act_as_user');
    localStorage.removeItem('patchman_act_as_user_name');
  }
}

export async function runBackendGuard(): Promise<void> {
  // Offline mode has no backend to guard — the user opted out of sync.
  if (useAuthStore.getState().mode === 'local') return;

  const active = activeRemoteInfo();
  // Resolve a relative built-in "/api" against the page origin so a web / dev
  // deployment (where "/api" IS reachable same-origin) still gets version
  // checked. Only a packaged tauri://localhost origin leaves it relative — and
  // that genuinely can't be probed, so the first-run gate handles it.
  const probeUrl = resolveBackendUrl(active.url);
  if (probeUrl.startsWith('/')) return;

  const store = useRemoteStore.getState();
  const outcome = await checkRemote(probeUrl);

  if (outcome.verdict === 'ok') {
    cacheServerConfig(probeUrl, outcome.cfg);
    store.recordCompat(probeUrl, { compat: 'ok', apiVersion: outcome.cfg.apiVersion, checkedAt: Date.now() });
  } else if (outcome.verdict === 'incompatible') {
    store.recordCompat(probeUrl, { compat: 'incompatible', apiVersion: outcome.cfg.apiVersion, reason: outcome.reason, checkedAt: Date.now() });
  }
  // unreachable / not_patchman → keep-last (leave the cached verdict alone).

  if (!isDesktop()) return; // never block/relocate the web build

  const rec = useRemoteStore.getState().compatMap[probeUrl];
  if (!rec || rec.compat !== 'incompatible') return; // ok / unknown → leave as-is

  // Active is incompatible → find the first known-compatible remote, in list
  // order (built-in first, then user remotes), using STORED verdicts only (no
  // startup fan-out re-check). Compat is keyed by the RESOLVED probe URL.
  const s = useRemoteStore.getState();
  const candidates = [
    { id: BUILTIN_REMOTE_ID, url: resolveBackendUrl(builtinUrlNormalized()), label: 'PatchMan' },
    ...s.remotes.map((r) => ({ id: r.id, url: resolveBackendUrl(r.url), label: r.label || r.url })),
  ];
  const firstOk = candidates.find((c) => c.url !== probeUrl && s.compatMap[c.url]?.compat === 'ok');

  if (firstOk) {
    signOutForSwitch();
    s.setActive(firstOk.id); // also clears blockedIncompatible
    s.setNotice({ kind: 'switched', fromLabel: active.label, toLabel: firstOk.label });
    return;
  }

  // No STORED-compatible remote. Before blocking the whole app (which would
  // trap a hosted-tenant user who can't reach Settings to see the built-in
  // URL), do ONE fresh check of the built-in if it was never checked — it's the
  // fallback everyone has. This is a single fetch, not the N-way fan-out we avoid.
  const builtinUrl = resolveBackendUrl(builtinUrlNormalized());
  const builtinRec = useRemoteStore.getState().compatMap[builtinUrl];
  if (/^https?:\/\//i.test(builtinUrl) && builtinUrl !== probeUrl && builtinRec?.compat !== 'incompatible') {
    const o = await checkRemote(builtinUrl);
    if (o.verdict === 'ok') {
      s.recordCompat(builtinUrl, { compat: 'ok', apiVersion: o.cfg.apiVersion, checkedAt: Date.now() });
      cacheServerConfig(builtinUrl, o.cfg);
      signOutForSwitch();
      s.setActive(BUILTIN_REMOTE_ID);
      s.setNotice({ kind: 'switched', fromLabel: active.label, toLabel: o.cfg.name || 'PatchMan' });
      return;
    }
    if (o.verdict === 'incompatible') {
      s.recordCompat(builtinUrl, { compat: 'incompatible', apiVersion: o.cfg.apiVersion, reason: o.reason, checkedAt: Date.now() });
    }
  }
  s.setBlockedIncompatible(true);
}
