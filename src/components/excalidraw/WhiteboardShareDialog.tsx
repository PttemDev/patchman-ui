import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Link2, Copy, Trash2, Eye, Pencil, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PublicSharingPanel } from '@/components/sharing/PublicSharingPanel';
import { whiteboardSharingAPI } from '@/services/api';
import { getCachedServerConfig } from '@/stores/remoteStore';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/components/ui/use-toast';
import type { Whiteboard } from '@/types';

interface LinkRow {
  id: string;
  role: 'viewer' | 'editor';
  prefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  token?: string; // only on freshly-created
}

// The origin a no-account recipient opens the link in. The desktop shell's
// origin is `tauri://localhost` (useless in a browser) and the remote API host
// is a DIFFERENT host from the FE, so prefer the backend-advertised `webOrigin`
// (from /api/config). Fall back to the current origin only when it's already a
// real web origin (i.e. running as the web app).
function publicLinkBase(): string {
  const advertised = getCachedServerConfig().webOrigin;
  if (advertised && /^https?:/.test(advertised)) return advertised.replace(/\/+$/, '');
  const origin = window.location.origin;
  if (/^https?:/.test(origin)) return origin;
  return origin; // desktop with no configured webOrigin — link host may be wrong; surfaced to the user as-is
}

export function WhiteboardShareDialog({
  board,
  open,
  onOpenChange,
  onVisibilityChange,
}: {
  board: Whiteboard;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onVisibilityChange?: (v: 'private' | 'public') => void;
}) {
  const { t } = useTranslation('excalidraw');
  const { toast } = useToast();
  const userId = useAuthStore((s) => s.user?.id ?? '');
  // An editor re-sharing a board they were given: grants are editor-allowed on
  // the BE, but visibility and public links are owner-only (403 otherwise), so
  // those controls are the owner's alone. Own boards carry no ownerId.
  const isOwner = (board.ownerId || userId) === userId;
  const [visibility, setVisibility] = useState<'private' | 'public'>(board.visibility ?? 'private');
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [creating, setCreating] = useState<'viewer' | 'editor' | null>(null);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);

  const fetchLinks = useCallback(async () => {
    if (!isOwner || visibility !== 'public') { setLinks([]); return; }
    setLoadingLinks(true);
    try {
      const res = await whiteboardSharingAPI.listLinks(board.id);
      setLinks((res.data as LinkRow[]) ?? []);
    } catch { setLinks([]); }
    setLoadingLinks(false);
  }, [board.id, visibility, isOwner]);

  useEffect(() => { if (open) fetchLinks(); }, [open, fetchLinks]);
  useEffect(() => { if (open) setVisibility(board.visibility ?? 'private'); }, [open, board.visibility]);

  const handleCreate = async (role: 'viewer' | 'editor') => {
    setCreating(role);
    try {
      const res = await whiteboardSharingAPI.createLink(board.id, role);
      const row = res.data as LinkRow;
      // Creating a link makes the board public server-side; reflect it.
      if (visibility !== 'public') { setVisibility('public'); onVisibilityChange?.('public'); }
      if (row.token) {
        const url = `${publicLinkBase()}/wb/${row.token}`;
        setFreshUrl(url);
        try { await navigator.clipboard.writeText(url); toast({ title: t('linkCopied') }); } catch { /* clipboard blocked */ }
      }
      await fetchLinks();
    } finally {
      setCreating(null);
    }
  };

  const handleRevoke = async (id: string) => {
    await whiteboardSharingAPI.revokeLink(board.id, id);
    setLinks((prev) => prev.filter((l) => l.id !== id));
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: t('linkCopied') }); } catch { /* ignore */ }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('shareTitle', { name: board.name })}</DialogTitle>
        </DialogHeader>

        <PublicSharingPanel
          kind="whiteboard"
          assetId={board.id}
          assetName={board.name}
          currentVisibility={visibility}
          ownerId={board.ownerId || userId}
          canManageVisibility={isOwner}
          onVisibilityChange={(v) => { setVisibility(v); onVisibilityChange?.(v); }}
        />

        {!isOwner ? (
          <p className="mt-2 min-w-0 border-t pt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link2 className="h-3.5 w-3.5 shrink-0" /> {t('linksOwnerOnly')}
          </p>
        ) : (
        <div className="mt-2 min-w-0 border-t pt-3 space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Link2 className="h-4 w-4" /> {t('linksHeading')}
          </div>
          <p className="text-xs text-muted-foreground">{t('linksHint')}</p>

          {freshUrl && (
            <div className="flex items-center gap-2 rounded border bg-muted/40 p-2">
              <code className="flex-1 min-w-0 truncate text-xs">{freshUrl}</code>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(freshUrl)}><Copy className="h-3.5 w-3.5" /></Button>
            </div>
          )}
          {freshUrl && <p className="text-[11px] text-amber-600 dark:text-amber-500">{t('newLinkReady')}</p>}

          {loadingLinks ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> …</div>
          ) : links.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('noLinks')}</p>
          ) : (
            <div className="space-y-1">
              {links.map((l) => (
                <div key={l.id} className="flex items-center gap-2 rounded border p-1.5 text-xs">
                  {l.role === 'editor' ? <Pencil className="h-3.5 w-3.5 text-amber-500" /> : <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="font-medium">{t(l.role === 'editor' ? 'roleEditor' : 'roleViewer')}</span>
                  <code className="text-muted-foreground">{l.prefix}…</code>
                  <span className="ml-auto text-muted-foreground/70">
                    {l.lastUsedAt ? `${t('lastUsed')} ${new Date(l.lastUsedAt).toLocaleDateString()}` : t('never')}
                  </span>
                  {l.token && (
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(`${publicLinkBase()}/wb/${l.token}`)} title={t('copy')}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => handleRevoke(l.id)} title={t('revoke')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={creating !== null} onClick={() => handleCreate('viewer')}>
              {creating === 'viewer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} {t('createReadOnly')}
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={creating !== null} onClick={() => handleCreate('editor')}>
              {creating === 'editor' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />} {t('createReadWrite')}
            </Button>
          </div>
          <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-500">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /> {t('rwWarning')}
          </p>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
