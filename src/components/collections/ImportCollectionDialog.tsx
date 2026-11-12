// Unified Import dialog. Two tabs:
//  - "File / URL / Paste" — accepts PatchMan, Postman v2.1, or OpenAPI in
//    any of those input modes; the format is auto-detected from content
//    with a manual override dropdown when detection is ambiguous.
//  - "GitLab" — separate flow because it goes through the BE OAuth-bound
//    integration endpoint instead of parsing locally.
//
// Multi-file is supported by dropping more than one file: each file is
// detected and parsed individually so a single drop can mix formats (e.g.
// pulling a folder of vendor Postman exports).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Loader2,
  FileText,
  UploadCloud,
  Link as LinkIcon,
  X,
  CheckCircle2,
  AlertCircle,
  GitBranch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { gitlabBaseUrl } from '@/lib/tenant';
import { useCollectionStore } from '@/stores/collectionStore';
import { useGitIntegrationStore } from '@/stores/gitIntegrationStore';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore, resolveWorkspaceFilter } from '@/stores/workspaceStore';
import { getRepo } from '@/data';
import { gitIntegrationAPI, importAPI } from '@/services/api';
import {
  parsePatchman,
  parsePostman,
  parseSwagger,
  persistParsedImport,
  detectImportFormat,
  type ImportFormat,
} from '@/lib/importers';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GitLabConnectCard } from '@/components/settings/GitLabConnectCard';
import { toast } from '@/components/ui/use-toast';
import type { AxiosError } from 'axios';

interface ImportCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FormatChoice = 'auto' | ImportFormat;

type ImportResult = {
  imported: Array<{ source: string; collectionId: string; name: string; requestCount: number }>;
  failed: Array<{ source: string; error: string }>;
};

const FORMAT_LABELS: Record<ImportFormat, string> = {
  patchman: 'PatchMan JSON',
  postman: 'Postman v2.1',
  swagger: 'OpenAPI / Swagger',
  wsdl: 'WSDL / SOAP',
};

export function ImportCollectionDialog({ open, onOpenChange }: ImportCollectionDialogProps) {
  const { t } = useTranslation('collections');
  const { fetchCollections } = useCollectionStore();
  const mode = useAuthStore((s) => s.mode);
  const isAuthed = useAuthStore((s) => s.isAuthenticated);
  const activeWorkspaceId = useWorkspaceStore((s) => resolveWorkspaceFilter(s.activeWorkspaceId));
  const gitlabStatus = useGitIntegrationStore((s) => s.status);
  const refreshGitlab = useGitIntegrationStore((s) => s.refresh);

  // Unified-tab state: drop-or-paste-or-URL with auto-detect + override.
  const [files, setFiles] = useState<File[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [specUrl, setSpecUrl] = useState('');
  const [formatChoice, setFormatChoice] = useState<FormatChoice>('auto');

  // GitLab-tab state.
  const [gitlabUrl, setGitlabUrl] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [activeTab, setActiveTab] = useState('import');

  useEffect(() => {
    if (open && isAuthed && mode !== 'local') {
      refreshGitlab();
    }
  }, [open, isAuthed, mode, refreshGitlab]);

  const resetState = () => {
    setFiles([]);
    setPasteText('');
    setSpecUrl('');
    setFormatChoice('auto');
    setGitlabUrl('');
    setError('');
    setResult(null);
  };

  const handleClose = (next: boolean) => {
    if (!next) resetState();
    onOpenChange(next);
  };

  // Live detection from the paste box. Files get per-file detection at
  // import time so we don't have to read every file just to populate the
  // dropdown.
  const detectedFromPaste = useMemo(() => {
    if (!pasteText.trim()) return null;
    return detectImportFormat(pasteText);
  }, [pasteText]);
  // Single-file drop: peek at filename extension to display the detected
  // format pill before the user clicks Import. JSON/YAML hint distinguishes
  // OpenAPI (only common YAML format here).
  const detectedFromFiles = useMemo<ImportFormat | null>(() => {
    if (files.length !== 1) return null;
    const name = files[0].name.toLowerCase();
    if (name.endsWith('.yaml') || name.endsWith('.yml')) return 'swagger';
    return null;
  }, [files]);
  const detectedFormat: ImportFormat | null = detectedFromPaste ?? detectedFromFiles;
  const effectiveFormat: ImportFormat | null =
    formatChoice === 'auto' ? detectedFormat : formatChoice;

  const handleFilesAppend = (incoming: File[]) => {
    if (incoming.length === 0) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size));
      const merged = [...prev];
      for (const f of incoming) if (!seen.has(f.name + f.size)) merged.push(f);
      return merged;
    });
    setError('');
    setResult(null);
  };

  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const parseByFormat = async (text: string, format: ImportFormat, sourceURL?: string) => {
    if (format === 'patchman') return parsePatchman(text);
    if (format === 'postman') return parsePostman(text);
    return parseSwagger(text, sourceURL);
  };

  const handleImport = async () => {
    setError('');
    setResult(null);

    // 1. Files take priority — supports bulk + per-file format detection.
    if (files.length > 0) {
      setLoading(true);
      const out: ImportResult = { imported: [], failed: [] };
      const repo = getRepo();
      for (const file of files) {
        try {
          const text = await file.text();
          const fmt: ImportFormat | null =
            formatChoice !== 'auto'
              ? formatChoice
              : detectImportFormat(text) ??
                (file.name.toLowerCase().match(/\.ya?ml$/) ? 'swagger' : null);
          if (!fmt) {
            out.failed.push({
              source: file.name,
              error: t('import.couldNotDetect'),
            });
            continue;
          }
          if (fmt === 'wsdl') {
            if (mode === 'local') {
              out.failed.push({ source: file.name, error: t('import.wsdlNeedsBackend') });
              continue;
            }
            const bulk = await importAPI.importWSDL({ content: text, workspaceId: activeWorkspaceId || undefined });
            out.imported.push({
              source: file.name,
              collectionId: bulk.data.collection?.id,
              name: bulk.data.collection?.name || t('import.importedWsdl'),
              requestCount: bulk.data.count || 0,
            });
            continue;
          }
          const parsed = await parseByFormat(text, fmt);
          const { collection, requestCount } = await persistParsedImport(parsed, repo, {
            workspaceId: activeWorkspaceId || undefined,
          });
          out.imported.push({
            source: file.name,
            collectionId: collection.id,
            name: collection.name,
            requestCount,
          });
        } catch (err: unknown) {
          out.failed.push({
            source: file.name,
            error: err instanceof Error ? err.message : extractError(err, t('import.failed')),
          });
        }
      }
      setResult(out);
      if (out.imported.length > 0) await fetchCollections();
      if (out.failed.length === 0) setFiles([]);
      setLoading(false);
      return;
    }

    // 2. URL — could be a direct JSON spec OR a Scalar / Swagger UI /
    //    Redoc page. The BE resolver scrapes either, so we always go
    //    through it. Surface a "searching" toast first because the
    //    resolver may probe several candidate URLs and that takes a
    //    second or two on slow networks.
    if (specUrl.trim()) {
      setLoading(true);
      const url0 = specUrl.trim();
      // WSDL is not an OpenAPI page — skip the resolver and let the BE fetch
      // + parse it directly. Triggered by the format override or a .wsdl/?wsdl URL.
      const looksWsdl =
        formatChoice === 'wsdl' || /\.wsdl(\?|$)/i.test(url0) || /[?&]wsdl(=|&|$)/i.test(url0);
      if (looksWsdl) {
        const tw = toast({ title: t('import.importingWsdl'), description: t('import.wsdlFetching') });
        try {
          if (mode === 'local') throw new Error(t('import.wsdlNeedsBackend'));
          const bulk = await importAPI.importWSDL({ url: url0, workspaceId: activeWorkspaceId || undefined });
          await fetchCollections();
          const wCount = bulk.data.count || 0;
          tw.update({
            id: tw.id,
            title: t('import.imported'),
            description: `${bulk.data.collection?.name || t('import.importedWsdl')} · ${t(wCount === 1 ? 'requestsCountOne' : 'requestsCountOther', { count: wCount })}`,
          });
          resetState();
          onOpenChange(false);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : extractError(err, t('import.failed'));
          setError(msg);
          tw.update({ id: tw.id, title: t('import.failed'), description: msg, variant: 'destructive' });
        } finally {
          setLoading(false);
        }
        return;
      }
      const tt = toast({
        title: t('import.lookingForSpec'),
        description: t('import.probing'),
      });
      try {
        const url = specUrl.trim();
        const res = await importAPI.resolveSpec(url);
        const text = res.data.spec;
        const fmt: ImportFormat = formatChoice !== 'auto'
          ? formatChoice
          : (detectImportFormat(text) ?? 'swagger');
        // Stamp the *user-typed* URL on the collection (not the
        // resolved one) so a future Update Collection dialog pre-fills
        // with what they actually pasted — clearer mental model than
        // showing a server-resolved path the user never typed. The
        // resolver will figure it out again on next sync.

        // Synced-mode + Swagger: skip FE parsing entirely and let the
        // BE persist root + folders + every operation in one
        // transaction. A real-world spec (Swashbuckle BFF, ~250 ops)
        // turned into 200+ POST /api/requests roundtrips through the
        // generic CRUD path; this collapses to a single POST. Local
        // mode falls back to the FE parse + per-row persist path
        // because there's no BE to call.
        let collectionName = '';
        let requestCount = 0;
        if (mode !== 'local' && fmt === 'swagger') {
          const bulk = await importAPI.importSwaggerJSON(text, {
            sourceUrl: url,
            workspaceId: activeWorkspaceId || undefined,
          });
          collectionName = bulk.data.collection?.name || t('import.imported');
          requestCount = bulk.data.count || 0;
        } else {
          const parsed = await parseByFormat(text, fmt, url);
          const out = await persistParsedImport(parsed, getRepo(), {
            workspaceId: activeWorkspaceId || undefined,
          });
          collectionName = out.collection.name;
          requestCount = out.requestCount;
        }
        await fetchCollections();
        tt.update({
          id: tt.id,
          title: t('import.imported'),
          description: `${collectionName} · ${t(requestCount === 1 ? 'requestsCountOne' : 'requestsCountOther', { count: requestCount })} (${res.data.source})`,
        });
        resetState();
        onOpenChange(false);
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : extractError(err, t('import.failed'));
        setError(msg);
        tt.update({ id: tt.id, title: t('import.failed'), description: msg, variant: 'destructive' });
      } finally {
        setLoading(false);
      }
      return;
    }

    // 3. Paste box.
    if (pasteText.trim()) {
      setLoading(true);
      try {
        const text = pasteText.trim();
        const fmt = formatChoice !== 'auto' ? formatChoice : detectImportFormat(text);
        if (!fmt) {
          setError(t('import.couldNotDetect'));
          return;
        }
        if (fmt === 'wsdl') {
          if (mode === 'local') throw new Error(t('import.wsdlNeedsBackend'));
          await importAPI.importWSDL({ content: text, workspaceId: activeWorkspaceId || undefined });
          await fetchCollections();
          resetState();
          onOpenChange(false);
          return;
        }
        const parsed = await parseByFormat(text, fmt);
        await persistParsedImport(parsed, getRepo(), { workspaceId: activeWorkspaceId || undefined });
        await fetchCollections();
        resetState();
        onOpenChange(false);
      } catch (err: unknown) {
        if (err instanceof SyntaxError) setError(t('import.invalidJson'));
        else setError(err instanceof Error ? err.message : extractError(err, t('import.failed')));
      } finally {
        setLoading(false);
      }
      return;
    }

    setError(t('import.dropOrPaste'));
  };

  const handleGitlabImport = async () => {
    if (!gitlabStatus) {
      setError(t('import.connectGitlabFirst'));
      return;
    }
    if (!gitlabUrl.trim()) {
      setError(t('import.pasteGitlabUrl'));
      return;
    }
    setLoading(true);
    setError('');
    const tt = toast({ title: t('import.importingGitlab'), description: t('import.fetchingFile') });
    try {
      const res = await gitIntegrationAPI.import({ url: gitlabUrl.trim() });
      await fetchCollections();
      const name = res.data?.collection?.name || t('import.collectionFallback');
      const gCount = res.data?.count ?? 0;
      tt.update({
        id: tt.id,
        title: t('import.importedFromGitlab'),
        description: `${name} · ${t(gCount === 1 ? 'requestsCountOne' : 'requestsCountOther', { count: gCount })}`,
      });
      resetState();
      onOpenChange(false);
    } catch (err: unknown) {
      const ax = err as AxiosError<{ error?: string }>;
      const msg = ax.response?.data?.error || ax.message || t('import.gitlabFailed');
      setError(msg);
      tt.update({ id: tt.id, title: t('import.failed'), description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const importDisabled =
    loading ||
    (files.length === 0 && !pasteText.trim() && !specUrl.trim());

  const footerHandler = activeTab === 'gitlab' ? handleGitlabImport : handleImport;
  const footerDisabled =
    activeTab === 'gitlab'
      ? loading || !gitlabStatus || !gitlabUrl.trim()
      : importDisabled;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t('import.title')}</DialogTitle>
          <DialogDescription>
            {t('import.description')}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setError(''); }}>
          <TabsList className="w-full">
            <TabsTrigger value="import" className="flex-1">{t('import.tabFile')}</TabsTrigger>
            <TabsTrigger value="gitlab" className="flex-1">{t('import.tabGitlab')}</TabsTrigger>
          </TabsList>

          <TabsContent value="import">
            <div className="grid gap-3 py-2">
              {/* Format-aware inputs are bundled together: the Format
                  selector applies to both URL and paste, so they read
                  as one decision. The file dropzone sits below a
                  separator because per-file detection makes a global
                  format choice less relevant. */}
              <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-3">
                {/* Format selector */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs shrink-0">{t('import.format')}</Label>
                  <Select value={formatChoice} onValueChange={(v) => setFormatChoice(v as FormatChoice)}>
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        {t('import.autoDetect')}{detectedFormat ? ` · ${FORMAT_LABELS[detectedFormat]}` : ''}
                      </SelectItem>
                      <SelectItem value="patchman">PatchMan JSON</SelectItem>
                      <SelectItem value="postman">Postman Collection v2.1</SelectItem>
                      <SelectItem value="swagger">OpenAPI / Swagger</SelectItem>
                      <SelectItem value="wsdl">WSDL / SOAP</SelectItem>
                    </SelectContent>
                  </Select>
                  {formatChoice === 'auto' && pasteText.trim() && !detectedFormat && (
                    <span className="text-[11px] text-yellow-500 shrink-0">{t('import.unknownPickManually')}</span>
                  )}
                </div>

                {/* URL — accepts direct JSON spec URLs OR docs UI pages
                    (Scalar / Swagger UI / Redoc). The BE resolver
                    figures out where the actual spec lives. */}
                <div className="grid gap-1.5">
                  <Label htmlFor="spec-url" className="flex items-center gap-1.5 text-xs">
                    <LinkIcon className="h-3.5 w-3.5" />
                    {t('import.fetchFromUrl')}
                  </Label>
                  <Input
                    id="spec-url"
                    value={specUrl}
                    onChange={(e) => {
                      setSpecUrl(e.target.value);
                      setError('');
                    }}
                    placeholder={t('import.urlPlaceholder')}
                    disabled={files.length > 0 || pasteText.trim().length > 0}
                  />
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    <Trans
                      t={t}
                      i18nKey="import.urlHint"
                      components={{ code: <code className="text-[10px]" /> }}
                    />
                  </p>
                </div>

                {/* Paste */}
                <div className="grid gap-1.5">
                  <Label htmlFor="paste-json" className="text-xs">{t('import.orPasteJson')}</Label>
                  <Textarea
                    id="paste-json"
                    value={pasteText}
                    onChange={(e) => {
                      setPasteText(e.target.value);
                      setError('');
                    }}
                    placeholder={t('import.pastePlaceholder')}
                    rows={6}
                    className="font-mono text-xs"
                    disabled={files.length > 0 || specUrl.trim().length > 0}
                  />
                </div>
              </div>

              {/* Visual separator: file drop is its own input mode and
                  doesn't share the format selector above (per-file
                  detection runs at submit time). The line + label
                  cue makes that boundary obvious. */}
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <div className="flex-1 h-px bg-border" />
                <span>{t('import.orUploadFiles')}</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              <FileDropzone
                accept=".json,.yaml,.yml"
                multiple
                onFiles={handleFilesAppend}
                title={t('import.dragDrop')}
                hint={t('import.dropzoneHintMulti')}
                browseLabel={t('import.browse')}
                dropLabel={t('import.dropToUpload')}
                clearLabel={t('import.clearSelection')}
                selectedSummary={
                  files.length === 0
                    ? null
                    : t(files.length === 1 ? 'import.filesReadyOne' : 'import.filesReadyOther', { count: files.length })
                }
              />

              {files.length > 0 && (
                <div className="border rounded-md divide-y max-h-44 overflow-auto">
                  {files.map((f, idx) => (
                    <div key={f.name + f.size + idx} className="flex items-center gap-2 px-2 py-1.5 text-xs">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="text-muted-foreground shrink-0">{formatSize(f.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(idx)}
                        className="p-0.5 rounded hover:bg-muted"
                        aria-label={t('import.removeFile')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {result && (
                <div className="grid gap-1.5 text-xs">
                  {result.imported.map((i) => (
                    <div key={i.collectionId} className="flex items-center gap-2 text-green-600 dark:text-green-500">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{i.source}</span>
                      <span className="text-muted-foreground ml-auto shrink-0">
                        {i.name} · {t(i.requestCount === 1 ? 'requestsCountOne' : 'requestsCountOther', { count: i.requestCount })}
                      </span>
                    </div>
                  ))}
                  {result.failed.map((f, idx) => (
                    <div key={f.source + idx} className="flex items-center gap-2 text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{f.source}</span>
                      <span className="ml-auto shrink-0 truncate max-w-[50%]" title={f.error}>{f.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="gitlab">
            <div className="grid gap-3 py-2">
              {mode === 'local' ? (
                <div className="rounded-md border p-3 text-sm text-muted-foreground">
                  {t('import.gitlabSignIn')}
                </div>
              ) : !gitlabStatus ? (
                <div className="rounded-md border p-3">
                  <div className="flex items-start gap-3 mb-3">
                    <GitBranch className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{t('import.connectGitlabTitle')}</div>
                      <div className="text-xs text-muted-foreground">
                        {t('import.connectGitlabDesc')}
                      </div>
                    </div>
                  </div>
                  <GitLabConnectCard variant="embedded" />
                </div>
              ) : (
                <>
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    <span className="text-muted-foreground">{t('import.importingAs')}</span>
                    <span className="font-medium">@{gitlabStatus.gitlabUsername}</span>
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="gitlab-url" className="flex items-center gap-1.5 text-xs">
                      <LinkIcon className="h-3.5 w-3.5" />
                      {t('import.gitlabFileUrl')}
                    </Label>
                    <Input
                      id="gitlab-url"
                      value={gitlabUrl}
                      onChange={(e) => {
                        setGitlabUrl(e.target.value);
                        setError('');
                      }}
                      placeholder={`${gitlabBaseUrl()}/group/repo/-/blob/main/path/to/file.postman_collection.json`}
                    />
                    <p className="text-xs text-muted-foreground">
                      <Trans
                        t={t}
                        i18nKey="import.gitlabUrlHint"
                        components={{ code: <code className="text-[11px]" /> }}
                      />
                    </p>
                  </div>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={loading}>
            {result && result.imported.length > 0 ? t('common:close') : t('common:cancel')}
          </Button>
          <Button onClick={footerHandler} disabled={footerDisabled}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t('import.import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────────
// FileDropzone — drag/drop + click-to-browse area.
// ──────────────────────────────────────────────────────────────
interface FileDropzoneProps {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  hint?: string;
  compact?: boolean;
  disabled?: boolean;
  selectedSummary?: string | null;
  onClear?: () => void;
  browseLabel: string;
  dropLabel: string;
  clearLabel: string;
}

function FileDropzone({
  accept,
  multiple,
  onFiles,
  title,
  hint,
  compact,
  disabled,
  selectedSummary,
  onClear,
  browseLabel,
  dropLabel,
  clearLabel,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);

  const acceptList = accept
    ? accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];

  const filterAccepted = (files: File[]) => {
    if (acceptList.length === 0) return files;
    return files.filter((f) => acceptList.some((ext) => f.name.toLowerCase().endsWith(ext)));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragOver(false);
    if (disabled) return;
    const dropped = Array.from(e.dataTransfer.files || []);
    const files = filterAccepted(dropped);
    if (files.length) onFiles(files);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    dragDepth.current += 1;
    setDragOver(true);
  };

  const handleDragLeave = () => {
    if (disabled) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };

  const openPicker = () => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={openPicker}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) e.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-disabled={disabled}
      className={cn(
        'relative flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed text-center transition-colors outline-none',
        compact ? 'py-6 px-4' : 'py-8 px-6',
        disabled
          ? 'opacity-50 cursor-not-allowed border-border'
          : 'cursor-pointer hover:border-primary/60 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring',
        dragOver && !disabled ? 'border-primary bg-primary/5' : !disabled ? 'border-border' : '',
      )}
    >
      <UploadCloud
        className={cn(
          'h-7 w-7 transition-colors',
          dragOver && !disabled ? 'text-primary' : 'text-muted-foreground',
        )}
      />
      <p className="text-sm font-medium">
        {dragOver && !disabled ? dropLabel : title}
      </p>
      <p className="text-xs text-muted-foreground">
        {hint ? <>{hint} · </> : null}
        <span className="underline underline-offset-2">{browseLabel}</span>
      </p>
      {selectedSummary && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-foreground/80">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate max-w-[320px]">{selectedSummary}</span>
          {onClear && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="p-0.5 rounded hover:bg-muted"
              aria-label={clearLabel}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function extractError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    return (err as { response: { data: { error?: string } } }).response?.data?.error || fallback;
  }
  return fallback;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
