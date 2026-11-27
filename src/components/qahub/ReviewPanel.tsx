import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, Loader2, Pencil, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { qaAPI } from '@/services/api';
import type { QAFindingSeverity, QAMRRef, QAReview, QAReviewFinding } from '@/types';
import { REVIEW_TOOLS, reviewPrompt } from './agentLaunch';
import { AgentRunCard } from './AgentRun';
import { VerifyPanel } from './VerifyPanel';
import { mrLabel, useAge } from './qaRadarUtil';

const SEV_TONE: Record<QAFindingSeverity, string> = {
  blocker: 'border-red-500/50 bg-red-500/15 text-red-600 dark:text-red-400',
  major: 'border-orange-500/50 bg-orange-500/15 text-orange-700 dark:text-orange-400',
  minor: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  nit: 'border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-300',
};

function errText(e: unknown, fallback: string) {
  return (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

function FindingCard({ f, editable, onDecide }: {
  f: QAReviewFinding;
  editable: boolean;
  onDecide: (fid: string, data: { status?: string; title?: string; body?: string }) => Promise<void>;
}) {
  const { t } = useTranslation('qa');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(f.title);
  const [body, setBody] = useState(f.body);
  const [busy, setBusy] = useState(false);
  const act = async (data: { status?: string; title?: string; body?: string }) => {
    setBusy(true);
    await onDecide(f.id, data);
    setBusy(false);
  };
  return (
    <div className={cn('rounded-lg border p-3', f.status === 'rejected' && 'opacity-50', f.status === 'posted' && 'border-emerald-500/40')}>
      <div className="flex flex-wrap items-start gap-2">
        <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase', SEV_TONE[f.severity])}>{t(`review.severity.${f.severity}`)}</span>
        {editing ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-0 flex-1 rounded border bg-background px-2 py-0.5 text-sm" aria-label={t('review.findingTitle')} />
        ) : (
          <span className="min-w-0 flex-1 text-sm font-medium">{f.title}</span>
        )}
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t(`review.status.${f.status}`)}</span>
      </div>
      {f.file && <div className="mt-1 font-mono text-[11px] text-muted-foreground">{f.file}{f.line ? `:${f.line}` : ''}{f.status === 'posted' && f.inline === false ? ` · ${t('review.postedGeneral')}` : ''}</div>}
      {editing ? (
        <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} className="mt-2 text-xs" aria-label={t('review.findingBody')} />
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-xs text-foreground/90">{f.body}</p>
      )}
      {f.suggestion && !editing && <pre className="mt-2 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">{f.suggestion}</pre>}
      {f.postError && <p className="mt-2 text-[11px] text-destructive">{f.postError}</p>}
      {editable && f.status !== 'posted' && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {editing ? (
            <>
              <Button size="sm" className="h-7 gap-1 text-xs" disabled={busy} onClick={async () => { await act({ title, body }); setEditing(false); }}><Check className="h-3 w-3" />{t('review.saveEdit')}</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditing(false); setTitle(f.title); setBody(f.body); }}>{t('settings.links.cancel')}</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant={f.status === 'approved' ? 'default' : 'outline'} className="h-7 gap-1 text-xs" disabled={busy} onClick={() => void act({ status: f.status === 'approved' ? 'pending' : 'approved' })}><Check className="h-3 w-3" />{t('review.approve')}</Button>
              <Button size="sm" variant={f.status === 'rejected' ? 'secondary' : 'ghost'} className="h-7 gap-1 text-xs" disabled={busy} onClick={() => void act({ status: f.status === 'rejected' ? 'pending' : 'rejected' })}><X className="h-3 w-3" />{t('review.reject')}</Button>
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setEditing(true)}><Pencil className="h-3 w-3" />{t('review.edit')}</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// The MR's AI review at its current head (CR_QA_RFC P1): findings to
// approve / reject / edit, then post the approved ones to GitLab / GitHub
// with your own credentials. Without a review: launch your agent.
export function ReviewPanel({ mr }: { mr: QAMRRef }) {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const age = useAge();
  const [reviews, setReviews] = useState<QAReview[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await qaAPI.reviews({ linkId: mr.linkId, iid: mr.iid });
      setReviews(res.data);
    } catch (e) {
      toast({ title: errText(e, t('review.loadFailed')), variant: 'destructive' });
      setReviews([]);
    }
  }, [mr.linkId, mr.iid, t, toast]);
  useEffect(() => { void load(); }, [load]);

  const current = useMemo(() => {
    const list = (reviews ?? []).filter((r) => r.status !== 'discarded');
    return list.find((r) => r.headSha === mr.headSha) ?? list[0] ?? null;
  }, [reviews, mr.headSha]);

  const decide = async (fid: string, data: { status?: string; title?: string; body?: string }) => {
    if (!current) return;
    try {
      const res = await qaAPI.decideFinding(current.id, fid, data);
      setReviews((rs) => (rs ?? []).map((r) => (r.id === res.data.id ? res.data : r)));
    } catch (e) {
      toast({ title: errText(e, t('review.decideFailed')), variant: 'destructive' });
    }
  };

  const post = async () => {
    if (!current) return;
    const n = current.findings.filter((f) => f.status === 'approved').length;
    if (!(await confirmDialog({ title: t('review.postConfirmTitle', { count: n }), description: t('review.postConfirmBody', { mr: mrLabel(mr) }) }))) return;
    setPosting(true);
    try {
      const res = await qaAPI.postReview(current.id);
      setReviews((rs) => (rs ?? []).map((r) => (r.id === res.data.review.id ? res.data.review : r)));
      toast({ title: t('review.posted', { count: res.data.posted }), description: res.data.failed ? t('review.postFailedSome', { count: res.data.failed }) : undefined });
    } catch (e) {
      toast({ title: errText(e, t('review.postFailed')), variant: 'destructive' });
    } finally {
      setPosting(false);
    }
  };

  const discard = async () => {
    if (!current) return;
    if (!(await confirmDialog({ title: t('review.discardTitle'), description: t('review.discardBody'), destructive: true }))) return;
    try {
      await qaAPI.discardReview(current.id);
      await load();
    } catch (e) {
      toast({ title: errText(e, t('review.decideFailed')), variant: 'destructive' });
    }
  };

  if (reviews === null) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('review.loading')}</div>;

  const prompt = reviewPrompt(mr.linkId, mr.iid, mrLabel(mr));
  const atHead = current && current.headSha === mr.headSha;
  if (!current || !atHead || current.status === 'claimed') {
    return (
      <div className="space-y-4 p-5">
        <VerifyPanel mr={mr} reviews={reviews} onChanged={() => void load()} />
        {current && current.status === 'claimed' && atHead && (
          <div className="flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs"><Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />{t('review.inProgress', { when: age(current.updatedAt) })}</div>
        )}
        {current && !atHead && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">{t('review.olderOnly')}</div>
        )}
        <AgentRunCard
          runKey={`review:${mr.linkId}:${mr.iid}`}
          prompt={prompt}
          tools={REVIEW_TOOLS}
          title={t('review.withAgent')}
          hint={t('review.withAgentHint')}
          doneCheck={async () => {
            const res = await qaAPI.reviews({ linkId: mr.linkId, iid: mr.iid });
            return res.data.some((r) => r.headSha === mr.headSha && (r.status === 'draft' || r.status === 'stale' || r.status === 'posted'));
          }}
          onDone={() => void load()}
        />
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => void load()}><RefreshCw className="h-3 w-3" />{t('radar.refresh')}</Button>
      </div>
    );
  }

  const visible = current.findings.filter((f) => showAll || f.severity === 'blocker' || f.severity === 'major');
  const hidden = current.findings.length - visible.length;
  const approved = current.findings.filter((f) => f.status === 'approved').length;
  return (
    <div className="space-y-4 p-5">
      <VerifyPanel mr={mr} reviews={reviews} onChanged={() => void load()} />
      <div className="flex flex-wrap items-center gap-2">
        <Bot className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">{t('review.title')}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase', current.status === 'stale' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : current.status === 'posted' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>{t(`review.reviewStatus.${current.status}`)}</span>
        <span className="text-[11px] text-muted-foreground">{[current.agent, current.model].filter(Boolean).join(' · ')} · {age(current.updatedAt)}</span>
        <span className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => void discard()}><Trash2 className="h-3 w-3" />{t('review.discard')}</Button>
          <Button size="sm" className="h-7 gap-1 text-xs" disabled={!approved || posting || current.status === 'stale'} onClick={() => void post()}>
            {posting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}{t('review.postApproved', { count: approved })}
          </Button>
        </span>
      </div>
      {current.status === 'stale' && <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">{t('review.staleNote')}</p>}
      {current.summary && <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">{current.summary}</p>}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={showAll} onCheckedChange={setShowAll} aria-label={t('review.showAll')} />
        {t('review.showAll')}{hidden > 0 && !showAll ? ` (${t('review.hiddenCount', { count: hidden })})` : ''}
      </div>
      {current.findings.length === 0 && <p className="text-sm text-muted-foreground">{t('review.noFindings')}</p>}
      <div className="space-y-2">
        {visible.map((f) => <FindingCard key={f.id} f={f} editable={current.status !== 'stale'} onDecide={decide} />)}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('review.approverNote')}</p>
    </div>
  );
}
