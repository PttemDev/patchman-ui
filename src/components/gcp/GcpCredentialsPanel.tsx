import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, CloudCog, KeyRound, Laptop, Loader2, Plus, Trash2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { gcpAPI } from '@/services/api';
import { useGCPStore, gcpData } from '@/stores/gcpStore';
import { isDesktop } from '@/lib/platform';
import { extractErr } from '@/components/git/util';
import type { GCPCredential } from '@/types';

const SERVICES = ['storage', 'pubsub', 'logging', 'bigquery', 'gke'] as const;

const KindIcon = ({ kind }: { kind: GCPCredential['kind'] }) =>
  kind === 'adc' ? <Laptop className="h-4 w-4 text-sky-500" /> : kind === 'oauth' ? <UserRound className="h-4 w-4 text-emerald-500" /> : <KeyRound className="h-4 w-4 text-amber-500" />;

// Settings → Google Cloud → credentials: one Google login shared by Cloud
// Storage, Pub/Sub, Cloud Logging and GKE (GOOGLE_CLOUD_RFC.md ADR-1).
export function GcpCredentialsPanel() {
  const { t } = useTranslation('gcp');
  const { toast } = useToast();
  const { credentials, oauthAvailable, adcAllowed, loading, error, fetch, addServiceAccount, addADC, update, remove } = useGCPStore();
  const [mode, setMode] = useState<'' | 'sa' | 'adc' | 'oauth'>('');
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [project, setProject] = useState('');
  const [rw, setRw] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [adc, setAdc] = useState<{ found: boolean; account?: string; project?: string; type?: string } | null>(null);
  const [services, setServices] = useState<string[]>(['storage', 'pubsub', 'logging']);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void fetch(); }, [fetch]);
  useEffect(() => {
    if (!isDesktop()) return;
    gcpAPI.adc('local').then((r) => setAdc(gcpData<typeof adc>(r))).catch(() => setAdc(null));
  }, []);

  const reset = () => { setMode(''); setKey(''); setName(''); setProject(''); setRw(false); setErr(''); };
  const run = async (k: string, fn: () => Promise<void>) => {
    setBusy(k); setErr('');
    try { await fn(); } catch (e) { setErr(extractErr(e, t('failed'))); } finally { setBusy(''); }
  };

  const add = () => run('add', async () => {
    if (mode === 'sa') await addServiceAccount(key.trim(), name.trim(), project.trim(), rw);
    else await addADC(name.trim(), project.trim() || adc?.project || '', rw);
    toast({ title: t('added') });
    reset();
  });

  const connectGoogle = () => run('oauth', async () => {
    const res = await gcpAPI.oauthStart({ origin: window.location.origin, services, write: rw });
    const url = gcpData<{ url: string }>(res).url;
    const w = window.open(url, 'patchman-gcp', 'width=520,height=680');
    if (!w) { window.location.href = url; return; }
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'patchman:gcp-linked') return;
      window.removeEventListener('message', onMsg);
      void fetch();
      toast({ title: t('linked', { account: e.data.account ?? '' }) });
      reset();
    };
    window.addEventListener('message', onMsg);
  });

  const test = (c: GCPCredential) => run(`test-${c.id}`, async () => {
    const r = await gcpAPI.test(c.id, c.scope);
    const d = r.data as { data?: { id: string }[]; warning?: string } | { id: string }[];
    const list = Array.isArray(d) ? d : d.data ?? [];
    toast({ title: t('testOk', { count: list.length }), description: Array.isArray(d) ? undefined : d.warning });
  });

  const del = async (c: GCPCredential) => {
    if (!(await confirmDialog({ title: t('deleteTitle', { name: c.name }), description: t('deleteBody'), destructive: true }))) return;
    await run(`del-${c.id}`, async () => {
      const r = await remove(c, false);
      if (r.usedBy?.length) {
        if (!(await confirmDialog({ title: t('inUseTitle'), description: t('inUseBody', { list: r.usedBy.join(', ') }), destructive: true }))) return;
        await remove(c, true);
      }
    });
  };

  return (
    <div className="max-w-xl space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <CloudCog className="h-4 w-4 text-sky-500" />
        <div className="text-sm font-medium">{t('credentials')}</div>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('credentialsHint')}</p>
      {error && !credentials.length && <p className="text-xs text-destructive">{error}</p>}
      <div className="space-y-1.5">
        {credentials.map((c) => (
          <div key={c.id} className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs">
            <KindIcon kind={c.kind} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{c.name}</div>
              <div className="truncate text-[10px] text-muted-foreground">{t(`kind.${c.kind}`)}{c.account && c.account !== c.name ? ` · ${c.account}` : ''}{c.projectId ? ` · ${c.projectId}` : ''}</div>
            </div>
            {c.scope === 'local' && isDesktop() && <Badge variant="outline" className="text-[9px]">{t('thisComputer')}</Badge>}
            <label className="flex items-center gap-1 text-[10px] text-muted-foreground" title={t('allowWritesHint')}>
              <Switch className="scale-75" checked={c.readWrite} onCheckedChange={(v) => void run(`rw-${c.id}`, () => update(c, { readWrite: v }))} />{t('allowWrites')}
            </label>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => void test(c)}>
              {busy === `test-${c.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" disabled={!!busy} onClick={() => void del(c)} aria-label={t('delete')}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {!loading && credentials.length === 0 && <p className="text-xs text-muted-foreground">{t('none')}</p>}
      </div>

      {!mode ? (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setMode('sa')}><Plus className="h-3.5 w-3.5" />{t('addSA')}</Button>
          {adcAllowed && isDesktop() && (
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={!adc?.found} title={adc?.found ? undefined : t('adcMissing')} onClick={() => setMode('adc')}>
              <Laptop className="h-3.5 w-3.5" />{adc?.found ? t('addADC') : t('adcNone')}
            </Button>
          )}
          {oauthAvailable && !isDesktop() && <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setMode('oauth')}><UserRound className="h-3.5 w-3.5" />{t('connectGoogle')}</Button>}
        </div>
      ) : (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          {mode === 'sa' && (
            <>
              <div className="flex items-center justify-between">
                <Label className="text-xs">{t('keyJson')}</Label>
                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => fileRef.current?.click()}>{t('fromFile')}</Button>
                <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(setKey); e.target.value = ''; }} />
              </div>
              <Textarea value={key} onChange={(e) => setKey(e.target.value)} placeholder='{"type": "service_account", …}' className="min-h-[90px] font-mono text-[11px]" />
            </>
          )}
          {mode === 'adc' && adc?.found && (
            <p className="text-[11px] text-muted-foreground">{t('adcFound', { type: adc.type ?? '', account: adc.account ?? '—', project: adc.project ?? '—' })}</p>
          )}
          {mode === 'oauth' && (
            <div className="space-y-1">
              <Label className="text-xs">{t('services')}</Label>
              <div className="flex flex-wrap gap-2">
                {SERVICES.map((s) => (
                  <label key={s} className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={services.includes(s)} onChange={(e) => setServices((cur) => e.target.checked ? [...cur, s] : cur.filter((x) => x !== s))} />
                    {t(`service.${s}`)}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{t('oauthHint')}</p>
            </div>
          )}
          {mode !== 'oauth' && (
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">{t('name')}</Label><Input className="mt-1 h-8 text-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} /></div>
              <div><Label className="text-xs">{t('defaultProject')}</Label><Input className="mt-1 h-8 text-xs font-mono" value={project} onChange={(e) => setProject(e.target.value)} placeholder={adc?.project || 'my-project'} /></div>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs"><Switch checked={rw} onCheckedChange={setRw} className="scale-90" />{t('allowWrites')}<span className="text-[10px] text-muted-foreground">{t('allowWritesHint')}</span></label>
          {err && <p className="text-xs text-destructive">{err}</p>}
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={reset}>{t('cancel')}</Button>
            {mode === 'oauth' ? (
              <Button size="sm" className="h-7 text-xs" disabled={!!busy || !services.length} onClick={() => void connectGoogle()}>{busy === 'oauth' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}{t('continueGoogle')}</Button>
            ) : (
              <Button size="sm" className="h-7 text-xs" disabled={!!busy || (mode === 'sa' && !key.trim())} onClick={() => void add()}>{busy === 'add' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}{t('add')}</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
