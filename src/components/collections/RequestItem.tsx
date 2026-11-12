import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { extractPathParams } from '@/lib/pathParams';
import { useRequestStore } from '@/stores/requestStore';
import { useCollectionStore } from '@/stores/collectionStore';
import { Trash2, MoreHorizontal, Pencil, ExternalLink, Edit3, GripVertical, Copy, Archive } from 'lucide-react';
import { useSavedResponsesUI } from '@/stores/savedResponsesUIStore';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
import type { SavedRequest, KeyValue, RequestBody, RequestAuth } from '@/types';

const methodColors: Record<string, string> = {
  GET: 'text-green-500',
  POST: 'text-yellow-500',
  PUT: 'text-blue-500',
  PATCH: 'text-purple-500',
  DELETE: 'text-red-500',
  HEAD: 'text-teal-500',
  OPTIONS: 'text-gray-500',
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

interface RequestItemProps {
  request: SavedRequest;
  collectionName: string;
  baseUrl?: string;
}

export function RequestItem({ request, collectionName, baseUrl }: RequestItemProps) {
  const { t } = useTranslation('collections');
  const showSavedResponses = useSavedResponsesUI((s) => s.show);
  const { addTab } = useRequestStore();
  const { deleteRequest, updateRequest, createRequest } = useCollectionStore();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editMethod, setEditMethod] = useState('');
  const [editUrl, setEditUrl] = useState('');

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `req:${request.id}`,
    data: { type: 'request', parentId: request.collectionId },
  });

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const buildTabData = () => {
    const parseJSON = <T,>(val: unknown, fallback: T): T => {
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          return parsed ?? fallback;
        } catch { return fallback; }
      }
      return (val as T) ?? fallback;
    };

    const headers = parseJSON<KeyValue[]>(request.headers, []);
    const params = parseJSON<KeyValue[]>(request.params, []);
    const body = parseJSON<RequestBody>(request.body, { type: 'none', content: '' });
    const auth = parseJSON<RequestAuth>(request.auth, { type: 'none' });

    // If URL is a relative path and we have a baseUrl, prepend it
    let resolvedUrl = request.url;
    if (baseUrl && resolvedUrl && resolvedUrl.startsWith('/')) {
      resolvedUrl = baseUrl.replace(/\/+$/, '') + resolvedUrl;
    }

    // Split a leading scheme off the URL so the protocol selector and the
    // URL input stay in sync. Without this, a saved URL like
    // "https://example.com" lands in the input as-is, the user sees both
    // the selector saying https:// AND the input showing https:// — and on
    // send we'd end up with https://https://example.com.
    let resolvedProtocol: 'https://' | 'http://' | undefined;
    if (resolvedUrl.startsWith('https://')) {
      resolvedProtocol = 'https://';
      resolvedUrl = resolvedUrl.slice('https://'.length);
    } else if (resolvedUrl.startsWith('http://')) {
      resolvedProtocol = 'http://';
      resolvedUrl = resolvedUrl.slice('http://'.length);
    }

    // Path params: single-brace {name} in the path (NOT {{env}} variables).
    // Reuse any SAVED path-param values so reopening a request restores the
    // values the user entered, rather than deriving empty rows from the URL.
    const savedPath = parseJSON<KeyValue[]>((request as { pathParams?: unknown }).pathParams, []);
    const pathParams = extractPathParams(resolvedUrl).map((key) => {
      const found = savedPath.find((p) => p.key === key);
      return found ? { ...found } : { key, value: '', enabled: true };
    });

    // Extract query params from URL and merge with saved params
    const mergedParams = params.length > 0 ? [...params] : [];
    const qsIdx = resolvedUrl.indexOf('?');
    if (qsIdx >= 0) {
      try {
        const urlParams = new URLSearchParams(resolvedUrl.slice(qsIdx + 1));
        const existingKeys = new Set(mergedParams.map((p) => p.key));
        urlParams.forEach((value, key) => {
          if (!existingKeys.has(key)) {
            mergedParams.push({ key, value, enabled: true });
          }
        });
      } catch { /* skip invalid */ }
    }
    // Always have at least one empty row
    if (mergedParams.length === 0 || mergedParams.every((p) => p.key)) {
      mergedParams.push({ key: '', value: '', enabled: true });
    }

    return {
      name: `${collectionName} → ${request.name}`,
      method: request.method,
      url: resolvedUrl,
      ...(resolvedProtocol ? { protocol: resolvedProtocol } : {}),
      requestId: request.id,
      headers: headers.length > 0 ? headers : [{ key: '', value: '', enabled: true }],
      params: mergedParams,
      pathParams,
      body,
      auth,
      preRequestScript: request.preRequestScript,
      testScript: request.testScript,
    };
  };

  const handleOpen = () => {
    addTab(buildTabData());
  };

  const handleOpenNewTab = () => {
    addTab(buildTabData(), true);
  };

  const handleDelete = () => {
    deleteRequest(request.id);
    setDeleteOpen(false);
  };

  const handleDuplicate = () => {
    // Clone into the same collection. Fields are passed through as-stored
    // (string or parsed) — serializeRequestPayload handles both — so the copy
    // carries headers/params/body/auth/scripts/path-params verbatim. New id +
    // sortOrder are assigned by the repo.
    createRequest(request.collectionId, {
      name: `${request.name} Copy`,
      method: request.method,
      url: request.url,
      headers: request.headers,
      params: request.params,
      pathParams: request.pathParams,
      body: request.body,
      auth: request.auth,
      preRequestScript: request.preRequestScript,
      testScript: request.testScript,
    });
  };

  const handleEditOpen = () => {
    setEditName(request.name);
    setEditMethod(request.method);
    setEditUrl(request.url);
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!editName.trim()) return;
    await updateRequest(request.id, {
      name: editName.trim(),
      method: editMethod,
      url: editUrl.trim(),
    });
    setEditOpen(false);
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={sortableStyle}
        className={cn(
          "flex items-center group px-2 py-1.5 rounded-md hover:bg-accent transition-colors duration-200 cursor-pointer",
        )}
        onClick={handleOpen}
        {...attributes}
      >
        <button
          type="button"
          className="shrink-0 p-0.5 -ml-1 mr-1 text-muted-foreground opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-grab active:cursor-grabbing touch-none"
          aria-label={t('tree.dragToReorder')}
          onClick={(e) => e.stopPropagation()}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={cn(
              'text-[10px] font-bold uppercase w-10 text-left shrink-0',
              methodColors[request.method] || 'text-gray-500'
            )}
          >
            {request.method}
          </span>
          <span className="truncate text-sm text-left flex-1">{request.name}</span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity cursor-pointer shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={handleOpen}>
              <Pencil className="h-3.5 w-3.5 mr-2" />
              {t('request.open')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleOpenNewTab}>
              <ExternalLink className="h-3.5 w-3.5 mr-2" />
              {t('request.openNewTab')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleEditOpen}>
              <Edit3 className="h-3.5 w-3.5 mr-2" />
              {t('common:edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleDuplicate}>
              <Copy className="h-3.5 w-3.5 mr-2" />
              {t('request.duplicate')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => showSavedResponses(request.name, [request.collectionId], undefined, request.id)}>
              <Archive className="h-3.5 w-3.5 mr-2" />
              {t('tree.savedResponses')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setDeleteOpen(true)}
              className="text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              {t('common:delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('request.editTitle')}</DialogTitle>
            <DialogDescription>
              {t('request.editDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="req-name">{t('common:name')}</Label>
              <Input
                id="req-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleEditSave()}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t('request.methodLabel')}</Label>
              <Select value={editMethod} onValueChange={setEditMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      <span className={cn('font-medium', methodColors[m])}>{m}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="req-url">{t('request.urlPathLabel')}</Label>
              <Input
                id="req-url"
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                placeholder={t('request.urlPlaceholder')}
                onKeyDown={(e) => e.key === 'Enter' && handleEditSave()}
              />
              {baseUrl && editUrl.startsWith('/') && (
                <p className="text-xs text-muted-foreground">
                  {t('request.full', { url: `${baseUrl.replace(/\/+$/, '')}${editUrl}` })}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {t('common:cancel')}
            </Button>
            <Button onClick={handleEditSave}>{t('common:save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('request.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('request.deleteDescription', { name: request.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common:delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
