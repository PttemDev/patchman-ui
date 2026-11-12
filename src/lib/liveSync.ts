// Realtime mutation broadcast client.
//
// Opens a single authenticated WebSocket to `${API}/realtime` after login
// and routes incoming events to the matching Zustand store's
// refresh action. First iteration uses tam-refresh (no surgical updates) —
// the BE event carries `type` + `collectionId|environmentId` and the FE
// calls the relevant store's `refreshLists` or `fetch*` action. Surgical
// reducers can land later without touching this transport layer.
//
// Lifetime is driven from `App.tsx` (or wherever auth lifecycle lives):
// `connect()` on login, `disconnect()` on logout/local mode. The client
// auto-reconnects with exponential backoff so a momentary BE blip
// recovers without a page reload.

import { useCollectionStore } from '@/stores/collectionStore';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useNotesStore } from '@/stores/notesStore';
import { scheduleMemoryRefresh } from '@/stores/memoryStore';
import { useAuthStore } from '@/stores/authStore';
import { clientId } from '@/lib/clientId';
import { getRemoteBaseUrl } from '@/stores/remoteStore';

// Same env var the axios client reads. Falls back to `/api` so the dev
// proxy still works when VITE_API_URL is unset. Both prod (https) and
// local (vite proxy → http) work because we derive the WS scheme from
// the page protocol.

interface RealtimeEvent {
  type: string;
  collectionId?: string;
  environmentId?: string;
  noteId?: string;
  // originClientId echoes the X-Client-Id of the request that produced
  // this mutation. We compare against our own id to suppress the
  // self-mutation refresh — the FE already calls refreshLists in the
  // mutation's own promise chain, so a duplicate refresh on the event
  // round-trip is wasted bandwidth.
  originClientId?: string;
}

class LiveSyncClient {
  private socket: WebSocket | null = null;
  // Backoff state. Reset to 0 on a clean open; doubles up to a cap on
  // each failed/dropped connection.
  private retries = 0;
  // Reconnect timer handle so disconnect() can cancel a pending retry
  // and the client truly stays down until the next connect() call.
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // shouldStayConnected guards against zombie reconnects after the user
  // logs out — `disconnect()` flips it false; the onclose handler reads
  // it before scheduling another retry.
  private shouldStayConnected = false;
  // Consecutive handshake failures (onclose without a preceding onopen).
  // After a threshold we probe the regular REST API to determine
  // whether the token has expired — that path's axios interceptor
  // already does the right thing (clear token, redirect to /login).
  // Without this guard the WS would silently retry forever against an
  // expired token while the user sits on an idle page.
  private handshakeFailures = 0;
  private openedAtLeastOnce = false;

  /** Open (or re-open) the socket using the JWT currently in authStore. */
  connect() {
    this.shouldStayConnected = true;
    // If a socket is already alive (or opening), don't stack two.
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const token = useAuthStore.getState().token;
    if (!token) {
      // No JWT → nothing to authenticate with. The BE would reject the
      // Upgrade anyway; bail quietly so login-mode flips don't spam
      // failed handshakes.
      return;
    }

    const url = buildWsUrl(token);
    if (!url) return;

    try {
      this.socket = new WebSocket(url);
    } catch (e) {
      console.warn('[liveSync] WebSocket constructor threw', e);
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.retries = 0;
      this.handshakeFailures = 0;
      this.openedAtLeastOnce = true;
    };

    this.socket.onmessage = (msg) => {
      // Defensive: a malformed frame OR a thrown store action must not
      // tear down the socket — refresh failures are recoverable on the
      // next event or manual refresh, but a thrown handler would kill
      // the connection and the user would silently lose live sync.
      let ev: RealtimeEvent;
      try {
        ev = JSON.parse(msg.data);
      } catch {
        return;
      }
      try {
        dispatch(ev);
      } catch (e) {
        console.warn('[liveSync] dispatch threw, ignoring', e);
      }
    };

    this.socket.onclose = () => {
      this.socket = null;
      if (!this.openedAtLeastOnce) {
        this.handshakeFailures += 1;
      }
      // After 3 consecutive handshake failures the token is likely
      // expired or the server is missing the route entirely. Probe the
      // regular API: a 401 there triggers the existing axios
      // interceptor (clear token → /login), and a success means the
      // socket is just sad and we keep trying. The probe runs only on
      // the auth-failure suspicion path so a healthy reconnect storm
      // (BE restart) doesn't generate phantom traffic.
      if (this.handshakeFailures === 3) {
        void probeAuth();
      }
      if (this.shouldStayConnected) {
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = () => {
      // No-op — onclose will fire next and handle reconnect. Logging
      // here would just produce a duplicate line per failure.
    };
  }

  disconnect() {
    this.shouldStayConnected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.retries = 0;
    this.handshakeFailures = 0;
    this.openedAtLeastOnce = false;
  }

  private scheduleReconnect() {
    if (!this.shouldStayConnected) return;
    if (this.reconnectTimer) return;
    // 1s, 2s, 4s, 8s, 16s, 30s, then 60s steady-state cap. Capped low
    // enough that a transient BE restart recovers under a minute, high
    // enough that a misconfigured deploy (no WS route, ingress strips
    // Upgrade) doesn't hammer the BE — the FE keeps working with
    // manual refresh; reconnect keeps trying quietly in the background.
    const delay = Math.min(60_000, 1000 * Math.pow(2, this.retries));
    this.retries += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

// probeAuth fires a lightweight GET against the auth endpoint to decide
// whether repeated WS handshake failures are an auth issue or just a
// flaky route. On 401 we clear the stored token + redirect to /login —
// same effect the axios interceptor produces on any other API call.
// Anything else is treated as transient and the reconnect loop keeps
// running quietly in the background.
async function probeAuth() {
  try {
    const token = useAuthStore.getState().token;
    if (!token) return; // already logged out — nothing to do
    let base = getRemoteBaseUrl();
    if (base.startsWith('/')) {
      base = `${window.location.origin}${base}`;
    }
    if (base.endsWith('/')) base = base.slice(0, -1);
    const res = await fetch(`${base}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      try {
        localStorage.removeItem('patchman_token');
        localStorage.removeItem('patchman_user');
      } catch {
        /* ignore */
      }
      // Hard reload to /login: matches the axios interceptor's behaviour
      // so the user lands in the same place whether REST or WS detects
      // the expired token first.
      window.location.href = '/login';
    }
  } catch {
    // Network error — leave the reconnect loop alone, the BE might just
    // be down. The next probe will run after another 3 failures.
  }
}

function buildWsUrl(token: string): string | null {
  // Map http(s):// → ws(s):// on the configured API origin. When
  // getRemoteBaseUrl() is the relative `/api`, the WebSocket spec resolves
  // it against the current page origin — exactly what the vite dev
  // proxy expects.
  let base = getRemoteBaseUrl();
  if (base.startsWith('http://')) base = 'ws://' + base.slice('http://'.length);
  else if (base.startsWith('https://')) base = 'wss://' + base.slice('https://'.length);
  else if (base.startsWith('/')) {
    const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    base = `${wsScheme}//${window.location.host}${base}`;
  } else {
    // Unrecognised — bail rather than guess.
    return null;
  }
  // Strip a trailing slash so `${base}/realtime` doesn't yield `//realtime`.
  if (base.endsWith('/')) base = base.slice(0, -1);
  // BE accepts `?token=<jwt>` since the browser WebSocket API can't set
  // Authorization headers on the Upgrade request.
  return `${base}/realtime?token=${encodeURIComponent(token)}`;
}

let notesRefreshTimer: number | undefined;

function dispatch(ev: RealtimeEvent) {
  if (!ev || typeof ev.type !== 'string') return;
  // Self-echo: our own mutation has already triggered refreshLists in
  // the action's promise chain; skipping here saves a duplicate fetch.
  if (ev.originClientId && ev.originClientId === clientId) {
    return;
  }

  // Coarse routing on the type prefix. The first iteration always full-
  // refreshes the relevant store — surgical patches are a future
  // optimization once we know the user-visible refresh feels too heavy.
  if (
    ev.type.startsWith('collection.') ||
    ev.type.startsWith('request.')
  ) {
    void useCollectionStore.getState().refreshLists();
    return;
  }
  if (ev.type.startsWith('environment.')) {
    void useEnvironmentStore.getState().fetchEnvironments();
    return;
  }
  if (ev.type.startsWith('note.')) {
    // Refresh the notes tree (debounced — a burst of edits from a collaborator
    // or an agent is one refetch) and tell an open note tab about it.
    if (ev.type !== 'note.suggestion') {
      window.clearTimeout(notesRefreshTimer);
      notesRefreshTimer = window.setTimeout(() => { void useNotesStore.getState().refreshAll(); }, 400);
    }
    scheduleMemoryRefresh();
    window.dispatchEvent(new CustomEvent('patchman:note-event', { detail: { type: ev.type, noteId: ev.noteId } }));
    return;
  }
  if (ev.type.startsWith('workspace.')) {
    // Team-bind change can also affect which collections are visible
    // (because the workspace selector drives the collection list
    // filter), so refresh both stores on a workspace event.
    void useWorkspaceStore.getState().fetchWorkspaces();
    void useCollectionStore.getState().refreshLists();
  }
}

export const liveSync = new LiveSyncClient();
