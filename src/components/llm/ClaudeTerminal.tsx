import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { RotateCw, TerminalSquare, AlertTriangle, Loader2, MonitorSmartphone } from 'lucide-react';
import { aiShellAPI } from '@/services/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ClaudeTerminal embeds the locally-installed `claude` CLI in an xterm terminal,
// bridged to the BE PTY over a WebSocket (same stdin/stdout framing as the K8s
// terminals). It's desktop-only and rooted at the managed git-repos workspace,
// so every cloned project is reachable by name from one prompt.

type Status = 'connecting' | 'open' | 'closed';
type Probe = 'checking' | 'ready' | 'no-desktop' | 'not-installed' | 'error';

interface OutFrame {
  type: 'stdout' | 'stderr' | 'exit';
  data?: string;
  code?: number;
  error?: string;
}

export function ClaudeTerminal({ theme }: { theme?: string }) {
  const { t } = useTranslation('ai');
  const [probe, setProbe] = useState<Probe>('checking');
  const [status, setStatus] = useState<Status>('connecting');
  const [exit, setExit] = useState<{ code?: number; error?: string } | null>(null);
  const [nonce, setNonce] = useState(0);

  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Pre-flight: is claude present, and are we on desktop? Re-run on reconnect so
  // installing claude then hitting Reconnect picks it up.
  useEffect(() => {
    let cancelled = false;
    setProbe('checking');
    (async () => {
      try {
        const res = await aiShellAPI.status('local');
        if (cancelled) return;
        const d = res.data as { available: boolean; desktop: boolean };
        if (!d?.desktop) setProbe('no-desktop');
        else if (!d?.available) setProbe('not-installed');
        else setProbe('ready');
      } catch {
        if (!cancelled) setProbe('error');
      }
    })();
    return () => { cancelled = true; };
  }, [nonce]);

  const xtermTheme = useMemo(() => {
    if (theme === 'light') {
      return { background: '#ffffff', foreground: '#1e293b', cursor: '#1e293b', selectionBackground: '#cbd5e199' };
    }
    return { background: '#0a0a0a', foreground: '#e4e4e7', cursor: '#e4e4e7', selectionBackground: '#3f3f4699' };
  }, [theme]);

  const sendResize = useCallback(() => {
    const term = termRef.current;
    const ws = wsRef.current;
    if (!term || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  }, []);

  // Connect the terminal only once the probe says ready.
  useEffect(() => {
    if (probe !== 'ready') return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: xtermTheme,
      scrollback: 8000,
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    if (hostRef.current) {
      term.open(hostRef.current);
      try { fit.fit(); } catch { /* not laid out yet */ }
      term.focus();
      // Refit AFTER layout settles — a synchronous fit right after open can
      // measure a not-yet-final flex height and leave the last row(s) clipped.
      requestAnimationFrame(() => {
        try { fit.fit(); sendResize(); } catch { /* noop */ }
      });
    }

    setStatus('connecting');
    setExit(null);

    const { url } = aiShellAPI.shellUrl();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      try { fit.fit(); } catch { /* noop */ }
      sendResize();
    };

    ws.onmessage = (ev) => {
      let frame: OutFrame;
      try {
        frame = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as OutFrame;
      } catch {
        return;
      }
      if (frame.type === 'stdout' || frame.type === 'stderr') {
        if (frame.data) term.write(frame.data);
      } else if (frame.type === 'exit') {
        setExit({ code: frame.code, error: frame.error });
      }
    };

    ws.onclose = () => setStatus('closed');
    ws.onerror = () => setExit((e) => e ?? { error: t('terminal.wsError') });

    const dataSub = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stdin', data: d }));
      }
    });

    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* noop */ }
      sendResize();
    });
    if (hostRef.current) ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      dataSub.dispose();
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(); } catch { /* noop */ }
      term.dispose();
      if (termRef.current === term) termRef.current = null;
      if (fitRef.current === fit) fitRef.current = null;
      if (wsRef.current === ws) wsRef.current = null;
    };
    // Connect is keyed on `probe` ONLY: Reconnect flips probe 'ready'→'checking'
    // →'ready' (via the probe effect's nonce dep), which re-runs this. Theme is
    // NOT a dep — a light/dark toggle must not dispose the term and kill a live
    // claude session; it's pushed to the running term below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe]);

  // Push theme changes to the live terminal without tearing it down.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme;
  }, [xtermTheme]);

  const reconnect = () => setNonce((n) => n + 1);

  // ── Non-ready states ────────────────────────────────────────────────────
  if (probe !== 'ready') {
    let icon = <Loader2 className="h-6 w-6 animate-spin" />;
    let msg = t('terminal.checking');
    let showReconnect = false;
    if (probe === 'no-desktop') {
      icon = <MonitorSmartphone className="h-7 w-7" />;
      msg = t('terminal.desktopOnly');
    } else if (probe === 'not-installed') {
      icon = <TerminalSquare className="h-7 w-7" />;
      msg = t('terminal.notInstalled');
      showReconnect = true;
    } else if (probe === 'error') {
      icon = <AlertTriangle className="h-7 w-7 text-destructive" />;
      msg = t('terminal.probeError');
      showReconnect = true;
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
        {icon}
        <p className="max-w-sm whitespace-pre-line text-sm">{msg}</p>
        {showReconnect && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={reconnect}>
            <RotateCw className="h-3.5 w-3.5" /> {t('terminal.retry')}
          </Button>
        )}
      </div>
    );
  }

  const dot = status === 'open' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-muted-foreground/40';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/20 px-3 py-1.5">
        <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">{t('terminal.title')}</span>
        <span className="text-[11px] text-muted-foreground">· {t('terminal.workspaceNote')}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn('inline-block h-2 w-2 rounded-full', dot)} />
          {status === 'open' ? t('terminal.statusConnected') : status === 'connecting' ? t('terminal.statusConnecting') : t('terminal.statusDisconnected')}
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-[11px]" onClick={reconnect}>
          <RotateCw className="h-3 w-3" /> {t('terminal.reconnect')}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1" style={{ background: xtermTheme.background }}>
        {/* inset (not padding) for the gutter: FitAddon measures this element's
            box directly, so wrapper padding would make it overestimate rows and
            clip the last line(s). */}
        <div ref={hostRef} className="absolute inset-2" />
      </div>

      {exit && (
        <div
          className={cn(
            'shrink-0 border-t px-3 py-1.5 font-mono text-[11px]',
            exit.error || (exit.code != null && exit.code !== 0)
              ? 'bg-destructive/5 text-destructive'
              : 'bg-muted/20 text-muted-foreground',
          )}
        >
          {exit.error
            ? t('terminal.sessionEnded', { error: exit.error })
            : t('terminal.processExited', { code: exit.code ?? 0 })}
          <button type="button" className="ml-2 underline underline-offset-2 hover:text-foreground" onClick={reconnect}>
            {t('terminal.reconnectLink')}
          </button>
        </div>
      )}
    </div>
  );
}
