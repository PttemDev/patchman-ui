import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createXterm, xtermTheme } from '@/lib/ptyTerminal';
import { createDetachChannel, MAIN_WINDOW_LABEL, type DetachMsg } from '@/lib/detach/channel';

type State = NonNullable<DetachMsg['state']>;

// A terminal tab in a detached window: only a screen + keyboard. The shell
// lives in the main window (terminalBridge), which replays the recent output
// and then streams it here; keystrokes and size go back the same way.
export function DetachedTerminalView({ tabId }: { tabId: string }) {
  const { t } = useTranslation('terminal');
  const hostRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<(msg: Omit<DetachMsg, 'tabId' | 'epoch'>) => void>(() => {});
  const [state, setState] = useState<State>('connecting');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { term, fit } = createXterm(8000);
    const channel = createDetachChannel();
    const send = (msg: Omit<DetachMsg, 'tabId' | 'epoch'>) => channel.post(MAIN_WINDOW_LABEL, { ...msg, tabId, epoch: 0 });
    sendRef.current = send;
    let answered = false;

    term.open(host);
    const refit = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      try { fit.fit(); } catch { /* not laid out */ }
      send({ type: 'term:resize', cols: term.cols, rows: term.rows });
    };

    const unsub = channel.on((msg) => {
      if (msg.tabId !== tabId) return;
      if (msg.type === 'term:out') {
        answered = true;
        if (msg.replay) {
          term.reset();
          refit(); // after the replay the shell redraws at this window's size
        }
        if (msg.data) term.write(msg.data);
      } else if (msg.type === 'term:state' && msg.state) {
        answered = true;
        setState(msg.state);
        if (msg.state === 'ended') {
          void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close());
        }
      }
    });
    const dataSub = term.onData((data) => send({ type: 'term:in', data }));

    // The channel's listener starts asynchronously: ask again until main answers
    // (a repeated replay resets the screen, so it never doubles).
    const attach = () => { if (!answered) send({ type: 'term:attach' }); };
    const timers = [0, 150, 500, 1500].map((ms) => setTimeout(attach, ms));

    const ro = new ResizeObserver(refit);
    ro.observe(host);
    const raf = requestAnimationFrame(() => term.focus());

    return () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(raf);
      ro.disconnect();
      dataSub.dispose();
      unsub();
      channel.dispose();
      term.dispose();
    };
  }, [tabId]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1" style={{ background: xtermTheme().background }}>
        <div ref={hostRef} className="absolute inset-2" />
      </div>
      {(state === 'closed' || state === 'cancelled' || state === 'gone') && (
        <div className="shrink-0 border-t bg-muted/20 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
          {state === 'gone' ? t('sessionGone') : state === 'cancelled' ? t('stepUpCancelled') : t('sessionClosed')}
          {state !== 'gone' && (
            <button
              type="button"
              className="ml-2 underline underline-offset-2 hover:text-foreground"
              onClick={() => sendRef.current({ type: 'term:restart' })}
            >
              {t('restart')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
