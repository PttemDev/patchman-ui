import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Trash2, Users, Link, Loader2, ChevronLeft, ChevronRight, UserCircle2, Info } from 'lucide-react';
import { collectionCollabAPI } from '@/services/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { PublicSharingPanel } from '@/components/sharing/PublicSharingPanel';
import { useAuthStore } from '@/stores/authStore';
import type { Collection, CollectionCollaborator } from '@/types';

interface ShareCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: Collection;
}

export function ShareCollectionDialog({ open, onOpenChange, collection }: ShareCollectionDialogProps) {
  const { t } = useTranslation('collections');
  const currentUserId = useAuthStore((s) => s.user?.id) ?? '';
  // Owner of *this* collection is the source of truth for the "you
  // (owner)" affordance in the public panel. Fall back to current user
  // when the collection row lacks userId (some legacy List payloads
  // strip it on shared rows).
  const ownerId = collection.userId || currentUserId;
  // Editors (the dialog is gated to owner+editor upstream by the
  // PublicNode dropdown) get a trimmed view: just the Editors / Viewers
  // grant lists + Add row. The visibility toggle, "make private"
  // confirmation, and individual share-code panel stay owner-only.
  const isOwner = currentUserId === ownerId;

  // Local visibility state mirrors `collection.visibility`. The dialog's
  // parent receives a live collection via prop; we cache it locally so
  // the public panel can write through `onVisibilityChange` without a
  // round-trip back to the parent.
  const [visibility, setVisibility] = useState<'private' | 'public'>(
    collection.visibility ?? 'private',
  );
  useEffect(() => {
    setVisibility(collection.visibility ?? 'private');
  }, [collection.visibility, collection.id]);

  const [shareToken, setShareToken] = useState('');
  const [collaborators, setCollaborators] = useState<CollectionCollaborator[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 5;

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await collectionCollabAPI.listCollaborators(collection.id);
      const data = res.data as { collaborators: CollectionCollaborator[]; shareToken: string };
      setCollaborators(data.collaborators || []);
      setShareToken(data.shareToken || '');
    } catch {
      // no share link yet
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchData();
      setCopied(false);
      setPage(1);
    }
  }, [open, collection.id]);

  const totalPages = Math.max(1, Math.ceil(collaborators.length / pageSize));
  const pageItems = useMemo(
    () => collaborators.slice((page - 1) * pageSize, page * pageSize),
    [collaborators, page]
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleCreateShare = async () => {
    setCreating(true);
    try {
      const res = await collectionCollabAPI.createShare(collection.id);
      const data = res.data as { shareToken?: string; ShareToken?: string };
      setShareToken(data.shareToken || data.ShareToken || '');
    } catch {
      // error
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async () => {
    try {
      await collectionCollabAPI.revokeShare(collection.id);
      setShareToken('');
      setCollaborators([]);
    } catch {
      // error
    }
  };

  const handleRemoveCollaborator = async (userId: string) => {
    try {
      await collectionCollabAPI.removeCollaborator(collection.id, userId);
      setCollaborators((prev) => prev.filter((c) => c.userId !== userId));
    } catch {
      // error
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t('share.title')}
          </DialogTitle>
          <DialogDescription>
            {t('share.description', { name: collection.name })}
          </DialogDescription>
        </DialogHeader>

        {/* Plain overflow-y-auto instead of radix ScrollArea — the
            Scroll Area's Viewport doesn't always compute its height
            from a flex-1 min-h-0 parent, so on short viewports the
            dialog body just clipped past the bottom. A real
            overflow-y-auto on the flex child Just Works. */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-2">
          {/* Public sharing surface — visibility toggle + Editors/Viewers
              dual list. See PublicSharingPanel for the dual-list editor
              + everyone-takeover guard. */}
          <PublicSharingPanel
            kind="collection"
            assetId={collection.id}
            assetName={collection.name}
            currentVisibility={visibility}
            ownerId={ownerId}
            onVisibilityChange={setVisibility}
            canManageVisibility={isOwner}
          />

          {/* Share-code path is mutually exclusive with the public
              grants surface: a public collection has its Editors /
              Viewers list as the only access channel, and flipping
              to public wipes existing share rows (BE-side guardrail
              in SetVisibility). Hide the entire individual share-code
              section while public so the user never sees both options
              at once. Owner-only either way. */}
          {isOwner && visibility === 'private' && (
          <>
          {/* Divider — flags the legacy share-code path as deprecated.
              The badge + info tooltip surface the deprecation reason
              directly in the dialog so a user reaching for this surface
              sees, at the moment they\'re about to use it, that the
              recommended path is Public + Editors/Viewers above. */}
          <div className="my-4 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <div className="flex-1 h-px bg-border" />
            <span>{t('share.individualCode')}</span>
            <Badge
              variant="outline"
              className="text-[9px] uppercase tracking-wider border-amber-500/50 text-amber-600 dark:text-amber-400 px-1.5 py-0"
            >
              {t('share.deprecated')}
            </Badge>
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    aria-label={t('share.whyDeprecated')}
                  >
                    <Info className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  // Override the default brand-color tooltip surface
                  // (cream-on-dark in dark mode) with the popover
                  // surface tokens — matches the rich-tooltip pattern
                  // used by PublicInfoTooltip so secondary copy stays
                  // legible in both light and dark themes.
                  className="max-w-[280px] p-3 text-xs leading-relaxed bg-popover text-popover-foreground border shadow-md normal-case tracking-normal"
                >
                  {t('share.deprecatedInfo')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <div className="flex-1 h-px bg-border" />
          </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: share code + revoke */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('share.shareCode')}</label>
                {shareToken ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/50 font-mono text-sm">
                      <Link className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="select-all">{shareToken}</span>
                    </div>
                    <Button size="icon" variant="outline" onClick={handleCopy} title={t('common:copy')}>
                      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                ) : (
                  <Button onClick={handleCreateShare} disabled={creating} className="w-full">
                    {creating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Link className="h-4 w-4 mr-2" />
                    )}
                    {t('share.generate')}
                  </Button>
                )}
                {shareToken && (
                  <p className="text-xs text-muted-foreground">
                    {t('share.shareHint')}
                  </p>
                )}
              </div>

              {/* Shareable URL — recipients can click instead of pasting
                  the code into the Join dialog. The /join/:token route
                  bounces through /login when the recipient is signed out. */}
              {shareToken && (
                <div className="space-y-2 pt-2 border-t">
                  <label className="text-sm font-medium">{t('share.shareableLink')}</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/50 font-mono text-xs min-w-0">
                      <Link className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="select-all truncate" title={`${window.location.origin}/join/${shareToken}`}>
                        {window.location.origin}/join/{shareToken}
                      </span>
                    </div>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={async () => {
                        await navigator.clipboard.writeText(`${window.location.origin}/join/${shareToken}`);
                        setUrlCopied(true);
                        setTimeout(() => setUrlCopied(false), 2000);
                      }}
                      title={t('share.copyUrl')}
                    >
                      {urlCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('share.linkHint')}
                  </p>
                </div>
              )}

              {shareToken && (
                <div className="pt-2 border-t">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleRevoke}
                    className="w-full"
                  >
                    {t('share.revoke')}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1 text-center">
                    {t('share.revokeHint')}
                  </p>
                </div>
              )}
            </div>

            {/* Right: accepted collaborators with pagination */}
            <div className="flex flex-col min-h-[260px]">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">
                  {t('share.sharedWith', { count: collaborators.length })}
                </label>
              </div>
              <div className="flex-1 space-y-1 rounded-md border p-1 bg-muted/20">
                {collaborators.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center py-8 px-4">
                    <UserCircle2 className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">{t('share.noneJoined')}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('share.inviteesHint')}
                    </p>
                  </div>
                ) : (
                  pageItems.map((collab) => (
                    <div
                      key={collab.id}
                      className="flex items-center justify-between px-3 py-2 rounded-md border bg-background text-sm"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <UserCircle2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{collab.userName || t('share.unknown')}</p>
                          <p className="text-xs text-muted-foreground truncate">{collab.userEmail}</p>
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => handleRemoveCollaborator(collab.userId)}
                        title={t('common:remove')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
              {collaborators.length > pageSize && (
                <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                  <span>
                    {t('share.pageOf', { page, total: totalPages })}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
          </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
