import { useCallback, useMemo, useState } from 'react';
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
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronRight,
  Shapes,
  Folder as FolderIcon,
  FolderOpen,
  MoreHorizontal,
  Edit3,
  Trash2,
  Share2,
  Globe2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { useWhiteboardStore } from '@/stores/whiteboardStore';
import { WhiteboardShareDialog } from './WhiteboardShareDialog';
import { cn } from '@/lib/utils';
import type { Whiteboard } from '@/types';

const PREFIX = 'wb:';
const ROOT_DROP = 'wb-root';

export type WhiteboardNode = Whiteboard & { children: WhiteboardNode[] };
type Node = WhiteboardNode;

// Build the folder tree from the flat, sort_order-ordered board list. Also used
// by SharedBoardTree ("Shared with me" arrives in the same flat parentId shape).
export function buildTree(boards: Whiteboard[]): { tree: Node[]; childrenOf: (parentId: string | null) => Whiteboard[] } {
  const byParent = new Map<string | null, Whiteboard[]>();
  for (const b of boards) {
    const key = b.parentId ?? null;
    const arr = byParent.get(key);
    if (arr) arr.push(b);
    else byParent.set(key, [b]);
  }
  for (const arr of byParent.values()) arr.sort((a, z) => (a.sortOrder ?? 0) - (z.sortOrder ?? 0) || a.name.localeCompare(z.name));
  const make = (parentId: string | null): Node[] =>
    (byParent.get(parentId) ?? []).map((b) => ({ ...b, children: b.type === 'folder' ? make(b.id) : [] }));
  return { tree: make(null), childrenOf: (parentId) => byParent.get(parentId) ?? [] };
}

// WhiteboardTree renders boards + folders as a draggable, nestable tree (mirrors
// CollectionTree). Drag a node onto a folder row to nest it; drag onto a sibling
// to reorder; drag to the root strip to un-nest. Persistence goes through
// whiteboardStore.moveNode (reparent + sort_order).
export function WhiteboardTree({
  boards,
  onOpen,
}: {
  boards: Whiteboard[];
  onOpen: (board: Whiteboard) => void;
}) {
  const { t } = useTranslation(['excalidraw', 'common']);
  const moveNode = useWhiteboardStore((s) => s.moveNode);
  const renameBoard = useWhiteboardStore((s) => s.renameBoard);
  const removeBoard = useWhiteboardStore((s) => s.removeBoard);
  const setVisibilityLocal = useWhiteboardStore((s) => s.setVisibilityLocal);

  const { tree, childrenOf } = useMemo(() => buildTree(boards), [boards]);

  // child id → parent id, for the "don't nest a folder into its own subtree"
  // cycle guard on drop.
  const parentOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const b of boards) m.set(b.id, b.parentId ?? null);
    return m;
  }, [boards]);
  const isWithin = useCallback(
    (nodeId: string, ancestorId: string) => {
      let cur: string | null | undefined = nodeId;
      for (let i = 0; i < 64 && cur; i++) {
        if (cur === ancestorId) return true;
        cur = parentOf.get(cur) ?? null;
      }
      return false;
    },
    [parentOf],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Whiteboard | null>(null);
  const [shareBoard, setShareBoard] = useState<Whiteboard | null>(null);

  const expand = useCallback((id: string) => setExpanded((s) => new Set(s).add(id)), []);
  const toggle = useCallback(
    (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    [],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const collisionStrategy: CollisionDetection = (args) => {
    const p = pointerWithin(args);
    if (p.length > 0) return p;
    const r = rectIntersection(args);
    if (r.length > 0) return r;
    return closestCenter(args);
  };

  const commitRename = useCallback(async () => {
    const id = editingId;
    const name = editingName.trim();
    setEditingId(null);
    setEditingName('');
    if (id && name) await renameBoard(id, name);
  }, [editingId, editingName, renameBoard]);

  // Compute the target parent's final child order after inserting `draggedId`
  // relative to `targetId` (above/below), then persist via moveNode.
  const reorderRelative = useCallback(
    (draggedId: string, parentId: string | null, targetId: string, position: 'above' | 'below') => {
      const sibs = childrenOf(parentId).map((b) => b.id).filter((sid) => sid !== draggedId);
      const at = sibs.indexOf(targetId);
      if (at === -1) return;
      sibs.splice(position === 'above' ? at : at + 1, 0, draggedId);
      void moveNode(draggedId, parentId, sibs);
    },
    [childrenOf, moveNode],
  );

  const nestInto = useCallback(
    (draggedId: string, folderId: string) => {
      const sibs = childrenOf(folderId).map((b) => b.id).filter((sid) => sid !== draggedId);
      sibs.push(draggedId);
      expand(folderId);
      void moveNode(draggedId, folderId, sibs);
    },
    [childrenOf, moveNode, expand],
  );

  function handleDragEnd(event: DragEndEvent) {
    setDragLabel(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id).slice(PREFIX.length);
    const overRaw = String(over.id);

    // Dropped on the root strip → un-nest to root, appended at the end.
    if (overRaw === ROOT_DROP) {
      const sibs = childrenOf(null).map((b) => b.id).filter((sid) => sid !== activeId);
      sibs.push(activeId);
      void moveNode(activeId, null, sibs);
      return;
    }

    const overId = overRaw.slice(PREFIX.length);
    const activeData = active.data.current as { type?: string; parentId?: string | null } | undefined;
    const overData = over.data.current as { type?: string; parentId?: string | null } | undefined;
    if (!activeData || !overData) return;
    if (activeId === overId) return;

    const activeIdx = (active.data.current?.sortable as { index?: number } | undefined)?.index ?? -1;
    const overIdx = (over.data.current?.sortable as { index?: number } | undefined)?.index ?? -1;
    const position: 'above' | 'below' = activeIdx > overIdx ? 'above' : 'below';

    const sameParent = (activeData.parentId ?? null) === (overData.parentId ?? null);

    // Drop onto a FOLDER row → nest inside it (the natural "drag into folder"
    // gesture). This wins even when they share a parent — otherwise a root item
    // dropped on a root folder would just reorder as a sibling ("kaçıyor").
    // Skip only when the target folder is inside the dragged node's own subtree
    // (a cycle the BE would reject), letting it fall through to a reorder.
    if (overData.type === 'folder' && !isWithin(overId, activeId)) {
      nestInto(activeId, overId);
      return;
    }
    // Otherwise reorder as a sibling of `over` (same or crossing parent).
    reorderRelative(activeId, (overData.parentId ?? null) as string | null, overId, position);
    if (!sameParent && overData.parentId) expand(overData.parentId as string);
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id).slice(PREFIX.length);
    setDragLabel(boards.find((b) => b.id === id)?.name ?? null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionStrategy}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragLabel(null)}
    >
      <RootStrip />
      <NodeList
        nodes={tree}
        depth={0}
        expanded={expanded}
        toggle={toggle}
        onOpen={onOpen}
        editingId={editingId}
        editingName={editingName}
        setEditingName={setEditingName}
        beginRename={(b) => { setEditingId(b.id); setEditingName(b.name); }}
        commitRename={commitRename}
        cancelRename={() => { setEditingId(null); setEditingName(''); }}
        onDelete={setConfirmDelete}
        onShare={setShareBoard}
      />
      <DragOverlay>
        {dragLabel ? (
          <div className="px-2 py-1 rounded bg-popover border shadow text-sm truncate max-w-[220px]">{dragLabel}</div>
        ) : null}
      </DragOverlay>

      {shareBoard && (
        <WhiteboardShareDialog
          board={shareBoard}
          open={!!shareBoard}
          onOpenChange={(o) => { if (!o) setShareBoard(null); }}
          onVisibilityChange={(v) => setVisibilityLocal(shareBoard.id, v)}
        />
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle', { name: confirmDelete?.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.type === 'folder' ? t('deleteFolderDescription') : t('deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (confirmDelete) void removeBoard(confirmDelete.id); setConfirmDelete(null); }}
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

// A thin always-present drop target above the tree so a nested node can be
// dragged back out to the root level.
function RootStrip() {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROP });
  return <div ref={setNodeRef} className={cn('h-1.5 rounded transition-colors', isOver && 'bg-violet-400/40')} />;
}

interface NodeListProps {
  nodes: Node[];
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onOpen: (board: Whiteboard) => void;
  editingId: string | null;
  editingName: string;
  setEditingName: (v: string) => void;
  beginRename: (b: Whiteboard) => void;
  commitRename: () => void;
  cancelRename: () => void;
  onDelete: (b: Whiteboard) => void;
  onShare: (b: Whiteboard) => void;
}

function NodeList(props: NodeListProps) {
  const ids = useMemo(() => props.nodes.map((n) => PREFIX + n.id), [props.nodes]);
  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      <div className="space-y-0.5">
        {props.nodes.map((n) => (
          <TreeNode key={n.id} node={n} {...props} />
        ))}
      </div>
    </SortableContext>
  );
}

function TreeNode({ node, ...props }: { node: Node } & NodeListProps) {
  const { t } = useTranslation(['excalidraw', 'common']);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: PREFIX + node.id,
    data: { type: node.type ?? 'whiteboard', parentId: node.parentId ?? null },
  });
  const isFolder = node.type === 'folder';
  const open = props.expanded.has(node.id);
  const style = { transform: CSS.Translate.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'opacity-50')}>
      <div
        className={cn(
          'group flex items-center rounded hover:bg-accent/40 transition-colors',
          isFolder && isOver && 'ring-1 ring-violet-400/60 bg-violet-400/10',
        )}
        style={{ paddingLeft: props.depth * 12 }}
      >
        {props.editingId === node.id ? (
          <Input
            autoFocus
            value={props.editingName}
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
              {...attributes}
              {...listeners}
              onClick={() => (isFolder ? props.toggle(node.id) : props.onOpen(node))}
              className="flex-1 min-w-0 flex items-center gap-1 px-1.5 py-1 text-left cursor-grab active:cursor-grabbing"
              title={node.name}
            >
              {isFolder ? (
                <>
                  <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
                  {open ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-400" /> : <FolderIcon className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                </>
              ) : (
                <>
                  <span className="w-3 shrink-0" />
                  <Shapes className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                </>
              )}
              <span className="text-sm truncate">{node.name || t('untitled')}</span>
              {node.visibility === 'public' && <Globe2 className="h-3 w-3 shrink-0 text-sky-500/80" aria-label={t('share')} />}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onClick={() => props.beginRename(node)}>
                  <Edit3 className="h-3.5 w-3.5 mr-2" /> {t('rename')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => props.onShare(node)}>
                  <Share2 className="h-3.5 w-3.5 mr-2" /> {t('share')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => props.onDelete(node)} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> {t('common:delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
      {isFolder && open && node.children.length > 0 && (
        <div className="mt-0.5">
          <NodeList {...props} nodes={node.children} depth={props.depth + 1} />
        </div>
      )}
    </div>
  );
}
