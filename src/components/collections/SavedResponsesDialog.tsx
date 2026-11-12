import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search, Loader2, ExternalLink, Play, Trash2, Copy, Download, Pencil, Check, X, Archive, Clock, HardDrive, User, FolderOpen,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { useToast } from '@/components/ui/use-toast';
import { getRepo } from '@/data';
import { useSavedResponsesUI } from '@/stores/savedResponsesUIStore';
import { useThemeStore } from '@/stores/themeStore';
import { cn } from '@/lib/utils';
import type { KeyValue, SavedResponseDetail, SavedResponseSummary } from '@/types';
import { METHOD_COLORS, flattenCollections, humanBytes, openSavedRequest, statusTone } from './savedResponsesUtil';

// "Saved responses" of a collection (and every folder in it): the list on
// the left, the selected request and its response on the right. A saved
// request re-opens in a new tab with every parameter it had; the author or a
// collection editor can rename or delete it.

function relativeTime(iso: string, lng: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lng, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString(lng);
}

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  const k = Object.keys(headers ?? {}).find((h) => h.toLowerCase() === name);
  return k ? headers![k] : '';
}

function bodyView(body: string, contentType: string): { text: string; language: string } {
  const ct = contentType.toLowerCase();
  const trimmed = body.trim();
  if (ct.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return { text: JSON.stringify(JSON.parse(trimmed), null, 2), language: 'json' }; } catch { /* not JSON */ }
  }
  if (ct.includes('xml') || trimmed.startsWith('<?xml')) return { text: body, language: 'xml' };
  if (ct.includes('html')) return { text: body, language: 'html' };
  return { text: body, language: 'plaintext' };
}

export function SavedResponsesDialog() {
  const { t, i18n } = useTranslation(['collections', 'common']);
  const { toast } = useToast();
  const { open, title, collectionIds, focusId, requestId, close } = useSavedResponsesUI();
  const [items, setItems] = useState<SavedResponseSummary[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, SavedResponseDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SavedResponseSummary | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const list = await getRepo().savedResponses.list(collectionIds, requestId);
      setItems(list);
      setSelected((cur) => cur && list.some((x) => x.id === cur) ? cur : (focusId && list.some((x) => x.id === focusId) ? focusId : list[0]?.id ?? null));
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } }; message?: string };
      setError(ax.response?.data?.error || ax.message || t('saved.loadFailed'));
      setItems([]);
    }
  }, [collectionIds, focusId, requestId, t]);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setDetails({});
    setQuery('');
    setSelected(focusId ?? null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, collectionIds, requestId]);

  useEffect(() => {
    if (!open || !selected || details[selected]) return;
    let cancelled = false;
    setLoadingDetail(true);
    getRepo().savedResponses.get(selected)
      .then((d) => { if (!cancelled) setDetails((m) => ({ ...m, [selected]: d })); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingDetail(false); });
    return () => { cancelled = true; };
  }, [open, selected, details]);

  const folderNames = useMemo(() => (open ? new Map(flattenCollections().map((f) => [f.id, f.path])) : new Map<string, string>()), [open]);
  const q = query.trim().toLowerCase();
  const filtered = (items ?? []).filter((x) => !q || x.name.toLowerCase().includes(q) || x.url.toLowerCase().includes(q) || String(x.statusCode).startsWith(q) || x.method.toLowerCase() === q);
  const detail = selected ? details[selected] : undefined;
  const summary = items?.find((x) => x.id === selected);

  const remove = async () => {
    if (!confirmDelete) return;
    try {
      await getRepo().savedResponses.remove(confirmDelete.id);
      setItems((list) => (list ?? []).filter((x) => x.id !== confirmDelete.id));
      if (selected === confirmDelete.id) setSelected(null);
      toast({ title: t('saved.deleted') });
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } }; message?: string };
      toast({ title: t('saved.deleteFailed'), description: ax.response?.data?.error || ax.message, variant: 'destructive' });
    }
    setConfirmDelete(null);
  };

  const rename = async (id: string, name: string) => {
    await getRepo().savedResponses.rename(id, name);
    setItems((list) => (list ?? []).map((x) => (x.id === id ? { ...x, name } : x)));
    setDetails((m) => (m[id] ? { ...m, [id]: { ...m[id], name } } : m));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="w-[94vw] max-w-[1280px] sm:max-w-[1280px] h-[86vh] p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Archive className="h-4 w-4 text-primary" /> {t('saved.title')}
              <span className="text-muted-foreground font-normal truncate">· {title}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">{requestId ? t('saved.descriptionRequest') : t('saved.description')}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 grid grid-cols-[minmax(260px,340px)_1fr]">
            <div className="border-r flex flex-col min-h-0">
              <div className="p-2 border-b">
                <div className="relative">
                  <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('saved.search')} className="h-8 text-xs pl-7" />
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {items === null ? (
                  <div className="h-32 flex items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                ) : error ? (
                  <div className="p-4 text-xs text-destructive">{error}</div>
                ) : filtered.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground space-y-1">
                    <Archive className="h-6 w-6 mx-auto opacity-40" />
                    <div>{items.length === 0 ? t('saved.empty') : t('saved.noMatch')}</div>
                    {items.length === 0 && <div className="text-[11px] opacity-80">{t('saved.emptyHint')}</div>}
                  </div>
                ) : filtered.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => setSelected(x.id)}
                    className={cn('w-full text-left px-3 py-2 border-b border-border/50 transition-colors', selected === x.id ? 'bg-primary/10' : 'hover:bg-accent/40')}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn('text-[10px] font-bold w-12 shrink-0', METHOD_COLORS[x.method] ?? 'text-muted-foreground')}>{x.method}</span>
                      <span className="text-xs font-medium truncate">{x.name}</span>
                    </div>
                    <div className="pl-14 text-[10px] text-muted-foreground truncate font-mono" title={x.url}>{x.url}</div>
                    <div className="pl-14 mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span className={cn('rounded px-1 font-mono font-semibold', statusTone(x.statusCode))}>{x.statusCode}</span>
                      <span>{x.durationMs} ms</span>
                      <span>· {humanBytes(x.responseSize)}</span>
                      <span className="ml-auto truncate">{relativeTime(x.createdAt, i18n.language)}</span>
                    </div>
                  </button>
                ))}
              </div>
              {items && items.length > 0 && <div className="px-3 py-1.5 border-t text-[10px] text-muted-foreground">{t('saved.count', { count: filtered.length })}</div>}
            </div>

            <div className="min-h-0 min-w-0 flex flex-col">
              {!summary ? (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">{items && items.length > 0 ? t('saved.pick') : ''}</div>
              ) : (
                <Detail
                  summary={summary}
                  detail={detail}
                  loading={loadingDetail && !detail}
                  folder={folderNames.get(summary.collectionId)}
                  onOpen={(send) => { if (detail) { openSavedRequest(detail, send); close(); } }}
                  onDelete={() => setConfirmDelete(summary)}
                  onRename={(name) => rename(summary.id, name)}
                />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('saved.deleteTitle', { name: confirmDelete?.name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('saved.deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-white hover:bg-destructive/90">{t('common:delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Detail({ summary, detail, loading, folder, onOpen, onDelete, onRename }: {
  summary: SavedResponseSummary; detail?: SavedResponseDetail; loading: boolean; folder?: string;
  onOpen: (send: boolean) => void; onDelete: () => void; onRename: (name: string) => Promise<void>;
}) {
  const { t, i18n } = useTranslation(['collections', 'common']);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(summary.name);
  const [reqTab, setReqTab] = useState<'headers' | 'body' | 'params' | 'template'>('headers');
  const [resTab, setResTab] = useState<'body' | 'headers'>('body');
  useEffect(() => { setName(summary.name); setEditing(false); }, [summary.id, summary.name]);

  const sent = detail?.sent;
  const contentType = headerValue(detail?.responseHeaders, 'content-type');
  const view = useMemo(() => (detail && !detail.bodyBase64 ? bodyView(detail.responseBody, contentType) : null), [detail, contentType]);
  const reqBody = sent?.body ?? '';
  const reqBodyView = useMemo(() => bodyView(reqBody, headerValue(sent?.headers, 'content-type')), [reqBody, sent?.headers]);

  const download = () => {
    if (!detail) return;
    let blob: Blob;
    if (detail.bodyBase64) {
      const bin = atob(detail.responseBody);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: contentType || 'application/octet-stream' });
    } else {
      blob = new Blob([detail.responseBody], { type: contentType || 'text/plain' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${summary.name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'response'}${view?.language === 'json' ? '.json' : ''}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 pt-3 pb-2 border-b space-y-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {editing ? (
            <form className="flex items-center gap-1 flex-1 min-w-0" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void onRename(name.trim()).then(() => setEditing(false)); }}>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" autoFocus />
              <Button type="submit" size="sm" variant="ghost" className="h-8 w-8 p-0"><Check className="h-4 w-4" /></Button>
              <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { setEditing(false); setName(summary.name); }}><X className="h-4 w-4" /></Button>
            </form>
          ) : (
            <h3 className="text-sm font-semibold truncate flex-1 min-w-0" title={summary.name}>
              {summary.name}
              {summary.canDelete && (
                <button type="button" className="ml-1.5 align-middle text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)} title={t('saved.rename')}><Pencil className="h-3 w-3" /></button>
              )}
            </h3>
          )}
          <Button size="sm" className="h-8 text-xs gap-1.5" disabled={!detail} onClick={() => onOpen(false)}>
            <ExternalLink className="h-3.5 w-3.5" /> {t('saved.openInTab')}
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={!detail} onClick={() => onOpen(true)} title={t('saved.sendAgainHint')}>
            <Play className="h-3.5 w-3.5" /> {t('saved.sendAgain')}
          </Button>
          {summary.canDelete && (
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={onDelete} title={t('common:delete')}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className={cn('rounded px-1.5 py-px font-mono font-semibold', statusTone(summary.statusCode))}>{summary.statusText?.startsWith(String(summary.statusCode)) ? summary.statusText : `${summary.statusCode} ${summary.statusText ?? ''}`.trim()}</span>
          <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {summary.durationMs} ms</span>
          <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" /> {humanBytes(summary.responseSize)}</span>
          {folder && <span className="flex items-center gap-1 truncate max-w-[260px]" title={folder}><FolderOpen className="h-3 w-3" /> {folder}</span>}
          {summary.authorName && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {summary.authorName}</span>}
          <span title={new Date(summary.createdAt).toLocaleString(i18n.language)}>{new Date(summary.createdAt).toLocaleString(i18n.language)}</span>
          {summary.truncated && <span className="text-amber-600 dark:text-amber-400">{t('saved.truncated')}</span>}
        </div>
      </div>

      {loading || !detail ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-rows-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* Request */}
          <section className="min-h-0 flex flex-col border-b">
            <div className="px-4 py-2 flex items-center gap-2 shrink-0">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold w-16">{t('saved.request')}</span>
              <span className={cn('text-[11px] font-bold', METHOD_COLORS[sent?.method ?? summary.method] ?? '')}>{sent?.method ?? summary.method}</span>
              <span className="text-xs font-mono truncate flex-1 min-w-0" title={sent?.url ?? summary.url}>{sent?.url ?? summary.url}</span>
            </div>
            <div className="px-4 flex items-center gap-1 border-b shrink-0">
              {(['headers', 'body', 'params', 'template'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setReqTab(k)} className={cn('px-2 py-1 text-[11px] border-b-2 -mb-px', reqTab === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                  {t(`saved.req_${k}`)}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-auto px-4 py-2">
              {reqTab === 'headers' && <KVTable rows={Object.entries(sent?.headers ?? {})} empty={t('saved.none')} />}
              {reqTab === 'params' && <KVTable rows={Object.entries(sent?.params ?? {})} empty={t('saved.none')} />}
              {reqTab === 'body' && (reqBody ? <pre className="text-[11px] font-mono whitespace-pre-wrap break-all">{reqBodyView.text}</pre> : <div className="text-xs text-muted-foreground">{t('saved.noBody')}</div>)}
              {reqTab === 'template' && <TemplateView detail={detail} />}
            </div>
          </section>
          {/* Response */}
          <section className="min-h-0 flex flex-col">
            <div className="px-4 py-2 flex items-center gap-2 shrink-0">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold w-16">{t('saved.response')}</span>
              <span className={cn('rounded px-1.5 py-px text-[11px] font-mono font-semibold', statusTone(summary.statusCode))}>{summary.statusCode}</span>
              <span className="text-[11px] text-muted-foreground truncate">{contentType}</span>
              <div className="ml-auto flex items-center gap-1">
                {(['body', 'headers'] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setResTab(k)} className={cn('px-2 py-0.5 text-[11px] rounded', resTab === k ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                    {t(`saved.res_${k}`)}{k === 'headers' && ` (${Object.keys(detail.responseHeaders ?? {}).length})`}
                  </button>
                ))}
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => void navigator.clipboard.writeText(detail.responseBody)} title={t('common:copy')}><Copy className="h-3 w-3" /></Button>
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={download} title={t('saved.download')}><Download className="h-3 w-3" /></Button>
              </div>
            </div>
            <div className="flex-1 min-h-0 px-4 pb-3">
              {resTab === 'headers' ? (
                <div className="h-full overflow-auto"><KVTable rows={Object.entries(detail.responseHeaders ?? {})} empty={t('saved.none')} /></div>
              ) : detail.bodyBase64 ? (
                contentType.startsWith('image/')
                  ? <div className="h-full overflow-auto border rounded-md p-2"><img src={`data:${contentType};base64,${detail.responseBody}`} alt="" className="max-w-full" /></div>
                  : <div className="text-xs text-muted-foreground">{t('saved.binary', { size: humanBytes(summary.responseSize) })}</div>
              ) : !detail.responseBody ? (
                <div className="text-xs text-muted-foreground">{t('saved.noBody')}</div>
              ) : (
                <div className="h-full border rounded-md overflow-hidden">
                  <BodyEditor text={view?.text ?? ''} language={view?.language ?? 'plaintext'} />
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function BodyEditor({ text, language }: { text: string; language: string }) {
  const { theme } = useThemeStore();
  return (
    <CodeEditor
      height="100%"
      language={language}
      theme={theme === 'dark' ? 'vs-dark' : 'light'}
      value={text}
      options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, lineNumbers: 'on', scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true, domReadOnly: true }}
    />
  );
}

function KVTable({ rows, empty }: { rows: Array<[string, string]>; empty: string }) {
  if (rows.length === 0) return <div className="text-xs text-muted-foreground">{empty}</div>;
  return (
    <table className="w-full text-[11px] table-fixed">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-border/40 last:border-0 align-top">
            <td className="w-1/3 py-1 pr-3 font-mono text-muted-foreground break-all">{k}</td>
            <td className="py-1 font-mono break-all">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The request as it was edited: URL template, params and headers with {{variables}}. */
function TemplateView({ detail }: { detail: SavedResponseDetail }) {
  const { t } = useTranslation('collections');
  const r = detail.request;
  const on = (kv: KeyValue[] | undefined) => (kv ?? []).filter((x) => x.key && x.enabled !== false).map((x) => [x.key, x.value] as [string, string]);
  const body = r.body;
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">{t('saved.templateNote')}</div>
      <div className="font-mono text-[11px] break-all"><span className="font-bold mr-1.5">{r.method}</span>{r.url}</div>
      {on(r.params).length > 0 && <div><div className="text-[10px] uppercase text-muted-foreground mb-0.5">{t('saved.req_params')}</div><KVTable rows={on(r.params)} empty="" /></div>}
      {on(r.headers).length > 0 && <div><div className="text-[10px] uppercase text-muted-foreground mb-0.5">{t('saved.req_headers')}</div><KVTable rows={on(r.headers)} empty="" /></div>}
      {body && body.type !== 'none' && body.content && <div><div className="text-[10px] uppercase text-muted-foreground mb-0.5">{t('saved.req_body')} ({body.type})</div><pre className="text-[11px] font-mono whitespace-pre-wrap break-all">{body.content}</pre></div>}
      {r.auth?.type && r.auth.type !== 'none' && (
        <div className="text-[11px]"><span className="text-muted-foreground">{t('saved.auth')}:</span> {r.auth.type}</div>
      )}
    </div>
  );
}
