import type { CookieItem, ResponseCookie } from '@/types';
import { getRepo } from '@/data';

function isIp(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(':') && /^[0-9a-f:]+$/i.test(host)) return true;
  return false;
}

function domainMatches(host: string, cookieDomain: string): boolean {
  host = host.toLowerCase();
  // Normalize common user-entered prefixes: "*.example.com", "*example.com",
  // and ".example.com" all map to the base domain "example.com" and match
  // the base + any subdomain, matching what the sidebar UI visually implies.
  cookieDomain = cookieDomain.toLowerCase().replace(/^\*\.?|^\./, '');
  if (!cookieDomain) return false;
  if (host === cookieDomain) return true;
  if (isIp(host)) return false;
  return host.endsWith('.' + cookieDomain);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (!cookiePath) cookiePath = '/';
  if (!requestPath) requestPath = '/';
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  if (cookiePath.endsWith('/')) return true;
  return requestPath[cookiePath.length] === '/';
}

function isExpired(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return false;
  return t < Date.now();
}

export function cookieMatchesRequest(cookie: CookieItem, url: URL): boolean {
  if (!domainMatches(url.hostname, cookie.domain)) return false;
  if (!pathMatches(url.pathname || '/', cookie.path || '/')) return false;
  if (cookie.secure && url.protocol !== 'https:') return false;
  if (isExpired(cookie.expiresAt)) return false;
  return true;
}

export async function buildCookieHeaderForUrl(fullUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(fullUrl);
  } catch {
    return '';
  }
  const all = await getRepo().cookies.list();
  const matches = all
    .filter((c) => cookieMatchesRequest(c, url))
    .sort((a, b) => (b.path?.length || 0) - (a.path?.length || 0));
  return matches.map((c) => `${c.name}=${c.value}`).join('; ');
}

// Split a joined Set-Cookie string on comma boundaries that start a new cookie,
// preserving commas that appear inside "expires=<weekday, DD ...>" values.
export function splitSetCookie(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw.flatMap((r) => splitSetCookie(r));
  const tokens = raw.split(',');
  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < tokens.length; i++) {
    buf = buf ? buf + ',' + tokens[i] : tokens[i];
    const next = tokens[i + 1];
    if (next === undefined) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    if (/^\s*[^=;,\s]+=/.test(next)) {
      out.push(buf.trim());
      buf = '';
    }
  }
  return out.filter(Boolean);
}

export function parseSetCookie(rawList: string[], responseUrl: URL): ResponseCookie[] {
  const out: ResponseCookie[] = [];
  for (const raw of rawList) {
    const parts = raw.split(';').map((p) => p.trim());
    const [nameVal, ...attrs] = parts;
    const eqIdx = nameVal.indexOf('=');
    if (eqIdx === -1) continue;
    const name = nameVal.substring(0, eqIdx).trim();
    const value = nameVal.substring(eqIdx + 1).trim();
    if (!name) continue;
    let path = '/';
    let secure = false;
    let httpOnly = false;
    let domain = responseUrl.hostname;
    let expiresAt: string | undefined;
    let sameSite: string | undefined;
    let maxAge: number | undefined;
    for (const attr of attrs) {
      const lower = attr.toLowerCase();
      if (lower.startsWith('path=')) {
        path = attr.substring(5).trim() || '/';
      } else if (lower.startsWith('domain=')) {
        const d = attr.substring(7).trim().replace(/^\./, '');
        if (d) domain = d;
      } else if (lower.startsWith('expires=')) {
        const d = new Date(attr.substring(8).trim());
        if (!Number.isNaN(d.getTime())) expiresAt = d.toISOString();
      } else if (lower.startsWith('max-age=')) {
        const n = parseInt(attr.substring(8).trim(), 10);
        if (!Number.isNaN(n)) maxAge = n;
      } else if (lower.startsWith('samesite=')) {
        sameSite = attr.substring(9).trim();
      } else if (lower === 'secure') {
        secure = true;
      } else if (lower === 'httponly') {
        httpOnly = true;
      }
    }
    if (maxAge !== undefined) {
      expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
    }
    out.push({ name, value, domain, path, secure, httpOnly, sameSite, expiresAt, rawSetCookie: raw });
  }
  return out;
}

// Event name used to notify open cookie-related UIs to refresh after a save.
export const COOKIES_CHANGED_EVENT = 'patchman:cookies-changed';

export function emitCookiesChanged() {
  try {
    window.dispatchEvent(new CustomEvent(COOKIES_CHANGED_EVENT));
  } catch {
    // noop
  }
}
