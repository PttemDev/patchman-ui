import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  RefreshCw,
  Link as LinkIcon,
  Loader2,
  GitBranch,
  ExternalLink,
  UploadCloud,
  FileText,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { collectionSyncAPI, gitIntegrationAPI, importAPI, type GitLabBinding } from '@/services/api';
import { useCollectionStore } from '@/stores/collectionStore';
import { useGitIntegrationStore } from '@/stores/gitIntegrationStore';
import { useAuthStore } from '@/stores/authStore';
import { GitLabConnectCard } from '@/components/settings/GitLabConnectCard';
import { toast } from '@/components/ui/use-toast';
import { detectImportFormat } from '@/lib/importers';
import type { AxiosError } from 'axios';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Collection } from '@/types';

type SyncFormatChoice = 'auto' | 'swagger' | 'postman';

interface SyncCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: Collection;
}

export function SyncCollectionDialog({
  open,
  onOpenChange,
  collection,
}: SyncCollectionDialogProps) {
  const { t } = useTranslation('collections');
  const { fetchCollections } = useCollectionStore();
  const mode = useAuthStore((s) => s.mode);
  const isAuthed = useAuthStore((s) => s.isAuthenticated);
  const gitlabStatus = useGitIntegrationStore((s) => s.status);
  const refreshGitlabStatus = useGitIntegrationStore((s) => s.refresh);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Merged "Source" tab state — URL or paste or file, format auto-detected.
  const [sourceUrl, setSourceUrl] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [formatChoice, setFormatChoice] = useState<SyncFormatChoice>('auto');

  // GitLab binding for this collection (null if not bound).
  const [binding, setBinding] = useState<GitLabBinding | null>(null);
  const [bindingLoading, setBindingLoading] = useState(false);

  const hasSourceUrl = !!collection.sourceUrl;
  const hasGitlabBinding = !!binding;

  // Fetch the binding (and refresh GitLab status) when the dialog opens.
  // Doing it on open instead of on mount keeps the call cheap — it only
  // fires when the user actually pulls up Update for this collection.
  useEffect(() => {
    if (!open || !isAuthed || mode === 'local') {
      return;
    }
    setBindingLoading(true);
    refreshGitlabStatus();
    gitIntegrationAPI
      .binding(collection.id)
      .then((res) => setBinding(res.data ?? null))
      .catch(() => setBinding(null))
      .finally(() => setBindingLoading(false));
  }, [open, isAuthed, mode, collection.id, refreshGitlabStatus]);

  // Pre-fill the source URL on open so the user doesn't have to retype
  // each time. We rely on the BE-managed `collection.sourceUrl` field —
  // every successful URL sync writes back to it, so it always reflects
  // the most recent successful URL for this collection. Stays correct
  // across devices and signed-in sessions; no localStorage hack.
  useEffect(() => {
    if (!open) return;
    setSourceUrl(collection.sourceUrl || '');
  }, [open, collection.id, collection.sourceUrl]);

  const handleRefresh = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    const tt = toast({
      title: t('tree.refreshingNamed', { name: collection.name }),
      description: t('sync.refreshingDesc'),
    });
    try {
      const res = await collectionSyncAPI.refresh(collection.id);
      const count = (res.data as { count: number }).count;
      const msg = t(count === 1 ? 'sync.refreshedCountOne' : 'sync.refreshedCountOther', { count });
      setSuccess(msg);
      tt.update({ id: tt.id, title: t('sync.refreshedTitle'), description: t(count === 1 ? 'requestsSyncedOne' : 'requestsSyncedOther', { count }) });
      fetchCollections();
    } catch (err: unknown) {
      let msg = t('tree.refreshFailed');
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } };
        msg = axiosErr.response?.data?.error || t('tree.refreshFailed');
      }
      setError(msg);
      tt.update({ id: tt.id, title: t('tree.refreshFailed'), description: msg, variant: 'destructive' });
    }
    setLoading(false);
  };

  // One submit path for the merged "Source" tab. Resolves URL via the
  // shared spec resolver (handles direct JSON, Scalar, Swagger UI,
  // Redoc), detects the resulting content's format (Postman vs.
  // OpenAPI), then dispatches to the matching BE sync endpoint.
  const handleSyncFromSource = async () => {
    setError('');
    setSuccess('');
    if (!sourceUrl.trim() && !pasteText.trim() && !sourceFile) {
      setError(t('sync.pasteOrDrop'));
      return;
    }
    setLoading(true);
    const tt = toast({
      title: sourceUrl.trim() ? t('import.lookingForSpec') : t('sync.parsingContent'),
      description: sourceUrl.trim()
        ? t('import.probing')
        : undefined,
    });
    try {
      let text = pasteText.trim();
      if (sourceFile) {
        text = await sourceFile.text();
      } else if (sourceUrl.trim()) {
        const res = await importAPI.resolveSpec(sourceUrl.trim());
        text = res.data.spec;
      }
      const detected = detectImportFormat(text);
      const fmt: SyncFormatChoice =
        formatChoice === 'auto'
          ? detected === 'postman'
            ? 'postman'
            : 'swagger'
          : formatChoice;

      // Pass the original user-typed URL so the BE stamps it on the
      // collection (source_url). Next dialog open will pre-fill from it.
      const stampUrl = sourceUrl.trim() || undefined;
      let count = 0;
      if (fmt === 'postman') {
        const parsed = JSON.parse(text);
        const res = await collectionSyncAPI.fromPostman(collection.id, parsed, stampUrl);
        count = (res.data as { count: number }).count;
      } else {
        const res = await collectionSyncAPI.fromJSON(collection.id, text, stampUrl);
        count = (res.data as { count: number }).count;
      }
      const msg = t(count === 1 ? 'sync.updatedCountOne' : 'sync.updatedCountOther', { count });
      setSuccess(msg);
      // Leave sourceUrl filled — it's the URL we just used, and a
      // re-sync usually wants the same URL. Clear paste/file because
      // those represent a one-off action, not a remembered source. The
      // BE Sync handler stamps collection.source_url on every URL sync
      // so fetchCollections() ensures the next dialog open gets the
      // canonical value if the user closes and reopens.
      setPasteText('');
      setSourceFile(null);
      fetchCollections();
      tt.update({ id: tt.id, title: t('sync.updatedTitle'), description: msg });
    } catch (err: unknown) {
      let msg = t('sync.failed');
      if (err instanceof SyntaxError) msg = t('import.invalidJson');
      else if (err && typeof err === 'object' && 'response' in err) {
        const ax = err as AxiosError<{ error?: string }>;
        msg = ax.response?.data?.error || ax.message || t('sync.failed');
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
      tt.update({ id: tt.id, title: t('sync.failed'), description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const detectedSourceFormat = useMemo(() => {
    if (!pasteText.trim()) return null;
    return detectImportFormat(pasteText);
  }, [pasteText]);

  const handleSyncFromGitLab = async () => {
    if (!binding) return;
    setLoading(true);
    setError('');
    setSuccess('');
    const tt = toast({ title: t('sync.pullingGitlab'), description: t('sync.pullingDesc') });
    try {
      const res = await gitIntegrationAPI.refresh(collection.id);
      const count = res.data.count;
      setSuccess(t(count === 1 ? 'sync.pulledCountOne' : 'sync.pulledCountOther', { count }));
      setBinding(res.data.binding);
      fetchCollections();
      tt.update({
        id: tt.id,
        title: t('sync.pulledTitle'),
        description: t(count === 1 ? 'requestsSyncedOne' : 'requestsSyncedOther', { count }),
      });
    } catch (err: unknown) {
      const ax = err as AxiosError<{ error?: string }>;
      const msg = ax.response?.data?.error || ax.message || t('sync.gitlabRefreshFailed');
      setError(msg);
      tt.update({ id: tt.id, title: t('sync.pullFailed'), description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setError('');
      setSuccess('');
    }
    onOpenChange(v);
  };

  // GitLab binding wins over generic source URL — if the collection came
  // from GitLab, that's the most recently used path and the one push will
  // write back to.
  const defaultTab = hasGitlabBinding ? 'gitlab' : hasSourceUrl ? 'refresh' : 'source';
  // Pre-filled URL for the GitLab tab — reconstructed from the binding so
  // it matches the original `/-/blob/` link the user pasted.
  const bindingUrl = binding
    ? `${binding.baseUrl.replace(/\/+$/, '')}/${binding.projectId}/-/blob/${binding.branch}/${binding.filePath}`
    : '';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('sync.title')}</DialogTitle>
          <DialogDescription>
            {t('sync.description', { name: collection.name })}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 rounded-md bg-green-500/10 text-green-600 dark:text-green-400 text-sm">
            {success}
          </div>
        )}

        <Tabs key={defaultTab} defaultValue={defaultTab} className="w-full">
          {/* Hide the tab strip when there's only the source mode — no
              point in a single-button tab bar; collapse straight to the
              content. The list re-appears as soon as Refresh or GitLab
              also have something to offer. */}
          {(hasGitlabBinding || hasSourceUrl) && (
            <TabsList
              className={cn(
                'grid w-full',
                hasGitlabBinding && hasSourceUrl ? 'grid-cols-3' : 'grid-cols-2',
              )}
            >
              {hasGitlabBinding && (
                <TabsTrigger value="gitlab" className="text-xs">
                  <GitBranch className="h-3 w-3 mr-1" />
                  GitLab
                </TabsTrigger>
              )}
              {hasSourceUrl && (
                <TabsTrigger value="refresh" className="text-xs">
                  <RefreshCw className="h-3 w-3 mr-1" />
                  {t('common:refresh')}
                </TabsTrigger>
              )}
              <TabsTrigger value="source" className="text-xs">
                <LinkIcon className="h-3 w-3 mr-1" />
                {t('sync.tabSource')}
              </TabsTrigger>
            </TabsList>
          )}

          {hasGitlabBinding && (
            <TabsContent value="gitlab" className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {t('sync.gitlabTabDesc')}
              </div>
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  <span className="font-medium text-foreground">{binding!.projectId}</span>
                  <span>·</span>
                  <span>{t('sync.branchPrefix')} <span className="font-medium text-foreground">{binding!.branch}</span></span>
                </div>
                <div className="text-[11px] font-mono break-all text-muted-foreground">{binding!.filePath}</div>
                <a
                  href={bindingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {t('sync.openOnGitlab')}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              {!gitlabStatus ? (
                // Edge case — collection has a binding but the user is no
                // longer linked (token revoked, switched users). Re-prompt
                // for connect inline rather than failing on submit.
                <div className="rounded-md border p-3">
                  <div className="text-sm font-medium mb-2">{t('sync.reconnectGitlab')}</div>
                  <GitLabConnectCard variant="embedded" />
                </div>
              ) : (
                <Button onClick={handleSyncFromGitLab} disabled={loading} className="w-full">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  {t('sync.pullFromGitlab')}
                </Button>
              )}
            </TabsContent>
          )}

          {hasSourceUrl && (
            <TabsContent value="refresh" className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {t('sync.refetchFromUrl')}
              </div>
              <div className="p-2 rounded bg-muted text-xs font-mono break-all">
                {collection.sourceUrl}
              </div>
              {collection.lastSynced && (
                <div className="text-xs text-muted-foreground">
                  {t('sync.lastSynced', { date: new Date(collection.lastSynced).toLocaleString() })}
                </div>
              )}
              <Button onClick={handleRefresh} disabled={loading} className="w-full">
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                {t('common:refresh')}
              </Button>
            </TabsContent>
          )}

          <TabsContent value="source" className="space-y-3">
            {/* Format-aware inputs bundled together: URL goes through
                the spec resolver (Scalar / Swagger UI / Redoc / direct
                JSON). Paste box accepts OpenAPI or Postman v2.1 — auto
                detected from content; the format dropdown is for the
                rare case detection misfires. */}
            <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs shrink-0">{t('import.format')}</Label>
                <Select value={formatChoice} onValueChange={(v) => setFormatChoice(v as SyncFormatChoice)}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      {t('import.autoDetect')}{detectedSourceFormat === 'postman' ? ' · Postman' : detectedSourceFormat === 'swagger' ? ' · OpenAPI' : ''}
                    </SelectItem>
                    <SelectItem value="swagger">OpenAPI / Swagger</SelectItem>
                    <SelectItem value="postman">Postman Collection v2.1</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="source-url" className="flex items-center gap-1.5 text-xs">
                  <LinkIcon className="h-3.5 w-3.5" />
                  {t('import.fetchFromUrl')}
                  {sourceUrl && (
                    <span className="ml-auto text-[10px] text-muted-foreground font-normal">{t('sync.prefilled')}</span>
                  )}
                </Label>
                <Input
                  id="source-url"
                  placeholder={t('import.urlPlaceholder')}
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  disabled={pasteText.trim().length > 0 || !!sourceFile}
                />
                <p className="text-[10px] text-muted-foreground leading-snug">
                  <Trans
                    t={t}
                    i18nKey="import.urlHint"
                    components={{ code: <code className="text-[10px]" /> }}
                  />
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="source-paste" className="text-xs">{t('import.orPasteJson')}</Label>
                <Textarea
                  id="source-paste"
                  placeholder={t('sync.pastePlaceholder')}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={6}
                  className="font-mono text-xs"
                  disabled={sourceUrl.trim().length > 0 || !!sourceFile}
                />
              </div>
            </div>

            {/* File drop sits below a divider — same pattern as the
                Import dialog. Per-file detection means the format
                selector above doesn't have to apply to it. */}
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div className="flex-1 h-px bg-border" />
              <span>{t('sync.orUploadFile')}</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <SyncFileDropzone
              file={sourceFile}
              onFile={(f) => {
                setSourceFile(f);
                if (f) {
                  setSourceUrl('');
                  setPasteText('');
                }
              }}
            />

            <Button
              onClick={handleSyncFromSource}
              disabled={loading || (!sourceUrl.trim() && !pasteText.trim() && !sourceFile)}
              className="w-full"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              {t('sync.title')}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// Single-file dropzone for the Update Collection dialog. Compact —
// duplicates a fraction of the larger Import dialog dropzone but keeps
// this dialog's bundle size down without a cross-component import.
function SyncFileDropzone({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  const { t } = useTranslation('collections');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files || []);
    const accepted = dropped.find((f) => /\.(json|ya?ml)$/i.test(f.name));
    if (accepted) onFile(accepted);
  };

  if (file) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/20 text-xs">
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 truncate">{file.name}</span>
        <span className="text-muted-foreground shrink-0">{Math.ceil(file.size / 1024)} KB</span>
        <button
          type="button"
          onClick={() => onFile(null)}
          className="p-0.5 rounded hover:bg-muted"
          aria-label={t('import.removeFile')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragOver(false);
      }}
      onDrop={handleDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed py-5 px-4 text-center cursor-pointer transition-colors outline-none',
        dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60 hover:bg-muted/40',
      )}
    >
      <UploadCloud className={cn('h-5 w-5', dragOver ? 'text-primary' : 'text-muted-foreground')} />
      <p className="text-xs">{dragOver ? t('sync.dropToUse') : t('import.dragDrop')}</p>
      <p className="text-[10px] text-muted-foreground">.json · .yaml · .yml · <span className="underline">{t('import.browse')}</span></p>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.yaml,.yml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
