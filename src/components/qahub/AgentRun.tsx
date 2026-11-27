import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, CheckCircle2, Copy, ExternalLink, Loader2, Play, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { agentCommand, canLaunchAgent, toolNames } from './agentLaunch';

// Runs your own agent (Claude Code) right here, in a terminal session shown
// under the card — no tab to switch to. The session keeps running if the
// panel closes; reopening it re-attaches (one run per key). The agent can
// still ask for permission in the embedded terminal.

const runs = new Map<string, string>(); // run key → terminal session id

type Phase = 'idle' | 'starting' | 'running' | 'done' | 'ended';

export function AgentRunCard({ runKey, prompt, tools, title, hint, doneCheck, onDone }: {
  runKey: string;
  prompt: string;
  tools: string[];
  title: string;
  hint: string;
  /** Polled while running; true = the agent's work arrived (then it exits). */
  doneCheck?: () => Promise<boolean>;
  onDone?: () => void;
}) {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const host = useRef<HTMLDivElement>(null);
  const [sid, setSid] = useState<string | null>(() => runs.get(runKey) ?? null);
  const [phase, setPhase] = useState<Phase>(() => (runs.has(runKey) ? 'running' : 'idle'));
  const cmd = agentCommand(prompt, toolNames(tools));
  const desktop = canLaunchAgent();
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Attach the session's terminal view below the card.
  useEffect(() => {
    if (!sid || !host.current) return;
    let detach = () => {};
    let alive = true;
    void import('@/components/terminal/terminalSessions').then((m) => {
      if (alive && host.current) detach = m.attachSession(sid, host.current);
    });
    return () => { alive = false; detach(); };
  }, [sid]);

  // Session ended (shell closed / stopped) → ended.
  useEffect(() => {
    if (!sid) return;
    let unsub = () => {};
    void import('@/components/terminal/terminalSessions').then((m) => {
      unsub = m.useTerminalSessions.subscribe((s) => {
        const ses = s.sessions.find((x) => x.id === sid);
        if (!ses || ses.state === 'closed' || ses.state === 'cancelled') {
          setPhase((p) => (p === 'done' ? p : 'ended'));
          runs.delete(runKey);
        }
      });
    });
    return () => unsub();
  }, [sid, runKey]);

  // Poll for the agent's result; when it lands, refresh and let the agent exit.
  useEffect(() => {
    if (!sid || phase !== 'running' || !doneCheck) return;
    const h = window.setInterval(async () => {
      let ok = false;
      try { ok = await doneCheck(); } catch { /* keep polling */ }
      if (!ok) return;
      setPhase('done');
      onDoneRef.current?.();
      const m = await import('@/components/terminal/terminalSessions');
      m.sendCommand(sid, '/exit', true);
    }, 4000);
    return () => window.clearInterval(h);
  }, [sid, phase, doneCheck]);

  const start = useCallback(async () => {
    setPhase('starting');
    const m = await import('@/components/terminal/terminalSessions');
    const id = m.createSession('shell');
    runs.set(runKey, id);
    setSid(id);
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 150));
      if (m.sendCommand(id, cmd, true)) { setPhase('running'); return; }
    }
    setPhase('ended');
    toast({ title: t('review.launchFailed'), variant: 'destructive' });
  }, [cmd, runKey, t, toast]);

  const stop = async () => {
    if (!sid) return;
    const v = await import('@/components/terminal/terminalView');
    v.endSession(sid);
    runs.delete(runKey);
    setSid(null);
    setPhase('idle');
  };
  const openTab = async () => {
    if (!sid) return;
    const v = await import('@/components/terminal/terminalView');
    v.showSession(sid);
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: t('review.copied') }); } catch { /* ignore */ }
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-muted/20">
      <div className="p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Bot className="h-4 w-4 text-primary" />{title}
          {phase === 'running' && <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-700 dark:text-sky-400"><Loader2 className="h-3 w-3 animate-spin" />{t('agentRun.running')}</span>}
          {phase === 'done' && <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" />{t('agentRun.done')}</span>}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {desktop && (phase === 'idle' || phase === 'ended' || phase === 'done') && (
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void start()}><Play className="h-3.5 w-3.5" />{phase === 'idle' ? t('agentRun.run') : t('agentRun.runAgain')}</Button>
          )}
          {desktop && phase === 'starting' && <Button size="sm" className="h-8 gap-1.5 text-xs" disabled><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('agentRun.starting')}</Button>}
          {sid && (phase === 'running' || phase === 'starting') && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => void stop()}><Square className="h-3.5 w-3.5" />{t('agentRun.stop')}</Button>
          )}
          {sid && <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => void openTab()}><ExternalLink className="h-3.5 w-3.5" />{t('agentRun.openTab')}</Button>}
          {sid && (phase === 'done' || phase === 'ended') && (
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => void stop()}><X className="h-3.5 w-3.5" />{t('agentRun.close')}</Button>
          )}
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => void copy(cmd)}><Copy className="h-3.5 w-3.5" />{t('review.copyCommand')}</Button>
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => void copy(prompt)}><Copy className="h-3.5 w-3.5" />{t('review.copyPrompt')}</Button>
        </div>
        {!desktop && <p className="mt-2 text-[11px] text-muted-foreground">{t('agentRun.webNote')}</p>}
      </div>
      {sid && <div ref={host} className={cn('h-[360px] border-t bg-black/90 p-1', phase === 'ended' && 'opacity-70')} />}
    </div>
  );
}
