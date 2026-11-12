import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Loader2 } from 'lucide-react';
import { collectionCollabAPI } from '@/services/api';
import { useCollectionStore } from '@/stores/collectionStore';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface JoinCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function JoinCollectionDialog({ open, onOpenChange }: JoinCollectionDialogProps) {
  const { t } = useTranslation('collections');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { fetchCollections } = useCollectionStore();

  const handleJoin = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await collectionCollabAPI.join(trimmed);
      const data = res.data as { collection?: { name?: string }; message?: string };
      setSuccess(t('join.addedSuccess', { name: data.collection?.name || t('import.collectionFallback') }));
      setCode('');
      fetchCollections();
      setTimeout(() => {
        onOpenChange(false);
        setSuccess('');
      }, 1500);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr.response?.data?.error || t('join.failedCollection'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setCode(''); setError(''); setSuccess(''); } }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            {t('join.title')}
          </DialogTitle>
          <DialogDescription>
            {t('join.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <input
            autoFocus
            className="w-full h-10 px-3 rounded-md border bg-transparent text-sm font-mono outline-none focus:ring-2 focus:ring-ring tracking-widest text-center uppercase"
            placeholder={t('join.codePlaceholder')}
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleJoin(); }}
            maxLength={20}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          {success && <p className="text-xs text-green-500">{success}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleJoin} disabled={loading || !code.trim()}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
            {t('join.join')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
