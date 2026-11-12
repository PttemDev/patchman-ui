import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Check, CircleAlert, Eye, Users, ChevronRight, Folder as FolderIcon, FolderOpen, Shapes, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Excalidraw, serializeAsJSON, reconcileElements, CaptureUpdateAction } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { whiteboardPublicAPI } from '@/services/api';
import { useThemeStore } from '@/stores/themeStore';
import { connectCollab, type CollabConn, type CollabPeer } from './whiteboardCollab';
import type { BoardApi } from './excalidrawInsert';

function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 70%, 55%)`;
}

type InitialData = ComponentProps<typeof Excalidraw>['initialData'];
type ChangeHandler = NonNullable<ComponentProps<typeof Excalidraw>['onChange']>;
type ChangeArgs = Parameters<ChangeHandler>;
type SaveState = 'saved' | 'saving' | 'error';
type LinkRole = 'viewer' | 'editor';

interface PublicBoardData { id: string; name: string; type?: 'whiteboard'; scene: string; role: LinkRole }
interface PublicItem { id: string; parentId: string | null; name: string; type: 'whiteboard' | 'folder'; sortOrder: number }
interface PublicFolderData { id: string; name: string; type: 'folder'; role: LinkRole; items: PublicItem[] }

function fingerprint(elements: ChangeArgs[0]): string {
  let sum = 0;
  for (const el of elements) sum += (el as { version?: number }).version ?? 0;
  return `${elements.length}:${sum}`;
}

// PublicWhiteboardPage is the NO-ACCOUNT view opened via a share link at
// /wb/:token. It resolves the token through the unauthed public API: a board
// link renders that board; a folder link renders the folder's tree beside the
// picked board (?board=<id>, so deep links and Back work). Standalone: no app
// shell, no auth.
export function PublicWhiteboardPage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<{ data?: PublicBoardData | PublicFolderData; error?: boolean }>({});

  useEffect(() => {
    let cancelled = false;
    setState({});
    whiteboardPublicAPI.get(token)
      .then((res) => { if (!cancelled) setState({ data: res.data as PublicBoardData | PublicFolderData }); })
      .catch(() => { if (!cancelled) setState({ error: true }); });
    return () => { cancelled = true; };
  }, [token]);

  if (state.error) return <LoadError />;
  if (!state.data) return <Loading />;
  // An older BE sends no `type` — that is always a board link.
  if (state.data.type === 'folder') return <PublicFolder token={token} folder={state.data} />;
  return <PublicBoard token={token} board={state.data as PublicBoardData} />;
}

function Loading() {
  const { t } = useTranslation('excalidraw');
  return (
    <div className="h-full min-h-0 flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}
    </div>
  );
}

function LoadError() {
  const { t } = useTranslation('excalidraw');
  return <div className="h-full min-h-0 flex-1 flex items-center justify-center text-sm text-destructive">{t('loadError')}</div>;
}

// PublicBoard renders one board and — for an 'editor' link — autosaves
// anonymous edits back through the token (`boardId` set = a board under a
// folder link). A 'viewer' link is fully read-only (Excalidraw viewMode + no
// save path).
function PublicBoard({ token, board, boardId }: { token: string; board: PublicBoardData; boardId?: string }) {
  const { t } = useTranslation('excalidraw');
  const theme = useThemeStore((s) => s.theme);
  const { name, role } = board;
  const [initialData] = useState<InitialData>(() => {
    let scene: { elements?: unknown; appState?: unknown; files?: unknown } = {};
    try { scene = board.scene ? JSON.parse(board.scene) : {}; } catch { scene = {}; }
    return { elements: (scene.elements ?? []) as ChangeArgs[0], appState: scene.appState ?? {}, files: scene.files ?? {} } as InitialData;
  });
  const [saveState, setSaveState] = useState<SaveState>('saved');

  const saveTimer = useRef<number | null>(null);
  const savedFp = useRef<string>(fingerprint(((initialData as { elements?: ChangeArgs[0] })?.elements ?? []) as ChangeArgs[0]));
  const mounted = useRef(true);

  const apiRef = useRef<BoardApi | null>(null);
  const collab = useRef<CollabConn | null>(null);
  const cursors = useRef<Map<string, { x: number; y: number }>>(new Map());
  const peerNames = useRef<Map<string, string>>(new Map());
  const sceneThrottle = useRef<{ last: number; timer: number | null }>({ last: 0, timer: null });
  const pointerThrottle = useRef<number>(0);
  const latest = useRef<ChangeArgs | null>(null); // live [elements, appState, files]
  const [peerCount, setPeerCount] = useState(0);

  const save = useCallback(
    (scene: string) => (boardId ? whiteboardPublicAPI.updateBoard(token, boardId, scene) : whiteboardPublicAPI.update(token, scene)),
    [token, boardId],
  );

  // Switching boards in a folder unmounts this view — flush a pending
  // autosave instead of dropping the last second of edits.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
      const l = latest.current;
      if (role === 'editor' && l && fingerprint(l[0]) !== savedFp.current) {
        void saveRef.current(serializeAsJSON(l[0], l[1], l[2], 'database')).catch(() => undefined);
      }
    };
  }, [role]);

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

  // Join the collab room via the anonymous share LINK. Editors relay their
  // edits; viewers observe. Remote scenes are reconciled + marked clean.
  useEffect(() => {
    // Join the room by the REAL board id (from PublicGet) — not the link token —
    // so anonymous editors share the room with signed-in editors on this board.
    const conn = connectCollab(board.id, { link: token }, {
      onScene: (remoteEls) => {
        const api = apiRef.current;
        if (!api) return;
        const reconciled = reconcileElements(api.getSceneElements() as never, remoteEls as never, api.getAppState() as never);
        api.updateScene({ elements: reconciled as never, captureUpdate: CaptureUpdateAction.NEVER });
        const merged = reconciled as unknown as ChangeArgs[0];
        savedFp.current = fingerprint(merged);
        // Track the converged scene so a pending save flushes the merged result.
        latest.current = [merged, api.getAppState() as ChangeArgs[1], api.getFiles() as ChangeArgs[2]];
      },
      onPointer: (senderId, x, y) => {
        if (!senderId) return;
        cursors.current.set(senderId, { x, y });
        pushCursors();
      },
      onPresence: (peers: CollabPeer[]) => {
        peerNames.current = new Map(peers.map((p) => [p.id, p.name || 'Guest']));
        for (const sid of [...cursors.current.keys()]) if (!peerNames.current.has(sid)) cursors.current.delete(sid);
        setPeerCount(Math.max(0, peers.length - 1));
        pushCursors();
      },
    });
    collab.current = conn;
    return () => { conn.close(); collab.current = null; cursors.current.clear(); peerNames.current.clear(); setPeerCount(0); };
  }, [board.id, token, pushCursors]);

  // Sends the live scene (latest.current), throttled.
  const broadcastScene = useCallback(() => {
    const conn = collab.current;
    if (!conn) return;
    const th = sceneThrottle.current;
    const now = Date.now();
    const flush = () => { th.last = Date.now(); conn.sendScene((latest.current ? latest.current[0] : []) as unknown[]); };
    if (now - th.last >= 150) { if (th.timer) { window.clearTimeout(th.timer); th.timer = null; } flush(); }
    else if (!th.timer) { th.timer = window.setTimeout(() => { th.timer = null; flush(); }, 150 - (now - th.last)); }
  }, []);

  type PointerPayload = { pointer: { x: number; y: number } };
  const handlePointer = useCallback(
    (payload: PointerPayload) => {
      if (role !== 'editor') return;
      const conn = collab.current;
      if (!conn) return;
      const now = Date.now();
      if (now - pointerThrottle.current < 50) return;
      pointerThrottle.current = now;
      conn.sendPointer(payload.pointer.x, payload.pointer.y);
    },
    [role],
  );

  const handleChange = useCallback<ChangeHandler>(
    (elements, appState, files) => {
      if (role !== 'editor') return;
      const fp = fingerprint(elements);
      latest.current = [elements, appState, files];
      if (fp === savedFp.current) return;
      broadcastScene();
      setSaveState('saving');
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        saveTimer.current = null;
        // Save the LIVE scene, not this closure's snapshot (a remote frame may
        // have merged newer elements in since we scheduled).
        const l = latest.current;
        if (!l) return;
        const liveFp = fingerprint(l[0]);
        if (liveFp === savedFp.current) { if (mounted.current) setSaveState('saved'); return; }
        try {
          await save(serializeAsJSON(l[0], l[1], l[2], 'database'));
          savedFp.current = liveFp;
          if (mounted.current) setSaveState('saved');
        } catch {
          if (mounted.current) setSaveState('error');
        }
      }, 800);
    },
    [role, save, broadcastScene],
  );

  return (
    <div className={cn('flex flex-col min-w-0', boardId ? 'h-full flex-1' : 'h-screen')}>
      <div className="shrink-0 h-9 px-3 flex items-center justify-between gap-2 border-b text-xs bg-background">
        <span className="truncate font-medium">{name}</span>
        <div className="flex items-center gap-2 shrink-0">
          {peerCount > 0 && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400" title={t('collabActive', { count: peerCount })}>
              <Users className="h-3.5 w-3.5" /> {peerCount}
            </span>
          )}
          {role === 'viewer' ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Eye className="h-3.5 w-3.5" /> {t('roleViewer')}
            </span>
          ) : (
            <SaveStatus state={saveState} />
          )}
        </div>
      </div>
      {role === 'viewer' && (
        <div className="shrink-0 px-3 py-1 text-[11px] text-amber-600 dark:text-amber-500 border-b bg-amber-500/5">
          {t('readOnlyBanner')}
        </div>
      )}
      <div className="flex-1 min-h-0 w-full">
        <Excalidraw
          excalidrawAPI={(api) => { apiRef.current = api; }}
          theme={theme === 'dark' ? 'dark' : 'light'}
          initialData={initialData}
          viewModeEnabled={role === 'viewer'}
          onChange={handleChange}
          onPointerUpdate={handlePointer as ComponentProps<typeof Excalidraw>['onPointerUpdate']}
        />
      </div>
    </div>
  );
}

// PublicFolder: a folder link — the folder's boards on the left (tree, or a
// flat list while searching), the picked board on the right.
function PublicFolder({ token, folder }: { token: string; folder: PublicFolderData }) {
  const { t } = useTranslation('excalidraw');
  const [params, setParams] = useSearchParams();
  const selected = params.get('board') ?? '';
  const [query, setQuery] = useState('');

  // Tree keyed by parent; the folder's own children are the roots.
  const { childrenOf, byId, boardCount } = useMemo(() => {
    const kids = new Map<string, PublicItem[]>();
    const ids = new Map<string, PublicItem>();
    let count = 0;
    for (const it of folder.items) {
      ids.set(it.id, it);
      if (it.type === 'whiteboard') count++;
      const key = it.parentId ?? folder.id;
      const arr = kids.get(key);
      if (arr) arr.push(it);
      else kids.set(key, [it]);
    }
    for (const arr of kids.values()) {
      arr.sort((a, z) => (a.type === z.type ? 0 : a.type === 'folder' ? -1 : 1) || a.sortOrder - z.sortOrder || a.name.localeCompare(z.name));
    }
    return { childrenOf: (id: string) => kids.get(id) ?? [], byId: ids, boardCount: count };
  }, [folder]);

  const pathOf = useCallback((it: PublicItem) => {
    const parts: string[] = [];
    let cur = it.parentId ? byId.get(it.parentId) : undefined;
    for (let i = 0; cur && i < 64; i++) { parts.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
    return parts.join(' / ');
  }, [byId]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? folder.items.filter((it) => it.type === 'whiteboard' && it.name.toLowerCase().includes(q)) : []),
    [folder.items, q],
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const pick = (id: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('board', id); return n; });

  const renderNode = (it: PublicItem, depth: number): React.ReactNode => {
    const pad = { paddingLeft: `${depth * 12 + 6}px` };
    if (it.type === 'folder') {
      const open = !collapsed.has(it.id);
      return (
        <div key={it.id}>
          <button type="button" onClick={() => toggle(it.id)} style={pad}
            className="w-full flex items-center gap-1.5 py-1 pr-2 rounded text-left text-sm hover:bg-accent/50">
            <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
            {open ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : <FolderIcon className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
            <span className="truncate">{it.name}</span>
          </button>
          {open && childrenOf(it.id).map((c) => renderNode(c, depth + 1))}
        </div>
      );
    }
    return (
      <button key={it.id} type="button" onClick={() => pick(it.id)} style={pad} title={it.name}
        className={cn('w-full flex items-center gap-1.5 py-1 pr-2 rounded text-left text-sm',
          it.id === selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')}>
        <span className="w-3 shrink-0" />
        <Shapes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{it.name}</span>
      </button>
    );
  };

  return (
    <div className="h-screen flex">
      <aside className="w-60 sm:w-64 shrink-0 border-r flex flex-col min-h-0 bg-background">
        <div className="shrink-0 h-9 px-3 flex items-center gap-1.5 border-b text-xs">
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="truncate font-medium">{folder.name}</span>
          <span className="ml-auto shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground" title={t('publicFolder.boardCount')}>{boardCount}</span>
        </div>
        <div className="shrink-0 p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('publicFolder.search')}
              className="w-full h-7 pl-7 pr-2 rounded-md border bg-transparent text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
          {boardCount === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t('publicFolder.empty')}</p>
          ) : q ? (
            matches.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">{t('publicFolder.noMatches')}</p>
            ) : matches.map((it) => (
              <button key={it.id} type="button" onClick={() => pick(it.id)} title={it.name}
                className={cn('w-full flex flex-col items-start px-2 py-1 rounded text-left',
                  it.id === selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')}>
                <span className="flex items-center gap-1.5 text-sm min-w-0 max-w-full">
                  <Shapes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{it.name}</span>
                </span>
                {pathOf(it) && <span className="pl-5 text-[10px] text-muted-foreground truncate max-w-full">{pathOf(it)}</span>}
              </button>
            ))
          ) : (
            childrenOf(folder.id).map((it) => renderNode(it, 0))
          )}
        </div>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col">
        {selected ? (
          <FolderBoard key={selected} token={token} boardId={selected} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <Shapes className="h-8 w-8 text-muted-foreground/40" />
            {boardCount === 0 ? t('publicFolder.empty') : t('publicFolder.pickBoard')}
          </div>
        )}
      </main>
    </div>
  );
}

// One board under a folder link, loaded by id.
function FolderBoard({ token, boardId }: { token: string; boardId: string }) {
  const [state, setState] = useState<{ data?: PublicBoardData; error?: boolean }>({});
  useEffect(() => {
    let cancelled = false;
    whiteboardPublicAPI.getBoard(token, boardId)
      .then((res) => { if (!cancelled) setState({ data: res.data as PublicBoardData }); })
      .catch(() => { if (!cancelled) setState({ error: true }); });
    return () => { cancelled = true; };
  }, [token, boardId]);
  if (state.error) return <LoadError />;
  if (!state.data) return <Loading />;
  return <PublicBoard token={token} board={state.data} boardId={boardId} />;
}

function SaveStatus({ state }: { state: SaveState }) {
  const { t } = useTranslation('excalidraw');
  if (state === 'saving') return <span className="flex items-center gap-1 text-muted-foreground shrink-0"><Loader2 className="h-3 w-3 animate-spin" /> {t('saving')}</span>;
  if (state === 'error') return <span className="flex items-center gap-1 text-destructive shrink-0" title={t('saveErrorHint')}><CircleAlert className="h-3 w-3" /> {t('saveError')}</span>;
  return <span className="flex items-center gap-1 text-muted-foreground/70 shrink-0" title={t('autoSavedHint')}><Check className="h-3 w-3 text-emerald-500/80" /> {t('autoSaved')}</span>;
}

export default PublicWhiteboardPage;
