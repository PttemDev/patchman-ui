import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Check, CircleAlert, Workflow, Eye, Users } from 'lucide-react';
import { Excalidraw, serializeAsJSON, reconcileElements, CaptureUpdateAction } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { whiteboardAPI } from '@/services/api';
import { useWhiteboardStore } from '@/stores/whiteboardStore';
import { useThemeStore } from '@/stores/themeStore';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Tab, Whiteboard } from '@/types';
import { registerBoard, unregisterBoard, insertMermaid, type BoardApi } from './excalidrawInsert';
import { MermaidDialog } from './MermaidDialog';
import { connectCollab, type CollabConn, type CollabPeer } from './whiteboardCollab';

// Derive Excalidraw's own prop types instead of importing the (heavy, subpath)
// named types — keeps us in sync with the installed version and lets the change
// handler's element/appState/files types flow straight into serializeAsJSON.
type InitialData = ComponentProps<typeof Excalidraw>['initialData'];
type ChangeHandler = NonNullable<ComponentProps<typeof Excalidraw>['onChange']>;
type ChangeArgs = Parameters<ChangeHandler>;
type SaveState = 'saved' | 'saving' | 'error';

// A cheap content fingerprint: element count + summed element versions. Excalidraw
// bumps an element's `version` on every real edit, so this changes iff the scene
// content changed — and stays put for selection / pan / zoom onChange spam (which
// must NOT trigger a save) and for the restore-on-mount onChange.
function fingerprint(elements: ChangeArgs[0]): string {
  let sum = 0;
  for (const el of elements) sum += (el as { version?: number }).version ?? 0;
  return `${elements.length}:${sum}`;
}

// Stable per-peer cursor color from the (server-stamped) senderId.
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 70%, 55%)`;
}

// ExcalidrawCanvas is the main-pane body for a `type:'excalidraw'` tab. It loads
// the full scene once (list responses omit it), renders the Excalidraw editor
// themed to the app, and autosaves content changes with an 800ms debounce — and
// flushes a pending save on unmount / board switch so the last stroke is never
// lost. A thin header shows the autosave status so nobody hunts for a Save
// button. Real-time collab (live cursors) is a later phase; this is single-editor.
export function ExcalidrawCanvas({ tab }: { tab: Tab }) {
  const { t } = useTranslation('excalidraw');
  const theme = useThemeStore((s) => s.theme);
  const saveScene = useWhiteboardStore((s) => s.saveScene);
  const id = tab.whiteboardId ?? '';
  // A board shared with the user at 'viewer' opens read-only: Excalidraw
  // viewMode on, autosave off.
  const readOnly = tab.whiteboardRole === 'viewer';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [initialData, setInitialData] = useState<InitialData>(undefined);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [diagramOpen, setDiagramOpen] = useState(false);

  const saveTimer = useRef<number | null>(null);
  const latest = useRef<ChangeArgs | null>(null); // last [elements, appState, files]
  const savedFp = useRef<string>(''); // fingerprint last persisted (or loaded)
  const mounted = useRef(true);

  // ── Real-time collab refs ──
  const apiRef = useRef<BoardApi | null>(null);
  const collab = useRef<CollabConn | null>(null);
  const cursors = useRef<Map<string, { x: number; y: number }>>(new Map()); // senderId → last pointer
  const peerNames = useRef<Map<string, string>>(new Map()); // senderId → display name
  const sceneThrottle = useRef<{ last: number; timer: number | null }>({ last: 0, timer: null });
  const pointerThrottle = useRef<number>(0);
  const [peerCount, setPeerCount] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setSaveState('saved');
    latest.current = null;
    (async () => {
      try {
        const res = await whiteboardAPI.get(id);
        // The response interceptor unwraps the { data: ... } envelope → res.data
        // is the whiteboard.
        const board = res.data as Whiteboard;
        let scene: { elements?: unknown; appState?: unknown; files?: unknown } = {};
        try {
          scene = board.scene ? JSON.parse(board.scene) : {};
        } catch {
          scene = {};
        }
        if (cancelled) return;
        const elements = (scene.elements ?? []) as ChangeArgs[0];
        savedFp.current = fingerprint(elements);
        // The scene is opaque JSON we only ever hand back to Excalidraw, which
        // restores/sanitizes it — cast once here at the data boundary.
        setInitialData({ elements, appState: scene.appState ?? {}, files: scene.files ?? {} } as InitialData);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Drop the board from the insert registry when it changes / the canvas
  // unmounts. Kept separate from the save-flush cleanup so the two concerns
  // don't ride on each other's dependency list.
  useEffect(() => () => unregisterBoard(id), [id]);

  // Owns the debounce timer and flushes a pending save when the board changes or
  // the canvas unmounts (tab switch within the 800ms window would otherwise drop
  // the last edit, because the debounced save never fires).
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        const l = latest.current;
        if (l && fingerprint(l[0]) !== savedFp.current) {
          void saveScene(id, serializeAsJSON(l[0], l[1], l[2], 'database'));
        }
      }
    };
  }, [id, saveScene]);

  // Render remote collaborators' live cursors on the canvas.
  const pushCursors = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    type CollabMap = NonNullable<Parameters<BoardApi['updateScene']>[0]>['collaborators'];
    const map = new Map<string, unknown>();
    for (const [sid, p] of cursors.current) {
      map.set(sid, {
        pointer: { x: p.x, y: p.y, tool: 'pointer' },
        button: 'up',
        username: peerNames.current.get(sid) ?? 'Guest',
        id: sid,
        color: { background: colorFor(sid), stroke: colorFor(sid) },
      });
    }
    api.updateScene({ collaborators: map as unknown as CollabMap });
  }, []);

  // Open the per-board collab room: apply remote scene deltas (reconciled, and
  // marked clean so receivers don't re-save), track cursors + presence.
  useEffect(() => {
    if (!id) return;
    let token: string | null = null;
    try { token = localStorage.getItem('patchman_token'); } catch { /* private mode */ }
    const conn = connectCollab(id, { token }, {
      onScene: (remoteEls) => {
        const api = apiRef.current;
        if (!api) return;
        const reconciled = reconcileElements(
          api.getSceneElements() as never,
          remoteEls as never,
          api.getAppState() as never,
        );
        api.updateScene({ elements: reconciled as never, captureUpdate: CaptureUpdateAction.NEVER });
        // A remote apply bumps element versions → our fingerprint would change
        // and EVERY receiver would re-persist the same scene. Mark clean so only
        // the edit's ORIGIN autosaves it — AND update latest.current to the
        // converged scene so a pending debounce/unmount flush saves the merged
        // result (not a pre-merge snapshot), keeping the DB from losing peers'
        // elements on last-write-wins.
        const merged = reconciled as unknown as ChangeArgs[0];
        savedFp.current = fingerprint(merged);
        latest.current = [merged, api.getAppState() as ChangeArgs[1], api.getFiles() as ChangeArgs[2]];
      },
      onPointer: (senderId, x, y) => {
        if (!senderId) return;
        cursors.current.set(senderId, { x, y });
        pushCursors();
      },
      onPresence: (peers: CollabPeer[]) => {
        peerNames.current = new Map(peers.map((p) => [p.id, p.name || 'Guest']));
        for (const sid of [...cursors.current.keys()]) {
          if (!peerNames.current.has(sid)) cursors.current.delete(sid);
        }
        // peerCount excludes self → show others only.
        setPeerCount(Math.max(0, peers.length - 1));
        pushCursors();
      },
    });
    collab.current = conn;
    return () => {
      conn.close();
      collab.current = null;
      cursors.current.clear();
      peerNames.current.clear();
      setPeerCount(0);
    };
  }, [id, pushCursors]);

  // Throttle scene broadcasts to ~150ms with a trailing send (the last edit
  // always reaches peers). Uses latest.current so the trailing frame is fresh.
  const broadcastScene = useCallback((elements: ChangeArgs[0]) => {
    const conn = collab.current;
    if (!conn) return;
    const th = sceneThrottle.current;
    const now = Date.now();
    const flush = () => {
      th.last = Date.now();
      conn.sendScene((latest.current ? latest.current[0] : elements) as unknown[]);
    };
    if (now - th.last >= 150) {
      if (th.timer) { window.clearTimeout(th.timer); th.timer = null; }
      flush();
    } else if (!th.timer) {
      th.timer = window.setTimeout(() => { th.timer = null; flush(); }, 150 - (now - th.last));
    }
  }, []);

  type PointerPayload = { pointer: { x: number; y: number } };
  const handlePointer = useCallback(
    (payload: PointerPayload) => {
      if (readOnly) return;
      const conn = collab.current;
      if (!conn) return;
      const now = Date.now();
      if (now - pointerThrottle.current < 50) return; // ~20fps cursor
      pointerThrottle.current = now;
      conn.sendPointer(payload.pointer.x, payload.pointer.y);
    },
    [readOnly],
  );

  // Poll for diagrams queued by the MCP draw_on_whiteboard tool and render each
  // onto the canvas (Mermaid→Excalidraw is browser-only, so the BE queues and
  // we draw). Drain is atomic server-side, so only this open client renders a
  // given diagram. Editors only — a viewer can't write.
  useEffect(() => {
    if (!id || readOnly) return;
    let stopped = false;
    const drain = async () => {
      if (stopped || !apiRef.current) return;
      // Skip the poll while the window is hidden — a backgrounded tab needn't
      // keep hitting the DB; we drain again the moment it becomes visible.
      if (document.visibilityState === 'hidden') return;
      try {
        const res = await whiteboardAPI.drainDiagrams(id);
        const items = (res.data as { mermaid?: string; title?: string }[]) ?? [];
        for (const it of items) {
          if (it.mermaid) {
            try { await insertMermaid(id, it.mermaid); } catch { /* skip a diagram that won't parse */ }
          }
        }
      } catch { /* transient — next tick retries */ }
    };
    const kick = window.setTimeout(drain, 1200); // after the canvas API registers
    const timer = window.setInterval(drain, 6000);
    const onVisible = () => { if (document.visibilityState === 'visible') void drain(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(kick);
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id, readOnly]);

  const handleChange = useCallback<ChangeHandler>(
    (elements, appState, files) => {
      if (readOnly) return; // viewer share — never write back
      latest.current = [elements, appState, files];
      const fp = fingerprint(elements);
      if (fp === savedFp.current) return; // selection / pan / zoom / restore — no content change
      // Broadcast the scene to the room, throttled to ~150ms (leading + a single
      // trailing send so the final state always propagates).
      broadcastScene(elements);
      setSaveState('saving');
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        saveTimer.current = null;
        // Read the LIVE scene (latest.current), not this closure's snapshot — a
        // remote collab frame may have merged newer elements in since we were
        // scheduled, and saving the stale snapshot would drop them.
        const l = latest.current;
        if (!l) return;
        const liveFp = fingerprint(l[0]);
        if (liveFp === savedFp.current) { if (mounted.current) setSaveState('saved'); return; }
        try {
          await saveScene(id, serializeAsJSON(l[0], l[1], l[2], 'database'));
          savedFp.current = liveFp; // only mark clean on success, so a failed save retries
          if (mounted.current) setSaveState('saved');
        } catch {
          if (mounted.current) setSaveState('error');
        }
      }, 800);
    },
    [id, saveScene, readOnly, broadcastScene],
  );

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
      </div>
    );
  }
  if (error) {
    return <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-destructive">{t('loadError')}</div>;
  }
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 h-7 px-3 flex items-center justify-between gap-2 border-b text-[11px]">
        <span className="truncate text-muted-foreground">{tab.name}</span>
        <div className="flex items-center gap-2 shrink-0">
          {peerCount > 0 && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 shrink-0" title={t('collabActive', { count: peerCount })}>
              <Users className="h-3 w-3" /> {peerCount}
            </span>
          )}
          {readOnly ? (
            <span className="flex items-center gap-1 text-muted-foreground shrink-0" title={t('readOnlyBanner')}>
              <Eye className="h-3 w-3" /> {t('roleViewer')}
            </span>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 text-[11px] gap-1"
                onClick={() => setDiagramOpen(true)}
                title={t('diagramButton')}
              >
                <Workflow className="h-3 w-3" /> {t('diagramButton')}
              </Button>
              <SaveStatus state={saveState} />
            </>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 w-full relative">
        <Excalidraw
          excalidrawAPI={(api) => { apiRef.current = api; registerBoard(id, api); }}
          theme={theme === 'dark' ? 'dark' : 'light'}
          initialData={initialData}
          viewModeEnabled={readOnly}
          onChange={handleChange}
          onPointerUpdate={handlePointer as ComponentProps<typeof Excalidraw>['onPointerUpdate']}
        />
      </div>
      {diagramOpen && !readOnly && <MermaidDialog boardId={id} onClose={() => setDiagramOpen(false)} />}
    </div>
  );
}

// SaveStatus makes the auto-save behaviour visible so there's no phantom Save
// button: "Saving…" while a write is in flight, "Auto-saved" at rest, a red
// "Save failed" if the last write errored.
function SaveStatus({ state }: { state: SaveState }) {
  const { t } = useTranslation('excalidraw');
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1 text-muted-foreground shrink-0">
        <Loader2 className="h-3 w-3 animate-spin" /> {t('saving')}
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="flex items-center gap-1 text-destructive shrink-0" title={t('saveErrorHint')}>
        <CircleAlert className="h-3 w-3" /> {t('saveError')}
      </span>
    );
  }
  return (
    <span className={cn('flex items-center gap-1 text-muted-foreground/70 shrink-0')} title={t('autoSavedHint')}>
      <Check className="h-3 w-3 text-emerald-500/80" /> {t('autoSaved')}
    </span>
  );
}
