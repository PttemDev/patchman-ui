import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useCollectionStore } from '@/stores/collectionStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import type { AxiosError } from 'axios';

interface CollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId?: string | null;
  editCollection?: { id: string; name: string; description: string; baseUrl?: string; parentId?: string | null } | null;
}

export function CollectionDialog({
  open,
  onOpenChange,
  parentId = null,
  editCollection = null,
}: CollectionDialogProps) {
  const { t } = useTranslation('collections');
  const { createCollection, updateCollection } = useCollectionStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Base URL is editable on every collection level (root + every sub-
  // folder), since the resolution logic now lets a nested folder
  // override its ancestor's baseUrl. Keeping this gated to root only
  // was hiding an existing model field — the BE has always stored
  // baseUrl per-row.
  const showBaseUrl = !!editCollection;

  useEffect(() => {
    if (open && editCollection) {
      setName(editCollection.name || '');
      setDescription(editCollection.description || '');
      setBaseUrl(editCollection.baseUrl || '');
    } else if (open) {
      setName('');
      setDescription('');
      setBaseUrl('');
    }
    // Reset submit-state when the dialog re-opens or switches between
    // create / edit so a previous spinner doesn't stick across uses.
    setSubmitting(false);
  }, [open, editCollection]);

  const handleSubmit = async () => {
    if (!name.trim() || submitting) return;

    setSubmitting(true);
    // "Saving…" toast we mutate to success/error. Single toast handle
    // means the user always sees the latest state of THIS action,
    // not a stack of intermediate toasts.
    const tt = toast({
      title: editCollection ? t('dialog.savingToast') : t('dialog.creatingToast'),
    });
    try {
      if (editCollection) {
        await updateCollection(editCollection.id, {
          name: name.trim(),
          description: description.trim(),
          baseUrl: baseUrl.trim(),
        });
        tt.update({
          id: tt.id,
          title: t('dialog.updated'),
          description: name.trim(),
        });
      } else {
        await createCollection({
          name: name.trim(),
          description: description.trim(),
          type: parentId ? 'folder' : 'collection',
          parentId,
          sortOrder: 0,
        });
        tt.update({
          id: tt.id,
          title: parentId ? t('dialog.folderCreated') : t('dialog.created'),
          description: name.trim(),
        });
      }
      setName('');
      setDescription('');
      setBaseUrl('');
      onOpenChange(false);
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      tt.update({
        id: tt.id,
        title: editCollection ? t('dialog.couldNotSave') : t('dialog.couldNotCreate'),
        description: ax.response?.data?.error || ax.message || t('tryAgain'),
        variant: 'destructive',
      });
      // Keep the dialog open so the user can correct + retry.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Block closing the dialog mid-save so the user doesn't lose
        // the form state to a network blip. The handleSubmit promise
        // reopens it (no-op) and the toast carries the success/error.
        if (submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {editCollection ? t('dialog.editTitle') : t('dialog.newTitle')}
          </DialogTitle>
          <DialogDescription>
            {editCollection
              ? t('dialog.editDescription')
              : t('dialog.newDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="name">{t('common:name')}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('dialog.namePlaceholder')}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              disabled={submitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">{t('dialog.descriptionLabel')}</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('dialog.descriptionPlaceholder')}
              rows={3}
              disabled={submitting}
            />
          </div>
          {showBaseUrl && (
            <div className="grid gap-2">
              <Label htmlFor="baseUrl">{t('dialog.baseUrlLabel')}</Label>
              <Input
                id="baseUrl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={t('dialog.baseUrlPlaceholder')}
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                {t('dialog.baseUrlHint')}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {submitting
              ? (editCollection ? t('dialog.saving') : t('dialog.creating'))
              : (editCollection ? t('dialog.saveChanges') : t('dialog.create'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
