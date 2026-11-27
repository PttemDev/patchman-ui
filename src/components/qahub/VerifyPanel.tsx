import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCheck, ListChecks, Loader2, MessageSquareReply } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { qaAPI } from '@/services/api';
import type { QAMRRef, QAReview, QAReviewFinding, QAVerdict, QAVerification } from '@/types';
import { VERIFY_TOOLS, verifyPrompt } from './agentLaunch';
import { AgentRunCard } from './AgentRun';
import { mrLabel, useAge } from './qaRadarUtil';

const VERDICT_TONE: Record<QAVerdict, string> = {
  fixed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  obsolete: 'border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-300',
  partly: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  not_fixed: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400',
};

const isOpen = (f: QAReviewFinding) => f.status === 'posted' && !f.resolved && f.verdict !== 'fixed' && f.verdict !== 'obsolete';

function errText(e: unknown, fallback: string) {
  return (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

// Fix check (CR_QA_P4_RFC §1): after findings were posted and new commits
// came in, your agent says per finding whether it was fixed. You then
// resolve the verified threads / reply on the open ones under your name.
export function VerifyPanel({ mr, reviews, onChanged }: { mr: QAMRRef; reviews: QAReview[]; onChanged: () => void }) {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const age = useAge();
  const [list, setList] = useState<QAVerification[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await qaAPI.verifications(mr.linkId, mr.iid);
      setList(res.data);
    } catch {
      setList([]);
    }
  }, [mr.linkId, mr.iid]);
  // Reload with the reviews (the panel's Refresh, posts, decisions).
  useEffect(() => { void load(); }, [load, reviews]);

  // Findings by id across the MR's reviews (verdicts point at them).
  const byId = useMemo(() => {
    const m = new Map<string, QAReviewFinding>();
    for (const r of reviews) for (const f of r.findings) m.set(f.id, f);
    return m;
  }, [reviews]);
  const openOlder = useMemo(
    () => reviews.filter((r) => r.headSha !== mr.headSha && r.status !== 'discarded').flatMap((r) => r.findings.filter(isOpen)),
    [reviews, mr.headSha],
  );
  const atHead = (list ?? []).find((v) => v.headSha === mr.headSha) ?? null;
  const done = atHead && atHead.status !== 'claimed' ? atHead : null;

  if (list === null) return null;
  if (!done && openOlder.length === 0) return null;

  const toResolve = done ? done.verdicts.filter((v) => !v.applied && (v.verdict === 'fixed' || v.verdict === 'obsolete')).map((v) => v.findingId) : [];
  const toReply = done ? done.verdicts.filter((v) => !v.applied && (v.verdict === 'not_fixed' || v.verdict === 'partly')).map((v) => v.findingId) : [];

  const apply = async (resolve: string[], reply: string[]) => {
    if (!done) return;
    const ok = await confirmDialog({
      title: resolve.length ? t('verify.resolveConfirmTitle', { count: resolve.length }) : t('verify.replyConfirmTitle', { count: reply.length }),
      description: t('verify.applyConfirmBody', { mr: mrLabel(mr) }),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await qaAPI.applyVerification(done.id, { resolve, reply });
      setList((l) => (l ?? []).map((v) => (v.id === res.data.verification.id ? res.data.verification : v)));
      toast({ title: t('verify.applied', { count: res.data.sent }), description: res.data.failed ? t('verify.appliedFailed', { count: res.data.failed }) : undefined });
      onChanged();
    } catch (e) {
      toast({ title: errText(e, t('verify.applyFailed')), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-teal-500/30 bg-teal-500/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ListChecks className="h-4 w-4 text-teal-600 dark:text-teal-400" />
        <span className="text-sm font-semibold">{t('verify.title')}</span>
        {done ? (
          <span className="text-[11px] text-muted-foreground">
            {(['fixed', 'not_fixed', 'partly', 'obsolete'] as QAVerdict[]).filter((k) => done.counts[k]).map((k) => `${done.counts[k]} ${t(`verify.verdict.${k}`)}`).join(' · ')}
            {' · '}{[done.agent, done.model].filter(Boolean).join(' · ')} · {age(done.updatedAt)}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">{t('verify.openCount', { count: openOlder.length })}</span>
        )}
      </div>

      {!done && (
        <>
          {atHead?.status === 'claimed' && (
            <div className="flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs"><Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />{t('verify.inProgress', { when: age(atHead.updatedAt) })}</div>
          )}
          <AgentRunCard
            runKey={`verify:${mr.linkId}:${mr.iid}`}
            prompt={verifyPrompt(mr.linkId, mr.iid, mrLabel(mr))}
            tools={VERIFY_TOOLS}
            title={t('verify.withAgent')}
            hint={t('verify.withAgentHint')}
            doneCheck={async () => {
              const res = await qaAPI.verifications(mr.linkId, mr.iid);
              return res.data.some((v) => v.headSha === mr.headSha && v.status !== 'claimed');
            }}
            onDone={() => { void load(); onChanged(); }}
          />
        </>
      )}

      {done && (
        <>
          {done.summary && <p className="whitespace-pre-wrap text-xs text-foreground/90">{done.summary}</p>}
          <div className="space-y-1.5">
            {done.verdicts.map((v) => {
              const f = byId.get(v.findingId);
              return (
                <div key={v.findingId} className="rounded-lg border bg-background/60 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase', VERDICT_TONE[v.verdict])}>{t(`verify.verdict.${v.verdict}`)}</span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{f?.title ?? v.findingId}</span>
                    {v.applied && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t(`verify.appliedState.${v.applied}`)}</span>}
                  </div>
                  {f?.file && <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{f.file}{f.line ? `:${f.line}` : ''}</div>}
                  {v.evidence && <p className="mt-1 text-[11px] text-foreground/80">{v.evidence}</p>}
                  {v.applyError && <p className="mt-1 text-[11px] text-destructive">{v.applyError}</p>}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-7 gap-1 text-xs" disabled={busy || !toResolve.length} onClick={() => void apply(toResolve, [])}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}{t('verify.resolveVerified', { count: toResolve.length })}
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={busy || !toReply.length} onClick={() => void apply([], toReply)}>
              <MessageSquareReply className="h-3 w-3" />{t('verify.replyOpen', { count: toReply.length })}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('verify.applyNote')}</p>
        </>
      )}
    </div>
  );
}
