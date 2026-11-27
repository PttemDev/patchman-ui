import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { xtermTheme } from '@/lib/ptyTerminal';
import { useThemeStore } from '@/stores/themeStore';
import { useTerminalPrefsStore } from '@/stores/terminalPrefsStore';
import { attachSession, restartSession, useTerminalSessions } from './terminalSessions';

// One session's xterm (attached from the registry) plus its "ended — Restart"
// bar. Used under the sidebar list and in a terminal tab.
export function TerminalSessionView({ id }: { id: string }) {
  const { t } = useTranslation('terminal');
  useThemeStore((s) => s.preset); // re-render so the background follows the preset
  useTerminalPrefsStore((s) => s.colorScheme); // ...and the terminal color scheme
  const session = useTerminalSessions((s) => s.sessions.find((x) => x.id === id));
  const exists = !!session;
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exists || !hostRef.current) return;
    return attachSession(id, hostRef.current);
  }, [id, exists]);

  if (!session) {
    return <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">{t('sessionGone')}</div>;
  }
  return (
    <>
      <div className="relative min-h-0 flex-1" style={{ background: xtermTheme().background }}>
        {/* inset (not padding): FitAddon measures this box directly. */}
        <div ref={hostRef} className="absolute inset-2" />
      </div>
      {(session.state === 'closed' || session.state === 'cancelled') && (
        <div className="shrink-0 border-t bg-muted/20 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
          {session.state === 'cancelled' ? t('stepUpCancelled') : t('sessionClosed')}
          <button
            type="button"
            className="ml-2 underline underline-offset-2 hover:text-foreground"
            onClick={() => restartSession(session.id)}
          >
            {t('restart')}
          </button>
        </div>
      )}
    </>
  );
}
