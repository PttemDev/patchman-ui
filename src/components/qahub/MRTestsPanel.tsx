import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, CircleSlash, FlaskConical, Loader2, MessageSquare, Play, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { qaAPI } from '@/services/api';
import { useEnvironmentStore } from '@/stores/environmentStore';
import type { QAMRRef, QAMRTests } from '@/types';
import { AgentRunCard } from './AgentRun';
import { TEST_TOOLS, testsPrompt } from './agentLaunch';
import { mrLabel, useAge } from './qaRadarUtil';

const NONE = '__none__';

function errText(e: unknown, fallback: string) {
  return (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

// MR tests (CR_QA_RFC P2): cases linked to the MR (its ref or Jira key),
// drafted by your agent from the acceptance criteria; one click runs them on
// the link's test environment; results go to the MR or Jira on your click.
export function MRTestsPanel({ mr }: { mr: QAMRRef }) {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const age = useAge();
  const envs = useEnvironmentStore((s) => s.environments);
  const [data, setData] = useState<QAMRTests | null>(null);
  const [env, setEnv] = useState<string>('');
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await qaAPI.mrTests(mr.linkId, mr.iid);
      const d = { ...res.data, cases: res.data.cases ?? [], runs: res.data.runs ?? [] };
      setData(d);
      setEnv((e) => e || d.environmentId || '');
    } catch (e) {
      toast({ title: errText(e, t('mrTests.loadFailed')), variant: 'destructive' });
    }
  }, [mr.linkId, mr.iid, t, toast]);
  useEffect(() => { void load(); }, [load]);

  const run = async () => {
    setRunning(true);
    try {
      const res = await qaAPI.runMRTests(mr.linkId, mr.iid, env || undefined);
      const s = res.data.summary;
      toast({ title: t('mrTests.ran', { passed: s.passed, failed: s.failed, skipped: s.skipped + (s.drafts ?? 0) }) });
      await load();
    } catch (e) {
      toast({ title: errText(e, t('mrTests.runFailed')), variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const post = async (runId: string, target: 'mr' | 'jira') => {
    if (!(await confirmDialog({ title: t(`mrTests.postTitle.${target}`), description: t(`mrTests.postBody.${target}`, { mr: mrLabel(mr), key: data?.jiraKey ?? '' }) }))) return;
    try {
      await qaAPI.postMRTestResults(mr.linkId, mr.iid, runId, target);
      toast({ title: t('mrTests.posted') });
    } catch (e) {
      toast({ title: errText(e, t('review.postFailed')), variant: 'destructive' });
    }
  };

  if (!data) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('review.loading')}</div>;
  const executable = data.cases.filter((c) => c.executable && c.status === 'active').length;
  const drafts = data.cases.filter((c) => c.status !== 'active').length;

  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <FlaskConical className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">{t('mrTests.title')}</span>
        {data.jiraKey && <span className="rounded bg-muted px-1.5 font-mono text-[11px]">{data.jiraKey}</span>}
        <span className="ml-auto flex items-center gap-2">
          <Select value={env || NONE} onValueChange={(v) => setEnv(v === NONE ? '' : v)}>
            <SelectTrigger className="h-8 w-[200px] text-xs" aria-label={t('settings.links.testEnv')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('mrTests.noEnv')}</SelectItem>
              {envs.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={running || executable === 0} onClick={() => void run()}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{t('mrTests.run', { count: executable })}
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => void load()} aria-label={t('radar.refresh')}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </span>
      </div>

      {drafts > 0 && <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">{t('mrTests.draftsNote', { count: drafts })}</p>}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('mrTests.cases')}</h4>
        {data.cases.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('mrTests.noCases')}</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {data.cases.map((c) => (
              <div key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="text-[11px] text-muted-foreground">{c.mrRef ? t('mrTests.byMR') : t('mrTests.byJira')}</span>
                <span className={cn('rounded px-1.5 text-[10px]', c.executable ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground')}>{c.executable ? t('mrTests.automated') : t('mrTests.manual')}</span>
                <span className="text-[10px] uppercase text-muted-foreground">{c.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <AgentRunCard runKey={`tests:${mr.linkId}:${mr.iid}`} prompt={testsPrompt(mr.linkId, mr.iid, mrLabel(mr))} tools={TEST_TOOLS}
        title={t('mrTests.draftWithAgent')} hint={t('mrTests.draftHint')} />

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('mrTests.runs')}</h4>
        {data.runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('mrTests.noRuns')}</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {data.runs.map((r) => {
              const results = r.results ?? [];
              const passed = results.filter((x) => x.status === 'passed').length;
              const failed = results.length - passed;
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  {r.status === 'passed' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : r.status === 'cancelled' ? <CircleSlash className="h-4 w-4 text-muted-foreground" /> : <XCircle className="h-4 w-4 text-red-500" />}
                  <span className="text-xs">{t('mrTests.result', { passed, failed })}</span>
                  <span className="text-[11px] text-muted-foreground">{age(r.startedAt)}</span>
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => void post(r.id, 'mr')}><MessageSquare className="h-3 w-3" />{t('mrTests.postMR')}</Button>
                    {r.jiraKey && <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => void post(r.id, 'jira')}><MessageSquare className="h-3 w-3" />{t('mrTests.postJira')}</Button>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
