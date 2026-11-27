import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlarmClock, AlertOctagon, BellRing, ClipboardCheck, Eye, ExternalLink, FlaskConical, ListChecks, Loader2, RefreshCw, Settings2, Sun,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { qaAPI } from '@/services/api';
import { useQAInboxStore } from '@/stores/qaInboxStore';
import { systemNotifyPermission } from '@/lib/desktopNotify';
import { useGitConnectionStore } from '@/stores/gitConnectionStore';
import type { QAInboxItem, QARadarMR } from '@/types';
import { MRDrawer, SignalChip } from './RadarSection';
import { mrLabel, snoozeRef, useAge } from './qaRadarUtil';
import type { QASection } from './sections';

const KINDS: { kind: QAInboxItem['kind']; icon: typeof Eye; tone: string }[] = [
  { kind: 'review', icon: Eye, tone: 'text-sky-600 dark:text-sky-400' },
  { kind: 'verify', icon: ListChecks, tone: 'text-teal-600 dark:text-teal-400' },
  { kind: 'stuck', icon: AlertOctagon, tone: 'text-red-600 dark:text-red-400' },
  { kind: 'test', icon: FlaskConical, tone: 'text-violet-600 dark:text-violet-400' },
];

// Inbox (CR_QA_P0_PLAN P0.c): what needs me — reviews I owe, my stuck MRs,
// Jira issues waiting for my test — grouped, with snooze. Shares the
// poller's store, so the rail badge and this list agree.
export function InboxSection({ onNavigate }: { onNavigate?: (s: QASection) => void }) {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const age = useAge();
  const { inbox, loading, error, fetch } = useQAInboxStore();
  const [open, setOpen] = useState<QARadarMR | null>(null);
  const [openReview, setOpenReview] = useState(false);
  const [perm, setPerm] = useState<string>(() => systemNotifyPermission());
  const gitConns = useGitConnectionStore((s) => s.connections);
  const fetchGit = useGitConnectionStore((s) => s.fetchConnections);

  useEffect(() => { void fetch(); }, [fetch]);
  useEffect(() => { if (!gitConns.length) void fetchGit(); }, [gitConns.length, fetchGit]);

  const snooze = async (it: QAInboxItem, hours: number) => {
    try {
      await qaAPI.snooze(snoozeRef(it.ref, it.mr?.headSha), hours);
      await fetch();
      toast({ title: t('inbox.snoozed') });
    } catch {
      toast({ title: t('inbox.snoozeFailed'), variant: 'destructive' });
    }
  };

  const askPermission = async () => {
    try { setPerm(await Notification.requestPermission()); } catch { setPerm('unsupported'); }
  };

  if (!inbox && loading) {
    return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('inbox.loading')}</div>;
  }
  if (!inbox && error) return <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error === 'error' ? t('inbox.loadFailed') : error}</div>;
  if (!inbox) return null;

  if (inbox.links.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
        <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
        <p className="max-w-md text-sm text-muted-foreground">{t('inbox.noLinks')}</p>
        <Button size="sm" className="gap-1.5" onClick={() => onNavigate?.('settings')}><Settings2 className="h-3.5 w-3.5" />{t('radar.linkProjects')}</Button>
      </div>
    );
  }

  const count = (k: QAInboxItem['kind']) => inbox.items.filter((it) => it.kind === k).length;
  return (
    <div className="space-y-5">
      {/* Today */}
      <div className="grid gap-3 @2xl:grid-cols-2 @4xl:grid-cols-4">
        {KINDS.map(({ kind, icon: Icon, tone }) => (
          <div key={kind} className="rounded-xl border bg-gradient-to-br from-muted/40 to-transparent p-4">
            <div className={cn('flex items-center gap-2 text-xs font-medium', tone)}><Icon className="h-4 w-4" />{t(`inbox.kind.${kind}`)}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{kind === 'test' && inbox.testStatuses.length === 0 ? '—' : count(kind)}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Sun className="h-3.5 w-3.5" />
        <span>{t('inbox.updated', { when: age(inbox.generatedAt) })}</span>
        {inbox.snoozed > 0 && <span>· {t('inbox.snoozedCount', { count: inbox.snoozed })}</span>}
        {inbox.testStatuses.length === 0 && (
          <button type="button" className="text-primary hover:underline" onClick={() => onNavigate?.('settings')}>· {t('inbox.testOff')}</button>
        )}
        {inbox.jiraTruncated && <span>· {t('inbox.jiraTruncated')}</span>}
        {inbox.jiraSkipped > 0 && <span title={t('inbox.jiraSkippedHint')}>· {t('inbox.jiraSkipped', { count: inbox.jiraSkipped })}</span>}
        <span className="ml-auto flex items-center gap-2">
          {perm === 'default' && (
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => void askPermission()}><BellRing className="h-3.5 w-3.5" />{t('inbox.enableNotifications')}</Button>
          )}
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => void fetch(true)} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />{t('radar.refresh')}
          </Button>
        </span>
      </div>

      {inbox.pendingSetup > 0 && (
        <button type="button" onClick={() => onNavigate?.('settings')} className="w-full rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-left text-xs">
          {t('pending.banner', { count: inbox.pendingSetup })}
        </button>
      )}
      {inbox.links.some((l) => l.status === 'ok' && !l.personal) && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          {t('inbox.notPersonal', { projects: inbox.links.filter((l) => l.status === 'ok' && !l.personal).map((l) => l.gitProject).join(', ') })}{' '}
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => onNavigate?.('settings')}>{t('settings.mine.useMine')}</button>
        </p>
      )}

      {inbox.items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm font-medium">{t('inbox.empty')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('inbox.monitoring', { count: inbox.links.length })}</p>
        </div>
      ) : (
        KINDS.filter(({ kind }) => count(kind) > 0).map(({ kind, icon: Icon, tone }) => (
          <section key={kind} className="space-y-2">
            <h3 className={cn('flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide', tone)}><Icon className="h-3.5 w-3.5" />{t(`inbox.kind.${kind}`)}</h3>
            <div className="divide-y rounded-lg border">
              {inbox.items.filter((it) => it.kind === kind).map((it) => (
                <div key={it.ref + kind} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    {it.mr ? (
                      <>
                        <div className="truncate text-sm font-medium">{it.mr.title}</div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="font-mono">{mrLabel(it.mr)}</span>
                          <span>· {it.mr.author.name || it.mr.author.username}</span>
                          <span>· {age(it.since)}</span>
                          {it.mr.jiraKey && <span className="font-mono">· {it.mr.jiraKey}{it.mr.jira?.status ? ` ${it.mr.jira.status}` : ''}</span>}
                          {it.mr.signals.map((s) => <SignalChip key={s.kind} kind={s.kind} reason={s.reason} />)}
                        </div>
                      </>
                    ) : it.issue ? (
                      <>
                        <div className="truncate text-sm font-medium"><span className="font-mono">{it.issue.key}</span> {it.issue.summary}</div>
                        <div className="text-[11px] text-muted-foreground">{it.issue.status} · {age(it.since)}</div>
                      </>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {it.mr ? (
                      <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => { setOpenReview(it.kind === 'verify'); setOpen(it.mr!); }}>{t('inbox.open')}</Button>
                    ) : it.issue?.url ? (
                      <Button size="sm" variant="secondary" className="h-7 gap-1 text-xs" asChild>
                        <a href={it.issue.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" />{t('inbox.openJira')}</a>
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('inbox.snooze')} title={t('inbox.snooze')}><AlarmClock className="h-3.5 w-3.5" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => void snooze(it, 1)}>{t('inbox.snoozeFor.h1')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void snooze(it, 4)}>{t('inbox.snoozeFor.h4')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void snooze(it, 0)}>{t('inbox.snoozeFor.tomorrow')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void snooze(it, 24 * 7)}>{t('inbox.snoozeFor.week')}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
      {inbox.items.some((it) => it.mr) && <p className="text-[11px] text-muted-foreground">{t('inbox.snoozeNote')}</p>}

      {open && <MRDrawer mr={open} initialTab={openReview ? 'review' : undefined} onClose={() => setOpen(null)} onChanged={() => void fetch(true)} />}
    </div>
  );
}
