import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch, Link2, Loader2, Pencil, Plus, Ticket, Trash2, Webhook } from 'lucide-react';
import { getRemoteBaseUrl } from '@/stores/remoteStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { qaAPI } from '@/services/api';
import { useGitConnectionStore } from '@/stores/gitConnectionStore';
import { useJiraConnectionStore } from '@/stores/jiraConnectionStore';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { JiraConnectionsPanel } from '@/components/jira/JiraConnectionsPanel';
import type { QAProjectLink } from '@/types';
import { RadarSettings } from './RadarSettings';
import { PendingSetupCard } from './PendingSetupCard';
import { SearchPicker, type PickerOption } from './SearchPicker';
import { gitAPI, jiraAPI } from '@/services/api';
import { scopeForJira } from '@/stores/jiraConnectionStore';

const NONE = '__none__';

function errText(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return msg || fallback;
}

// CR + QA Hub → Settings (CR_QA_P0_PLAN.md P0.b): Jira connections and the
// Git project ↔ Jira project links the review tools (P0.c) work from. Links
// follow the QA space chosen in the header (personal or a team workspace).
export function QASettingsSection() {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const [links, setLinks] = useState<QAProjectLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<QAProjectLink | null>(null);
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<QAProjectLink | null>(null);
  const [hook, setHook] = useState<QAProjectLink | null>(null);
  const [applied, setApplied] = useState(0);
  const gitConns = useGitConnectionStore((s) => s.connections);
  const fetchGit = useGitConnectionStore((s) => s.fetchConnections);
  const jiraConns = useJiraConnectionStore((s) => s.connections);
  const envs = useEnvironmentStore((s) => s.environments);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await qaAPI.links();
      setLinks(res.data ?? []);
    } catch (e) {
      toast({ title: errText(e, t('settings.links.loadFailed')), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!gitConns.length) void fetchGit(); }, [gitConns.length, fetchGit]);

  const nameOf = (list: { id: string; name: string }[], id: string) =>
    id ? (list.find((c) => c.id === id)?.name ?? t('settings.links.unknownConn')) : '—';

  const del = async (l: QAProjectLink) => {
    if (!(await confirmDialog({ title: t('settings.links.deleteTitle', { project: l.gitProject }), description: t('settings.links.deleteBody'), destructive: true }))) return;
    try {
      await qaAPI.deleteLink(l.id);
      setLinks((xs) => xs.filter((x) => x.id !== l.id));
    } catch (e) {
      toast({ title: errText(e, t('settings.links.deleteFailed')), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-8">
      <PendingSetupCard onApplied={() => { void load(); setApplied((n) => n + 1); }} />
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="whitespace-nowrap text-sm font-semibold">{t('settings.links.title')}</h3>
          <span className="hidden min-w-0 truncate text-xs text-muted-foreground @2xl:inline">· {t('settings.links.hint')}</span>
          <Button size="sm" className="ml-auto h-8 shrink-0 gap-1.5 text-xs" onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus className="h-3.5 w-3.5" /> {t('settings.links.add')}
          </Button>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t('settings.links.loading')}</div>
        ) : links.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('settings.links.empty')}</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('settings.links.gitProject')}</th>
                  <th className="px-3 py-2 font-medium">{t('settings.links.jiraProject')}</th>
                  <th className="px-3 py-2 font-medium">{t('settings.links.keyPattern')}</th>
                  <th className="px-3 py-2 font-medium">{t('settings.links.testEnv')}</th>
                  <th className="px-3 py-2 font-medium" title={t('settings.mine.hint')}>{t('settings.mine.column')}</th>
                  <th className="w-28 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5 font-medium"><GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{l.gitProject}</span></div>
                      <div className="text-xs text-muted-foreground">{nameOf(gitConns, l.gitConnectionId)}</div>
                    </td>
                    <td className="px-3 py-2">
                      {l.jiraProjectKey ? (
                        <>
                          <div className="flex items-center gap-1.5 font-mono text-xs font-medium"><Ticket className="h-3.5 w-3.5 text-muted-foreground" />{l.jiraProjectKey}</div>
                          <div className="text-xs text-muted-foreground">{nameOf(jiraConns, l.jiraConnectionId)}</div>
                        </>
                      ) : <span className="text-xs text-muted-foreground">{t('settings.links.noJira')}</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{l.keyPattern || <span className="text-muted-foreground">{t('settings.links.defaultPattern')}</span>}</td>
                    <td className="px-3 py-2 text-xs">{l.testEnvironmentId ? (envs.find((e) => e.id === l.testEnvironmentId)?.name ?? '—') : '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      <button type="button" onClick={() => setMine(l)} className="rounded px-1 text-left hover:bg-accent" title={t('settings.mine.hint')}>
                        {l.myGitConnectionId || l.myJiraConnectionId ? (
                          <span className="text-primary">{[l.myGitConnectionId && nameOf(gitConns, l.myGitConnectionId), l.myJiraConnectionId && nameOf(jiraConns, l.myJiraConnectionId)].filter(Boolean).join(' · ')}</span>
                        ) : (
                          <span className="text-muted-foreground underline decoration-dotted">{t('settings.mine.useMine')}</span>
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="icon" className={'h-7 w-7' + (l.hasWebhook ? ' text-emerald-600 dark:text-emerald-400' : '')} aria-label={t('settings.webhook.title')} title={l.webhookAt ? t('settings.webhook.lastEvent', { when: new Date(l.webhookAt).toLocaleString() }) : t('settings.webhook.title')} onClick={() => setHook(l)}><Webhook className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t('settings.links.edit')} onClick={() => { setEditing(l); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label={t('settings.links.delete')} onClick={() => void del(l)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RadarSettings key={applied} />

      <section>
        <JiraConnectionsPanel />
      </section>

      {hook && <WebhookDialog link={hook} onClose={() => { setHook(null); void load(); }} />}
      {mine && (
        <MineDialog
          link={mine}
          onClose={() => setMine(null)}
          onSaved={(git, jira) => setLinks((xs) => xs.map((x) => (x.id === mine.id ? { ...x, myGitConnectionId: git, myJiraConnectionId: jira } : x)))}
        />
      )}

      <LinkDialog
        open={open}
        onOpenChange={setOpen}
        link={editing}
        onSaved={(l) => setLinks((xs) => (xs.some((x) => x.id === l.id) ? xs.map((x) => (x.id === l.id ? l : x)) : [...xs, l]))}
      />
    </div>
  );
}

function LinkDialog({ open, onOpenChange, link, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  link: QAProjectLink | null;
  onSaved: (l: QAProjectLink) => void;
}) {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const gitConns = useGitConnectionStore((s) => s.connections);
  const jiraConns = useJiraConnectionStore((s) => s.connections);
  const envs = useEnvironmentStore((s) => s.environments);
  const [form, setForm] = useState({ gitConnectionId: '', gitProject: '', jiraConnectionId: '', jiraProjectKey: '', keyPattern: '', testEnvironmentId: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm({
      gitConnectionId: link?.gitConnectionId ?? gitConns[0]?.id ?? '',
      gitProject: link?.gitProject ?? '',
      jiraConnectionId: link?.jiraConnectionId ?? jiraConns[0]?.id ?? '',
      jiraProjectKey: link?.jiraProjectKey ?? '',
      keyPattern: link?.keyPattern ?? '',
      testEnvironmentId: link?.testEnvironmentId ?? '',
    });
  }, [open, link, gitConns, jiraConns]);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const keyOk = !form.jiraProjectKey || /^[A-Za-z][A-Za-z0-9_]*$/.test(form.jiraProjectKey);
  const canSave = !!form.gitConnectionId && !!form.gitProject.trim() && keyOk && (!form.jiraProjectKey || !!form.jiraConnectionId);

  const save = async () => {
    setSaving(true);
    const body = { ...form, jiraConnectionId: form.jiraProjectKey ? form.jiraConnectionId : '' };
    try {
      const res = link ? await qaAPI.updateLink(link.id, body) : await qaAPI.createLink({ id: crypto.randomUUID(), ...body });
      onSaved(res.data);
      onOpenChange(false);
    } catch (e) {
      toast({ title: errText(e, t('settings.links.saveFailed')), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{link ? t('settings.links.editTitle') : t('settings.links.addTitle')}</DialogTitle>
          <DialogDescription>{t('settings.links.dialogHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{t('settings.links.gitConnection')}</Label>
            <Select value={form.gitConnectionId || undefined} onValueChange={set('gitConnectionId')}>
              <SelectTrigger><SelectValue placeholder={gitConns.length ? t('settings.links.pick') : t('settings.links.noGitConns')} /></SelectTrigger>
              <SelectContent>{gitConns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>{t('settings.links.gitProject')}</Label>
            <SearchPicker
              value={form.gitProject ? `${form.gitConnectionId}\u0000${form.gitProject}` : ''}
              display={form.gitProject ? `${form.gitProject} · ${gitConns.find((c) => c.id === form.gitConnectionId)?.name ?? ''}` : undefined}
              onChange={(v) => {
                const i = v.indexOf('\u0000');
                if (i < 0) { set('gitProject')(v); return; } // typed by hand: keep the selected connection
                setForm((f) => ({ ...f, gitConnectionId: v.slice(0, i), gitProject: v.slice(i + 1) }));
              }}
              disabled={gitConns.length === 0}
              placeholder={t('settings.links.gitProjectPlaceholder')}
              deps={[gitConns.length]}
              hint={(opts, q) => (!q && opts.length >= 50 ? t('picker.typeToSearch') : undefined)}
              load={async (q) => {
                // Every Git connection is searched; picking a project also
                // picks its connection.
                const lists = await Promise.all(gitConns.map(async (c) => {
                  try {
                    const res = await gitAPI.repos(c.id, { search: q || undefined });
                    return ((res.data ?? []) as { fullPath: string; name: string }[]).map((r): PickerOption => ({ value: `${c.id}\u0000${r.fullPath}`, label: r.fullPath, sub: c.name }));
                  } catch {
                    return [] as PickerOption[];
                  }
                }));
                return lists.flat();
              }}
            />
            <p className="text-[11px] text-muted-foreground">{t('settings.links.gitProjectHint')}</p>
          </div>
          <div className="grid grid-cols-[1fr_180px] gap-3">
            <div className="grid gap-1.5">
              <Label>{t('settings.links.jiraConnection')}</Label>
              <Select value={form.jiraConnectionId || undefined} onValueChange={set('jiraConnectionId')}>
                <SelectTrigger><SelectValue placeholder={jiraConns.length ? t('settings.links.pick') : t('settings.links.noJiraConns')} /></SelectTrigger>
                <SelectContent>{jiraConns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t('settings.links.jiraProject')}</Label>
              <SearchPicker
                value={form.jiraProjectKey}
                onChange={(v) => set('jiraProjectKey')(v.toUpperCase())}
                disabled={!form.jiraConnectionId}
                placeholder="MER"
                mono
                deps={[form.jiraConnectionId]}
                load={async (q) => {
                  const res = await jiraAPI.projects(form.jiraConnectionId, q, scopeForJira(jiraConns, form.jiraConnectionId));
                  return (res.data ?? []).map((p): PickerOption => ({ value: p.key, label: p.key, sub: p.name }));
                }}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t('settings.links.keyPattern')}</Label>
            <Input value={form.keyPattern} onChange={(e) => set('keyPattern')(e.target.value)} placeholder={t('settings.links.defaultPattern')} className="font-mono" />
            <p className="text-xs text-muted-foreground">{t('settings.links.keyPatternHint')}</p>
          </div>
          <div className="grid gap-1.5">
            <Label>{t('settings.links.testEnv')}</Label>
            <Select value={form.testEnvironmentId || NONE} onValueChange={(v) => set('testEnvironmentId')(v === NONE ? '' : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('settings.links.noTestEnv')}</SelectItem>
                {envs.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('settings.links.cancel')}</Button>
          <Button onClick={() => void save()} disabled={!canSave || saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{t('settings.links.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LINKS = '__link__';

/** Read a shared link through my own Git / Jira connection, so the radar
 * knows who I am there (my reviews, my MRs, my Jira test queue). */
function MineDialog({ link, onClose, onSaved }: { link: QAProjectLink; onClose: () => void; onSaved: (git: string, jira: string) => void }) {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const gitConns = useGitConnectionStore((s) => s.connections);
  const jiraConns = useJiraConnectionStore((s) => s.connections);
  const [git, setGit] = useState(link.myGitConnectionId || '');
  const [jira, setJira] = useState(link.myJiraConnectionId || '');
  const [saving, setSaving] = useState(false);
  const linkGit = gitConns.find((c) => c.id === link.gitConnectionId)?.name ?? t('settings.links.unknownConn');
  const linkJira = jiraConns.find((c) => c.id === link.jiraConnectionId)?.name ?? t('settings.links.unknownConn');

  const save = async () => {
    setSaving(true);
    try {
      await qaAPI.mapMine(link.id, { gitConnectionId: git, jiraConnectionId: jira });
      onSaved(git, jira);
      onClose();
    } catch (e) {
      toast({ title: errText(e, t('settings.links.saveFailed')), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settings.mine.title', { project: link.gitProject })}</DialogTitle>
          <DialogDescription>{t('settings.mine.body')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{t('settings.links.gitConnection')}</Label>
            <Select value={git || LINKS} onValueChange={(v) => setGit(v === LINKS ? '' : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={LINKS}>{t('settings.mine.linkDefault', { name: linkGit })}</SelectItem>
                {gitConns.filter((c) => c.id !== link.gitConnectionId).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {link.jiraProjectKey && (
            <div className="grid gap-1.5">
              <Label>{t('settings.links.jiraConnection')}</Label>
              <Select value={jira || LINKS} onValueChange={(v) => setJira(v === LINKS ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={LINKS}>{t('settings.mine.linkDefault', { name: linkJira })}</SelectItem>
                  {jiraConns.filter((c) => c.id !== link.jiraConnectionId).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('settings.mine.note')}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('settings.links.cancel')}</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{t('settings.links.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** GitLab webhook for a link: a secret, the URL, and "Create in GitLab". */
function WebhookDialog({ link, onClose }: { link: QAProjectLink; onClose: () => void }) {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const [secret, setSecret] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const res = await qaAPI.webhookSecret(link.id);
      let base = getRemoteBaseUrl().replace(/\/+$/, '').replace(/\/api$/, '');
      if (!/^https?:/.test(base)) base = window.location.origin + base;
      setUrl(base + res.data.path);
      setSecret(res.data.secret);
    } catch (e) {
      toast({ title: errText(e, t('settings.links.saveFailed')), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  const install = async () => {
    setBusy(true);
    try {
      await qaAPI.installWebhook(link.id, url, secret);
      toast({ title: t('settings.webhook.installed') });
    } catch (e) {
      toast({ title: errText(e, t('settings.webhook.installFailed')), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  const copy = (v: string) => { void navigator.clipboard.writeText(v).then(() => toast({ title: t('review.copied') }), () => undefined); };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('settings.webhook.title')} · {link.gitProject}</DialogTitle>
          <DialogDescription>{t('settings.webhook.body')}</DialogDescription>
        </DialogHeader>
        {link.webhookAt && <p className="text-xs text-emerald-600 dark:text-emerald-400">{t('settings.webhook.lastEvent', { when: new Date(link.webhookAt).toLocaleString() })}</p>}
        {!secret ? (
          <div className="space-y-2">
            {link.hasWebhook && <p className="text-xs text-muted-foreground">{t('settings.webhook.exists')}</p>}
            <Button size="sm" onClick={() => void make()} disabled={busy}>{busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{link.hasWebhook ? t('settings.webhook.regenerate') : t('settings.webhook.create')}</Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>{t('settings.webhook.url')}</Label>
              <div className="flex gap-2"><Input value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-xs" /><Button size="sm" variant="outline" onClick={() => copy(url)}>{t('review.copy')}</Button></div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t('settings.webhook.secret')}</Label>
              <div className="flex gap-2"><Input readOnly value={secret} className="font-mono text-xs" /><Button size="sm" variant="outline" onClick={() => copy(secret)}>{t('review.copy')}</Button></div>
              <p className="text-xs text-muted-foreground">{t('settings.webhook.secretOnce')}</p>
            </div>
            <p className="text-xs text-muted-foreground">{t('settings.webhook.events')}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('radar.close')}</Button>
          {secret && <Button onClick={() => void install()} disabled={busy}>{busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{t('settings.webhook.install')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
