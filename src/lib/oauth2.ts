// Platform-aware OAuth2 authorization-code / implicit flow helper.
//
// Web build: opens a popup to the provider's auth URL, polls `popup.location`
// until it redirects to the callback URL, then reads code/state (or the
// fragment for implicit grants).
//
// Desktop build: `window.open()` in Tauri opens the system browser with no
// reference back, so polling can't work. Instead we hand the URL to
// `shell.open()` and await a `patchman://oauth/callback` deep-link event —
// the OS routes it back into the running app via tauri-plugin-deep-link.
//
// Callers pass the callback URL they advertised to the provider; on desktop
// the callback MUST be `patchman://oauth/callback` (what the bundle registers).
// On web it's `${window.location.origin}/oauth/callback` by default.
//
// Result shape mirrors what AuthEditor already extracts from the popup URL:
//   { code?, state?, accessToken?, tokenType?, expiresIn?, raw }
// so callers can treat both flows identically.

import { isDesktop } from './platform';

export interface OAuth2CallbackResult {
  code?: string;
  state?: string;
  accessToken?: string;
  tokenType?: string;
  expiresIn?: string;
  raw: string;
}

export interface OAuth2FlowOptions {
  authUrl: string;
  callbackUrl: string;
  // Implicit grants put the access token in the URL fragment instead of query.
  fragment?: boolean;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export async function runOAuth2Flow(opts: OAuth2FlowOptions): Promise<OAuth2CallbackResult> {
  if (isDesktop()) return runDesktopFlow(opts);
  return runWebFlow(opts);
}

function parseCallbackUrl(rawUrl: string, fragment: boolean): OAuth2CallbackResult {
  const urlObj = new URL(rawUrl);
  const params = fragment
    ? new URLSearchParams(urlObj.hash.replace(/^#/, ''))
    : urlObj.searchParams;
  return {
    code: params.get('code') ?? undefined,
    state: params.get('state') ?? undefined,
    accessToken: params.get('access_token') ?? undefined,
    tokenType: params.get('token_type') ?? undefined,
    expiresIn: params.get('expires_in') ?? undefined,
    raw: rawUrl,
  };
}

async function runDesktopFlow(opts: OAuth2FlowOptions): Promise<OAuth2CallbackResult> {
  const { authUrl, callbackUrl, fragment = false, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const [{ open: openExternal }, deepLink] = await Promise.all([
    import('@tauri-apps/plugin-shell'),
    import('@tauri-apps/plugin-deep-link'),
  ]);

  return new Promise<OAuth2CallbackResult>((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | null = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unlisten?.();
      reject(new Error('OAuth2 flow timed out'));
    }, timeoutMs);

    deepLink
      .onOpenUrl((urls) => {
        if (settled) return;
        const match = urls.find((u) => u.startsWith(callbackUrl));
        if (!match) return;
        settled = true;
        clearTimeout(timer);
        unlisten?.();
        try {
          resolve(parseCallbackUrl(match, fragment));
        } catch (e) {
          reject(e);
        }
      })
      .then((fn) => {
        unlisten = fn;
        // openExternal may reject (e.g. shell permission missing). Tie its
        // rejection back to the outer promise so the caller sees a real error
        // instead of hanging until timeout.
        return openExternal(authUrl);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unlisten?.();
        reject(err);
      });
  });
}

async function runWebFlow(opts: OAuth2FlowOptions): Promise<OAuth2CallbackResult> {
  const { authUrl, callbackUrl, fragment = false, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const popup = window.open(
    authUrl,
    'oauth2_flow',
    'width=600,height=700,scrollbars=yes',
  );
  if (!popup) throw new Error('Popup blocked by browser');

  return new Promise<OAuth2CallbackResult>((resolve, reject) => {
    const poll = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(poll);
          clearTimeout(timer);
          reject(new Error('Authorization window closed'));
          return;
        }
        const href = popup.location.href;
        if (href && href.startsWith(callbackUrl)) {
          clearInterval(poll);
          clearTimeout(timer);
          popup.close();
          resolve(parseCallbackUrl(href, fragment));
        }
      } catch {
        // Cross-origin access throws until the popup lands on our callback
        // URL (same-origin). Swallow and keep polling.
      }
    }, 500);
    const timer = setTimeout(() => {
      clearInterval(poll);
      try { popup.close(); } catch { /* ignore */ }
      reject(new Error('OAuth2 flow timed out'));
    }, timeoutMs);
  });
}
