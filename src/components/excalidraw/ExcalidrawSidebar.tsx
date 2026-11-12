import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, FolderPlus, Loader2, Shapes, Laptop, Cloud, CloudUpload, Users2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useWhiteboardStore } from '@/stores/whiteboardStore';
import { useRequestStore } from '@/stores/requestStore';
import { isEmbeddedBackend } from '@/services/api';
import { activeRemoteInfo, useRemoteStore } from '@/stores/remoteStore';
import { useAuthStore } from '@/stores/authStore';
import type { Whiteboard } from '@/types';
import { WhiteboardTree } from './WhiteboardTree';
import { SharedBoardTree } from './SharedBoardTree';

// Section open/closed state, persisted per section like CollectionsAccordion's
// (default open; localStorage may be unavailable — then it just resets).
function usePersistedOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) !== '0'; } catch { return true; }
  });
  const toggle = useCallback(() => {
    setOpen((v) => {
      try { localStorage.setItem(key, v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  }, [key]);
  return [open, toggle];
}

// Collapsible section header — same markup as CollectionsAccordion's so the two
// sidebars read alike: chevron + icon + uppercase label + count badge.
function SectionHeader({ open, onToggle, icon, label, count }: {
  open: boolean;
  onToggle: () => void;
  icon: ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/40 rounded transition-colors"
    >
      {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      {icon}
      <span className="uppercase tracking-wider">{label}</span>
      {count > 0 && <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">{count}</Badge>}
    </button>
  );
}

// Open a whiteboard in a main-pane tab, reusing the existing tab if that board
// is already open (matched by whiteboardId) — the same find-by-type/id pattern
// the Dev Tools sidebar uses. Shared so header "New" can open too.
function useOpenBoard() {
  const tabs = useRequestStore((s) => s.tabs);
  const addTab = useRequestStore((s) => s.addTab);
  const setActiveTab = useRequestStore((s) => s.setActiveTab);
  return useCallback(
    (board: Whiteboard) => {
      const existing = tabs.find((t) => t.type === 'excalidraw' && t.whiteboardId === board.id);
      if (existing) {
        setActiveTab(existing.id);
        return;
      }
      addTab(
        {
          type: 'excalidraw',
          whiteboardId: board.id,
          name: board.name,
          method: 'GET',
          url: '',
          // Own boards have no role → editable; shared rows carry viewer/editor.
          ...(board.role ? { whiteboardRole: board.role } : {}),
        },
        true,
      );
    },
    [tabs, addTab, setActiveTab],
  );
}

// ExcalidrawHeaderActions — Refresh + New folder + New board, for the shared
// sidebar panel header.
export function ExcalidrawHeaderActions() {
  const { t } = useTranslation('excalidraw');
  const fetchBoards = useWhiteboardStore((s) => s.fetchBoards);
  const createBoard = useWhiteboardStore((s) => s.createBoard);
  const createFolder = useWhiteboardStore((s) => s.createFolder);
  const openBoard = useOpenBoard();

  const handleNew = useCallback(async () => {
    const board = await createBoard(t('untitled'));
    openBoard(board);
  }, [createBoard, openBoard, t]);

  return (
    <div className="flex items-center gap-0.5">
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => fetchBoards()} title={t('common:refresh')}>
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => createFolder(t('newFolderName'))} title={t('newFolder')}>
        <FolderPlus className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleNew} title={t('new')}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// StorageBadge shows WHERE whiteboards physically live for this session:
// the on-device local database (desktop offline) or the remote PatchMan server.
function StorageBadge() {
  const { t } = useTranslation('excalidraw');
  // Re-render when the storage location can change: local ↔ synced (authStore)
  // or the active remote (remoteStore).
  const sig = useAuthStore((s) => `${s.mode}:${s.dataSource}`);
  const activeId = useRemoteStore((s) => s.activeId);
  void sig;
  void activeId;
  const embedded = isEmbeddedBackend();
  const remote = activeRemoteInfo();
  const name = remote.label;
  const url = remote.url.startsWith('/') ? window.location.host : remote.url;
  return (
    <div className="flex items-center gap-1.5 px-1 pb-1.5 mb-1 border-b text-[10px] text-muted-foreground">
      {embedded ? (
        <Laptop className="h-3 w-3 shrink-0 text-emerald-500/80" />
      ) : (
        <Cloud className="h-3 w-3 shrink-0 text-sky-500/80" />
      )}
      <span className="truncate" title={embedded ? t('storedLocalHint') : t('storedServerHint', { name, url })}>
        {embedded ? t('storedLocal') : t('storedServer', { name })}
      </span>
    </div>
  );
}

export function ExcalidrawSidebar() {
  const { t } = useTranslation(['excalidraw', 'common']);
  const { boards, sharedBoards, deviceBoards, loading, loaded, fetchBoards, fetchShared, fetchDeviceBoards, moveDeviceBoardToCloud, createBoard } = useWhiteboardStore();
  const openBoard = useOpenBoard();
  const { toast } = useToast();
  const [movingId, setMovingId] = useState<string | null>(null);
  const isLocal = useAuthStore((s) => s.mode === 'local');
  const [mineOpen, toggleMine] = usePersistedOpen('patchman_wb_mine_open');
  const [sharedOpen, toggleShared] = usePersistedOpen('patchman_wb_shared_open');
  const [deviceOpen, toggleDevice] = usePersistedOpen('patchman_wb_device_open');

  useEffect(() => {
    fetchBoards();
    fetchShared();
    fetchDeviceBoards();
  }, [fetchBoards, fetchShared, fetchDeviceBoards]);

  // A local→cloud merge (Settings → Data) can push boards into the account
  // while this sidebar is already mounted; reload so they show without a
  // manual refresh. authStore fires this after applyFirstSync.
  useEffect(() => {
    const reload = () => { fetchBoards(); fetchShared(); fetchDeviceBoards(); };
    window.addEventListener('patchman:sync-applied', reload);
    return () => window.removeEventListener('patchman:sync-applied', reload);
  }, [fetchBoards, fetchShared, fetchDeviceBoards]);

  // Header counts are top-level nodes, like Collections' root count. Shared
  // share-roots arrive with parentId=null (their subtree keeps real parents).
  const mineCount = boards.filter((b) => !b.parentId).length;
  const sharedCount = sharedBoards.filter((b) => !b.parentId).length;
  // Sharing needs an account — no "Shared with me" section in local mode.
  const showShared = !isLocal;

  // "On this device": leaf boards on the embedded backend that aren't yet in
  // the cloud account (by id). Boards made offline or by the local MCP land
  // here; a shared id means it's already synced, so hide it.
  // Gate on `loaded`: until the cloud list finishes, cloudIds is empty and every
  // device board would flash into the section then vanish once cloud loads.
  const cloudIds = new Set(boards.map((b) => b.id));
  const deviceOnly = loaded ? deviceBoards.filter((b) => b.type !== 'folder' && !cloudIds.has(b.id)) : [];

  const handleMoveToCloud = useCallback(async (id: string) => {
    setMovingId(id);
    try {
      await moveDeviceBoardToCloud(id);
      toast({ title: t('movedToCloud') });
    } catch {
      toast({ title: t('moveToCloudFailed'), variant: 'destructive' });
    } finally {
      setMovingId(null);
    }
  }, [moveDeviceBoardToCloud, toast, t]);

  const handleNew = useCallback(async () => {
    const board = await createBoard(t('untitled'));
    openBoard(board);
  }, [createBoard, openBoard, t]);

  return (
    <div className="p-2 flex flex-col gap-2">
      <StorageBadge />

      {/* My boards — the draggable own tree; compact empty/loading states (no
          tall centered placeholder pushing the other sections down). */}
      <section className="flex flex-col">
        <SectionHeader
          open={mineOpen}
          onToggle={toggleMine}
          icon={<Shapes className="h-3 w-3 text-violet-400" />}
          label={t('myBoards')}
          count={mineCount}
        />
        {mineOpen && (
          <div className="pl-1 pr-0.5 pt-1">
            {boards.length === 0 && (loading || !loaded) ? (
              <div className="flex items-center justify-center py-3" aria-label={t('loading')}>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              </div>
            ) : boards.length === 0 ? (
              <div className="px-2 py-1.5">
                <p className="text-[11px] text-muted-foreground italic">{t('empty')}</p>
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs gap-1" onClick={handleNew}>
                  <Plus className="h-3.5 w-3.5" /> {t('addFirst')}
                </Button>
              </div>
            ) : (
              <WhiteboardTree boards={boards} onOpen={openBoard} />
            )}
          </div>
        )}
      </section>

      {showShared && (
        <>
          <div className="h-px bg-border mx-2" />
          <section className="flex flex-col">
            <SectionHeader
              open={sharedOpen}
              onToggle={toggleShared}
              icon={<Users2 className="h-3 w-3 text-primary" />}
              label={t('sharedWithMe')}
              count={sharedCount}
            />
            {sharedOpen && (
              <div className="pl-1 pr-0.5 pt-1">
                {sharedBoards.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic px-2 py-1.5">{t('sharedEmpty')}</p>
                ) : (
                  <SharedBoardTree boards={sharedBoards} onOpen={openBoard} />
                )}
              </div>
            )}
          </section>
        </>
      )}

      {deviceOnly.length > 0 && (
        <>
          <div className="h-px bg-border mx-2" />
          <section className="flex flex-col">
            <SectionHeader
              open={deviceOpen}
              onToggle={toggleDevice}
              icon={<Laptop className="h-3 w-3 text-emerald-500/80" />}
              label={t('onThisDevice')}
              count={deviceOnly.length}
            />
            {deviceOpen && (
              <div className="pl-1 pr-0.5 pt-1">
                <p className="px-1 pb-1.5 text-[10px] leading-snug text-muted-foreground/80">{t('onThisDeviceHint')}</p>
                <div className="space-y-0.5">
                  {deviceOnly.map((board) => (
                    <div
                      key={board.id}
                      className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-accent/40 transition-colors"
                      title={board.name}
                    >
                      <Shapes className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <span className="text-sm truncate flex-1 min-w-0">{board.name || t('untitled')}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        disabled={movingId === board.id}
                        onClick={() => handleMoveToCloud(board.id)}
                        title={t('moveToCloud')}
                      >
                        {movingId === board.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
