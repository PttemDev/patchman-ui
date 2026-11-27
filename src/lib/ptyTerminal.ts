import { Terminal, type IDisposable, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { isMacPlatform, isTabSwitchKey } from '@/lib/keymap';
import { useTerminalPrefsStore, type TerminalColorScheme } from '@/stores/terminalPrefsStore';

// Shared xterm + PTY-WebSocket plumbing for the embedded terminals (Claude CLI,
// K8s exec / local shell, multi-session terminal). FE→BE we only send
// {type:'stdin'|'resize'}; BE→FE we receive {type:'stdout'|'stderr'|'exit'}.

export interface PtyExit { code?: number; error?: string }

interface OutFrame {
  type: 'stdout' | 'stderr' | 'exit';
  data?: string;
  code?: number;
  error?: string;
}

let probeCtx: CanvasRenderingContext2D | null | undefined;

// Reads a CSS var off <html> and resolves any CSS color (incl. oklch) to sRGB via a
// 1x1 canvas; undefined if the var is empty/unparseable or there is no DOM.
function cssColor(name: string): [number, number, number] | undefined {
  if (typeof document === 'undefined') return undefined;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return undefined;
  probeCtx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!probeCtx) return undefined;
  probeCtx.clearRect(0, 0, 1, 1);
  probeCtx.fillStyle = '#000001'; // sentinel: an unparseable value leaves fillStyle untouched
  probeCtx.fillStyle = raw;
  if (probeCtx.fillStyle === '#000001') return undefined; // unparseable: sentinel untouched
  probeCtx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probeCtx.getImageData(0, 0, 1, 1).data;
  return a === 0 ? undefined : [r, g, b];
}

const rgb = (c: [number, number, number], alpha = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;

// Published palettes of well-known terminal schemes (cursor comes from the prefs / foreground).
type Ansi = [string, string, string, string, string, string, string, string]; // black..white
const scheme = (background: string, foreground: string, selectionBackground: string, n: Ansi, b: Ansi): ITheme => ({
  background, foreground, selectionBackground,
  black: n[0], red: n[1], green: n[2], yellow: n[3], blue: n[4], magenta: n[5], cyan: n[6], white: n[7],
  brightBlack: b[0], brightRed: b[1], brightGreen: b[2], brightYellow: b[3],
  brightBlue: b[4], brightMagenta: b[5], brightCyan: b[6], brightWhite: b[7],
});

export const TERMINAL_SCHEMES: Record<Exclude<TerminalColorScheme, 'app'>, ITheme> = {
  dracula: scheme('#282a36', '#f8f8f2', '#44475a',
    ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2'],
    ['#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']),
  oneDark: scheme('#282c34', '#abb2bf', '#3e4451',
    ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf'],
    ['#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff']),
  nord: scheme('#2e3440', '#d8dee9', '#434c5e',
    ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0'],
    ['#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4']),
  solarizedDark: scheme('#002b36', '#839496', '#073642',
    ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'],
    ['#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']),
  solarizedLight: scheme('#fdf6e3', '#657b83', '#eee8d5',
    ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'],
    ['#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']),
  githubLight: scheme('#ffffff', '#24292f', 'rgba(9, 105, 218, 0.2)',
    ['#24292f', '#cf222e', '#116329', '#4d2d00', '#0969da', '#8250df', '#1b7c83', '#6e7781'],
    ['#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f']),
};

// 'app' scheme: follows the active app theme preset (CSS vars); ANSI colors stay xterm defaults.
// Fallbacks match the old fixed light/dark surface when the vars can't be read.
export function xtermTheme(): ITheme {
  const { colorScheme, cursorColor } = useTerminalPrefsStore.getState();
  const t = colorScheme === 'app' ? undefined : TERMINAL_SCHEMES[colorScheme]; // unknown persisted id → app
  if (t) {
    return { ...t, cursor: cursorColor ?? t.foreground, cursorAccent: t.background };
  }
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const bg = cssColor('--background') ?? (dark ? [10, 10, 10] : [255, 255, 255]);
  const fg = cssColor('--foreground') ?? (dark ? [228, 228, 231] : [30, 41, 59]);
  const sel = cssColor('--primary') ?? fg;
  return {
    background: rgb(bg),
    foreground: rgb(fg),
    cursor: cursorColor ?? rgb(fg),
    cursorAccent: rgb(bg),
    selectionBackground: rgb(sel, 0.3),
  };
}

// Pushes theme + cursor + font prefs into a live terminal (no teardown).
export function applyTerminalPrefs(term: Terminal): void {
  const { cursorStyle, cursorBlink, fontSize } = useTerminalPrefsStore.getState();
  term.options.theme = xtermTheme();
  term.options.cursorStyle = cursorStyle;
  term.options.cursorBlink = cursorBlink;
  term.options.fontSize = fontSize;
}

// macOS editing keys → the readline/zle sequences shells already bind, like iTerm's Natural Text Editing;
// xterm sends nothing for ⌘-arrows and an unbound ESC[1;3D/C for ⌥-arrows.
const MAC_CMD_KEYS: Record<string, string> = { ArrowLeft: '\x01', ArrowRight: '\x05', Backspace: '\x15' }; // line start, line end, kill line
const MAC_OPT_KEYS: Record<string, string> = { ArrowLeft: '\x1bb', ArrowRight: '\x1bf' };                // word back, word forward

function macEditingKey(e: KeyboardEvent): string | undefined {
  if (e.type !== 'keydown' || e.shiftKey || e.ctrlKey || e.metaKey === e.altKey) return undefined;
  return (e.metaKey ? MAC_CMD_KEYS : MAC_OPT_KEYS)[e.key];
}

export function createXterm(scrollback: number): { term: Terminal; fit: FitAddon } {
  const { cursorStyle, cursorBlink, fontSize } = useTerminalPrefsStore.getState();
  const term = new Terminal({
    cursorStyle,
    cursorBlink,
    fontSize,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    theme: xtermTheme(),
    scrollback,
    convertEol: false,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.attachCustomKeyEventHandler((e) => {
    if (isTabSwitchKey(e)) return false; // the app's tab switch, not the shell's (Alt-digit / ⌥ character)
    // Full-screen programs (vim, less, top: the alternate screen) get the raw keys,
    // so ⌘← is not turned into Ctrl-A (vim: increment) there.
    if (!isMacPlatform || term.buffer.active.type === 'alternate') return true;
    const seq = macEditingKey(e);
    if (seq === undefined) return true;
    e.preventDefault();
    term.input(seq);
    return false;
  });
  return { term, fit };
}

export function sendPtyResize(ws: WebSocket | null, term: Terminal | null): void {
  if (!term || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
}

// Wires inbound frames to the terminal and keystrokes to the socket. Returns the
// stdin subscription so the caller can dispose it on teardown.
export function attachPtySocket(term: Terminal, ws: WebSocket, onExit: (e: PtyExit) => void): IDisposable {
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
      onExit({ code: frame.code, error: frame.error });
    }
  };

  return term.onData((d) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stdin', data: d }));
    }
  });
}
