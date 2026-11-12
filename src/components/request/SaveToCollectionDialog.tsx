import { useState, useEffect, useMemo } from 'react';
import { Save, Copy, Folder, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCollectionStore } from '@/stores/collectionStore';
import { useRequestStore } from '@/stores/requestStore';
import type { Collection } from '@/types';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Tab } from '@/types';

interface SaveToCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: Tab;
}

export function SaveToCollectionDialog({ open, onOpenChange, tab }: SaveToCollectionDialogProps) {
  const { t } = useTranslation('request');
  const { collections, fetchCollections, createRequest, updateRequest } = useCollectionStore();
  const { updateTab } = useRequestStore();
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'choose' | 'new'>('choose');

  const requestExists = useMemo(() => {
    if (!tab.requestId) return false;
    const walk = (list: Collection[]): boolean => {
      for (const col of list) {
        if ((col.requests || []).some((r) => r.id === tab.requestId)) return true;
        if (col.children && walk(col.children)) return true;
      }
      return false;
    };
    return walk(collections);
  }, [collections, tab.requestId]);

  // Flatten the collection tree into a depth-tagged list so the Select
  // dropdown can render folders alongside their parent collections. Saving
  // *into* a folder is just a write with that folder's id as collectionId —
  // folders are Collection rows with type='folder' on the BE.
  type FlatTarget = { id: string; name: string; depth: number; isFolder: boolean };
  const flatTargets = useMemo(() => {
    const out: FlatTarget[] = [];
    const walk = (list: Collection[], depth: number) => {
      for (const c of list) {
        out.push({ id: c.id, name: c.name, depth, isFolder: c.type === 'folder' });
        if (c.children?.length) walk(c.children, depth + 1);
      }
    };
    walk(collections, 0);
    return out;
  }, [collections]);

  const hasExisting = !!tab.requestId && requestExists;

  useEffect(() => {
    if (open) {
      fetchCollections();
      setMode(hasExisting ? 'choose' : 'new');
      try {
        const url = new URL(tab.url.startsWith('http') ? tab.url : `https://${tab.url}`);
        const pathName = url.pathname === '/' ? url.hostname : url.pathname;
        setName(`${tab.method} ${pathName}`);
      } catch {
        setName(tab.url || t('tab.newRequest'));
      }
    }
  }, [open, tab.url, tab.method, fetchCollections, hasExisting, t]);

  const tabData = {
    method: tab.method,
    url: tab.url,
    headers: tab.headers,
    params: tab.params,
    pathParams: tab.pathParams,
    body: tab.body,
    auth: tab.auth,
    preRequestScript: tab.preRequestScript,
    testScript: tab.testScript,
  };

  const handleOverwrite = async () => {
    if (!tab.requestId) return;
    // The open tab's name carries the breadcrumb ("Folder → get"); persist only
    // the LEAF (last segment) so re-opening doesn't stack it into
    // "Folder → Folder → get" each save.
    const leafName = tab.name.includes(' → ')
      ? tab.name.slice(tab.name.lastIndexOf(' → ') + 3)
      : tab.name;
    await updateRequest(tab.requestId, {
      ...tabData,
      name: leafName,
    });
    onOpenChange(false);
  };

  const handleSaveNew = async () => {
    if (!selectedCollectionId || !name.trim()) return;
    await createRequest(selectedCollectionId, {
      ...tabData,
      name: name.trim(),
      collectionId: selectedCollectionId,
      sortOrder: 0,
    });
    // Clear requestId so the tab is no longer linked to the old request
    updateTab(tab.id, { requestId: undefined });
    onOpenChange(false);
  };

  // Choice mode: overwrite or save as new
  if (hasExisting && mode === 'choose') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('save.title')}</DialogTitle>
            <DialogDescription>
              {t('save.linkedDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Button onClick={handleOverwrite} className="justify-start gap-2">
              <Save className="h-4 w-4" />
              {t('save.updateExisting')}
            </Button>
            <Button variant="outline" onClick={() => setMode('new')} className="justify-start gap-2">
              <Copy className="h-4 w-4" />
              {t('save.saveAsNew')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // New save mode
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('save.toCollectionTitle')}</DialogTitle>
          <DialogDescription>
            {t('save.toCollectionDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="collection">{t('save.saveInto')}</Label>
            <Select value={selectedCollectionId} onValueChange={setSelectedCollectionId}>
              <SelectTrigger>
                <SelectValue placeholder={t('save.pickCollection')} />
              </SelectTrigger>
              <SelectContent>
                {flatTargets.map((t) => {
                  const Icon = t.isFolder ? Folder : FolderOpen;
                  return (
                    <SelectItem key={t.id} value={t.id}>
                      <span
                        className="inline-flex items-center gap-1.5"
                        style={{ paddingLeft: t.depth * 14 }}
                      >
                        <Icon className="h-3.5 w-3.5 opacity-70" />
                        <span className="truncate">{t.name}</span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">{t('save.requestName')}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('save.requestNamePlaceholder')}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveNew()}
            />
          </div>
        </div>

        <DialogFooter>
          {hasExisting && (
            <Button variant="ghost" onClick={() => setMode('choose')} className="mr-auto">
              {t('actions.back')}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSaveNew} disabled={!selectedCollectionId || !name.trim()}>
            {t('common:save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
