import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Folder,
  Globe2,
  Plus,
  MoreHorizontal,
  Trash2,
  Edit3,
  FilePlus,
  FolderPlus,
  Download,
  FolderInput,
  Copy,
  Users,
  UserPlus,
  RefreshCw,
  GripVertical,
  Building2,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
  rectIntersection,
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
import { useCollectionStore } from '@/stores/collectionStore';
import { useCollectionTreeUIStore } from '@/stores/collectionTreeUIStore';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore, WORKSPACE_ALL } from '@/stores/workspaceStore';
import { collectionShareAPI, collectionSyncAPI, collectionCollabAPI } from '@/services/api';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { CollectionDialog } from './CollectionDialog';
import { ImportCollectionDialog } from './ImportCollectionDialog';
import { ShareCollectionDialog } from './ShareCollectionDialog';
import { SyncCollectionDialog } from './SyncCollectionDialog';
import { PushToGitLabDialog } from './PushToGitLabDialog';
import { GitBranch, Archive } from 'lucide-react';
import { useSavedResponsesUI } from '@/stores/savedResponsesUIStore';
import { collectionWithDescendants } from './savedResponsesUtil';
import { JoinCollectionDialog } from './JoinCollectionDialog';
import { RequestItem } from './RequestItem';
import type { Collection } from '@/types';

// Prefixes keep collection and request ids distinct inside the shared dnd-kit
// id space, and the "real" id is reconstructed when reorder handlers fire.
const COL_PREFIX = 'col:';
const REQ_PREFIX = 'req:';

function CollectionNode({ collection, depth = 0, rootBaseUrl }: { collection: Collection; depth?: number; rootBaseUrl?: string }) {
  const { t } = useTranslation('collections');
  const showSavedResponses = useSavedResponsesUI((s) => s.show);
  // Expansion lives in a Zustand store so external actions (drag-and-drop
  // landing inside this folder, search-jump, etc.) can open the target
  // without re-mounting the node.
  const expanded = useCollectionTreeUIStore((s) => !!s.expanded[collection.id]);
  const setExpandedState = useCollectionTreeUIStore((s) => s.setExpanded);
  const setExpanded = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === 'function' ? (v as (p: boolean) => boolean)(expanded) : v;
    setExpandedState(collection.id, next);
  };
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [newReqName, setNewReqName] = useState('');
  const [showNewReq, setShowNewReq] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const { deleteCollection, createRequest, createCollection, updateCollection, fetchCollections } = useCollectionStore();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const isLocal = useAuthStore((s) => s.mode === 'local');
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const isShared = collection.shared;
  const isRootCollection = !collection.parentId;
  // Nearest-ancestor wins: a sub-folder with its own baseUrl overrides
  // the parent's value for requests inside it, otherwise we fall back
  // to whatever the closest ancestor set. Previously `rootBaseUrl ||
  // collection.baseUrl` was root-wins, which silently discarded any
  // per-folder override the user typed in the Edit dialog.
  const effectiveBaseUrl = collection.baseUrl || rootBaseUrl || '';

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `${COL_PREFIX}${collection.id}`,
    data: { type: 'collection', parentId: collection.parentId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const childIds = (collection.children || []).map((c) => `${COL_PREFIX}${c.id}`);
  const requestIds = (collection.requests || []).map((r) => `${REQ_PREFIX}${r.id}`);

  const handleRefresh = async () => {
    setRefreshing(true);
    // Single in-place toast handle — flips from "refreshing" to the
    // resolved title so the user always sees the latest state of THIS
    // refresh, not a stack of intermediate notices when they click
    // multiple times.
    const tt = toast({
      title: collection.sourceUrl ? t('tree.refreshingNamed', { name: collection.name }) : t('tree.reloading'),
      description: collection.sourceUrl ? t('tree.refreshingDesc') : undefined,
    });
    try {
      if (collection.sourceUrl) {
        const res = await collectionSyncAPI.refresh(collection.id);
        const count = (res.data as { count?: number })?.count ?? 0;
        tt.update({ id: tt.id, title: t('tree.refreshed'), description: t(count === 1 ? 'requestsSyncedOne' : 'requestsSyncedOther', { count }) });
      } else {
        tt.update({ id: tt.id, title: t('tree.reloaded') });
      }
      await fetchCollections();
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } }; message?: string };
      tt.update({
        id: tt.id,
        title: t('tree.refreshFailed'),
        description: ax.response?.data?.error || ax.message || t('tree.couldNotRefresh'),
        variant: 'destructive',
      });
    }
    setRefreshing(false);
  };

  const handleLeaveShare = async () => {
    try {
      await collectionCollabAPI.leave(collection.id);
      await fetchCollections();
      toast({ title: t('tree.leftShared'), description: t('tree.noLongerAccess', { name: collection.name }) });
    } catch {
      toast({ title: t('tree.couldNotLeave'), description: t('tryAgain'), variant: 'destructive' });
    }
  };

  const hasChildren = (collection.children && collection.children.length > 0) ||
    (collection.requests && collection.requests.length > 0);

  // Recursive request count: direct requests + every descendant. Shown
  // next to the collection name as "(N)" so the user can see the size
  // of an imported spec without expanding every folder. Folders bubble
  // up their leaves so a tag-folder shows just its own ops, while the
  // root collection shows the full spec total.
  const requestCount = countRequests(collection);

  const handleAddRequest = () => {
    if (!newReqName.trim()) return;
    createRequest(collection.id, {
      name: newReqName.trim(),
      method: 'GET',
      url: '',
      headers: [],
      params: [],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      preRequestScript: '',
      testScript: '',
      sortOrder: 0,
    });
    setNewReqName('');
    setShowNewReq(false);
  };

  const handleAddFolder = async () => {
    if (!newFolderName.trim()) return;
    const name = newFolderName.trim();
    const tt = toast({ title: t('tree.creatingFolder', { name }) });
    try {
      await createCollection({
        name,
        parentId: collection.id,
        type: 'folder',
      });
      await fetchCollections();
      tt.update({ id: tt.id, title: t('tree.folderCreated'), description: name });
    } catch (err) {
      const ax = err as { response?: { data?: { error?: string } }; message?: string };
      tt.update({
        id: tt.id,
        title: t('tree.couldNotCreateFolder'),
        description: ax.response?.data?.error || ax.message || t('tryAgain'),
        variant: 'destructive',
      });
    }
    setNewFolderName('');
    setShowNewFolder(false);
  };

  const handleExport = async () => {
    try {
      const response = await collectionShareAPI.export(collection.id);
      const jsonStr = JSON.stringify(response.data, null, 2);
      await navigator.clipboard.writeText(jsonStr);
      // Could use a toast here, but for now just copy to clipboard
    } catch {
      // Silently fail or could add error handling
    }
  };

  const handleDownload = async () => {
    try {
      const response = await collectionShareAPI.export(collection.id);
      const jsonStr = JSON.stringify(response.data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${collection.name.replace(/\s+/g, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Silently fail
    }
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={cn(
          "flex items-center gap-1 px-2 py-1 hover:bg-accent rounded-md transition-colors duration-200 group cursor-pointer",
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        {...attributes}
      >
        <button
          type="button"
          className="shrink-0 p-0.5 -ml-1 text-muted-foreground opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-grab active:cursor-grabbing touch-none"
          aria-label={t('tree.dragToReorder')}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer"
        >
          {(() => {
            // Pick the icon + tooltip based on the collection's sharing
            // signals. Priority: workspace-cascade > public visibility >
            // individual share > default folder. Workspace-cascade wins
            // visually because it's a distinct access surface (you see
            // this row because you're in the shared workspace, not
            // because of a per-collection share) and we want the user
            // to be able to tell at a glance that the workspace —
            // not the collection itself — is what was shared.
            const isPublic = collection.visibility === 'public';
            const viaWorkspace = !!collection.cascadedViaWorkspace;
            const lines: string[] = [];
            if (viaWorkspace) {
              lines.push(t('tree.sharedViaWorkspace', { owner: collection.ownerName || t('tree.someone') }));
            } else if (isShared) {
              lines.push(t('tree.sharedWithYouBy', { owner: collection.ownerName || t('tree.someone') }));
            }
            if (collection.sharedByMe && collection.collaboratorCount) {
              lines.push(
                t(collection.collaboratorCount === 1 ? 'tree.sharedWithCountOne' : 'tree.sharedWithCountOther', { count: collection.collaboratorCount }),
              );
            } else if (collection.sharedByMe) {
              lines.push(t('tree.sharedIndividually'));
            }
            if (isPublic) lines.push(t('tree.publicGrantInfo'));
            const hasSharing = viaWorkspace || isShared || collection.sharedByMe || isPublic;

            let IconCmp: typeof Users = expanded ? FolderOpen : Folder;
            let iconColor = 'text-muted-foreground';
            if (viaWorkspace) {
              // Building2 = "workspace" — matches the icon already used
              // by the workspace selector + manager so the visual link
              // between "this collection sits in the shared workspace"
              // and "the workspace selector dropdown" is obvious.
              IconCmp = Building2;
              iconColor = 'text-sky-500';
            } else if (isPublic) {
              IconCmp = Globe2;
              iconColor = 'text-amber-500';
            } else if (isShared) {
              IconCmp = Users;
              iconColor = 'text-primary';
            } else if (collection.sharedByMe) {
              IconCmp = Users;
              iconColor = 'text-green-500';
            }

            const icon = <IconCmp className={cn('h-3.5 w-3.5 shrink-0', iconColor)} />;
            if (!hasSharing) return icon;
            return (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="shrink-0">{icon}</span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    // Same neutral popover styling as the public-info
                    // tooltip — rich bullet content needs a neutral
                    // background so the text is legible in dark mode.
                    className="max-w-[260px] p-2.5 bg-popover text-popover-foreground border shadow-md"
                  >
                    <ul className="text-xs leading-5 list-disc pl-3 text-foreground">
                      {lines.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })()}
          <span className="text-sm truncate">{collection.name}</span>
          {requestCount > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              ({requestCount})
            </span>
          )}
        </button>

        {isRootCollection && (
          <button
            onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
            className={cn(
              'opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity cursor-pointer',
              refreshing && 'opacity-100'
            )}
            title={collection.sourceUrl ? t('tree.refreshFromSource') : t('common:refresh')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity cursor-pointer">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => { setShowNewReq(true); setExpanded(true); }}>
              <FilePlus className="h-3.5 w-3.5 mr-2" />
              {t('tree.addRequest')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setShowNewFolder(true); setExpanded(true); }}>
              <FolderPlus className="h-3.5 w-3.5 mr-2" />
              {t('tree.addFolder')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Edit3 className="h-3.5 w-3.5 mr-2" />
              {t('common:edit')}
            </DropdownMenuItem>
            {isRootCollection && !isShared && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Building2 className="h-3.5 w-3.5 mr-2" />
                  {t('tree.moveToWorkspace')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  {workspaces.map((ws) => (
                    <DropdownMenuItem
                      key={ws.id}
                      disabled={ws.id === collection.workspaceId}
                      onClick={async () => {
                        const tt = toast({ title: t('tree.movingTo', { name: ws.name }) });
                        try {
                          await updateCollection(collection.id, { workspaceId: ws.id });
                          tt.update({ id: tt.id, title: t('tree.moved'), description: t('tree.movedDesc', { name: collection.name, target: ws.name }) });
                        } catch (err) {
                          const ax = err as { response?: { data?: { error?: string } }; message?: string };
                          tt.update({
                            id: tt.id,
                            title: t('tree.moveFailed'),
                            description: ax.response?.data?.error || ax.message || t('tryAgain'),
                            variant: 'destructive',
                          });
                        }
                      }}
                    >
                      {ws.name}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!collection.workspaceId}
                    onClick={async () => {
                      // Empty string clears the workspace binding on the BE
                      // and drops the collection into the "No Workspace" bucket.
                      const tt = toast({ title: t('tree.movingToNoWorkspace') });
                      try {
                        await updateCollection(collection.id, { workspaceId: '' });
                        tt.update({ id: tt.id, title: t('tree.moved'), description: t('tree.movedDesc', { name: collection.name, target: t('tree.noWorkspace') }) });
                      } catch (err) {
                        const ax = err as { response?: { data?: { error?: string } }; message?: string };
                        tt.update({
                          id: tt.id,
                          title: t('tree.moveFailed'),
                          description: ax.response?.data?.error || ax.message || t('tryAgain'),
                          variant: 'destructive',
                        });
                      }
                    }}
                  >
                    <span className="text-muted-foreground">{t('tree.noWorkspace')}</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuItem onClick={() => showSavedResponses(collection.name, collectionWithDescendants(collection))}>
              <Archive className="h-3.5 w-3.5 mr-2" />
              {t('tree.savedResponses')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleExport}>
              <Copy className="h-3.5 w-3.5 mr-2" />
              {t('tree.copyAsJson')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDownload}>
              <Download className="h-3.5 w-3.5 mr-2" />
              {t('tree.downloadJson')}
            </DropdownMenuItem>
            {isRootCollection && !isLocal && (
              <DropdownMenuItem onClick={() => setSyncOpen(true)}>
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                {collection.sourceUrl ? t('tree.refreshUpdate') : t('tree.updateFromSource')}
              </DropdownMenuItem>
            )}
            {isRootCollection && !isLocal && !isShared && (
              <DropdownMenuItem onClick={() => setPushOpen(true)}>
                <GitBranch className="h-3.5 w-3.5 mr-2" />
                {t('push.title')}
              </DropdownMenuItem>
            )}
            {isRootCollection && !isShared && !isLocal && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShareOpen(true)}>
                  <Users className="h-3.5 w-3.5 mr-2" />
                  {t('tree.shareCollaborate')}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            {isShared ? (
              collection.cascadedViaWorkspace ? (
                // Workspace-cascade access has no per-user share row
                // to drop — leaving would mean leaving the team or
                // unbinding the workspace, both of which are
                // owner-side actions. Render disabled with an
                // explanatory tooltip; bg-popover keeps the tooltip
                // legible in dark mode.
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuItem
                        disabled
                        onSelect={(e) => e.preventDefault()}
                        className="text-muted-foreground opacity-60 cursor-not-allowed"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        {t('tree.leaveShared')}
                      </DropdownMenuItem>
                    </TooltipTrigger>
                    <TooltipContent
                      side="left"
                      className="max-w-[260px] p-2.5 text-xs leading-relaxed bg-popover text-popover-foreground border shadow-md"
                    >
                      {t('tree.cascadeLeaveInfo')}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <DropdownMenuItem
                  onClick={() => setLeaveOpen(true)}
                  className="text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  {t('tree.leaveShared')}
                </DropdownMenuItem>
              )
            ) : (
              <DropdownMenuItem
                onClick={() => setDeleteOpen(true)}
                className="text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                {t('common:delete')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded && (
        <div>
          {childIds.length > 0 && (
            <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
              {collection.children!.map((child) => (
                <CollectionNode key={child.id} collection={child} depth={depth + 1} rootBaseUrl={effectiveBaseUrl} />
              ))}
            </SortableContext>
          )}
          {requestIds.length > 0 && (
            <SortableContext items={requestIds} strategy={verticalListSortingStrategy}>
              {collection.requests!.map((req) => (
                <div key={req.id} style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
                  <RequestItem request={req} collectionName={collection.name} baseUrl={effectiveBaseUrl} />
                </div>
              ))}
            </SortableContext>
          )}
          {showNewReq && (
            <div
              className="flex items-center gap-1 px-2 py-1"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <input
                autoFocus
                className="flex-1 h-7 px-2 text-xs rounded border bg-transparent outline-none focus:ring-1 focus:ring-ring"
                placeholder={t('tree.requestNamePlaceholder')}
                value={newReqName}
                onChange={(e) => setNewReqName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddRequest();
                  if (e.key === 'Escape') setShowNewReq(false);
                }}
                onBlur={() => {
                  if (!newReqName.trim()) setShowNewReq(false);
                }}
              />
            </div>
          )}
          {showNewFolder && (
            <div
              className="flex items-center gap-1 px-2 py-1"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                autoFocus
                className="flex-1 h-7 px-2 text-xs rounded border bg-transparent outline-none focus:ring-1 focus:ring-ring"
                placeholder={t('tree.folderNamePlaceholder')}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddFolder();
                  if (e.key === 'Escape') setShowNewFolder(false);
                }}
                onBlur={() => {
                  if (!newFolderName.trim()) setShowNewFolder(false);
                }}
              />
            </div>
          )}
          {!hasChildren && !showNewReq && !showNewFolder && (
            <p
              className="text-xs text-muted-foreground py-1 px-2"
              style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
            >
              {t('tree.emptyCollection')}
            </p>
          )}
        </div>
      )}

      <CollectionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editCollection={collection}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('tree.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('tree.deleteDescription', { name: collection.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteCollection(collection.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common:delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('tree.leaveShared')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('tree.leaveDescription', { name: collection.name, ownerSuffix: collection.ownerName ? ` (${collection.ownerName})` : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeaveShare}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('tree.leave')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {!isLocal && (
        <ShareCollectionDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          collection={collection}
        />
      )}

      <SyncCollectionDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        collection={collection}
      />

      <PushToGitLabDialog
        open={pushOpen}
        onOpenChange={setPushOpen}
        collection={collection}
      />
    </div>
  );
}

// Total leaf-request count under a collection — direct + every
// descendant. Cheap walk in JS since the tree is already loaded.
function countRequests(col: Collection): number {
  let n = col.requests?.length ?? 0;
  if (col.children) {
    for (const child of col.children) n += countRequests(child);
  }
  return n;
}

function findCollectionById(cols: Collection[], id: string): Collection | undefined {
  for (const col of cols) {
    if (col.id === id) return col;
    if (col.children) {
      const found = findCollectionById(col.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

function findRequestParent(cols: Collection[], requestId: string): Collection | undefined {
  for (const col of cols) {
    if (col.requests?.some((r) => r.id === requestId)) return col;
    if (col.children) {
      const found = findRequestParent(col.children, requestId);
      if (found) return found;
    }
  }
  return undefined;
}

export function CollectionTree() {
  const {
    collections,
    fetchCollections,
    reorderCollections,
    reorderRequests,
    moveRequest,
    moveCollection,
    isLoading,
    elsewhereCount,
  } = useCollectionStore();
  const { t } = useTranslation('collections');
  const isLocal = useAuthStore((s) => s.mode === 'local');
  const activeWorkspaceName = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.name,
  );
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  // Subscribe to the active workspace id so the tree re-fetches whenever it
  // changes. Relying on an imperative fetch inside the selector's onChange
  // is fragile — it misses workspace switches that don't go through the
  // dropdown (persisted state hydration, programmatic switches after
  // create/delete, etc.).
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  // Imperative setter only — read via getState() inside the drag handler
  // so toggling expanded state on individual nodes doesn't re-render the
  // whole tree root.
  const expandNode = (id: string) => useCollectionTreeUIStore.getState().setExpanded(id, true);
  const { toast: treeToast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importCollectionOpen, setImportCollectionOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [activeDragLabel, setActiveDragLabel] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections, activeWorkspaceId]);

  // The 4 top-level collection actions (refresh / join / import / create)
  // now live in the Sidebar header. They reach into this component via
  // `patchman:collections-action` window events so the existing dialog
  // state + refresh toast logic stay co-located with the tree.
  useEffect(() => {
    const handler = async (e: Event) => {
      const action = (e as CustomEvent<string>).detail;
      switch (action) {
        case 'create':
          setDialogOpen(true);
          break;
        case 'import':
          setImportCollectionOpen(true);
          break;
        case 'join':
          if (!isLocal) setJoinOpen(true);
          break;
        case 'refresh': {
          const tt = treeToast({ title: t('tree.refreshingCollections') });
          try {
            // Refresh both Private and Public lists so the sidebar
            // reflects fresh server state for either accordion section.
            await useCollectionStore.getState().refreshLists();
            const s = useCollectionStore.getState();
            tt.update({
              id: tt.id,
              title: t('tree.collectionsRefreshed'),
              description: t('tree.refreshedCounts', { private: s.collections.length, public: s.publicCollections.length }),
            });
          } catch {
            tt.update({ id: tt.id, title: t('tree.refreshFailed'), variant: 'destructive' });
          }
          break;
        }
      }
    };
    window.addEventListener('patchman:collections-action', handler);
    return () => window.removeEventListener('patchman:collections-action', handler);
  }, [fetchCollections, isLocal, treeToast]);

  // Collision strategy: try pointer-within first (forgiving — catches the
  // moment the cursor enters a folder/collection row even if its centre is
  // not the closest hit), and fall back to closest-centre when the cursor
  // is in the gap between rows. closestCenter alone makes cross-parent
  // drops feel finicky because it always picks the geometrically nearest
  // sortable, which is usually the row the cursor *just left*.
  const collisionStrategy: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    const intersections = rectIntersection(args);
    if (intersections.length > 0) return intersections;
    return closestCenter(args);
  };

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith(COL_PREFIX)) {
      const col = findCollectionById(collections, id.slice(COL_PREFIX.length));
      setActiveDragLabel(col?.name ?? null);
    } else if (id.startsWith(REQ_PREFIX)) {
      const parent = findRequestParent(collections, id.slice(REQ_PREFIX.length));
      const req = parent?.requests?.find((r) => r.id === id.slice(REQ_PREFIX.length));
      setActiveDragLabel(req ? `${req.method}  ${req.name}` : null);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragLabel(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const activeData = active.data.current as { type?: string; parentId?: string | null } | undefined;
    const overData = over.data.current as { type?: string; parentId?: string | null } | undefined;
    if (!activeData || !overData) return;

    const activeIdx = (active.data.current?.sortable as { index?: number } | undefined)?.index ?? -1;
    const overIdx = (over.data.current?.sortable as { index?: number } | undefined)?.index ?? -1;
    const position: 'above' | 'below' = activeIdx > overIdx ? 'above' : 'below';

    // ── Cross-type drops ────────────────────────────────────────────
    // Dropping a request onto a collection/folder ROW means "drop INSIDE
    // this collection". The container's children area itself isn't a
    // separate droppable, so we treat the row as the parent target.
    if (activeData.type === 'request' && overData.type === 'collection') {
      const draggedReal = activeId.slice(REQ_PREFIX.length);
      const targetParentId = overId.slice(COL_PREFIX.length);
      if (activeData.parentId === targetParentId) return;
      // Open the target folder so the user actually sees the dropped
      // request land. Without this a drop into a collapsed folder looks
      // like the row vanished.
      expandNode(targetParentId);
      moveRequest(draggedReal, targetParentId);
      return;
    }
    // Dropping a folder onto another collection ROW (different parent) —
    // nest the folder inside that collection.
    if (activeData.type === 'collection' && overData.type === 'collection') {
      const draggedReal = activeId.slice(COL_PREFIX.length);
      const overReal = overId.slice(COL_PREFIX.length);
      if (activeData.parentId === overData.parentId) {
        // Same parent — straight reorder, keeps the existing optimistic UI.
        reorderCollections(draggedReal, overReal, position);
        return;
      }
      // Different parent. Nest under `over` rather than reordering at
      // its level — that's the more useful gesture (drop folder INTO
      // collection). If the user wants peer ordering across parents we
      // can revisit, but treating "drop on row" as nesting matches the
      // "drop on row" semantics for requests above and avoids surprising
      // sibling moves into other folder hierarchies.
      expandNode(overReal);
      moveCollection(draggedReal, overReal);
      return;
    }

    // ── Same-type drops ─────────────────────────────────────────────
    if (activeData.type !== overData.type) return;

    if (activeData.type === 'collection') {
      const draggedReal = activeId.slice(COL_PREFIX.length);
      const targetReal = overId.slice(COL_PREFIX.length);
      if (activeData.parentId === overData.parentId) {
        reorderCollections(draggedReal, targetReal, position);
      } else {
        // Reorder *across* parents — insert before/after the target as a
        // sibling under the target's parent.
        const beforeOrAfter = position === 'above'
          ? { beforeCollectionId: targetReal }
          : { afterCollectionId: targetReal };
        const newParent = (overData.parentId ?? null) as string | null;
        if (newParent) expandNode(newParent);
        moveCollection(draggedReal, newParent, beforeOrAfter);
      }
      return;
    }

    if (activeData.type === 'request') {
      const draggedReal = activeId.slice(REQ_PREFIX.length);
      const targetReal = overId.slice(REQ_PREFIX.length);
      if (activeData.parentId === overData.parentId) {
        reorderRequests(draggedReal, targetReal, activeData.parentId as string, position);
      } else {
        const beforeOrAfter = position === 'above'
          ? { beforeRequestId: targetReal }
          : { afterRequestId: targetReal };
        const newParent = overData.parentId as string;
        expandNode(newParent);
        moveRequest(draggedReal, newParent, beforeOrAfter);
      }
      return;
    }
  }

  const topLevelIds = collections.map((c) => `${COL_PREFIX}${c.id}`);

  return (
    <div className="p-2">
      {/* The "Collections" header + 4 action buttons used to live here.
          They moved up to the Sidebar's tab header (next to the
          "Collections" h2) so a single header serves both the Public
          and Private accordion sections. CollectionTree now exposes the
          same actions via a window-level custom event so the header
          buttons can trigger the existing dialog state in place. */}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : collections.length === 0 ? (
        <div className="text-center py-8 px-4">
          <FolderOpen className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          {activeWorkspaceId && elsewhereCount > 0 ? (
            <>
              {/* The "0 here · N elsewhere" path. Shows up when the user has
                  data in the personal/no-workspace view but a workspace is
                  selected — pre-1.9.0 this case looked identical to a fresh
                  account, which sent users digging through Settings → Data
                  thinking the remote was empty. */}
              <p className="text-sm text-muted-foreground">
                <Trans
                  t={t}
                  i18nKey="tree.noCollectionsIn"
                  values={{ workspace: activeWorkspaceName || t('tree.thisWorkspace') }}
                  components={{ name: <span className="font-medium" /> }}
                />
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t(elsewhereCount === 1 ? 'tree.collectionsElsewhereOne' : 'tree.collectionsElsewhereOther', { count: elsewhereCount })}
              </p>
              <div className="flex flex-col gap-2 mt-3">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setActiveWorkspace(WORKSPACE_ALL)}
                >
                  {t('tree.showAllWorkspaces')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t('tree.newCollectionHere')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t('tree.noCollectionsYet')}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t('tree.createHint')}
              </p>
              <div className="flex flex-col gap-2 mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDialogOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t('tree.newCollection')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setImportCollectionOpen(true)}
                >
                  <FolderInput className="h-3.5 w-3.5 mr-1" />
                  {t('tree.importCollection')}
                </Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionStrategy}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragLabel(null)}
        >
          <SortableContext items={topLevelIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-0.5">
              {collections.map((collection) => (
                <CollectionNode key={collection.id} collection={collection} />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeDragLabel ? (
              <div className="px-2 py-1 rounded-md bg-accent border shadow-lg text-sm whitespace-nowrap max-w-[280px] truncate">
                {activeDragLabel}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <CollectionDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <ImportCollectionDialog open={importCollectionOpen} onOpenChange={setImportCollectionOpen} />
      {!isLocal && <JoinCollectionDialog open={joinOpen} onOpenChange={setJoinOpen} />}
    </div>
  );
}
