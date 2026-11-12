import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Shapes, Folder as FolderIcon, FolderOpen, MoreHorizontal, Share2, Eye } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Whiteboard } from '@/types';
import { buildTree, type WhiteboardNode } from './WhiteboardTree';
import { WhiteboardShareDialog } from './WhiteboardShareDialog';

// SharedBoardTree renders "Shared with me" as the owner's folder tree:
// ListShared returns each share root with parentId=null plus its subtree with
// real parents, so it builds the same way as the own-boards tree. Structure is
// read-only (no drag/drop, rename or delete — the recipient doesn't own these).
//
// Editors get a Share action, but only on nodes the owner made public (the
// share roots): AddGrant requires a public node and only the owner can flip
// visibility, so a private child — which already inherits access from its
// folder — isn't separately shareable.
export function SharedBoardTree({
  boards,
  onOpen,
}: {
  boards: Whiteboard[];
  onOpen: (board: Whiteboard) => void;
}) {
  const tree = useMemo(() => buildTree(boards).tree, [boards]);
  // Share roots start expanded (this list used to be flat, so a collapsed root
  // folder would make its boards look gone); deeper folders start collapsed.
  // Track flips from that default, since the list arrives after mount.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const isOpen = useCallback((id: string, depth: number) => (depth === 0) !== flipped.has(id), [flipped]);
  const toggle = useCallback(
    (id: string) => setFlipped((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    }),
    [],
  );
  const [shareBoard, setShareBoard] = useState<Whiteboard | null>(null);

  return (
    <>
      <div className="space-y-0.5">
        {tree.map((n) => (
          <SharedNode key={n.id} node={n} depth={0} isOpen={isOpen} toggle={toggle} onOpen={onOpen} onShare={setShareBoard} />
        ))}
      </div>
      {shareBoard && (
        <WhiteboardShareDialog
          board={shareBoard}
          open={!!shareBoard}
          onOpenChange={(o) => { if (!o) setShareBoard(null); }}
        />
      )}
    </>
  );
}

interface SharedNodeProps {
  node: WhiteboardNode;
  depth: number;
  isOpen: (id: string, depth: number) => boolean;
  toggle: (id: string) => void;
  onOpen: (board: Whiteboard) => void;
  onShare: (board: Whiteboard) => void;
}

function SharedNode({ node, depth, isOpen, toggle, onOpen, onShare }: SharedNodeProps) {
  const { t } = useTranslation('excalidraw');
  const isFolder = node.type === 'folder';
  const open = isFolder && isOpen(node.id, depth);
  const canShare = node.role === 'editor' && node.visibility === 'public';

  return (
    <div>
      <div className="group flex items-center rounded hover:bg-accent/40 transition-colors" style={{ paddingLeft: depth * 12 }}>
        <button
          type="button"
          onClick={() => (isFolder ? toggle(node.id) : onOpen(node))}
          className="flex-1 min-w-0 flex items-center gap-1 px-1.5 py-1 text-left"
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
          {node.role === 'viewer' && <Eye className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={t('openReadOnly')} />}
        </button>
        {canShare && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => onShare(node)}>
                <Share2 className="h-3.5 w-3.5 mr-2" /> {t('share')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {open && node.children.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {node.children.map((c) => (
            <SharedNode key={c.id} node={c} depth={depth + 1} isOpen={isOpen} toggle={toggle} onOpen={onOpen} onShare={onShare} />
          ))}
        </div>
      )}
    </div>
  );
}
