import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  Globe2,
  Lock,
  Folder,
  Loader2,
  MoreHorizontal,
  Edit3,
  Trash2,
  Users,
  Info,
  Crown,
  Eye,
  UserCircle2,
} from 'lucide-react';
import { useCollectionStore } from '@/stores/collectionStore';
import { useAuthStore } from '@/stores/authStore';
import { useRequestStore } from '@/stores/requestStore';
import { collectionCollabAPI, collectionSharingAPI } from '@/services/api';
import { toast } from '@/components/ui/use-toast';
import { CollectionTree } from './CollectionTree';
import { CollectionDialog } from './CollectionDialog';
import { ShareCollectionDialog } from './ShareCollectionDialog';
import { RequestItem } from './RequestItem';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Collection, PublicGrant, SavedRequest } from '@/types';

// Persistence keys for the accordion's open/close state. Both sections
// default to expanded — the user can collapse either independently and
// the choice survives reloads via localStorage.
const PUBLIC_OPEN_KEY = 'patchman_collections_public_open';
const PRIVATE_OPEN_KEY = 'patchman_collections_private_open';

function readPersistedFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1';
  } catch {
    return fallback;
  }
}

function writePersistedFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

// Top-level Collections panel. Renders two vertical sections — Public
// (read-only nav for collections the user reaches via team / everyone
// grants) and Private (the full CollectionTree the rest of the app
// already uses). Both default open; either can collapse independently.
//
// The Public section is intentionally simpler than the Private one:
// no drag/drop, no folder expansion, no inline create/rename. Public
// collections still get their full request list rendered inline when
// expanded; the user opens a request the same way as in Private.
// Public collections the user OWNS also appear under Private — single
// source of truth for ownership, two listings (per the RFC).
export function CollectionsAccordion() {
  const { t } = useTranslation('collections');
  const [publicOpen, setPublicOpen] = useState(() => readPersistedFlag(PUBLIC_OPEN_KEY, true));
  const [privateOpen, setPrivateOpen] = useState(() => readPersistedFlag(PRIVATE_OPEN_KEY, true));
  const togglePublic = useCallback(() => {
    setPublicOpen((v) => {
      writePersistedFlag(PUBLIC_OPEN_KEY, !v);
      return !v;
    });
  }, []);
  const togglePrivate = useCallback(() => {
    setPrivateOpen((v) => {
      writePersistedFlag(PRIVATE_OPEN_KEY, !v);
      return !v;
    });
  }, []);

  const publicCollections = useCollectionStore((s) => s.publicCollections);
  const isLoadingPublic = useCollectionStore((s) => s.isLoadingPublic);
  const fetchPublicCollections = useCollectionStore((s) => s.fetchPublicCollections);
  // Private section header shows the root-collection count for parity
  // with the Public header's `(N)` badge.
  const privateCount = useCollectionStore((s) => s.collections.length);
  const isLocal = useAuthStore((s) => s.mode === 'local');

  // Fetch on mount + when auth mode changes (logging in/out can flip the
  // backing repo from IndexedDB to HTTP, and the result set differs).
  useEffect(() => {
    if (!isLocal) {
      fetchPublicCollections();
    }
  }, [fetchPublicCollections, isLocal]);

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Public section */}
      <section className="flex flex-col min-h-0">
        <button
          type="button"
          onClick={togglePublic}
          className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/40 rounded transition-colors"
        >
          {publicOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Globe2 className="h-3 w-3 text-primary" />
          <span className="uppercase tracking-wider">{t('accordion.public')}</span>
          {publicCollections.length > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">{publicCollections.length}</Badge>
          )}
        </button>
        {publicOpen && (
          <div className="flex-1 min-h-0 overflow-y-auto pl-1 pr-0.5 pt-1">
            <PublicList
              collections={publicCollections}
              loading={isLoadingPublic}
            />
          </div>
        )}
      </section>

      {/* Divider */}
      <div className="h-px bg-border mx-2" />

      {/* Private section (existing CollectionTree) */}
      <section className="flex flex-col min-h-0 flex-1">
        <button
          type="button"
          onClick={togglePrivate}
          className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/40 rounded transition-colors"
        >
          {privateOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Lock className="h-3 w-3 text-muted-foreground" />
          <span className="uppercase tracking-wider">{t('accordion.private')}</span>
          {privateCount > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">{privateCount}</Badge>
          )}
        </button>
        {privateOpen && (
          <div className="flex-1 min-h-0">
            <CollectionTree />
          </div>
        )}
      </section>
    </div>
  );
}

interface PublicListProps {
  collections: Collection[];
  loading: boolean;
}

function PublicList({ collections, loading }: PublicListProps) {
  const { t } = useTranslation('collections');
  if (loading) {
    return (
      <div className="flex items-center justify-center py-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (collections.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground italic px-2 py-2">
        {t('accordion.nothingPublic')}
      </p>
    );
  }
  return (
    <div className="space-y-0.5">
      {collections.map((col) => (
        <PublicNode key={col.id} collection={col} />
      ))}
    </div>
  );
}

function PublicNode({
  collection,
  depth = 0,
  rootRole,
}: {
  collection: Collection;
  depth?: number;
  // Effective role propagated from the root. Sub-folders don't carry
  // their own `myRole` (BE stamps it only on the root list response),
  // so children inherit the role resolved at the top of the tree.
  rootRole?: 'owner' | 'editor' | 'viewer';
}) {
  const { t } = useTranslation('collections');
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const addTab = useRequestStore((s) => s.addTab);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const deleteCollection = useCollectionStore((s) => s.deleteCollection);
  const fetchCollections = useCollectionStore((s) => s.fetchCollections);
  const fetchPublicCollections = useCollectionStore((s) => s.fetchPublicCollections);

  const isRoot = depth === 0;
  const children = collection.children ?? [];
  const requests = collection.requests ?? [];
  // Effective role on this collection. Owner is always `myRole='owner'`
  // (BE stamps it via ResolveCollectionRole during the public-list
  // build). Children inherit `rootRole` since the BE only stamps the
  // role on the root row; falls back to local owner check when neither
  // is available (covers the legacy Private path where ownership is
  // implicit).
  const myRole: 'owner' | 'editor' | 'viewer' | undefined =
    collection.myRole ?? rootRole ?? (collection.userId === currentUserId ? 'owner' : undefined);
  const isOwner = myRole === 'owner';
  const canEdit = myRole === 'owner' || myRole === 'editor';
  const totalRequests = countAllRequests(collection);

  const handleMakePrivate = async () => {
    setBusy(true);
    try {
      await collectionSharingAPI.setVisibility(collection.id, 'private');
      // Refetch both so the row leaves Public and stays in Private.
      await Promise.all([fetchCollections(), fetchPublicCollections()]);
    } catch {
      /* surfaced by toast at higher layer ideally; silent here */
    }
    setBusy(false);
  };

  const handleDelete = async () => {
    setConfirmDelete(false);
    setBusy(true);
    try {
      await deleteCollection(collection.id);
      await fetchPublicCollections();
    } catch {
      /* ignore */
    }
    setBusy(false);
  };

  // Leave a shared collection. Only meaningful for legacy CollectionShare
  // collaborators — public-grant access has no per-user row to drop, so
  // a 404 from this endpoint means "you have access via team/everyone,
  // not via an individual share". We surface that as a friendly message
  // rather than a scary error.
  const handleLeave = async () => {
    setBusy(true);
    try {
      await collectionCollabAPI.leave(collection.id);
      toast({
        title: t('tree.leftShared'),
        description: t('tree.noLongerAccess', { name: collection.name }),
      });
      await Promise.all([fetchCollections(), fetchPublicCollections()]);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        toast({
          title: t('accordion.noIndividualShare'),
          description: t('accordion.accessViaGrant'),
          variant: 'destructive',
        });
      } else {
        toast({
          title: t('tree.couldNotLeave'),
          description: t('accordion.somethingWrong'),
          variant: 'destructive',
        });
      }
    }
    setBusy(false);
  };

  return (
    <>
      {/* Hover state lives on the row container, not the inner button,
          so the highlight stretches across the trailing info icon and
          3-dot menu instead of leaving them on the unhovered backdrop.
          Depth-based padding-left mirrors CollectionTree's CollectionNode
          so nested public folders indent consistently with the Private
          tree. */}
      <div
        className="group flex items-center pr-1 rounded hover:bg-accent/40 transition-colors"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          // Spacing + text size mirror the Private CollectionNode rows
          // (gap-1.5 / text-sm / h-3.5 icons) so the two accordion
          // sections share one visual rhythm.
          className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm truncate">{collection.name}</span>
          {totalRequests > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              ({totalRequests})
            </span>
          )}
        </button>
        {isRoot && <PublicInfoTooltip collection={collection} />}
        {isRoot && collection.ownerName && collection.shared && (
          <span className="text-[10px] text-muted-foreground/70 truncate max-w-[100px] mx-1 shrink-0">
            · {collection.ownerName}
          </span>
        )}
        {/* Dropdown is shown to editors (rename + admin actions) and to
            non-owner viewers on the root row (so they can Leave a
            shared collection without going back to a removed Private
            entry point). A viewer in a sub-folder gets nothing — no
            meaningful action available there. */}
        {(canEdit || (isRoot && !isOwner)) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                disabled={busy}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {/* Editors can edit metadata (name/desc/baseUrl); only the
                  owner can change sharing or make-private / delete. The
                  Manage sharing / Make private items live on the root
                  only — sub-folders inherit visibility from the root, so
                  exposing them on every nested row would confuse intent. */}
              {canEdit && (
                <DropdownMenuItem onClick={() => setRenaming(true)}>
                  <Edit3 className="h-3.5 w-3.5 mr-2" />
                  {t('common:edit')}
                </DropdownMenuItem>
              )}
              {canEdit && isRoot && (
                <DropdownMenuItem onClick={() => setSharing(true)}>
                  <Users className="h-3.5 w-3.5 mr-2" />
                  {t('accordion.manageSharing')}
                </DropdownMenuItem>
              )}
              {isOwner && isRoot && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleMakePrivate}>
                    <Lock className="h-3.5 w-3.5 mr-2" />
                    {t('accordion.makePrivate')}
                  </DropdownMenuItem>
                </>
              )}
              {isOwner && (
                <DropdownMenuItem
                  onClick={() => setConfirmDelete(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  {t('common:delete')}
                </DropdownMenuItem>
              )}
              {isRoot && !isOwner && (
                <DropdownMenuItem
                  onClick={handleLeave}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  {t('accordion.leaveShared')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {expanded && (
        <div>
          {/* Sub-folders first, then this folder's direct requests —
              matches CollectionTree's ordering so the two accordions
              read the same way. */}
          {children.map((child) => (
            <PublicNode
              key={child.id}
              collection={child}
              depth={depth + 1}
              rootRole={myRole}
            />
          ))}
          {requests.length === 0 && children.length === 0 ? (
            <p
              className="text-[10px] text-muted-foreground italic px-2 py-1"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              {t('accordion.noRequests')}
            </p>
          ) : canEdit ? (
            // Editor + owner get the full RequestItem with rename / dup /
            // delete affordances — same component the Private tree uses.
            requests.map((req) => (
              <div
                key={req.id}
                style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
              >
                <RequestItem
                  request={req}
                  collectionName={collection.name}
                  baseUrl={collection.baseUrl}
                />
              </div>
            ))
          ) : (
            // Viewer-only fallback — click opens a fresh tab seeded from
            // the request without write-back capability.
            requests.map((req) => (
              <div
                key={req.id}
                style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
              >
                <PublicRequest
                  request={req}
                  onOpen={() => openInTab(req, addTab, collection.baseUrl)}
                />
              </div>
            ))
          )}
        </div>
      )}

      {/* Reuse the same rename + share dialogs the Private tree uses. */}
      {renaming && (
        <CollectionDialog
          open={renaming}
          onOpenChange={setRenaming}
          editCollection={{
            id: collection.id,
            name: collection.name,
            description: collection.description,
            baseUrl: collection.baseUrl,
            parentId: collection.parentId,
          }}
        />
      )}
      {sharing && (
        <ShareCollectionDialog
          open={sharing}
          onOpenChange={setSharing}
          collection={collection}
        />
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('accordion.deleteConfirmTitle', { name: collection.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('accordion.deleteConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {t('common:delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PublicRequest({
  request,
  onOpen,
}: {
  request: SavedRequest;
  onOpen: () => void;
}) {
  const methodColor: Record<string, string> = {
    GET: 'text-green-500',
    POST: 'text-yellow-500',
    PUT: 'text-blue-500',
    PATCH: 'text-purple-500',
    DELETE: 'text-red-500',
  };
  return (
    <Button
      type="button"
      variant="ghost"
      className="w-full h-7 justify-start px-1.5 gap-1.5"
      onClick={onOpen}
    >
      <span className={cn('text-[10px] font-bold uppercase w-10 shrink-0', methodColor[request.method] ?? 'text-gray-500')}>
        {request.method}
      </span>
      <span className="text-xs truncate flex-1 font-normal text-left">{request.name}</span>
    </Button>
  );
}

// PublicInfoTooltip surfaces "who shared this with me / who can edit /
// who can view" without leaving the sidebar. Grants are fetched lazily
// the first time the user hovers, keeping the public-list payload
// light. Subsequent hovers reuse the cached list. Owner display name
// comes off the parent collection row (BE stamps `ownerName` on the
// public list response).
function PublicInfoTooltip({ collection }: { collection: Collection }) {
  const { t } = useTranslation('collections');
  const [grants, setGrants] = useState<PublicGrant[] | null>(null);
  const [loading, setLoading] = useState(false);

  const hydrate = useCallback(async () => {
    if (grants !== null || loading) return;
    setLoading(true);
    try {
      const res = await collectionSharingAPI.listGrants(collection.id);
      setGrants((res.data as PublicGrant[]) ?? []);
    } catch {
      setGrants([]);
    }
    setLoading(false);
  }, [collection.id, grants, loading]);

  const editors = grants?.filter((g) => g.role === 'editor') ?? [];
  const viewers = grants?.filter((g) => g.role === 'viewer') ?? [];

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onMouseEnter={hydrate}
            onFocus={hydrate}
            className="shrink-0 ml-1 p-0.5 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
            aria-label={t('accordion.sharingDetails')}
          >
            <Info className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          // Override the default brand-color tooltip styling — rich
          // tooltips need a neutral background so the secondary text
          // (muted-foreground) renders legibly in both light and dark
          // modes. `bg-popover` + `border` matches the dropdown/menu
          // surfaces used elsewhere in the app.
          className="max-w-[320px] p-3 space-y-2.5 bg-popover text-popover-foreground border shadow-md"
        >
          <div className="flex items-center gap-1.5 text-xs">
            <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{t('accordion.sharedBy')}</span>
            <span className="font-medium text-foreground">{collection.ownerName || t('accordion.you')}</span>
          </div>
          {loading && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('accordion.loadingSharing')}
            </div>
          )}
          {!loading && grants !== null && (
            <>
              <GrantListInTooltip
                icon={<Crown className="h-3 w-3 text-amber-500" />}
                title={t('accordion.editors')}
                emptyHint={t('accordion.onlyOwner')}
                grants={editors}
              />
              <GrantListInTooltip
                icon={<Eye className="h-3 w-3 text-muted-foreground" />}
                title={t('accordion.viewers')}
                emptyHint={t('accordion.noOne')}
                grants={viewers}
              />
            </>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function GrantListInTooltip({
  icon,
  title,
  emptyHint,
  grants,
}: {
  icon: React.ReactNode;
  title: string;
  emptyHint: string;
  grants: PublicGrant[];
}) {
  const { t } = useTranslation('collections');
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
        <span className="text-muted-foreground/70 normal-case">({grants.length})</span>
      </div>
      {grants.length === 0 ? (
        <p className="text-xs text-muted-foreground italic pl-4">{emptyHint}</p>
      ) : (
        <ul className="space-y-0.5 pl-4">
          {grants.slice(0, 8).map((g) => (
            <li key={g.id} className="flex items-center gap-1.5 text-xs text-foreground">
              {g.subjectKind === 'everyone' && <Globe2 className="h-2.5 w-2.5 text-primary shrink-0" />}
              {g.subjectKind === 'team' && <Users className="h-2.5 w-2.5 text-muted-foreground shrink-0" />}
              {g.subjectKind === 'user' && <UserCircle2 className="h-2.5 w-2.5 text-muted-foreground shrink-0" />}
              <span className="truncate">{g.label || g.subjectId}</span>
            </li>
          ))}
          {grants.length > 8 && (
            <li className="text-[10px] text-muted-foreground italic pl-1">
              {t('accordion.moreCount', { count: grants.length - 8 })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// Recursive leaf-request count — direct + every descendant. Mirrors
// `countRequests` in CollectionTree so the Public/Private accordion
// sections render the same (N) badge format.
function countAllRequests(col: Collection): number {
  let n = col.requests?.length ?? 0;
  if (col.children) {
    for (const child of col.children) n += countAllRequests(child);
  }
  return n;
}

// addTab signature: (overrides?, focus?) — see requestStore.addTab. We
// open a fresh tab seeded from the public request so it doesn't write
// back into the owner's collection unless the user explicitly saves.
function openInTab(
  req: SavedRequest,
  addTab: (overrides?: Partial<import('@/types').Tab>, focus?: boolean) => void,
  rootBaseUrl?: string,
) {
  // Normalize headers/params/body which may arrive as JSON strings from
  // the BE depending on the repo path — addTab expects KeyValue[] /
  // RequestBody, not strings.
  const parseJson = <T,>(v: unknown, fallback: T): T => {
    if (Array.isArray(v) || typeof v === 'object') return (v as T) ?? fallback;
    if (typeof v === 'string') {
      try { return JSON.parse(v) as T; } catch { return fallback; }
    }
    return fallback;
  };
  const url = rootBaseUrl ? rootBaseUrl.replace(/\/$/, '') + '/' + req.url.replace(/^\//, '') : req.url;
  addTab(
    {
      name: req.name,
      method: req.method,
      url,
      headers: parseJson(req.headers, []),
      params: parseJson(req.params, []),
      body: parseJson(req.body, { type: 'none', content: '' }),
      auth: parseJson(req.auth, { type: 'none' }),
      requestId: req.id,
    },
    true,
  );
}
