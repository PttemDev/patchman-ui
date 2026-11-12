// Backend compatibility check.
//
// The desktop app talks to remote backends that may be on different versions
// than the app. Even backward-compatible changes break eventually, so before
// trusting a backend we confirm (a) it is really a PatchMan backend and (b) its
// API contract version is within the range this app supports.
//
// The contract version is a plain integer (`apiVersion` from GET /api/config),
// bumped ONLY on a breaking client-visible change — see the BE's
// internal/apicontract. This app supports [SUPPORTED_API_MIN, SUPPORTED_API_MAX].
// A breaking backend change = bump the BE const AND widen SUPPORTED_API_MAX here
// in the SAME release, otherwise old apps silently talk to a backend they can't
// actually speak to.

import { getAppVersion } from '@/lib/version';

export const SUPPORTED_API_MIN = 1;
export const SUPPORTED_API_MAX = 1;

export type CompatVerdict =
  | 'ok' //            reachable PatchMan backend within our supported range
  | 'incompatible' //  reachable PatchMan backend, but contract version out of range
  | 'not_patchman'; // reachable, but not a PatchMan backend (or unrecognisable)

// Why an 'incompatible' verdict happened, so the UI can say the useful thing
// ("update the app" vs "the backend is too old").
export type IncompatReason = 'app_too_old' | 'backend_too_old' | null;

/** The discovery fields this check reads (a subset of RemoteConfig). */
export interface CompatConfig {
  service?: string;
  apiVersion?: number;
  minAppVersion?: string;
}

/**
 * Compare dotted numeric versions: is `a >= b`? Ignores any pre-release suffix
 * ("1.2.0-rc1" → "1.2.0") and treats missing segments as 0, so string
 * comparison bugs ("1.31.0" < "1.9.0") can't happen.
 */
export function semverGte(a: string, b: string): boolean {
  const parse = (v: string) => v.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true; // equal
}

/**
 * Decide whether a backend (described by its discovery doc) is compatible with
 * this app. `cfg` null/undefined or missing the `service:"patchman"` marker →
 * 'not_patchman' (this is what refuses a random URL like https://google.com/api
 * that happens to answer). A recognised PatchMan backend whose contract version
 * is outside [MIN, MAX], or that demands a newer app than we are, → incompatible.
 */
export function evaluateCompat(
  cfg: CompatConfig | null | undefined,
  appVersion: string = getAppVersion(),
): { verdict: CompatVerdict; reason: IncompatReason } {
  if (!cfg || cfg.service !== 'patchman') {
    return { verdict: 'not_patchman', reason: null };
  }
  // A backend that identifies as patchman but omits apiVersion is read as the
  // baseline (forward-compatible) rather than rejected.
  const v = typeof cfg.apiVersion === 'number' ? cfg.apiVersion : SUPPORTED_API_MIN;
  if (v > SUPPORTED_API_MAX) return { verdict: 'incompatible', reason: 'app_too_old' };
  if (v < SUPPORTED_API_MIN) return { verdict: 'incompatible', reason: 'backend_too_old' };
  if (cfg.minAppVersion && !semverGte(appVersion, cfg.minAppVersion)) {
    return { verdict: 'incompatible', reason: 'app_too_old' };
  }
  return { verdict: 'ok', reason: null };
}
