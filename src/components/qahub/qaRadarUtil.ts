import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertOctagon, Bot, Clock, ListChecks, FileStack, FlaskConical, GitMerge, TicketX, Unlink, type LucideIcon,
} from 'lucide-react';
import type { QAInboxItem, QARadarMR, QASignalKind } from '@/types';

// Signal look: icon + tone. Tones map to Tailwind classes with dark variants.
export const SIGNAL_META: Record<QASignalKind, { icon: LucideIcon; tone: string }> = {
  stuck: { icon: AlertOctagon, tone: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400' },
  unverifiedFixes: { icon: ListChecks, tone: 'border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400' },
  awaitingReview: { icon: Clock, tone: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  noJira: { icon: Unlink, tone: 'border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-400' },
  jiraMismatch: { icon: TicketX, tone: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400' },
  noTests: { icon: FlaskConical, tone: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' },
  large: { icon: FileStack, tone: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  collision: { icon: GitMerge, tone: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400' },
  aiAssisted: { icon: Bot, tone: 'border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300' },
};

export const SIGNAL_KINDS = Object.keys(SIGNAL_META) as QASignalKind[];

/** MR reference as the provider writes it: group/repo!12 or owner/repo#12. */
export function mrLabel(m: Pick<QARadarMR, 'project' | 'provider' | 'iid'>): string {
  return `${m.project}${m.provider === 'github' ? '#' : '!'}${m.iid}`;
}

/** Hours since an ISO time (null when unparsable). */
export function hoursSince(iso: string | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, (now - t) / 3_600_000);
}

/** Board column of an open MR. */
export type BoardColumn = 'draft' | 'review' | 'stuck' | 'ready';

export function boardColumn(m: QARadarMR): BoardColumn {
  if (m.signals.some((s) => s.kind === 'stuck')) return 'stuck';
  if (m.draft) return 'draft';
  const approved = m.approvalsLeft === 0 || (m.approvalsLeft == null && (m.approvalsGiven ?? 0) > 0);
  if (approved && m.pipeline !== 'failed' && m.pipeline !== 'running' && m.pipeline !== 'pending') return 'ready';
  return 'review';
}

/** Snooze key: an MR item ends its snooze on a new head commit. */
export function snoozeRef(ref: string, headSha?: string): string {
  return headSha ? `${ref}@${headSha}` : ref;
}

export function pipelineTone(p: string | null): string {
  switch (p) {
    case 'success': return 'text-emerald-600 dark:text-emerald-400';
    case 'failed':
    case 'canceled': return 'text-red-600 dark:text-red-400';
    case 'running':
    case 'pending': return 'text-sky-600 dark:text-sky-400';
    default: return 'text-muted-foreground';
  }
}

/** Notification dedupe key of an Inbox item (ref + head commit). */
export const inboxItemKey = (it: QAInboxItem) => snoozeRef(it.ref, it.mr?.headSha);

/** Localized relative age ("3 h ago") of an ISO time; "—" when unknown. */
export function useAge() {
  const { i18n } = useTranslation();
  return useCallback((iso?: string) => {
    if (!iso) return '—';
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return '—';
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto', style: 'narrow' });
    const diff = (ms - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    return rtf.format(Math.round(diff / 86400), 'day');
  }, [i18n.language]);
}
