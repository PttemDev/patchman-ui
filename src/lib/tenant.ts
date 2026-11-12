// Tenant-specific strings (per-deployment branding). Resolved in priority
// order so an open-source build needn't rebuild to rebrand:
//   1. discovered from the ACTIVE backend (GET /api/config), cached so the
//      value survives the backend going offline (VPN drop) — see remoteStore
//      getCachedServerConfig / refreshServerConfigIfNeeded.
//   2. Vite build-time env (VITE_*) — the hosted tenant build bakes these.
//   3. neutral defaults so a no-config build still renders.
//
// The app NAME/title is intentionally still static (build-time) for now; only
// the GitLab hostname and email-domain placeholder are discovered. Read fresh
// on each call so a value discovered mid-session is picked up on next render.

import { getCachedServerConfig } from '@/stores/remoteStore';

function emailDomain(): string {
  return (
    getCachedServerConfig().emailDomainPlaceholder ||
    (import.meta.env.VITE_EMAIL_DOMAIN_PLACEHOLDER as string | undefined) ||
    'company.com'
  );
}

function ghHost(): string {
  return (
    getCachedServerConfig().gitlabHostname ||
    (import.meta.env.VITE_GITLAB_HOSTNAME as string | undefined) ||
    'gitlab.example.com'
  );
}

/**
 * Placeholder shown in the email input on Login/Register
 * ("you@<tenant-domain>"). Tenants with no configured domain fall back
 * to a generic example.
 */
export function emailPlaceholder(): string {
  return `you@${emailDomain()}`;
}

/**
 * Bare GitLab hostname used in user-visible copy
 * ("approve PatchMan on gitlab.example.com"). Does NOT include scheme.
 */
export function gitlabHostname(): string {
  return ghHost();
}

/**
 * Full GitLab base URL used in placeholder URLs for the import dialog
 * ("https://gitlab.example.com/group/repo/-/blob/...").
 */
export function gitlabBaseUrl(): string {
  return `https://${ghHost()}`;
}
