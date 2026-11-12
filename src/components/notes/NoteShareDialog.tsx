import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PublicSharingPanel } from '@/components/sharing/PublicSharingPanel';
import { useAuthStore } from '@/stores/authStore';
import { useNotesStore } from '@/stores/notesStore';

// Share a note or folder: public toggle (owner only) plus user / team /
// everyone grants, which cascade to everything inside it. An "everyone" share
// makes the space show up in every user's Notes sidebar.
export function NoteShareDialog({
  note,
  open,
  onOpenChange,
}: {
  note: { id: string; title: string; userId: string; visibility: 'private' | 'public' };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('notes');
  const me = useAuthStore((s) => s.user?.id ?? '');
  const patchLocal = useNotesStore((s) => s.patchLocal);
  const isOwner = note.userId === me;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="truncate">{t('shareTitle', { name: note.title })}</DialogTitle>
          <DialogDescription>{t('shareDescription')}</DialogDescription>
        </DialogHeader>
        <PublicSharingPanel
          kind="note"
          assetId={note.id}
          assetName={note.title}
          currentVisibility={note.visibility}
          ownerId={note.userId}
          canManageVisibility={isOwner}
          onVisibilityChange={(v) => patchLocal(note.id, { visibility: v })}
        />
      </DialogContent>
    </Dialog>
  );
}
