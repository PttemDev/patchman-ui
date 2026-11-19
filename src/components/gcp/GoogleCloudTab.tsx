import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, ArrowLeft, Boxes, ChevronRight, Download, Eye, File, Folder, HardDrive, Loader2, Plus, Radio, RefreshCw,
  ScrollText, Search, Send, Trash2, Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { gcpAPI } from '@/services/api';
import { useGCPStore, gcpData } from '@/stores/gcpStore';
import { useRequestStore } from '@/stores/requestStore';
import { useK8sConnectionStore } from '@/stores/k8sConnectionStore';
import { extractErr, timeAgo } from '@/components/git/util';
import type { GCPCredential, Tab } from '@/types';

type Service = NonNullable<Tab['gcpService']>;
const SERVICES: { id: Service; icon: typeof HardDrive }[] = [
  { id: 'storage', icon: HardDrive }, { id: 'pubsub', icon: Radio }, { id: 'logging', icon: ScrollText }, { id: 'gke', icon: Boxes },
];

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

// The Google Cloud tab (GOOGLE_CLOUD_RFC.md): one credential + project, and
// its Cloud Storage, Pub/Sub, Cloud Logging and GKE views.
export default function GoogleCloudTab({ tab }: { tab: Tab }) {
  const { t } = useTranslation('gcp');
  const { credentials, fetch } = useGCPStore();
  const updateTab = useRequestStore((s) => s.updateTab);
  const cred = credentials.find((c) => c.id === tab.gcpCredentialId);
  const service = tab.gcpService ?? 'storage';
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const project = tab.gcpProject || cred?.projectId || '';

  useEffect(() => { if (!credentials.length) void fetch(); }, [credentials.length, fetch]);
  useEffect(() => {
    if (!cred) return;
    gcpAPI.projects(cred.id, cred.scope).then((r) => setProjects(gcpData<{ id: string; name: string }[]>(r) ?? [])).catch(() => setProjects([]));
  }, [cred]);

  if (!cred) {
    return <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">{credentials.length ? t('credentialGone') : <Loader2 className="h-4 w-4 animate-spin" />}</div>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Select value={cred.id} onValueChange={(v) => updateTab(tab.id, { gcpCredentialId: v, gcpProject: credentials.find((c) => c.id === v)?.projectId })}>
          <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{credentials.map((c) => <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={project} onValueChange={(v) => updateTab(tab.id, { gcpProject: v })}>
          <SelectTrigger className="h-8 w-56 font-mono text-xs"><SelectValue placeholder={t('pickProject')} /></SelectTrigger>
          <SelectContent>
            {(projects.length ? projects : project ? [{ id: project, name: project }] : []).map((p) => (
              <SelectItem key={p.id} value={p.id} className="font-mono text-xs">{p.id}{p.name && p.name !== p.id ? ` · ${p.name}` : ''}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-2 flex gap-1">
          {SERVICES.map((s) => (
            <button key={s.id} type="button" onClick={() => updateTab(tab.id, { gcpService: s.id })}
              className={cn('flex h-7 items-center gap-1.5 rounded px-2.5 text-xs', service === s.id ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/40')}>
              <s.icon className="h-3.5 w-3.5" />{t(`service.${s.id}`)}
            </button>
          ))}
        </div>
        {!cred.readWrite && <Badge variant="outline" className="ml-auto text-[10px]">{t('readOnly')}</Badge>}
      </div>
      {!project ? (
        <p className="p-4 text-xs text-muted-foreground">{t('pickProject')}</p>
      ) : service === 'storage' ? <StorageView key={cred.id + project} cred={cred} project={project} />
        : service === 'pubsub' ? <PubSubView key={cred.id + project} cred={cred} project={project} />
          : service === 'logging' ? <LoggingView key={cred.id + project} cred={cred} project={project} />
            : <GKEView key={cred.id + project} cred={cred} project={project} />}
    </div>
  );
}

// ── Cloud Storage ───────────────────────────────────────────────────────────

interface GcsObject { name: string; size: number; updated?: string; contentType?: string; storageClass?: string }

function StorageView({ cred, project }: { cred: GCPCredential; project: string }) {
  const { t } = useTranslation('gcp');
  const { toast } = useToast();
  const [buckets, setBuckets] = useState<{ name: string; location: string; storageClass: string }[] | null>(null);
  const [bucket, setBucket] = useState('');
  const [prefix, setPrefix] = useState('');
  const [list, setList] = useState<{ prefixes: string[]; objects: GcsObject[]; nextPageToken?: string } | null>(null);
  const [preview, setPreview] = useState<{ name: string; text?: string; image?: string; meta: GcsObject; tooLarge?: boolean } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    gcpAPI.buckets(cred.id, project, cred.scope).then((r) => setBuckets(gcpData<typeof buckets>(r) ?? [])).catch((e) => { setErr(extractErr(e, t('failed'))); setBuckets([]); });
  }, [cred, project, t]);
  const load = useCallback(async (more?: string) => {
    if (!bucket) return;
    setErr('');
    try {
      const r = await gcpAPI.objects(cred.id, { bucket, prefix: prefix || undefined, pageToken: more }, cred.scope);
      const d = gcpData<{ prefixes: string[]; objects: GcsObject[]; nextPageToken?: string }>(r);
      setList((cur) => more && cur ? { prefixes: [...cur.prefixes, ...d.prefixes], objects: [...cur.objects, ...d.objects], nextPageToken: d.nextPageToken } : d);
    } catch (e) { setErr(extractErr(e, t('failed'))); }
  }, [bucket, prefix, cred, t]);
  useEffect(() => { setList(null); setPreview(null); void load(); }, [load]);

  const open = async (o: GcsObject) => {
    setBusy(o.name);
    try {
      const r = await gcpAPI.object(cred.id, bucket, o.name, cred.scope);
      const d = gcpData<{ meta: GcsObject; content?: string; tooLarge?: boolean }>(r);
      let text: string | undefined;
      let image: string | undefined;
      if (d.content !== undefined) {
        if ((d.meta.contentType ?? '').startsWith('image/')) image = `data:${d.meta.contentType};base64,${d.content}`;
        else {
          const bytes = Uint8Array.from(atob(d.content), (c) => c.charCodeAt(0));
          text = new TextDecoder().decode(bytes);
          if (/^[{[]/.test(text.trim())) { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* not JSON */ } }
        }
      }
      setPreview({ name: o.name, text, image, meta: d.meta, tooLarge: d.tooLarge });
    } catch (e) { toast({ title: t('failed'), description: extractErr(e, ''), variant: 'destructive' }); } finally { setBusy(''); }
  };
  const download = async (o: GcsObject) => {
    try {
      const r = await gcpAPI.download(cred.id, bucket, o.name, cred.scope);
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement('a');
      a.href = url; a.download = o.name.split('/').pop() || 'object'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { toast({ title: t('failed'), description: extractErr(e, ''), variant: 'destructive' }); }
  };
  const del = async (o: GcsObject) => {
    if (!(await confirmDialog({ title: t('deleteObject', { name: o.name }), destructive: true }))) return;
    try { await gcpAPI.deleteObject(cred.id, bucket, o.name, cred.scope); toast({ title: t('deleted') }); setPreview(null); void load(); } catch (e) { toast({ title: t('failed'), description: extractErr(e, ''), variant: 'destructive' }); }
  };
  const upload = async (f: File) => {
    const name = prefix + f.name;
    if (!(await confirmDialog({ title: t('uploadConfirm', { name, bucket }) }))) return;
    const form = new FormData();
    form.append('file', f); form.append('bucket', bucket); form.append('name', name); form.append('allowWrite', 'true');
    setBusy('upload');
    try { await gcpAPI.upload(cred.id, form, cred.scope); toast({ title: t('uploaded', { name }) }); void load(); } catch (e) { toast({ title: t('failed'), description: extractErr(e, ''), variant: 'destructive' }); } finally { setBusy(''); }
  };
  const crumbs = prefix.split('/').filter(Boolean);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-60 shrink-0 overflow-auto border-r">
        <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">{t('buckets')}</div>
        {!buckets ? <Loader2 className="mx-3 h-4 w-4 animate-spin text-muted-foreground" /> : buckets.length === 0 ? <p className="px-3 text-xs text-muted-foreground">{t('noBuckets')}</p> : buckets.map((b) => (
          <button key={b.name} type="button" onClick={() => { setBucket(b.name); setPrefix(''); }}
            className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs', bucket === b.name ? 'bg-accent' : 'hover:bg-accent/40')}>
            <HardDrive className="h-3.5 w-3.5 shrink-0 text-sky-500" /><span className="truncate">{b.name}</span><span className="ml-auto text-[10px] text-muted-foreground">{b.location}</span>
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {err && <p className="m-2 rounded bg-destructive/10 p-2 text-xs text-destructive">{err}</p>}
        {!bucket ? <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">{t('pickBucket')}</div> : (
          <>
            <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5 text-xs">
              <button type="button" className="font-medium hover:underline" onClick={() => setPrefix('')}>{bucket}</button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1"><ChevronRight className="h-3 w-3 text-muted-foreground" />
                  <button type="button" className="hover:underline" onClick={() => setPrefix(crumbs.slice(0, i + 1).join('/') + '/')}>{c}</button></span>
              ))}
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => void load()} aria-label={t('refresh')}><RefreshCw className="h-3.5 w-3.5" /></Button>
                {cred.readWrite && (
                  <>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy === 'upload'} onClick={() => fileRef.current?.click()}>
                      {busy === 'upload' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{t('upload')}
                    </Button>
                    <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
                  </>
                )}
              </div>
            </div>
            <div className="flex min-h-0 flex-1">
              <div className="min-w-0 flex-1 overflow-auto">
                {!list ? <Loader2 className="m-3 h-4 w-4 animate-spin text-muted-foreground" /> : (
                  <table className="w-full text-xs">
                    <tbody>
                      {prefix && (
                        <tr className="cursor-pointer border-b hover:bg-accent/40" onClick={() => setPrefix(crumbs.slice(0, -1).join('/') + (crumbs.length > 1 ? '/' : ''))}>
                          <td className="px-3 py-1.5" colSpan={4}><ArrowLeft className="inline h-3.5 w-3.5" /> ..</td>
                        </tr>
                      )}
                      {list.prefixes.map((p) => (
                        <tr key={p} className="cursor-pointer border-b hover:bg-accent/40" onClick={() => setPrefix(p)}>
                          <td className="px-3 py-1.5" colSpan={4}><Folder className="mr-1.5 inline h-3.5 w-3.5 text-amber-500" />{p.slice(prefix.length)}</td>
                        </tr>
                      ))}
                      {list.objects.filter((o) => o.name !== prefix).map((o) => (
                        <tr key={o.name} className={cn('group cursor-pointer border-b hover:bg-accent/40', preview?.name === o.name && 'bg-accent/60')} onClick={() => void open(o)}>
                          <td className="px-3 py-1.5"><File className="mr-1.5 inline h-3.5 w-3.5 text-muted-foreground" />{o.name.slice(prefix.length)}{busy === o.name && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{fmtSize(o.size)}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{timeAgo(o.updated)}</td>
                          <td className="px-2 py-1.5 text-right">
                            <span className="invisible inline-flex gap-1 group-hover:visible">
                              <button type="button" title={t('download')} onClick={(e) => { e.stopPropagation(); void download(o); }}><Download className="h-3.5 w-3.5" /></button>
                              {cred.readWrite && <button type="button" title={t('delete')} className="text-destructive" onClick={(e) => { e.stopPropagation(); void del(o); }}><Trash2 className="h-3.5 w-3.5" /></button>}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {list.prefixes.length === 0 && list.objects.length === 0 && <tr><td className="px-3 py-4 text-muted-foreground">{t('empty')}</td></tr>}
                    </tbody>
                  </table>
                )}
                {list?.nextPageToken && <div className="flex justify-center p-2"><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void load(list.nextPageToken)}>{t('loadMore')}</Button></div>}
              </div>
              {preview && (
                <div className="flex w-[45%] shrink-0 flex-col border-l">
                  <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
                    <Eye className="h-3.5 w-3.5" /><span className="truncate font-medium">{preview.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{preview.meta.contentType} · {fmtSize(preview.meta.size)}</span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-3">
                    {preview.tooLarge ? <p className="text-xs text-muted-foreground">{t('tooLarge')}</p>
                      : preview.image ? <img src={preview.image} alt={preview.name} className="max-w-full" />
                        : <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">{preview.text}</pre>}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Pub/Sub ─────────────────────────────────────────────────────────────────

interface Sub { name: string; topic: string; ackDeadlineSeconds: number; retention?: string; filter?: string; push?: boolean; deadLetterTopic?: string; maxDeliveryAttempts?: number }
interface Msg { id: string; data: string; attributes?: Record<string, string>; publishTime?: string; orderingKey?: string; deliveryAttempt?: number }

function PubSubView({ cred, project }: { cred: GCPCredential; project: string }) {
  const { t } = useTranslation('gcp');
  const { toast } = useToast();
  const [topics, setTopics] = useState<{ name: string }[] | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [topic, setTopic] = useState('');
  const [sel, setSel] = useState<Sub | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [pubOpen, setPubOpen] = useState(false);
  const [pubData, setPubData] = useState('');
  const [pubAttrs, setPubAttrs] = useState('');

  useEffect(() => {
    Promise.all([gcpAPI.topics(cred.id, project, cred.scope), gcpAPI.subscriptions(cred.id, project, undefined, cred.scope)]).then(([a, b]) => {
      setTopics(gcpData<{ name: string }[]>(a) ?? []);
      setSubs(gcpData<Sub[]>(b) ?? []);
    }).catch((e) => { setErr(extractErr(e, t('failed'))); setTopics([]); });
  }, [cred, project, t]);
  const shown = topic ? subs.filter((s) => s.topic === topic) : subs;

  const peek = async (s: Sub) => {
    setSel(s); setMsgs(null); setBusy('peek');
    try {
      const r = await gcpAPI.peek(cred.id, project, s.name, 20, cred.scope);
      const d = gcpData<{ messages: Msg[]; note: string }>(r);
      setMsgs(d.messages); setNote(d.note);
    } catch (e) { setErr(extractErr(e, t('failed'))); setMsgs([]); } finally { setBusy(''); }
  };
  const publish = async () => {
    const attributes: Record<string, string> = {};
    for (const l of pubAttrs.split('\n')) { const i = l.indexOf('='); if (i > 0) attributes[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
    if (!(await confirmDialog({ title: t('publishConfirm', { topic }) }))) return;
    setBusy('pub');
    try {
      const r = await gcpAPI.publish(cred.id, project, { topic, data: pubData, attributes }, cred.scope);
      toast({ title: t('published', { id: gcpData<{ messageIds: string[] }>(r).messageIds?.[0] ?? '' }) });
      setPubOpen(false); setPubData(''); setPubAttrs('');
    } catch (e) { toast({ title: t('failed'), description: extractErr(e, ''), variant: 'destructive' }); } finally { setBusy(''); }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-56 shrink-0 overflow-auto border-r">
        <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">{t('topics')}</div>
        <button type="button" onClick={() => setTopic('')} className={cn('w-full px-3 py-1.5 text-left text-xs', !topic ? 'bg-accent' : 'hover:bg-accent/40')}>{t('allTopics')}</button>
        {!topics ? <Loader2 className="mx-3 h-4 w-4 animate-spin text-muted-foreground" /> : topics.map((tp) => (
          <button key={tp.name} type="button" onClick={() => setTopic(tp.name)} className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs', topic === tp.name ? 'bg-accent' : 'hover:bg-accent/40')}>
            <Radio className="h-3.5 w-3.5 shrink-0 text-violet-500" /><span className="truncate">{tp.name}</span>
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {err && <p className="m-2 rounded bg-destructive/10 p-2 text-xs text-destructive">{err}</p>}
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
          <span className="font-medium">{t('subscriptions')}</span><span className="text-muted-foreground">{shown.length}</span>
          {topic && cred.readWrite && <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-xs" onClick={() => setPubOpen((v) => !v)}><Send className="h-3.5 w-3.5" />{t('publish')}</Button>}
        </div>
        {pubOpen && (
          <div className="shrink-0 space-y-2 border-b bg-muted/30 p-3">
            <Textarea value={pubData} onChange={(e) => setPubData(e.target.value)} placeholder={t('messageBody')} className="min-h-[70px] font-mono text-xs" />
            <Textarea value={pubAttrs} onChange={(e) => setPubAttrs(e.target.value)} placeholder={t('attributes')} className="min-h-[40px] font-mono text-xs" />
            <div className="flex justify-end"><Button size="sm" className="h-7 gap-1 text-xs" disabled={busy === 'pub'} onClick={() => void publish()}>{busy === 'pub' && <Loader2 className="h-3 w-3 animate-spin" />}{t('publishTo', { topic })}</Button></div>
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <div className="w-[45%] shrink-0 overflow-auto border-r">
            {shown.map((s) => (
              <button key={s.name} type="button" onClick={() => void peek(s)} className={cn('block w-full border-b px-3 py-2 text-left text-xs', sel?.name === s.name ? 'bg-accent' : 'hover:bg-accent/40')}>
                <div className="flex items-center gap-1.5 font-medium">{s.name}{s.push && <Badge variant="outline" className="text-[9px]">push</Badge>}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">→ {s.topic} · ack {s.ackDeadlineSeconds}s{s.retention ? ` · ${s.retention}` : ''}{s.deadLetterTopic ? ` · DLQ ${s.deadLetterTopic} (${s.maxDeliveryAttempts})` : ''}</div>
                {s.filter && <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{s.filter}</div>}
              </button>
            ))}
            {topics && shown.length === 0 && <p className="p-3 text-xs text-muted-foreground">{t('noSubscriptions')}</p>}
          </div>
          <div className="min-w-0 flex-1 overflow-auto p-3">
            {!sel ? <p className="text-xs text-muted-foreground">{t('pickSubscription')}</p> : busy === 'peek' || !msgs ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
              <div className="space-y-2">
                <div className="flex items-start gap-2 rounded bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{note}{sel.deadLetterTopic ? ` ${t('dlqWarning', { topic: sel.deadLetterTopic, n: sel.maxDeliveryAttempts })}` : ''}</span>
                </div>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => void peek(sel)}><RefreshCw className="h-3.5 w-3.5" />{t('peekAgain')}</Button>
                {msgs.length === 0 && <p className="text-xs text-muted-foreground">{t('noMessages')}</p>}
                {msgs.map((m) => (
                  <div key={m.id} className="rounded border p-2 text-xs">
                    <div className="mb-1 flex gap-2 text-[10px] text-muted-foreground"><span className="font-mono">{m.id}</span><span>{timeAgo(m.publishTime)}</span>{!!m.deliveryAttempt && <span>{t('attempt', { n: m.deliveryAttempt })}</span>}</div>
                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px]">{m.data}</pre>
                    {m.attributes && Object.keys(m.attributes).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">{Object.entries(m.attributes).map(([k, v]) => <Badge key={k} variant="secondary" className="font-mono text-[9px]">{k}={v}</Badge>)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Cloud Logging ───────────────────────────────────────────────────────────

interface LogEntry { id: string; timestamp: string; severity: string; log: string; resource: string; resourceLabels?: Record<string, string>; message: string; payload?: unknown; trace?: string }
const RANGES = [['15m', 15], ['1h', 60], ['6h', 360], ['24h', 1440], ['7d', 10080]] as const;
const SEV_CLS: Record<string, string> = { ERROR: 'text-red-500', CRITICAL: 'text-red-600', ALERT: 'text-red-600', EMERGENCY: 'text-red-700', WARNING: 'text-amber-600', NOTICE: 'text-sky-500', INFO: 'text-sky-500', DEBUG: 'text-muted-foreground' };

function LoggingView({ cred, project }: { cred: GCPCredential; project: string }) {
  const { t } = useTranslation('gcp');
  const [filter, setFilter] = useState('severity>=WARNING');
  const [range, setRange] = useState<number>(60);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [next, setNext] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (more?: string) => {
    setBusy(true); setErr('');
    try {
      const from = new Date(Date.now() - range * 60000).toISOString();
      const r = await gcpAPI.logs(cred.id, { project, filter, from, pageSize: 200, pageToken: more }, cred.scope);
      const d = gcpData<{ entries: LogEntry[]; nextPageToken?: string }>(r);
      setEntries((cur) => (more && cur ? [...cur, ...d.entries] : d.entries));
      setNext(d.nextPageToken ?? '');
    } catch (e) { setErr(extractErr(e, t('failed'))); if (!more) setEntries([]); } finally { setBusy(false); }
  }, [cred, project, filter, range, t]);
  useEffect(() => { void run(); }, [run]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form className="flex shrink-0 items-center gap-2 border-b px-3 py-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 flex-1 font-mono text-xs" placeholder='resource.type="k8s_container" AND severity>=ERROR' />
        <div className="flex gap-0.5">
          {RANGES.map(([l, m]) => (
            <button key={l} type="button" onClick={() => setRange(m)} className={cn('h-7 rounded px-2 text-[11px]', range === m ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/40')}>{l}</button>
          ))}
        </div>
        <Button type="submit" size="sm" className="h-8 text-xs" disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('run')}</Button>
      </form>
      {err && <p className="m-2 rounded bg-destructive/10 p-2 text-xs text-destructive">{err}</p>}
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[11px]">
        {!entries ? <Loader2 className="m-3 h-4 w-4 animate-spin text-muted-foreground" /> : entries.length === 0 ? <p className="p-3 font-sans text-xs text-muted-foreground">{t('noLogs')}</p> : entries.map((e) => (
          <div key={e.id + e.timestamp} className="border-b">
            <button type="button" onClick={() => setOpen(open === e.id ? null : e.id)} className="flex w-full items-start gap-2 px-3 py-1 text-left hover:bg-accent/40">
              <span className="shrink-0 text-muted-foreground">{new Date(e.timestamp).toLocaleTimeString()}</span>
              <span className={cn('w-16 shrink-0 font-semibold', SEV_CLS[e.severity])}>{e.severity}</span>
              <span className="w-32 shrink-0 truncate text-muted-foreground" title={`${e.resource} · ${e.log}`}>{e.resourceLabels?.pod_name || e.resourceLabels?.service_name || e.log}</span>
              <span className="min-w-0 flex-1 truncate">{e.message}</span>
            </button>
            {open === e.id && (
              <pre className="whitespace-pre-wrap break-all bg-muted/40 px-3 py-2">{JSON.stringify({ log: e.log, resource: e.resource, resourceLabels: e.resourceLabels, trace: e.trace, payload: e.payload ?? e.message }, null, 2)}</pre>
            )}
          </div>
        ))}
        {next && <div className="flex justify-center p-2 font-sans"><Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => void run(next)}>{t('loadMore')}</Button></div>}
      </div>
    </div>
  );
}

// ── GKE ─────────────────────────────────────────────────────────────────────

interface Cluster { name: string; location: string; status: string; endpoint: string; version: string; nodes: number; autopilot: boolean; privateEndpoint: boolean }

function GKEView({ cred, project }: { cred: GCPCredential; project: string }) {
  const { t } = useTranslation('gcp');
  const { toast } = useToast();
  const k8s = useK8sConnectionStore();
  const [list, setList] = useState<Cluster[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    gcpAPI.clusters(cred.id, project, cred.scope).then((r) => setList(gcpData<Cluster[]>(r) ?? [])).catch((e) => { setErr(extractErr(e, t('failed'))); setList([]); });
  }, [cred, project, t]);
  const added = useMemo(() => new Set(k8s.connections.map((c) => c.name)), [k8s.connections]);
  const add = async (c: Cluster) => {
    setBusy(c.name);
    try {
      await gcpAPI.addCluster(cred.id, { project, location: c.location, cluster: c.name }, cred.scope);
      await k8s.fetchConnections?.();
      toast({ title: t('clusterAdded', { name: c.name }), description: t('clusterAddedHint') });
    } catch (e) { toast({ title: t('failed'), description: extractErr(e, ''), variant: 'destructive' }); } finally { setBusy(''); }
  };
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {err && <p className="mb-2 rounded bg-destructive/10 p-2 text-xs text-destructive">{err}</p>}
      <p className="mb-2 text-[11px] text-muted-foreground">{t('gkeHint')}</p>
      {!list ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : list.length === 0 ? <p className="text-xs text-muted-foreground">{t('noClusters')}</p> : (
        <table className="w-full max-w-4xl text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground"><tr>{['cluster', 'location', 'status', 'version', 'nodes', ''].map((h) => <th key={h} className="px-3 py-1.5 text-left font-normal">{h && t(`col.${h}`)}</th>)}</tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.location + c.name} className="border-t">
                <td className="px-3 py-2 font-medium"><Boxes className="mr-1.5 inline h-3.5 w-3.5 text-blue-500" />{c.name}{c.autopilot && <Badge variant="outline" className="ml-1.5 text-[9px]">Autopilot</Badge>}{c.privateEndpoint && <Badge variant="outline" className="ml-1 text-[9px]">{t('private')}</Badge>}</td>
                <td className="px-3 py-2 font-mono">{c.location}</td>
                <td className={cn('px-3 py-2', c.status === 'RUNNING' ? 'text-emerald-600' : 'text-amber-600')}>{c.status}</td>
                <td className="px-3 py-2 font-mono">{c.version}</td>
                <td className="px-3 py-2">{c.nodes}</td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy === c.name || added.has(`${c.name} (GKE)`)} onClick={() => void add(c)}>
                    {busy === c.name ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}{added.has(`${c.name} (GKE)`) ? t('inKubernetes') : t('addToKubernetes')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
