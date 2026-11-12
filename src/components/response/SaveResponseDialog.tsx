import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/components/ui/use-toast';
import { getRepo } from '@/data';
import { useCollectionStore } from '@/stores/collectionStore';
import { useSavedResponsesUI } from '@/stores/savedResponsesUIStore';
import type { Collection, Tab } from '@/types';
import { collectionOfRequest, collectionWithDescendants, flattenCollections } from '@/components/collections/savedResponsesUtil';

// "Save response": keeps the tab's request (as edited, {{variables}}
// unresolved) together with what was sent and the response, under a
// collection or folder — the tab's own collection by default.
export function SaveResponseDialog({ open, onOpenChange, tab }: { open: boolean; onOpenChange: (o: boolean) => void; tab: Tab }) {
  const { t } = useTranslation(['response', 'common']);
  const { toast } = useToast();
  const showSaved = useSavedResponsesUI((s) => s.show);
  const collections = useCollectionStore((s) => s.collections);
  const fetchCollections = useCollectionStore((s) => s.fetchCollections);
  const flat = useMemo(() => (open ? flattenCollections() : []), [open, collections]); // eslint-disable-line react-hooks/exhaustive-deps
  const [name, setName] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (collections.length === 0) void fetchCollections();
    const r = tab.response;
    setName(`${tab.name && tab.name !== 'New Request' ? tab.name : `${tab.method} ${tab.url}`} — ${r?.statusCode ?? ''}`.trim());
    setCollectionId(collectionOfRequest(tab.requestId ?? tab.originRequestId) ?? '');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && !collectionId && flat.length > 0) setCollectionId(collectionOfRequest(tab.requestId ?? tab.originRequestId) ?? flat[0].id);
  }, [open, flat, collectionId, tab.requestId, tab.originRequestId]);

  const save = async () => {
    const r = tab.response;
    if (!r || !collectionId) return;
    setBusy(true);
    setError('');
    try {
      const saved = await getRepo().savedResponses.create({
        collectionId,
        requestId: tab.requestId ?? tab.originRequestId,
        name: name.trim(),
        method: tab.sentRequest?.method || tab.method,
        url: tab.sentRequest?.url || tab.url,
        request: {
          name: tab.name, method: tab.method, url: tab.url, protocol: tab.protocol, headers: tab.headers, params: tab.params,
          pathParams: tab.pathParams, body: tab.body, auth: tab.auth, preRequestScript: tab.preRequestScript,
          testScript: tab.testScript, sendMode: tab.sendMode, corsBypass: tab.corsBypass,
        },
        sent: tab.sentRequest,
        response: {
          statusCode: r.statusCode, statusText: r.statusText, durationMs: Math.round(r.duration ?? r.timing?.total ?? 0),
          size: r.size, headers: r.headers, body: r.body, bodyBase64: r.bodyBase64,
        },
      });
      onOpenChange(false);
      const target = findCollection(useCollectionStore.getState().collections, collectionId)
        ?? findCollection(useCollectionStore.getState().publicCollections, collectionId);
      const where = flat.find((f) => f.id === collectionId)?.path ?? '';
      toast({
        title: t('response:save.saved'),
        description: saved.truncated ? t('response:save.truncated', { where }) : where,
        action: target ? (
          <ToastAction altText={t('response:save.view')} onClick={() => showSaved(target.name, collectionWithDescendants(target), saved.id)}>
            {t('response:save.view')}
          </ToastAction>
        ) : undefined,
      });
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } }; message?: string };
      setError(ax.response?.data?.error || ax.message || t('response:save.failed'));
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t('response:save.title')}</DialogTitle>
          <DialogDescription>{t('response:save.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t('response:save.name')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter' && collectionId && !busy) void save(); }} />
          </div>
          <div>
            <Label className="text-xs">{t('response:save.collection')}</Label>
            {flat.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-1">{t('response:save.noCollections')}</p>
            ) : (
              <Select value={collectionId} onValueChange={setCollectionId}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder={t('response:save.pick')} /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {flat.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      <span style={{ paddingLeft: f.depth * 12 }}>{f.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {error && <p className="text-xs text-destructive break-words">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common:cancel')}</Button>
          <Button onClick={save} disabled={busy || !collectionId}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}{t('common:save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function findCollection(list: Collection[], id: string): Collection | undefined {
  for (const c of list) {
    if (c.id === id) return c;
    const hit = findCollection(c.children ?? [], id);
    if (hit) return hit;
  }
  return undefined;
}
