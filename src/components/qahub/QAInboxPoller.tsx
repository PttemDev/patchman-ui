import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { useQAScopeStore } from '@/stores/qaScopeStore';
import { loadSeen, saveSeen, useQAInboxStore } from '@/stores/qaInboxStore';
import { useToast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';
import type { QAInboxItem, QAInboxResult } from '@/types';
import { openQAHub } from './openQAHub';
import { inboxItemKey } from './qaRadarUtil';
import { notifySystem } from '@/lib/desktopNotify';

const POLL_MS = 2 * 60 * 1000;
const DIGEST_KEY = 'patchman.qa.digest.lastDay';

// Polls the Inbox of the current QA space every 2 minutes while the app is
// open and visible (CR_QA_P0_PLAN P0.c). New items (by ref + head commit)
// raise at most one bundled notification per poll: an in-app toast, plus a
// system notification (native in the desktop app) when the app is in the
// background. At the space's digest hour it shows a "Today" summary once a
// day. Renders nothing.
export function QAInboxPoller() {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const signedIn = useAuthStore((s) => s.isAuthenticated);
  const scope = useQAScopeStore((s) => s.workspaceId);
  const available = useQAInboxStore((s) => s.available);
  const fetchInbox = useQAInboxStore((s) => s.fetch);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!signedIn || !available) return;
    let stopped = false;
    const notify = (inbox: QAInboxResult) => {
      const tr = tRef.current;
      const seen = loadSeen();
      const fresh = inbox.items.filter((it) => !seen.has(inboxItemKey(it)));
      inbox.items.forEach((it) => seen.add(inboxItemKey(it)));
      saveSeen(seen);
      if (fresh.length > 0) {
        const title = tr('inbox.notify.title', { count: fresh.length });
        const first = fresh[0];
        const body = first.mr ? first.mr.title : first.issue ? `${first.issue.key} ${first.issue.summary ?? ''}` : '';
        toast({
          title,
          description: body,
          action: <ToastAction altText={tr('inbox.open')} onClick={() => openQAHub('inbox')}>{tr('inbox.open')}</ToastAction>,
        });
        // System notification when the app isn't in front (desktop: native).
        if (document.hidden || !document.hasFocus()) void notifySystem(title, body);
      }
      // Daily "Today" summary at the space's digest hour.
      const hour = inbox.digestHour;
      if (hour != null && new Date().getHours() === hour) {
        const day = new Date().toDateString();
        let last = '';
        try { last = localStorage.getItem(DIGEST_KEY) ?? ''; } catch { /* ignore */ }
        if (last !== day) {
          try { localStorage.setItem(DIGEST_KEY, day); } catch { /* ignore */ }
          const count = (k: QAInboxItem['kind']) => inbox.items.filter((it) => it.kind === k).length;
          toast({
            title: tr('inbox.digest.title'),
            description: tr('inbox.digest.body', { review: count('review'), stuck: count('stuck'), test: count('test') }),
            action: <ToastAction altText={tr('inbox.open')} onClick={() => openQAHub('inbox')}>{tr('inbox.open')}</ToastAction>,
          });
        }
      }
    };
    const tick = async () => {
      if (stopped || document.hidden) return;
      const inbox = await fetchInbox();
      if (inbox && !stopped && inbox.links.length > 0) notify(inbox);
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    const onVisible = () => { if (!document.hidden) void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [signedIn, available, scope, fetchInbox, toast]);

  return null;
}

/** Count of Inbox items on the QA rail button. */
export function QAInboxBadge() {
  const n = useQAInboxStore((s) => (s.inbox?.items.length ?? 0) + (s.inbox?.pendingSetup ?? 0));
  if (!n) return null;
  return (
    <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold leading-none text-white">
      {n > 99 ? '99+' : n}
    </span>
  );
}
