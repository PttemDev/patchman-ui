import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Loader2, Pencil, SmilePlus, Tag, UserPlus, X } from 'lucide-react';
import { gitAPI } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import type { GitLabel, GitMember, GitMilestone, GitMRAward, GitMRDetail } from '@/types';
import { MarkdownEditor } from './GitMRMarkdown';
import { extractErr } from './util';

// GitLab MR page parity: emoji awards, the copy menu (reference, branch,
// checkout commands), people / labels / milestone summary and the edit dialog.

const stripDraft = (s: string) => s.replace(/^(Draft:|\[Draft\]|\(Draft\))\s*/i, '');

// ── awards ──────────────────────────────────────────────────────────────

/** The awards both GitLab and GitHub support (GitLab names). */
const AWARDS: { name: string; glyph: string }[] = [
  { name: 'thumbsup', glyph: '👍' }, { name: 'thumbsdown', glyph: '👎' }, { name: 'smile', glyph: '😄' },
  { name: 'tada', glyph: '🎉' }, { name: 'confused', glyph: '😕' }, { name: 'heart', glyph: '❤️' },
  { name: 'rocket', glyph: '🚀' }, { name: 'eyes', glyph: '👀' },
];
const glyphOf = (name: string) => AWARDS.find((a) => a.name === name)?.glyph ?? `:${name}:`;

export function MRAwardsBar({ connId, project, iid, canWrite }: { connId: string; project: string; iid: number; canWrite: boolean }) {
  const { t } = useTranslation('git');
  const { toast } = useToast();
  const [awards, setAwards] = useState<GitMRAward[]>([]);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    gitAPI.mrAwards(connId, { project, iid }).then((r) => setAwards((r.data as GitMRAward[]) ?? [])).catch(() => setAwards([]));
  }, [connId, project, iid]);
  useEffect(() => { load(); }, [load]);
  const toggle = async (name: string) => {
    const cur = awards.find((a) => a.name === name);
    setBusy(name);
    try {
      await gitAPI.toggleMRAward(connId, project, iid, name, !cur?.mine);
      load();
    } catch (e) {
      toast({ title: t('mr.actionFailed'), description: extractErr(e, t('mr.actionFailed')), variant: 'destructive' });
    } finally {
      setBusy('');
    }
  };
  // 👍 / 👎 always show (like GitLab), the rest once someone used them.
  const shown = AWARDS.filter((a) => a.name === 'thumbsup' || a.name === 'thumbsdown' || awards.some((x) => x.name === a.name && x.count > 0));
  const extra = awards.filter((a) => !AWARDS.some((x) => x.name === a.name));
  return (
    <div className="flex flex-wrap items-center gap-1">
      {[...shown.map((a) => a.name), ...extra.map((a) => a.name)].map((name) => {
        const a = awards.find((x) => x.name === name);
        return (
          <button key={name} type="button" disabled={!canWrite || !!busy} onClick={() => void toggle(name)}
            title={a?.users.length ? a.users.join(', ') : t('mr.awards.react', { name })}
            className={cn('flex h-6 items-center gap-1 rounded-full border px-2 text-[11px]', a?.mine ? 'border-primary bg-primary/10' : 'hover:bg-accent/50', !canWrite && 'cursor-default')}>
            {busy === name ? <Loader2 className="h-3 w-3 animate-spin" /> : <span>{glyphOf(name)}</span>}
            <span className="tabular-nums">{a?.count ?? 0}</span>
          </button>
        );
      })}
      {canWrite && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex h-6 w-6 items-center justify-center rounded-full border text-muted-foreground hover:bg-accent/50" title={t('mr.awards.add')} aria-label={t('mr.awards.add')}>
              <SmilePlus className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="flex gap-0.5 p-1">
            {AWARDS.map((a) => (
              <button key={a.name} type="button" className="rounded p-1 text-base hover:bg-accent" title={a.name} onClick={() => void toggle(a.name)}>{a.glyph}</button>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ── copy menu ───────────────────────────────────────────────────────────

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The checkout commands GitLab / GitHub suggest ("Code → Check out branch"). */
function checkoutCommands(mr: GitMRDetail, pr?: string): string {
  const src = mr.sourceBranch;
  if (pr) return `git fetch origin pull/${mr.iid}/head:${shq(src)}\ngit checkout ${shq(src)}`;
  if (mr.fork) return `git fetch origin merge-requests/${mr.iid}/head:mr-${mr.iid}\ngit checkout mr-${mr.iid}`;
  return `git fetch origin\ngit checkout -b ${shq(src)} ${shq(`origin/${src}`)}`;
}

export function MRCopyMenu({ mr, pr }: { mr: GitMRDetail; pr?: string }) {
  const { t } = useTranslation('git');
  const { toast } = useToast();
  const copy = (text: string, what: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast({ title: t('mr.copy.done', { what }) }),
      () => toast({ title: t('mr.copy.failed'), variant: 'destructive' }),
    );
  };
  const ref = mr.reference || `${pr ? '#' : '!'}${mr.iid}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"><Copy className="h-3.5 w-3.5" />{t('mr.copy.menu')}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="text-xs">
        <DropdownMenuItem onSelect={() => copy(ref, t('mr.copy.reference'))}>{t('mr.copy.reference')} <span className="ml-auto pl-3 font-mono text-[10px] text-muted-foreground">{ref}</span></DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copy(mr.sourceBranch, t('mr.copy.sourceBranch'))}>{t('mr.copy.sourceBranch')} <span className="ml-auto max-w-[160px] truncate pl-3 font-mono text-[10px] text-muted-foreground">{mr.sourceBranch}</span></DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copy(mr.webUrl, t('mr.copy.link'))}>{t('mr.copy.link')}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => copy(checkoutCommands(mr, pr), t('mr.copy.checkout'))}>{t('mr.copy.checkout')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── people / labels summary ─────────────────────────────────────────────

function People({ label, people }: { label: string; people: GitMember[] }) {
  const { t } = useTranslation('git');
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      {people.length === 0 ? <span className="text-muted-foreground">{t('mr.meta.none')}</span> : people.map((p) => (
        <span key={p.id || p.username} className="flex items-center gap-1 rounded-full border px-1.5 py-px" title={`@${p.username}`}>
          {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="h-3.5 w-3.5 rounded-full" /> : null}{p.name || p.username}
        </span>
      ))}
    </div>
  );
}

/** Assignees, reviewers, labels, milestone (GitLab's right sidebar, inline). */
export function MRMetaSummary({ mr, onEdit }: { mr: GitMRDetail; onEdit?: () => void }) {
  const { t } = useTranslation('git');
  if (mr.assignees === undefined && mr.reviewers === undefined) return null; // older backend
  return (
    <div className="group relative space-y-1.5 rounded-md border bg-card p-3 text-[11px]">
      {onEdit && (
        <button type="button" onClick={onEdit} title={t('mr.edit.open')} aria-label={t('mr.edit.open')}
          className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100">
          <Pencil className="h-3 w-3" />
        </button>
      )}
      <People label={t('mr.meta.assignees')} people={mr.assignees ?? []} />
      <People label={t('mr.meta.reviewers')} people={mr.reviewers ?? []} />
      <div className="flex flex-wrap items-center gap-1">
        <span className="w-20 shrink-0 text-muted-foreground">{t('mr.meta.labels')}</span>
        {(mr.labels ?? []).length === 0 ? <span className="text-muted-foreground">{t('mr.meta.none')}</span> : (mr.labels ?? []).map((l) => (
          <span key={l} className="flex items-center gap-1 rounded-full bg-secondary px-2 py-px"><Tag className="h-2.5 w-2.5" />{l}</span>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <span className="w-20 shrink-0 text-muted-foreground">{t('mr.meta.milestone')}</span>
        <span className={cn(!mr.milestone && 'text-muted-foreground')}>{mr.milestone?.title ?? t('mr.meta.none')}</span>
      </div>
      {mr.state === 'merged' && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="w-20 shrink-0 text-muted-foreground">{t('mr.meta.mergedBy')}</span>
          <span>{mr.mergedBy?.name ?? '—'}</span>
          {(mr.squashCommitSha || mr.mergeCommitSha) && <span className="font-mono text-muted-foreground">{(mr.squashCommitSha || mr.mergeCommitSha || '').slice(0, 8)}</span>}
        </div>
      )}
    </div>
  );
}

// ── member picker ───────────────────────────────────────────────────────

function MemberPicker({ connId, project, value, onChange, placeholder }: {
  connId: string; project: string; value: GitMember[]; onChange: (v: GitMember[]) => void; placeholder: string;
}) {
  const { t } = useTranslation('git');
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<GitMember[]>([]);
  useEffect(() => {
    if (query.trim().length < 2) { setMembers([]); return; }
    const h = setTimeout(() => {
      gitAPI.projectMembers(connId, { project, query: query.trim() }).then((r) => setMembers((r.data as GitMember[]) ?? [])).catch(() => setMembers([]));
    }, 250);
    return () => clearTimeout(h);
  }, [query, connId, project]);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
        {value.map((r) => (
          <span key={r.id} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">{r.name || r.username}
            <button type="button" aria-label={t('mr.edit.removePerson')} onClick={() => onChange(value.filter((y) => y.id !== r.id))}><X className="h-3 w-3" /></button>
          </span>
        ))}
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} className="h-7 w-44 text-xs" />
      </div>
      {members.length > 0 && (
        <div className="max-h-32 overflow-auto rounded border">
          {members.filter((m) => !value.some((r) => r.id === m.id)).map((m) => (
            <button key={m.id} type="button" className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent/50"
              onClick={() => { onChange([...value, m]); setQuery(''); }}>
              <span>{m.name}</span><span className="text-muted-foreground">@{m.username}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── edit dialog ─────────────────────────────────────────────────────────

const sameIds = (a: GitMember[], b: GitMember[]) => a.length === b.length && a.every((x) => b.some((y) => y.id === x.id));

export function EditMRDialog({ open, onOpenChange, connId, project, mr, pr, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connId: string;
  project: string;
  mr: GitMRDetail;
  pr?: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation('git');
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState(false);
  const [desc, setDesc] = useState('');
  const [target, setTarget] = useState('');
  const [assignees, setAssignees] = useState<GitMember[]>([]);
  const [reviewers, setReviewers] = useState<GitMember[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [labelQuery, setLabelQuery] = useState('');
  const [milestone, setMilestone] = useState<number>(0);
  const [squash, setSquash] = useState(false);
  const [removeSource, setRemoveSource] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [allLabels, setAllLabels] = useState<GitLabel[]>([]);
  const [milestones, setMilestones] = useState<GitMilestone[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(stripDraft(mr.title)); setDraft(mr.draft); setDesc(mr.description ?? ''); setTarget(mr.targetBranch);
    setAssignees(mr.assignees ?? []); setReviewers(mr.reviewers ?? []); setLabels(mr.labels ?? []); setLabelQuery('');
    setMilestone(mr.milestone?.id ?? 0); setSquash(!!mr.squash); setRemoveSource(!!mr.removeSourceBranch); setErr('');
    gitAPI.branches(connId, { project }).then((r) => setBranches(((r.data as { name: string }[]) ?? []).map((b) => b.name))).catch(() => setBranches([]));
    gitAPI.projectLabels(connId, { project }).then((r) => setAllLabels((r.data as GitLabel[]) ?? [])).catch(() => setAllLabels([]));
    gitAPI.projectMilestones(connId, { project }).then((r) => setMilestones((r.data as GitMilestone[]) ?? [])).catch(() => setMilestones([]));
  }, [open, mr, connId, project]);

  const save = async () => {
    const body: Record<string, unknown> = {};
    // GitLab keeps "Draft:" in the title: send both so a title edit never drops it.
    if (title.trim() !== stripDraft(mr.title) || draft !== mr.draft) { body.title = title.trim(); body.draft = draft; }
    if (desc !== (mr.description ?? '')) body.description = desc;
    if (target.trim() && target.trim() !== mr.targetBranch) body.targetBranch = target.trim();
    if (!sameIds(assignees, mr.assignees ?? [])) body.assigneeIds = assignees.map((a) => a.id);
    if (!sameIds(reviewers, mr.reviewers ?? [])) body.reviewerIds = reviewers.map((a) => a.id);
    const curLabels = mr.labels ?? [];
    if (labels.length !== curLabels.length || labels.some((l) => !curLabels.includes(l))) body.labels = labels.join(',');
    if (milestone !== (mr.milestone?.id ?? 0)) body.milestoneId = milestone;
    if (!pr) {
      if (squash !== !!mr.squash) body.squash = squash;
      if (removeSource !== !!mr.removeSourceBranch) body.removeSourceBranch = removeSource;
    }
    if (Object.keys(body).length === 0) { onOpenChange(false); return; }
    setBusy(true);
    setErr('');
    try {
      await gitAPI.updateMR(connId, project, mr.iid, body);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setErr(extractErr(e, t('mr.actionFailed')));
    } finally {
      setBusy(false);
    }
  };

  const labelSuggestions = allLabels.filter((l) => !labels.includes(l.name) && (!labelQuery.trim() || l.name.toLowerCase().includes(labelQuery.trim().toLowerCase()))).slice(0, 30);
  const addLabel = (name: string) => { const n = name.trim(); if (n && !labels.includes(n)) setLabels([...labels, n]); setLabelQuery(''); };
  const colorOf = (name: string) => allLabels.find((l) => l.name === name)?.color;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t('mr.edit.title', { iid: mr.iid, context: pr })}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-xs">
          <div className="space-y-1">
            <div className="font-medium">{t('mr.edit.titleLabel')}</div>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-xs" />
            <label className="flex items-center gap-2 pt-1"><Switch checked={draft} onCheckedChange={setDraft} className="scale-90" />{t('mr.edit.draft')}</label>
          </div>
          <div className="space-y-1">
            <div className="font-medium">{t('mr.edit.description')}</div>
            <MarkdownEditor value={desc} onChange={setDesc} onSubmit={() => void save()} placeholder={t('mr.descriptionPlaceholder')} minHeight={160} />
          </div>
          <div className="space-y-1">
            <div className="font-medium">{t('mr.edit.targetBranch')}</div>
            <datalist id="pm-mr-edit-branches">{branches.map((b) => <option key={b} value={b} />)}</datalist>
            <Input list="pm-mr-edit-branches" value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 font-mono text-xs" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="font-medium">{t('mr.meta.assignees')}</div>
              <MemberPicker connId={connId} project={project} value={assignees} onChange={setAssignees} placeholder={t('mr.edit.addAssignee')} />
            </div>
            <div className="space-y-1">
              <div className="font-medium">{t('mr.meta.reviewers')}</div>
              <MemberPicker connId={connId} project={project} value={reviewers} onChange={setReviewers} placeholder={t('mr.addReviewer')} />
            </div>
          </div>
          <div className="space-y-1">
            <div className="font-medium">{t('mr.meta.labels')}</div>
            <div className="flex flex-wrap items-center gap-1">
              {labels.map((l) => (
                <span key={l} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
                  <span className="h-2 w-2 rounded-full" style={{ background: colorOf(l) ?? 'currentColor', opacity: colorOf(l) ? 1 : 0.4 }} />{l}
                  <button type="button" aria-label={t('mr.edit.removeLabel')} onClick={() => setLabels(labels.filter((x) => x !== l))}><X className="h-3 w-3" /></button>
                </span>
              ))}
              <Input value={labelQuery} onChange={(e) => setLabelQuery(e.target.value)} placeholder={t('mr.edit.addLabel')} className="h-7 w-40 text-xs"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLabel(labelQuery); } }} />
            </div>
            {labelQuery.trim() !== '' && labelSuggestions.length > 0 && (
              <div className="flex max-h-24 flex-wrap gap-1 overflow-auto rounded border p-1">
                {labelSuggestions.map((l) => (
                  <button key={l.name} type="button" onClick={() => addLabel(l.name)} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] hover:bg-accent/50">
                    <span className="h-2 w-2 rounded-full" style={{ background: l.color ?? 'currentColor' }} />{l.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1">
            <div className="font-medium">{t('mr.meta.milestone')}</div>
            <select value={milestone} onChange={(e) => setMilestone(Number(e.target.value))} aria-label={t('mr.meta.milestone')}
              className="h-8 w-full rounded-md border bg-background px-2 text-xs">
              <option value={0}>{t('mr.meta.none')}</option>
              {mr.milestone && !milestones.some((m) => m.id === mr.milestone?.id) && <option value={mr.milestone.id}>{mr.milestone.title}</option>}
              {milestones.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </div>
          {!pr && (
            <div className="flex flex-wrap gap-4 pt-1">
              <label className="flex items-center gap-2"><Switch checked={removeSource} onCheckedChange={setRemoveSource} className="scale-90" />{t('mr.removeSource')}</label>
              <label className="flex items-center gap-2"><Switch checked={squash} onCheckedChange={setSquash} className="scale-90" />{t('mr.squash')}</label>
            </div>
          )}
          {err && <p className="text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>{t('vcs.cancel')}</Button>
          <Button size="sm" disabled={busy || !title.trim()} onClick={() => void save()}>
            {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}{t('mr.edit.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
