import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  MoreHorizontal,
  Edit3,
  Trash2,
  Share2,
  Globe2,
  FilePlus2,
  FolderPlus,
  Link2,
  Brain,
  StickyNote,
  Users2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { useNotesStore } from '@/stores/notesStore';
import { useRequestStore } from '@/stores/requestStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { notesAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import type { MemoryScope, NoteMeta } from '@/types';
import { NoteShareDialog } from './NoteShareDialog';
import { buildNoteTree, type NoteNode as Node } from './noteUtils';
import { formatExact, noteTimesTitle } from './time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const PREFIX = 'note:';
/** Rows a long folder renders at once; the rest follow in the next frames so
 *  opening the sidebar / a big folder never blocks the UI. */
const FIRST_ROWS = 120;
const MORE_ROWS = 250;

// Per-tree UI state (open folders, the active note, the row being renamed)
// lives in a tiny external store: each row subscribes to ITS OWN slice
// (useSyncExternalStore), so opening a folder or switching notes re-renders
// only the rows whose state changed — not the whole tree.
// Folder open / closed choices are remembered across sidebar re-mounts and
// restarts (they used to reset to "open" every time): id → open. A folder
// the user never toggled falls back to the tree's default.
const OPEN_KEY = 'patchman.notes.open.v1';
function loadOpenChoices(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') as Record<string, boolean>; } catch { return {}; }
}
function saveOpenChoice(id: string, open: boolean) {
  try {
    const all = loadOpenChoices();
    all[id] = open;
    // Keep it small: the most recent 2000 choices.
    const keys = Object.keys(all);
    if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete all[k];
    localStorage.setItem(OPEN_KEY, JSON.stringify(all));
  } catch { /* storage blocked: choices last for this session */ }
}

function makeTreeUI(defaults: Set<string>) {
  const choices = loadOpenChoices();
  let expanded = new Set(defaults);
  for (const [id, open] of Object.entries(choices)) {
    if (open) expanded.add(id);
    else expanded.delete(id);
  }
  let active: string | undefined;
  let editing: { id: string | null; name: string } = { id: null, name: '' };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    isOpen: (id: string) => expanded.has(id),
    toggle: (id: string) => {
      const n = new Set(expanded);
      const open = !n.has(id);
      if (open) n.add(id); else n.delete(id);
      expanded = n;
      saveOpenChoice(id, open);
      emit();
    },
    expand: (id: string) => { if (expanded.has(id)) return; expanded = new Set(expanded).add(id); saveOpenChoice(id, true); emit(); },
    getActive: () => active,
    setActive: (id: string | undefined) => { if (active !== id) { active = id; emit(); } },
    getEditing: () => editing,
    setEditing: (e: { id: string | null; name: string }) => { editing = e; emit(); },
  };
}
type TreeUI = ReturnType<typeof makeTreeUI>;
/** Cards listed under one folder in the tree before a "N more" row. */
const CARD_CAP = 30;
const ROOT_DROP = 'note-root';


// NoteTree renders a notes tree. `own` trees are draggable (drop on a folder to
// nest, on a row to reorder, on the top strip to un-nest); shared trees aren't,
// and their actions follow the caller's role (editors add/rename/share inside,
// and delete anything but the share root).
export function NoteTree({ notes, mode, onOpen }: { notes: NoteMeta[]; mode: 'own' | 'shared'; onOpen: (n: NoteMeta) => void }) {
  const { t } = useTranslation(['notes', 'common']);
  const { toast } = useToast();
  const moveNode = useNotesStore((s) => s.moveNode);
  const renameNote = useNotesStore((s) => s.renameNote);
  const removeNote = useNotesStore((s) => s.removeNote);
  const createNote = useNotesStore((s) => s.createNote);
  const activeNoteId = useRequestStore((s) => s.tabs.find((tb) => tb.id === s.activeTabId)?.noteId);
  const draggable = mode === 'own';

  const refreshAll = useNotesStore((s) => s.refreshAll);
  const memoryFolders = useMemoryStore((s) => s.folders);
  const refreshMemory = useMemoryStore((s) => s.refresh);
  // Inside an agent memory every folder behaves the same — a project folder
  // is just a folder with a key: it expands to show what it holds. Cards can
  // be hundreds, so a folder lists its first CARD_CAP and a "N more" row
  // opens the rest in the memory view. Badges: a memory counts every card
  // in it, a folder inside one counts its own items.
  const { visible, cardCount, overflow } = useMemo(() => {
    const byId = new Map(notes.map((n) => [n.id, n]));
    const inMemo = new Map<string, string>(); // folder id → its memory root ('' outside)
    const rootOf = (id: string | null | undefined): string => {
      const seen: string[] = [];
      let cur = id ?? null;
      let found = '';
      for (let i = 0; i < 32 && cur; i++) {
        if (inMemo.has(cur)) { found = inMemo.get(cur)!; break; }
        seen.push(cur);
        const n = byId.get(cur);
        if (!n) break;
        if (n.memory) { found = n.id; break; }
        cur = n.parentId ?? null;
      }
      for (const s2 of seen) inMemo.set(s2, found);
      return found;
    };
    const count = new Map<string, number>();
    const bump = (id: string) => count.set(id, (count.get(id) ?? 0) + 1);
    const cardsBy = new Map<string, NoteMeta[]>();
    for (const n of notes) {
      if (!n.parentId || n.type === 'folder') continue;
      const root = rootOf(n.parentId);
      if (!root) continue;
      if (n.type === 'card') {
        bump(root);
        if (!cardsBy.has(n.parentId)) cardsBy.set(n.parentId, []);
        cardsBy.get(n.parentId)!.push(n);
      }
      if (n.parentId !== root) bump(n.parentId);
    }
    const hidden = new Set<string>();
    const over = new Map<string, number>();
    for (const [parent, list] of cardsBy) {
      if (list.length <= CARD_CAP) continue;
      list.sort((a, z) => (a.sortOrder ?? 0) - (z.sortOrder ?? 0) || a.title.localeCompare(z.title));
      for (const n of list.slice(CARD_CAP)) hidden.add(n.id);
      over.set(parent, list.length - CARD_CAP);
    }
    return { visible: hidden.size ? notes.filter((n) => !hidden.has(n.id)) : notes, cardCount: count, overflow: over };
  }, [notes]);
  const scopeOf = useCallback((id: string) => memoryFolders.find((f) => f.id === id)?.scope, [memoryFolders]);
  const { tree, childrenOf } = useMemo(() => buildNoteTree(visible), [visible]);
  const parentOf = useMemo(() => new Map(notes.map((n) => [n.id, n.parentId ?? null])), [notes]);
  const isWithin = useCallback((nodeId: string, ancestorId: string) => {
    let cur: string | null | undefined = nodeId;
    for (let i = 0; i < 64 && cur; i++) {
      if (cur === ancestorId) return true;
      cur = parentOf.get(cur) ?? null;
    }
    return false;
  }, [parentOf]);

  // Shared spaces start expanded so their pages are visible; own folders too
  // when there are only a few nodes.
  const uiRef = useRef<TreeUI | null>(null);
  if (!uiRef.current) uiRef.current = makeTreeUI(new Set(mode === 'shared' || notes.length <= 30 ? notes.filter((n) => !n.parentId).map((n) => n.id) : []));
  const ui = uiRef.current;
  useEffect(() => { ui.setActive(activeNoteId); }, [ui, activeNoteId]);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<NoteMeta | null>(null);
  const [shareNote, setShareNote] = useState<NoteMeta | null>(null);

  const expand = ui.expand;
  const canEdit = useCallback((n: NoteMeta) => mode === 'own' || n.role === 'editor', [mode]);
  const canDelete = useCallback((n: NoteMeta) => mode === 'own' || (n.role === 'editor' && !!n.parentId), [mode]);
  // The parent may pass a new onOpen each render: keep rows stable.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const openNote = useCallback((n: NoteMeta) => onOpenRef.current(n), []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const collision: CollisionDetection = (args) => {
    const p = pointerWithin(args);
    if (p.length) return p;
    const r = rectIntersection(args);
    return r.length ? r : closestCenter(args);
  };

  const commitRename = useCallback(async () => {
    const { id, name } = ui.getEditing();
    ui.setEditing({ id: null, name: '' });
    if (id && name.trim()) await renameNote(id, name.trim());
  }, [ui, renameNote]);

  const addChild = useCallback(async (parent: NoteMeta | null, type: 'page' | 'folder') => {
    try {
      const n = await createNote({ title: type === 'folder' ? t('newFolderTitle') : t('untitled'), parentId: parent?.id ?? null, type });
      if (parent) expand(parent.id);
      if (type === 'page') openNote(n);
      else ui.setEditing({ id: n.id, name: n.title });
    } catch {
      toast({ title: t('createFailed'), variant: 'destructive' });
    }
  }, [createNote, expand, openNote, ui, t, toast]);

  const toggleMemory = useCallback(async (n: NoteMeta) => {
    try {
      await notesAPI.update(n.id, { memory: !n.memory });
      toast({ title: n.memory ? t('memory.memoryOff') : t('memory.memoryOn') });
      await refreshAll();
      void refreshMemory();
    } catch {
      toast({ title: t('memory.toggleFailed'), variant: 'destructive' });
    }
  }, [refreshAll, refreshMemory, t, toast]);

  const copyLink = useCallback((n: NoteMeta) => {
    void navigator.clipboard.writeText(`[${n.title}](note:${n.id})`).then(() => toast({ title: t('linkCopied') }));
  }, [t, toast]);

  function handleDragEnd(event: DragEndEvent) {
    setDragLabel(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id).slice(PREFIX.length);
    if (String(over.id) === ROOT_DROP) {
      const sibs = childrenOf(null).map((n) => n.id).filter((id) => id !== activeId);
      sibs.push(activeId);
      void moveNode(activeId, null, sibs);
      return;
    }
    const overId = String(over.id).slice(PREFIX.length);
    const overData = over.data.current as { type?: string; parentId?: string | null } | undefined;
    if (!overData || activeId === overId) return;
    if (overData.type === 'folder' && !isWithin(overId, activeId)) {
      const sibs = childrenOf(overId).map((n) => n.id).filter((id) => id !== activeId);
      sibs.push(activeId);
      expand(overId);
      void moveNode(activeId, overId, sibs);
      return;
    }
    const parentId = (overData.parentId ?? null) as string | null;
    if (parentId && isWithin(parentId, activeId)) return;
    const activeIdx = (active.data.current?.sortable as { index?: number } | undefined)?.index ?? -1;
    const overIdx = (over.data.current?.sortable as { index?: number } | undefined)?.index ?? -1;
    const sibs = childrenOf(parentId).map((n) => n.id).filter((id) => id !== activeId);
    const at = sibs.indexOf(overId);
    if (at === -1) return;
    sibs.splice(activeIdx > overIdx ? at : at + 1, 0, activeId);
    void moveNode(activeId, parentId, sibs);
  }

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id).slice(PREFIX.length);
    setDragLabel(notes.find((n) => n.id === id)?.title ?? null);
  }

  const rowProps = useMemo<RowShared>(() => ({
    draggable, ui, onOpen: openNote, commitRename,
    setEditingName: (name: string) => ui.setEditing({ ...ui.getEditing(), name }),
    cancelRename: () => ui.setEditing({ id: null, name: '' }),
    beginRename: (n: NoteMeta) => ui.setEditing({ id: n.id, name: n.title }),
    onDelete: setConfirmDelete, onShare: setShareNote, addChild, copyLink, canEdit, canDelete,
    cardCount, overflow, scopeOf, toggleMemory: mode === 'own' ? toggleMemory : undefined,
  }), [draggable, ui, openNote, commitRename, addChild, copyLink, canEdit, canDelete, cardCount, overflow, scopeOf, mode, toggleMemory]);

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setDragLabel(null)}>
      {draggable && <RootStrip />}
      <NodeList nodes={tree} depth={0} props={rowProps} />
      <DragOverlay>
        {dragLabel ? <div className="px-2 py-1 rounded bg-popover border shadow text-sm truncate max-w-[220px]">{dragLabel}</div> : null}
      </DragOverlay>

      {shareNote && (
        <NoteShareDialog
          note={shareNote}
          open={!!shareNote}
          onOpenChange={(o) => { if (!o) setShareNote(null); }}
        />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle', { name: confirmDelete?.title })}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = confirmDelete;
                setConfirmDelete(null);
                if (target) removeNote(target.id).catch(() => toast({ title: t('deleteFailed'), variant: 'destructive' }));
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t('common:delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DndContext>
  );
}

function RootStrip() {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROP });
  return <div ref={setNodeRef} className={cn('h-1.5 rounded transition-colors', isOver && 'bg-primary/30')} />;
}

interface RowShared {
  draggable: boolean;
  ui: TreeUI;
  onOpen: (n: NoteMeta) => void;
  setEditingName: (v: string) => void;
  beginRename: (n: NoteMeta) => void;
  commitRename: () => void;
  cancelRename: () => void;
  onDelete: (n: NoteMeta) => void;
  onShare: (n: NoteMeta) => void;
  addChild: (parent: NoteMeta | null, type: 'page' | 'folder') => void;
  copyLink: (n: NoteMeta) => void;
  canEdit: (n: NoteMeta) => boolean;
  canDelete: (n: NoteMeta) => boolean;
  cardCount: Map<string, number>;
  /** Folders whose cards the tree cut short: how many more there are. */
  overflow: Map<string, number>;
  scopeOf: (id: string) => MemoryScope | undefined;
  /** Own trees only: make a folder a memory folder or back. */
  toggleMemory?: (n: NoteMeta) => void;
}

const NodeList = memo(function NodeList({ nodes, depth, props }: { nodes: Node[]; depth: number; props: RowShared }) {
  // Long lists render in slices across frames: the first rows paint at once.
  const [limit, setLimit] = useState(() => Math.min(nodes.length, FIRST_ROWS));
  useEffect(() => {
    if (limit >= nodes.length) return;
    const h = requestAnimationFrame(() => setLimit((l) => Math.min(nodes.length, l + MORE_ROWS)));
    return () => cancelAnimationFrame(h);
  }, [limit, nodes.length]);
  const shown = limit >= nodes.length ? nodes : nodes.slice(0, limit);
  const ids = useMemo(() => shown.map((n) => PREFIX + n.id), [shown]);
  const rows = shown.map((n) => (props.draggable
    ? <SortableTreeNode key={n.id} node={n} depth={depth} props={props} />
    : <TreeNode key={n.id} node={n} depth={depth} props={props} />));
  return props.draggable
    ? <SortableContext items={ids} strategy={verticalListSortingStrategy}><div className="space-y-0.5">{rows}</div></SortableContext>
    : <div className="space-y-0.5">{rows}</div>;
});

interface DragBits {
  setNodeRef?: (el: HTMLElement | null) => void;
  style?: React.CSSProperties;
  isDragging?: boolean;
  isOver?: boolean;
  handle?: Record<string, unknown>;
}

// Own trees: a sortable row (drag to reorder / nest).
const SortableTreeNode = memo(function SortableTreeNode({ node, depth, props }: { node: Node; depth: number; props: RowShared }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: PREFIX + node.id,
    data: { type: node.type, parentId: node.parentId ?? null },
  });
  return (
    <TreeNode node={node} depth={depth} props={props}
      drag={{ setNodeRef, style: { transform: CSS.Translate.toString(transform), transition }, isDragging, isOver, handle: { ...attributes, ...listeners } }} />
  );
});

// One row (+ its open children). Rows re-render only when their node, their
// own open / active / renaming state, or the shared callbacks change.
const TreeNode = memo(function TreeNode({ node, depth, props, drag }: { node: Node; depth: number; props: RowShared; drag?: DragBits }) {
  const { t, i18n } = useTranslation(['notes', 'common']);
  const { ui } = props;
  const open = useSyncExternalStore(ui.subscribe, () => ui.isOpen(node.id));
  const isActive = useSyncExternalStore(ui.subscribe, () => ui.getActive() === node.id);
  const editing = useSyncExternalStore(ui.subscribe, () => (ui.getEditing().id === node.id ? ui.getEditing() : null));
  const isFolder = node.type === 'folder';
  const isMemory = isFolder && !!node.memory;
  const cards = props.cardCount.get(node.id) ?? 0;
  const more = props.overflow.get(node.id) ?? 0;
  // The emoji the backend gave memory / project folders is a default, not a
  // choice: they look like every other folder (memory: the brain icon).
  const icon = node.icon && !(isMemory && node.icon === '🧠') && !(isFolder && node.icon === '📁') ? node.icon : '';
  const shareTags = node.sharedWith ?? [];
  const owner = depth === 0 && node.shared ? node.ownerName ?? '' : '';
  const isShared = node.visibility === 'public' || !!node.everyone || shareTags.length > 0 || !!owner;
  const scope = isMemory ? props.scopeOf(node.id) : undefined;
  const hasKids = node.children.length > 0;
  const editable = props.canEdit(node);

  return (
    <div ref={drag?.setNodeRef} style={drag?.style} className={cn(drag?.isDragging && 'opacity-50')}>
      <div
        className={cn(
          'group flex items-center rounded hover:bg-accent/40 transition-colors',
          isActive && 'bg-accent/60',
          isFolder && drag?.isOver && 'ring-1 ring-primary/50 bg-primary/10',
        )}
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          type="button"
          onClick={() => ui.toggle(node.id)}
          className={cn('shrink-0 w-4 h-6 flex items-center justify-center text-muted-foreground', !(isFolder || hasKids) && 'invisible')}
          aria-label={open ? t('collapse') : t('expand')}
          tabIndex={isFolder || hasKids ? 0 : -1}
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
        </button>
        {editing ? (
          <Input
            autoFocus
            value={editing.name}
            onChange={(e) => props.setEditingName(e.target.value)}
            onBlur={props.commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.commitRename();
              if (e.key === 'Escape') props.cancelRename();
            }}
            className="h-7 text-sm mx-1"
          />
        ) : (
          <>
            <button
              type="button"
              {...(drag?.handle ?? {})}
              onClick={() => (isFolder && !isMemory ? ui.toggle(node.id) : props.onOpen(node))}
              className={cn('flex-1 min-w-0 flex items-center gap-1.5 pr-1.5 py-1 text-left', props.draggable && 'cursor-grab active:cursor-grabbing')}
              // Built on hover: formatting dates for every row up front is wasted work.
              onMouseEnter={(e) => { e.currentTarget.title = [node.title, noteTimesTitle(node, i18n.language, t)].filter(Boolean).join('\n'); }}
            >
              {icon ? (
                <span className="text-sm leading-none w-3.5 text-center shrink-0">{icon}</span>
              ) : isMemory ? (
                <Brain className="h-3.5 w-3.5 shrink-0 text-violet-400" />
              ) : node.type === 'card' || node.type === 'hub' ? (
                <StickyNote className={cn('h-3.5 w-3.5 shrink-0 text-amber-500/80', node.stale && 'opacity-50')} />
              ) : isFolder ? (
                open ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400" /> : <FolderIcon className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              ) : (
                <FileText className="h-3.5 w-3.5 shrink-0 text-sky-500/80" />
              )}
              <span className="text-sm truncate">{node.title || t('untitled')}</span>
              {scope?.kind === 'team' && <Users2 className="h-3 w-3 shrink-0 text-violet-400" aria-label={t('memory.scope.team', { teams: (scope.teams ?? []).join(', ') })} />}
              {cards > 0 && <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{cards}</span>}
              {isShared && <ShareBadge owner={owner} tags={shareTags} node={node} label={t('sharedBadge')} />}
            </button>
            <RowMenu node={node} props={props} editable={editable} isFolder={isFolder} isMemory={isMemory} />
          </>
        )}
      </div>
      {open && hasKids && (
        <div className="mt-0.5">
          <NodeList props={props} nodes={node.children} depth={depth + 1} />
          {more > 0 && (
            <button
              type="button"
              onClick={() => props.onOpen(node)}
              className="w-full text-left text-[11px] text-muted-foreground hover:text-foreground py-0.5"
              style={{ paddingLeft: (depth + 1) * 12 + 22 }}
            >
              {t('memory.moreCards', { count: more })}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

// The globe badge's tooltip mounts on first hover (one Radix tooltip per row
// was a large share of a big tree's render cost).
function ShareBadge({ owner, tags, node, label }: { owner: string; tags: NonNullable<Node['sharedWith']>; node: Node; label: string }) {
  const [hover, setHover] = useState(false);
  const icon = (
    <span className="shrink-0 inline-flex" aria-label={label} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Globe2 className="h-3 w-3 text-sky-500/80" />
    </span>
  );
  if (!hover) return icon;
  return (
    <Tooltip open>
      <TooltipTrigger asChild>{icon}</TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-xs bg-popover text-popover-foreground border shadow-lg px-3 py-2">
        <ShareDetails owner={owner} tags={tags} node={node} />
      </TooltipContent>
    </Tooltip>
  );
}

// The row's "…" menu mounts when first opened (same reason as ShareBadge).
function RowMenu({ node, props, editable, isFolder, isMemory }: { node: Node; props: RowShared; editable: boolean; isFolder: boolean; isMemory: boolean }) {
  const { t } = useTranslation(['notes', 'common']);
  const [open, setOpen] = useState(false);
  const trigger = (
    <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0"
      onClick={open ? undefined : () => setOpen(true)} aria-label={t('common:more', { defaultValue: 'More' })}>
      <MoreHorizontal className="h-3.5 w-3.5" />
    </Button>
  );
  if (!open) return trigger;
  return (
    <DropdownMenu open onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {editable && (
          <>
            <DropdownMenuItem onClick={() => props.addChild(node, 'page')}>
              <FilePlus2 className="h-3.5 w-3.5 mr-2" /> {t('newPageInside')}
            </DropdownMenuItem>
            {isFolder && (
              <DropdownMenuItem onClick={() => props.addChild(node, 'folder')}>
                <FolderPlus className="h-3.5 w-3.5 mr-2" /> {t('newFolderInside')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => props.beginRename(node)}>
              <Edit3 className="h-3.5 w-3.5 mr-2" /> {t('rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => props.onShare(node)}>
              <Share2 className="h-3.5 w-3.5 mr-2" /> {t('share')}
            </DropdownMenuItem>
            {isFolder && props.toggleMemory && (
              <DropdownMenuItem onClick={() => props.toggleMemory!(node)}>
                <Brain className="h-3.5 w-3.5 mr-2" /> {isMemory ? t('memory.stopMemory') : t('memory.useAsMemory')}
              </DropdownMenuItem>
            )}
          </>
        )}
        <DropdownMenuItem onClick={() => props.copyLink(node)}>
          <Link2 className="h-3.5 w-3.5 mr-2" /> {t('copyLink')}
        </DropdownMenuItem>
        {props.canDelete(node) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => props.onDelete(node)} className="text-destructive focus:text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-2" /> {t('common:delete')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The sharing tooltip on a row's globe: whose it is (shared-with-me
 *  roots), who it is shared with and how, and when it was updated / made. */
function ShareDetails({ owner, tags, node }: { owner: string; tags: NonNullable<Node['sharedWith']>; node: Node }) {
  const { t, i18n } = useTranslation('notes');
  const label = (g: NonNullable<Node['sharedWith']>[number]) => (g.kind === 'everyone' ? t('sharing.everyone') : g.name ?? '');
  return (
    <div className="space-y-1.5 text-xs">
      {owner && <div className="font-medium">{t('sharing.by', { name: owner })}</div>}
      {tags.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">{t('sharing.withTitle')}</div>
          <ul className="space-y-0.5">
            {tags.map((g, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className="truncate">{label(g)}</span>
                <span className="shrink-0 text-muted-foreground">{t(g.role === 'editor' ? 'sharing.editor' : 'sharing.viewer')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-[10px] text-muted-foreground border-t pt-1.5 space-y-0.5">
        {node.updatedAt && <div>{t('times.updated', { when: formatExact(node.updatedAt, i18n.language) })}</div>}
        {node.createdAt && <div>{t('times.created', { when: formatExact(node.createdAt, i18n.language) })}</div>}
      </div>
    </div>
  );
}
