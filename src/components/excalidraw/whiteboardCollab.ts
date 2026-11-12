import { getActiveBaseUrl } from '@/services/api';

// whiteboardCollab — a thin client for the per-board real-time room served by
// the BE at /api/whiteboards/:id/collab. It authenticates by query param (the
// browser WebSocket API can't set headers): a signed-in user passes the JWT via
// ?token=, an anonymous share-link viewer/editor passes ?link=. The connection
// relays three frame types — scene (full element array), pointer (live cursor),
// presence (roster) — with a server-stamped senderId so a client ignores its
// own echo. Sends are fire-and-forget; the caller throttles them.

export interface CollabPeer {
  id: string;
  name: string;
  canEdit: boolean;
}

export interface CollabHandlers {
  onScene: (elements: unknown[]) => void;
  onPointer: (senderId: string, x: number, y: number) => void;
  onPresence: (peers: CollabPeer[], selfId: string | null) => void;
  onStatus?: (connected: boolean) => void;
}

export interface CollabConn {
  sendScene: (elements: unknown[]) => void;
  sendPointer: (x: number, y: number) => void;
  close: () => void;
}

function wsBaseUrl(): string | null {
  let base = getActiveBaseUrl();
  if (base.startsWith('http://')) base = 'ws://' + base.slice('http://'.length);
  else if (base.startsWith('https://')) base = 'wss://' + base.slice('https://'.length);
  else if (base.startsWith('/')) {
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    base = `${scheme}//${window.location.host}${base}`;
  } else return null;
  if (base.endsWith('/')) base = base.slice(0, -1);
  return base;
}

// connectCollab opens (and keeps re-opening, with capped backoff) a room
// connection for `boardId`. Auth is exactly one of token/link. Returns a handle
// to send frames and to close. Safe to call even when collab isn't wanted — it
// just no-ops if the URL can't be built.
export function connectCollab(
  boardId: string,
  auth: { token?: string | null; link?: string | null },
  h: CollabHandlers,
): CollabConn {
  const base = wsBaseUrl();
  const q = auth.link ? `link=${encodeURIComponent(auth.link)}` : auth.token ? `token=${encodeURIComponent(auth.token)}` : '';
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let reconnectTimer: number | null = null;

  const connect = () => {
    if (closed || !base) return;
    let sock: WebSocket;
    try {
      sock = new WebSocket(`${base}/whiteboards/${boardId}/collab?${q}`);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      retry = 0;
      h.onStatus?.(true);
    };
    sock.onclose = () => {
      h.onStatus?.(false);
      if (!closed) scheduleReconnect();
    };
    sock.onerror = () => { try { sock.close(); } catch { /* ignore */ } };
    sock.onmessage = (ev) => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(ev.data as string); } catch { return; }
      const sender = typeof m.senderId === 'string' ? m.senderId : '';
      switch (m.type) {
        case 'scene':
          if (Array.isArray(m.elements)) h.onScene(m.elements as unknown[]);
          break;
        case 'pointer':
          if (typeof m.x === 'number' && typeof m.y === 'number') h.onPointer(sender, m.x, m.y);
          break;
        case 'presence': {
          const peers = Array.isArray(m.peers) ? (m.peers as CollabPeer[]) : [];
          // The server doesn't label which peer is us, so selfId stays null; we
          // rely on server-stamped senderId echo-suppression for scene frames.
          h.onPresence(peers, null);
          break;
        }
      }
    };
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    retry += 1;
    // Give up after ~8 tries so a revoked link / lost access doesn't hammer the
    // BE (repeated 403s) for the tab's whole lifetime.
    if (retry > 8) { closed = true; return; }
    const delay = Math.min(1000 * 2 ** Math.min(retry, 5), 30000); // 2s..30s
    reconnectTimer = window.setTimeout(() => { reconnectTimer = null; connect(); }, delay);
  };

  const send = (obj: Record<string, unknown>) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch { /* dropped */ }
    }
  };

  connect();

  return {
    sendScene: (elements) => send({ type: 'scene', elements }),
    sendPointer: (x, y) => send({ type: 'pointer', x, y }),
    close: () => {
      closed = true;
      if (reconnectTimer) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ws) { try { ws.close(); } catch { /* ignore */ } ws = null; }
    },
  };
}
