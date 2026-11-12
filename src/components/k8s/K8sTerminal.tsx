import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { RotateCw, TerminalSquare } from 'lucide-react';
import { k8sAPI, type DBScope } from '@/services/api';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// What the terminal is wired to:
//  - pod-exec: an interactive shell INSIDE a pod container (v2, current).
//  - local-shell: a login shell on the USER'S OWN machine with KUBECONFIG
//    pointed at this connection+context (v3, desktop-local only). No pod /
//    container / shell-command UI — the BE spawns $SHELL -l directly.
export type K8sTerminalSource =
  | { kind: 'pod-exec'; namespace?: string; pod: string; containers: string[] }
  | { kind: 'local-shell' };

interface K8sTerminalProps {
  connId: string;
  context: string;
  source: K8sTerminalSource;
  scope?: DBScope;
  /** 'dark' | 'light' — matches the app theme. */
  theme?: string;
}

// Shell candidates for pod-exec. /bin/sh is the safe default (present in
// ~every image); /bin/bash offered for images that ship it. These become the
// exec command[]. (Not used for local-shell — the host BE picks $SHELL.)
const SHELLS = ['/bin/sh', '/bin/bash', '/bin/ash', '/bin/zsh'];

type Status = 'connecting' | 'open' | 'closed';

// Our own WS framing (matches the BE bridge in k8s_exec.go / k8s_local_shell.go).
// FE→BE we only ever send stdin + resize; BE→FE we receive stdout/stderr/exit.
interface OutFrame {
  type: 'stdout' | 'stderr' | 'exit';
  data?: string;
  code?: number;
  error?: string;
}

// K8sTerminal is an interactive xterm terminal wired to a scope-routed
// WebSocket. term.onData → {type:'stdin'}; a fit/resize → {type:'resize',
// cols,rows}; inbound stdout/stderr frames are written to the term; an exit
// frame shows the code. The same framing drives two backends: pod-exec (a
// shell inside a pod) and local-shell (a shell on the user's machine with the
// cluster's kubeconfig). Dark + monospace to match the app. The terminal and
// socket are fully torn down on unmount and rebuilt on reconnect.
export function K8sTerminal({
  connId, context, source, scope, theme,
}: K8sTerminalProps) {
  const { t } = useTranslation('k8s');
  const isLocal = source.kind === 'local-shell';
  const containers = source.kind === 'pod-exec' ? source.containers : [];
  const namespace = source.kind === 'pod-exec' ? source.namespace : undefined;
  const pod = source.kind === 'pod-exec' ? source.pod : '';

  const [container, setContainer] = useState<string>(containers[0] ?? '');
  const [shell, setShell] = useState<string>(SHELLS[0]);
  const [status, setStatus] = useState<Status>('connecting');
  const [exit, setExit] = useState<{ code?: number; error?: string } | null>(null);
  // Bumped by the Reconnect button to re-run the connect effect.
  const [nonce, setNonce] = useState(0);

  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Default the container once the pod spec resolves (pod-exec only).
  useEffect(() => {
    if (!container && containers.length > 0) setContainer(containers[0]);
  }, [containers, container]);

  const xtermTheme = useMemo(() => {
    // Kept close to the app surface: near-black in dark, off-white in light.
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

  // Connect / reconnect. Keyed on the target + nonce; the cleanup disposes the
  // term and closes the socket, so switching container/shell or unmounting
  // tears the stream down cleanly (BE cancels the exec / kills the shell on WS
  // close).
  useEffect(() => {
    if (!connId || !context) return;
    if (!isLocal && !pod) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: xtermTheme,
      scrollback: 5000,
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    if (hostRef.current) {
      term.open(hostRef.current);
      try { fit.fit(); } catch { /* container not laid out yet */ }
      term.focus();
    }

    setStatus('connecting');
    setExit(null);

    const { url } = isLocal
      ? k8sAPI.localShellUrl(connId, { context }, scope)
      : k8sAPI.execUrl(
        connId,
        {
          context,
          namespace: namespace || undefined,
          pod,
          container: container || undefined,
          tty: true,
          command: [shell],
        },
        scope,
      );

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      // Fit again now the socket is up, then tell the remote our size.
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

    ws.onclose = () => {
      setStatus('closed');
    };
    ws.onerror = () => {
      // onclose follows; surface a generic error if the stream never emitted exit.
      setExit((e) => e ?? { error: t('terminal.wsError') });
    };

    // stdin: pipe every keystroke to the remote.
    const dataSub = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stdin', data: d }));
      }
    });

    // Refit + resize on container size changes.
    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* noop */ }
      sendResize();
    });
    if (hostRef.current) ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      dataSub.dispose();
      // Detach handlers before closing so a late onclose doesn't touch a
      // disposed term / stale state.
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(); } catch { /* noop */ }
      term.dispose();
      if (termRef.current === term) termRef.current = null;
      if (fitRef.current === fit) fitRef.current = null;
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [connId, context, isLocal, namespace, pod, container, shell, scope, nonce, xtermTheme, sendResize, t]);

  const dot = status === 'open' ? 'bg-emerald-500' : status === 'connecting' ? 'bg-amber-500' : 'bg-muted-foreground/40';

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20 flex-wrap">
        <TerminalSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {isLocal ? (
          <span className="text-xs font-medium">
            {t('terminal.localShell')} <span className="text-muted-foreground">·</span>{' '}
            <span className="font-mono text-muted-foreground">{context}</span>
          </span>
        ) : (
          <>
            <Select value={container} onValueChange={setContainer} disabled={containers.length === 0}>
              <SelectTrigger className="w-[150px] h-7 text-xs"><SelectValue placeholder={t('terminal.containerPlaceholder')} /></SelectTrigger>
              <SelectContent>
                {containers.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={shell} onValueChange={setShell}>
              <SelectTrigger className="w-[130px] h-7 text-xs"><SelectValue placeholder={t('terminal.shellPlaceholder')} /></SelectTrigger>
              <SelectContent>
                {SHELLS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn('inline-block h-2 w-2 rounded-full', dot)} />
          {status === 'open' ? t('terminal.statusConnected') : status === 'connecting' ? t('terminal.statusConnecting') : t('terminal.statusDisconnected')}
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 h-7 text-[11px]"
          onClick={() => setNonce((n) => n + 1)}
        >
          <RotateCw className="h-3 w-3" /> {t('terminal.reconnect')}
        </Button>
      </div>

      {/* Terminal surface */}
      <div className="flex-1 min-h-0 relative" style={{ background: xtermTheme.background }}>
        <div ref={hostRef} className="absolute inset-0 p-2" />
      </div>

      {/* Exit / status line */}
      {exit && (
        <div
          className={cn(
            'shrink-0 px-3 py-1.5 border-t text-[11px] font-mono',
            exit.error || (exit.code != null && exit.code !== 0)
              ? 'text-destructive bg-destructive/5'
              : 'text-muted-foreground bg-muted/20',
          )}
        >
          {exit.error
            ? t('terminal.sessionEnded', { error: exit.error })
            : t('terminal.processExited', { code: exit.code ?? 0 })}
          <button
            type="button"
            className="ml-2 underline underline-offset-2 hover:text-foreground"
            onClick={() => setNonce((n) => n + 1)}
          >
            {t('terminal.reconnectLink')}
          </button>
        </div>
      )}
    </div>
  );
}
