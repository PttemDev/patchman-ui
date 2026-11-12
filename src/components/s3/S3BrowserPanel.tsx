import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cloud,
  Folder,
  File as FileIcon,
  Upload,
  FolderPlus,
  RefreshCw,
  Download,
  Link2,
  Copy,
  Trash2,
  X,
  Loader2,
  ChevronRight,
  Home,
  AlertTriangle,
  Eye,
} from 'lucide-react';
import { s3API } from '@/services/api';
import { useS3ConnectionStore, scopeForS3 } from '@/stores/s3ConnectionStore';
import { ExecScopePicker } from '@/components/common/ExecScopePicker';
import { useRequestStore } from '@/stores/requestStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import type { S3Bucket, S3ObjectEntry, S3ObjectListing, S3ObjectMeta, Tab } from '@/types';

interface S3BrowserPanelProps {
  tab: Tab;
}

const LIST_MAX = 500;
const PREVIEW_MAX = 5 * 1024 * 1024; // 5 MB

// Object-table columns. `def` is the default width (px); users drag the
// header borders to resize and the width is remembered for the tab's life.
// The trailing "actions" column hosts per-row Download/Presign/Delete.
const S3_COLUMNS: { id: string; labelKey: string; def: number; align?: 'right'; resizable: boolean }[] = [
  { id: 'name', labelKey: 'columns.name', def: 360, resizable: true },
  { id: 'size', labelKey: 'columns.size', def: 110, align: 'right', resizable: true },
  { id: 'modified', labelKey: 'columns.modified', def: 190, resizable: true },
  { id: 'class', labelKey: 'columns.class', def: 110, resizable: true },
  { id: 'actions', labelKey: '', def: 104, resizable: false },
];

type PreviewState =
  | { type: 'image'; url: string }
  | { type: 'text'; text: string }
  | { type: 'unsupported'; reason: string }
  | null;

export function S3BrowserPanel({ tab }: S3BrowserPanelProps) {
  const { t } = useTranslation('s3');
  const { connections, fetchConnections } = useS3ConnectionStore();
  const updateTab = useRequestStore((s) => s.updateTab);
  const { toast } = useToast();

  const connId = tab.s3ConnectionId ?? '';
  const bucket = tab.s3Bucket ?? '';
  const prefix = tab.s3Prefix ?? '';

  const conn = useMemo(() => connections.find((c) => c.id === connId) ?? null, [connections, connId]);
  // Effective execution scope: per-tab override → connection's home scope.
  // Picks which BE reaches the endpoint (on-prem MinIO on the LAN vs. a
  // cloud/VPN bucket behind the server network).
  const scope = tab.s3ExecScope ?? conn?.scope ?? (connId ? scopeForS3(connections, connId) : undefined);
  const canWrite = conn ? conn.grantRole !== 'read' : false;

  useEffect(() => {
    if (connections.length === 0) fetchConnections();
  }, [connections.length, fetchConnections]);

  // ── Buckets for the connection picker ──────────────────────────────
  const [buckets, setBuckets] = useState<S3Bucket[]>([]);
  const [bucketsLoading, setBucketsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!connId) {
      setBuckets([]);
      return;
    }
    setBucketsLoading(true);
    s3API.buckets(connId, scope)
      .then((res) => { if (!cancelled) setBuckets((res.data as S3Bucket[]) ?? []); })
      .catch(() => { if (!cancelled) setBuckets([]); })
      .finally(() => { if (!cancelled) setBucketsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, scope]);

  // ── Object listing ─────────────────────────────────────────────────
  const [objects, setObjects] = useState<S3ObjectEntry[]>([]);
  const [listing, setListing] = useState<S3ObjectListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (token?: string) => {
    if (!connId || !bucket) {
      setObjects([]);
      setListing(null);
      return;
    }
    if (token) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const res = await s3API.listObjects(connId, { bucket, prefix, token, max: LIST_MAX }, scope);
      const data = res.data as S3ObjectListing;
      setListing(data);
      setObjects((prev) => (token ? [...prev, ...(data.objects ?? [])] : (data.objects ?? [])));
    } catch (err) {
      setError(extractErr(err, t('panel.listObjectsFailed')));
      if (!token) setObjects([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, bucket, prefix, scope]);

  // Fresh load whenever the location changes; also reset any selection.
  const [selected, setSelected] = useState<S3ObjectEntry | null>(null);
  useEffect(() => {
    setSelected(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, bucket, prefix]);

  // ── Selected-object detail state ───────────────────────────────────
  const [meta, setMeta] = useState<S3ObjectMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [presignUrl, setPresignUrl] = useState('');
  // Object to delete (from the detail footer or a per-row action).
  const [deleteTarget, setDeleteTarget] = useState<S3ObjectEntry | null>(null);
  // Per-column widths (px) for the resizable object grid.
  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  // Release blob URLs held by an image preview when it changes / unmounts.
  useEffect(() => {
    if (preview?.type === 'image') {
      const url = preview.url;
      return () => URL.revokeObjectURL(url);
    }
  }, [preview]);

  const selectFile = useCallback(async (entry: S3ObjectEntry) => {
    setSelected(entry);
    setMeta(null);
    setPreview(null);
    setPresignUrl('');
    setMetaLoading(true);
    try {
      const res = await s3API.objectMeta(connId, { bucket, key: entry.key }, scope);
      setMeta(res.data as S3ObjectMeta);
    } catch (err) {
      toast({ title: t('toast.metadataFailed'), description: extractErr(err, t('toast.couldNotLoadMetadata')), variant: 'destructive' });
    } finally {
      setMetaLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, bucket, scope, toast]);

  const closeDetail = useCallback(() => {
    setSelected(null);
    setMeta(null);
    setPreview(null);
    setPresignUrl('');
  }, []);

  const handleRowClick = useCallback((entry: S3ObjectEntry) => {
    if (entry.isPrefix) {
      updateTab(tab.id, { s3Prefix: entry.key });
    } else {
      selectFile(entry);
    }
  }, [tab.id, updateTab, selectFile]);

  // ── Breadcrumb navigation ──────────────────────────────────────────
  const crumbs = useMemo(() => prefix.split('/').filter(Boolean), [prefix]);
  const goToCrumb = useCallback((index: number) => {
    const next = index < 0 ? '' : crumbs.slice(0, index + 1).join('/') + '/';
    updateTab(tab.id, { s3Prefix: next });
  }, [crumbs, tab.id, updateTab]);

  // ── Write actions ──────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0 || !connId || !bucket) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await s3API.putObject(connId, { bucket, key: prefix + file.name }, file, scope);
      }
      toast({ title: t('toast.uploaded'), description: t(files.length === 1 ? 'toast.uploadedOne' : 'toast.uploadedOther', { count: files.length }) });
      await load();
    } catch (err) {
      toast({ title: t('toast.uploadFailed'), description: extractErr(err, t('toast.couldNotUpload')), variant: 'destructive' });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, bucket, prefix, scope, load, toast]);

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim().replace(/\/+$/, '');
    if (!name || !connId || !bucket) return;
    setBusy(true);
    try {
      await s3API.createFolder(connId, { bucket, prefix: prefix + name + '/' }, scope);
      toast({ title: t('toast.folderCreated'), description: name });
      setNewFolderOpen(false);
      setNewFolderName('');
      await load();
    } catch (err) {
      toast({ title: t('toast.createFailed'), description: extractErr(err, t('toast.couldNotCreateFolder')), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newFolderName, connId, bucket, prefix, scope, load, toast]);

  // ── Detail-panel object actions ────────────────────────────────────
  const handlePreview = useCallback(async () => {
    if (!selected) return;
    const size = meta?.size ?? selected.size;
    const kind = detectKind(selected.key, meta?.contentType);
    if (kind === 'other') {
      setPreview({ type: 'unsupported', reason: t('detail.previewUnsupported') });
      return;
    }
    if (size > PREVIEW_MAX) {
      setPreview({ type: 'unsupported', reason: t('detail.previewTooLarge', { size: humanSize(size) }) });
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await s3API.getObject(connId, { bucket, key: selected.key }, scope);
      const blob = res.data as Blob;
      if (kind === 'image') {
        setPreview({ type: 'image', url: URL.createObjectURL(blob) });
      } else {
        let text = await blob.text();
        const ct = (meta?.contentType ?? '').toLowerCase();
        if (ct.includes('json') || selected.key.toLowerCase().endsWith('.json')) {
          try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
        }
        setPreview({ type: 'text', text });
      }
    } catch (err) {
      toast({ title: t('toast.previewFailed'), description: extractErr(err, t('toast.couldNotFetchObject')), variant: 'destructive' });
    } finally {
      setPreviewLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, meta, connId, bucket, scope, toast]);

  const handleDownload = useCallback(async () => {
    if (!selected) return;
    try {
      const res = await s3API.getObject(connId, { bucket, key: selected.key, download: '1' }, scope);
      triggerDownload(res.data as Blob, selected.name || 'download');
    } catch (err) {
      toast({ title: t('toast.downloadFailed'), description: extractErr(err, t('toast.couldNotDownload')), variant: 'destructive' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, connId, bucket, scope, toast]);

  const handlePresign = useCallback(async () => {
    if (!selected) return;
    try {
      const res = await s3API.presign(connId, { bucket, key: selected.key, method: 'GET', ttlSec: 3600 }, scope);
      const url = (res.data as { url: string }).url;
      setPresignUrl(url);
      await navigator.clipboard.writeText(url).catch(() => { /* ignore */ });
      toast({ title: t('toast.presignedUrlCopied'), description: t('toast.presignValid') });
    } catch (err) {
      toast({ title: t('toast.presignFailed'), description: extractErr(err, t('toast.couldNotCreateUrl')), variant: 'destructive' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, connId, bucket, scope, toast]);

  const handleCopyKey = useCallback(() => {
    if (!selected) return;
    navigator.clipboard.writeText(selected.key).catch(() => { /* ignore */ });
    toast({ title: t('toast.keyCopied') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, toast]);

  const handleDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    try {
      await s3API.deleteObject(connId, { bucket, key: target.key }, scope);
      toast({ title: t('toast.deleted'), description: target.name });
      setDeleteTarget(null);
      if (selected?.key === target.key) closeDetail();
      await load();
    } catch (err) {
      toast({ title: t('toast.deleteFailed'), description: extractErr(err, t('toast.couldNotDelete')), variant: 'destructive' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteTarget, selected, connId, bucket, scope, load, closeDetail, toast]);

  // Per-row quick actions (operate on a given entry, independent of the
  // detail selection) so common ops don't require opening the drawer.
  const downloadEntry = useCallback(async (entry: S3ObjectEntry) => {
    try {
      const res = await s3API.getObject(connId, { bucket, key: entry.key, download: '1' }, scope);
      triggerDownload(res.data as Blob, entry.name || 'download');
    } catch (err) {
      toast({ title: t('toast.downloadFailed'), description: extractErr(err, t('toast.couldNotDownload')), variant: 'destructive' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, bucket, scope, toast]);

  const presignEntry = useCallback(async (entry: S3ObjectEntry) => {
    try {
      const res = await s3API.presign(connId, { bucket, key: entry.key, method: 'GET', ttlSec: 3600 }, scope);
      const url = (res.data as { url: string }).url;
      await navigator.clipboard.writeText(url).catch(() => { /* ignore */ });
      toast({ title: t('toast.presignedUrlCopied'), description: t('toast.presignValid') });
    } catch (err) {
      toast({ title: t('toast.presignFailed'), description: extractErr(err, t('toast.couldNotCreateUrl')), variant: 'destructive' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, bucket, scope, toast]);

  // ── Resizable columns ──────────────────────────────────────────────
  const widthOf = useCallback((id: string, def: number) => colWidths[id] ?? def, [colWidths]);
  const startResize = useCallback((e: React.MouseEvent, id: string, cur: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => setColWidths((p) => ({ ...p, [id]: Math.max(60, cur + (ev.clientX - startX)) }));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  }, []);
  const totalWidth = S3_COLUMNS.reduce((s, c) => s + widthOf(c.id, c.def), 0);

  const sorted = useMemo(() => {
    const arr = [...objects];
    arr.sort((a, b) => {
      if (a.isPrefix !== b.isPrefix) return a.isPrefix ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }, [objects]);

  // ── Empty states ───────────────────────────────────────────────────
  if (connections.length === 0) {
    return (
      <EmptyState
        title={t('empty.title')}
        body={t('empty.body')}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 border-b">
        <div className="px-4 pt-4 pb-2 flex items-center gap-2 flex-wrap">
          <Cloud className="h-4 w-4 text-muted-foreground" />
          <Select
            value={connId}
            onValueChange={(v) => updateTab(tab.id, { s3ConnectionId: v, s3Bucket: '', s3Prefix: '' })}
          >
            <SelectTrigger className="w-[220px] h-9 text-sm">
              <SelectValue placeholder={t('panel.selectConnPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="font-mono text-[10px] mr-2 text-muted-foreground uppercase">{c.provider}</span>
                  {c.name}
                  {c.shared && <span className="ml-2 text-[10px] text-muted-foreground">· {t(`roles.${c.grantRole ?? 'read'}`)}</span>}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={bucket}
            onValueChange={(v) => updateTab(tab.id, { s3Bucket: v, s3Prefix: '' })}
            disabled={!connId}
          >
            <SelectTrigger className="w-[200px] h-9 text-sm">
              <SelectValue placeholder={bucketsLoading ? t('panel.loadingBuckets') : t('panel.selectBucketPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {buckets.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  {bucketsLoading ? t('common:loading') : t('panel.noBuckets')}
                </div>
              ) : (
                buckets.map((b) => (
                  <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          {connId && (
            <ExecScopePicker
              scope={(scope ?? 'remote') as 'local' | 'remote'}
              availableScopes={conn?.availableScopes}
              onChange={(s) => updateTab(tab.id, { s3ExecScope: s })}
              noun="browse / transfer"
            />
          )}

          <TooltipProvider delayDuration={200}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <WriteButton
              canWrite={canWrite}
              disabled={!bucket || busy}
              onClick={() => fileInputRef.current?.click()}
              icon={busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              label={t('panel.upload')}
            />
            <WriteButton
              canWrite={canWrite}
              disabled={!bucket || busy}
              onClick={() => { setNewFolderName(''); setNewFolderOpen(true); }}
              icon={<FolderPlus className="h-3.5 w-3.5" />}
              label={t('panel.newFolder')}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" className="gap-1.5 h-9" disabled={!bucket || loading} onClick={() => load()}>
                  <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                  <span className="text-xs">{t('common:refresh')}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p className="text-xs">{t('panel.refreshTooltip')}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Breadcrumb */}
        {bucket && (
          <div className="px-4 pb-2 flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
            <button
              type="button"
              onClick={() => goToCrumb(-1)}
              className="flex items-center gap-1 hover:text-foreground"
              title={bucket}
            >
              <Home className="h-3 w-3" />
              <span className="font-mono">{bucket}</span>
            </button>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 opacity-60" />
                <button
                  type="button"
                  onClick={() => goToCrumb(i)}
                  className={cn('font-mono hover:text-foreground', i === crumbs.length - 1 && 'text-foreground')}
                >
                  {c}
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Body: object list + detail drawer */}
      <div className="flex-1 min-h-0 relative flex">
        <div className="flex-1 min-h-0 overflow-auto">
          {!connId ? (
            <CenterHint text={t('hints.pickConnection')} />
          ) : !bucket ? (
            <CenterHint text={t('hints.pickBucket')} />
          ) : error ? (
            <div className="p-4 flex items-start gap-2 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : loading ? (
            <CenterHint icon={<Loader2 className="h-4 w-4 animate-spin" />} text={t('hints.loadingObjects')} />
          ) : sorted.length === 0 ? (
            <CenterHint text={t('hints.emptyPrefix')} />
          ) : (
            <table className="text-xs" style={{ tableLayout: 'fixed', width: totalWidth }}>
              <colgroup>
                {S3_COLUMNS.map((c) => (
                  <col key={c.id} style={{ width: widthOf(c.id, c.def) }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  {S3_COLUMNS.map((c) => (
                    <th
                      key={c.id}
                      className={cn('relative font-semibold px-3 py-1.5 overflow-hidden select-none', c.align === 'right' ? 'text-right' : 'text-left')}
                    >
                      <span className="truncate block">{c.labelKey ? t(c.labelKey) : ''}</span>
                      {c.resizable && (
                        <div
                          onMouseDown={(e) => startResize(e, c.id, widthOf(c.id, c.def))}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40 active:bg-primary/60"
                          title={t('panel.dragToResize')}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((entry) => (
                  <tr
                    key={entry.key}
                    onClick={() => handleRowClick(entry)}
                    className={cn(
                      'group border-b border-border/50 cursor-pointer hover:bg-accent/40',
                      !entry.isPrefix && selected?.key === entry.key && 'bg-accent/60',
                    )}
                  >
                    <td className="px-3 py-1.5 overflow-hidden">
                      <span className="flex items-center gap-2 min-w-0">
                        {entry.isPrefix
                          ? <Folder className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                          : <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <span className="truncate">{entry.name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground overflow-hidden truncate">
                      {entry.isPrefix ? '—' : humanSize(entry.size)}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground overflow-hidden truncate">
                      {entry.lastModified ? new Date(entry.lastModified).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground overflow-hidden truncate">
                      {entry.isPrefix ? '' : (entry.storageClass || 'STANDARD')}
                    </td>
                    <td className="px-1 py-0.5 overflow-hidden">
                      {!entry.isPrefix && (
                        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <RowAction title={t('panel.download')} onClick={(e) => { e.stopPropagation(); downloadEntry(entry); }}>
                            <Download className="h-3.5 w-3.5" />
                          </RowAction>
                          <RowAction title={t('panel.copyPresignedUrl')} onClick={(e) => { e.stopPropagation(); presignEntry(entry); }}>
                            <Link2 className="h-3.5 w-3.5" />
                          </RowAction>
                          {canWrite && (
                            <RowAction title={t('common:delete')} destructive onClick={(e) => { e.stopPropagation(); setDeleteTarget(entry); }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </RowAction>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {listing?.isTruncated && listing.nextToken && (
            <div className="p-3 flex justify-center">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={loadingMore}
                onClick={() => load(listing.nextToken)}
              >
                {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                {t('panel.loadMore')}
              </Button>
            </div>
          )}
        </div>

        {/* Detail drawer */}
        {selected && (
          <div className="absolute right-0 top-0 bottom-0 w-[420px] max-w-[60vw] z-40 border-l bg-background shadow-xl flex flex-col">
            <header className="flex items-center justify-between px-3 py-2 border-b shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-mono truncate">{selected.name}</span>
              </div>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={closeDetail}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </header>

            <div className="flex-1 overflow-auto p-3 space-y-3">
              {metaLoading ? (
                <p className="text-xs text-muted-foreground italic">{t('detail.loadingMetadata')}</p>
              ) : (
                <div className="border rounded-md divide-y text-xs">
                  <MetaRow k={t('detail.metaKey')} v={selected.key} mono />
                  <MetaRow k={t('detail.metaSize')} v={`${humanSize(meta?.size ?? selected.size)} (${(meta?.size ?? selected.size).toLocaleString()} B)`} />
                  {meta?.contentType && <MetaRow k={t('detail.metaType')} v={meta.contentType} mono />}
                  {meta?.etag && <MetaRow k={t('detail.metaEtag')} v={meta.etag} mono />}
                  {(meta?.storageClass || selected.storageClass) && (
                    <MetaRow k={t('detail.metaClass')} v={meta?.storageClass || selected.storageClass || ''} />
                  )}
                  {(meta?.lastModified || selected.lastModified) && (
                    <MetaRow k={t('detail.metaModified')} v={new Date((meta?.lastModified || selected.lastModified)!).toLocaleString()} />
                  )}
                  {meta?.metadata && Object.keys(meta.metadata).length > 0 &&
                    Object.entries(meta.metadata).map(([k, v]) => (
                      <MetaRow key={k} k={t('detail.metaCustom', { key: k })} v={v} mono />
                    ))}
                </div>
              )}

              {presignUrl && (
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('detail.presignedUrlLabel')}</span>
                  <div className="flex items-center gap-1 mt-1">
                    <Input readOnly value={presignUrl} className="h-7 text-[11px] font-mono flex-1 min-w-0" onFocus={(e) => e.currentTarget.select()} />
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-7 w-7 shrink-0"
                      title={t('detail.copyUrl')}
                      onClick={() => { navigator.clipboard.writeText(presignUrl).catch(() => {}); toast({ title: t('toast.urlCopied') }); }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              {previewLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('detail.loadingPreview')}
                </div>
              ) : preview?.type === 'image' ? (
                <img src={preview.url} alt={selected.name} className="max-w-full rounded border" />
              ) : preview?.type === 'text' ? (
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-words border rounded-md p-2 bg-muted/30 max-h-[360px] overflow-auto">
                  {preview.text}
                </pre>
              ) : preview?.type === 'unsupported' ? (
                <p className="text-xs text-muted-foreground italic">{preview.reason}</p>
              ) : null}
            </div>

            <footer className="flex items-center gap-1.5 px-3 py-2 border-t shrink-0">
              <Button size="sm" variant="default" className="h-8 text-xs gap-1.5" onClick={handlePreview}>
                <Eye className="h-3.5 w-3.5" /> {t('detail.preview')}
              </Button>
              <Button size="sm" variant="secondary" className="h-8 text-xs gap-1.5" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" /> {t('panel.download')}
              </Button>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handlePresign} title={t('detail.presignedUrl')}>
                      <Link2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p className="text-xs">{t('detail.presignTooltip')}</p></TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleCopyKey} title={t('detail.copyKey')}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top"><p className="text-xs">{t('detail.copyKeyTooltip')}</p></TooltipContent>
                </Tooltip>
                <div className="flex-1" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={!canWrite}
                        onClick={() => setDeleteTarget(selected)}
                        title={t('common:delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">{canWrite ? t('detail.deleteObject') : t('panel.readOnlyWrite')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </footer>
          </div>
        )}
      </div>

      {/* New folder dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('panel.newFolder')}</DialogTitle>
          </DialogHeader>
          <div>
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={t('panel.folderNamePlaceholder')}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); }}
            />
            <p className="text-[10px] text-muted-foreground mt-1 font-mono break-all">
              {bucket}/{prefix}{newFolderName.trim().replace(/\/+$/, '')}/
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setNewFolderOpen(false)}>{t('common:cancel')}</Button>
            <Button onClick={handleCreateFolder} disabled={!newFolderName.trim() || busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t('dialog.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('panel.deleteObjectTitle', { name: deleteTarget?.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('panel.deleteObjectDescription')}
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
    </div>
  );
}

function WriteButton({
  canWrite, disabled, onClick, icon, label,
}: {
  canWrite: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  const { t } = useTranslation('s3');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 h-9"
            disabled={disabled || !canWrite}
            onClick={onClick}
          >
            {icon}
            <span className="text-xs">{label}</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">{canWrite ? label : t('panel.readOnlyWrite')}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function RowAction({
  title, onClick, destructive, children,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground',
        destructive && 'hover:text-destructive hover:bg-destructive/10',
      )}
    >
      {children}
    </button>
  );
}

function MetaRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="px-2 py-1.5 flex items-start gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground min-w-[72px] shrink-0 pt-px">{k}</span>
      <span className={cn('flex-1 break-all', mono && 'font-mono')}>{v}</span>
    </div>
  );
}

function CenterHint({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-full gap-2 text-xs text-muted-foreground p-8">
      {icon}
      {text}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
      <Cloud className="h-8 w-8 text-muted-foreground/40" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground max-w-sm">{body}</p>
    </div>
  );
}

function detectKind(key: string, contentType?: string): 'image' | 'text' | 'other' {
  const ct = (contentType || '').toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (
    ct.startsWith('text/') ||
    ct.includes('json') ||
    ct.includes('xml') ||
    ct.includes('javascript') ||
    ct.includes('csv')
  ) return 'text';
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return 'image';
  if (['txt', 'json', 'xml', 'csv', 'md', 'log', 'yaml', 'yml', 'html', 'htm', 'js', 'ts', 'tsx', 'css', 'sql', 'sh', 'env', 'ini', 'toml'].includes(ext)) return 'text';
  return 'other';
}

function humanSize(bytes: number): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}
