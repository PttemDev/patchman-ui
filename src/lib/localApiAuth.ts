// Attaches the desktop launch token to every request bound for the embedded
// BE (DESKTOP_SECURITY_RFC L1). The BE refuses local calls without it, so a
// web page or another program on the machine can't read the user's data.
//
// Rather than threading the token through dozens of call sites (axios
// instances, raw fetch, WebSocket and EventSource URLs), the four browser
// primitives are wrapped once, before any app module runs: anything whose
// origin is the embedded BE gets the token — a header where one can be set,
// the `pm_lt` query param where it can't (WebSocket / EventSource).
//
// Token sources: the main window gets it from the shell's init script
// (synchronous); a detached window asks the shell over IPC; the local web
// dev recipe sets VITE_LOCAL_API_TOKEN.

import { getLocalApiUrl, isDesktop } from './platform';
import { ensureStepUp, isSensitiveRequest, refreshSecurity } from './securityClient';

declare global {
  interface Window {
    __PATCHMAN_LOCAL_TOKEN__?: string;
  }
}

const HEADER = 'X-Local-Token';
const QUERY = 'pm_lt';

let token: string | null = null;
let pending: Promise<string | null> | null = null;

function syncToken(): string | null {
  if (token) return token;
  const injected = typeof window !== 'undefined' ? window.__PATCHMAN_LOCAL_TOKEN__ : undefined;
  const env = import.meta.env.VITE_LOCAL_API_TOKEN as string | undefined;
  token = injected || env || null;
  return token;
}

/** Resolves the launch token (IPC on detached desktop windows). */
export function ensureLocalToken(): Promise<string | null> {
  const t = syncToken();
  if (t) return Promise.resolve(t);
  if (!isDesktop()) return Promise.resolve(null);
  pending ??= import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke<string>('local_api_token'))
    .then((v) => { token = v || null; return token; })
    .catch((err) => { console.warn('[local-auth] token unavailable', err); return null; });
  return pending;
}

function localOrigin(): string | null {
  const base = getLocalApiUrl();
  if (!base) return null;
  try { return new URL(base).origin; } catch { return null; }
}

/** True when url (absolute or relative) targets the embedded BE. */
export function isLocalApiUrl(url: string | URL): boolean {
  const origin = localOrigin();
  if (!origin) return false;
  try {
    const u = new URL(String(url), window.location.href);
    const httpOrigin = u.origin.replace(/^ws(s?):/, 'http$1:');
    return httpOrigin === origin;
  } catch {
    return false;
  }
}

/** Adds the token as a query param (for WebSocket / EventSource URLs). */
export function withLocalToken(url: string | URL): string {
  const s = String(url);
  const t = syncToken();
  if (!t || !isLocalApiUrl(s)) return s;
  const u = new URL(s, window.location.href);
  u.searchParams.set(QUERY, t);
  return u.toString();
}

let installed = false;

export function installLocalApiAuth(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  syncToken();

  // fetch
  const origFetch = window.fetch.bind(window);
  const sendFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (!isLocalApiUrl(url)) return origFetch(input, init);
    const t = await ensureLocalToken();
    if (!t) return origFetch(input, init);
    if (input instanceof Request && !init) {
      const req = new Request(input);
      req.headers.set(HEADER, t);
      return origFetch(req);
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(HEADER, t);
    return origFetch(input, { ...init, headers });
  };
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    // Step-up (Touch ID) before sensitive calls — local and remote alike.
    if (isDesktop() && isSensitiveRequest(method, url)) await ensureStepUp();
    const res = await sendFetch(input, init);
    if (isLocalApiUrl(url)) {
      if (res.status === 423) void refreshSecurity();
      if (res.status === 428 && !(input instanceof Request && input.bodyUsed)) {
        await ensureStepUp();
        return sendFetch(input, init);
      }
    }
    return res;
  };

  // XMLHttpRequest (axios)
  const xhrUrl = new WeakMap<XMLHttpRequest, string>();
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send as (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) => void;
  const xhrMethod = new WeakMap<XMLHttpRequest, string>();
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    xhrMethod.set(this, String(args[0] ?? 'GET'));
    xhrUrl.set(this, String(args[1]));
    return (origOpen as (...a: unknown[]) => void).apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const url = xhrUrl.get(this);
    if (!url) return origSend.call(this, body);
    const local = isLocalApiUrl(url);
    const sensitive = isDesktop() && isSensitiveRequest(xhrMethod.get(this) ?? 'GET', url);
    if (local) {
      this.addEventListener('loadend', () => { if (this.status === 423) void refreshSecurity(); });
    }
    const t = local ? syncToken() : null;
    if (!sensitive && (!local || t)) {
      if (t) this.setRequestHeader(HEADER, t);
      return origSend.call(this, body);
    }
    // Hold the request for the IPC token (detached window) and / or the
    // step-up prompt; a cancelled prompt aborts it (axios: canceled).
    void (async () => {
      try {
        if (local) {
          const tok = t ?? (await ensureLocalToken());
          if (tok) this.setRequestHeader(HEADER, tok);
        }
        if (sensitive) await ensureStepUp();
        origSend.call(this, body);
      } catch {
        this.abort();
      }
    })();
  };

  // WebSocket / EventSource: no headers — token goes in the query string.
  // A sensitive socket (exec, shells) needs a fresh step-up first; a
  // constructor can't wait, so it gets a stand-in that connects afterwards.
  const OrigWS = window.WebSocket;
  const PatchedWS = function (this: WebSocket, url: string | URL, protocols?: string | string[]) {
    const target = withLocalToken(url);
    if (isDesktop() && isSensitiveRequest('GET', target)) return deferredSocket(OrigWS, target, protocols);
    return new OrigWS(target, protocols);
  } as unknown as typeof WebSocket;
  PatchedWS.prototype = OrigWS.prototype;
  Object.assign(PatchedWS, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = PatchedWS;

  if (typeof window.EventSource === 'function') {
    const OrigES = window.EventSource;
    const PatchedES = function (this: EventSource, url: string | URL, init?: EventSourceInit) {
      return new OrigES(withLocalToken(url), init);
    } as unknown as typeof EventSource;
    PatchedES.prototype = OrigES.prototype;
    Object.assign(PatchedES, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });
    window.EventSource = PatchedES;
  }
}

/**
 * A WebSocket stand-in that opens the real socket once the step-up prompt
 * succeeds and forwards its events; a cancelled prompt ends it with an error +
 * close (code 4401), like a refused handshake.
 */
function deferredSocket(Orig: typeof WebSocket, url: string, protocols?: string | string[]): WebSocket {
  const et = new EventTarget() as EventTarget & Record<string, unknown>;
  let real: WebSocket | null = null;
  let state: number = Orig.CONNECTING;
  let closedEarly = false;
  let binaryType: BinaryType = 'blob';
  const fire = (ev: Event) => {
    const h = et[`on${ev.type}`];
    if (typeof h === 'function') (h as (e: Event) => void).call(et, ev);
    et.dispatchEvent(ev);
  };
  Object.defineProperties(et, {
    url: { get: () => url },
    readyState: { get: () => (real ? real.readyState : state) },
    protocol: { get: () => real?.protocol ?? '' },
    extensions: { get: () => real?.extensions ?? '' },
    bufferedAmount: { get: () => real?.bufferedAmount ?? 0 },
    binaryType: { get: () => real?.binaryType ?? binaryType, set: (v: BinaryType) => { binaryType = v; if (real) real.binaryType = v; } },
    CONNECTING: { value: 0 }, OPEN: { value: 1 }, CLOSING: { value: 2 }, CLOSED: { value: 3 },
  });
  for (const k of ['onopen', 'onmessage', 'onerror', 'onclose']) et[k] = null;
  et.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
    if (!real) throw new DOMException('WebSocket is not open', 'InvalidStateError');
    real.send(data);
  };
  et.close = (code?: number, reason?: string) => {
    if (real) { real.close(code, reason); return; }
    closedEarly = true;
    state = Orig.CLOSED;
  };
  void ensureStepUp('open a shell in PatchMan').then(
    () => {
      if (closedEarly) return;
      real = new Orig(url, protocols);
      real.binaryType = binaryType;
      for (const type of ['open', 'message', 'error', 'close']) {
        real.addEventListener(type, (e) => {
          let copy: Event;
          if (e instanceof MessageEvent) copy = new MessageEvent('message', { data: e.data, origin: e.origin });
          else if (e instanceof CloseEvent) copy = new CloseEvent('close', { code: e.code, reason: e.reason, wasClean: e.wasClean });
          else copy = new Event(type);
          fire(copy);
        });
      }
    },
    () => {
      if (closedEarly) return;
      state = Orig.CLOSED;
      fire(new Event('error'));
      fire(new CloseEvent('close', { code: 4401, reason: 'step-up cancelled', wasClean: false }));
    },
  );
  return et as unknown as WebSocket;
}

installLocalApiAuth();
