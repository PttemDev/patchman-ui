import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { confirmDialog } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/use-toast';
import { getLocalApiUrl } from '@/lib/platform';
import { pluginAPI, type PluginConnection, type PluginInfo } from '@/lib/plugins/pluginApi';
import { useThemeStore } from '@/stores/themeStore';
import { errorMessage } from './util';

// PluginFrame hosts a plugin's custom UI (RFC §16.3, ADR-2 amendment A).
//
// - The page comes from the backend's /plugin-ui route, whose CSP sandboxes
//   it (opaque origin) and gives it no network; the iframe is sandboxed too.
// - The only channel is a MessageChannel handed over once, on the first
//   load. A second load means the frame navigated (to something that is not
//   the plugin page): it is torn down, never re-connected.
// - Every request is validated here; ops go through the normal API client,
//   so grants, the read-write switch, the lock and step-up all apply, and
//   write/sensitive ops ask the user first.

const METHODS = new Set(['ops.call', 'connection.get', 'theme.get', 'i18n.get', 'toast', 'state.get', 'state.set']);
const MAX_MESSAGE = 1 << 20;
const MAX_INFLIGHT = 16;
const MAX_STATE = 64 << 10;
const THEME_TOKENS = ['background', 'foreground', 'card', 'card-foreground', 'primary', 'primary-foreground', 'muted', 'muted-foreground', 'border', 'accent', 'destructive'];

/** Per-tab plugin UI state (state.get / state.set), kept in memory. */
const frameState = new Map<string, unknown>();

function themeSnapshot(mode: string) {
  const css = getComputedStyle(document.documentElement);
  const tokens: Record<string, string> = {};
  for (const k of THEME_TOKENS) tokens[k] = css.getPropertyValue(`--${k}`).trim();
  return { mode, tokens };
}

interface Props {
  tabId: string;
  plugin: PluginInfo;
  conn: PluginConnection | undefined;
}

export function PluginFrame({ tabId, plugin, conn }: Props) {
  const { t, i18n } = useTranslation('plugins');
  const { toast } = useToast();
  const theme = useThemeStore((s) => s.theme);
  const frame = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const loads = useRef(0);
  const [broken, setBroken] = useState(false);
  // Latest values for the long-lived message handler.
  const ctx = useRef({ plugin, conn, theme, lang: i18n.language });
  ctx.current = { plugin, conn, theme, lang: i18n.language };

  const base = getLocalApiUrl();
  const entry = plugin.ui?.entry?.replace(/^ui\//, '') ?? '';
  const src = base && plugin.uiRev ? `${base}/plugin-ui/${encodeURIComponent(plugin.id)}/${plugin.uiRev}/${entry.split('/').map(encodeURIComponent).join('/')}` : null;

  useEffect(() => () => port.current?.close(), []);

  // Push theme changes to a connected frame.
  useEffect(() => {
    port.current?.postMessage({ event: 'theme', data: themeSnapshot(theme) });
  }, [theme]);

  const handle = async (msg: unknown): Promise<unknown> => {
    const m = msg as { method?: unknown; params?: unknown };
    const p = (m.params ?? {}) as Record<string, unknown>;
    const { plugin: pl, conn: cn } = ctx.current;
    switch (m.method) {
      case 'ops.call': {
        const op = typeof p.op === 'string' ? p.op : '';
        const def = pl.ops[op];
        if (!def || op === 'test') throw new Error(`unknown op ${op}`);
        if (!cn) throw new Error('no connection selected');
        if (def.write || def.sensitive) {
          const ok = await confirmDialog({
            title: t('frame.confirmTitle', { plugin: pl.name, op }),
            description: def.sensitive ? t('frame.confirmSensitive', { conn: cn.name }) : t('frame.confirmWrite', { conn: cn.name }),
            confirmLabel: t('panel.run'),
            destructive: true,
          });
          if (!ok) throw new Error('cancelled by the user');
        }
        const r = await pluginAPI.callOp(pl.id, cn.id, op, p.input ?? {});
        return r.data;
      }
      case 'connection.get':
        return cn ? { id: cn.id, name: cn.name, config: cn.config, allowWrite: cn.allowWrite } : null;
      case 'theme.get':
        return themeSnapshot(ctx.current.theme);
      case 'i18n.get':
        return { lang: ctx.current.lang };
      case 'toast': {
        const text = typeof p.message === 'string' ? p.message.slice(0, 300) : '';
        if (text) toast({ title: pl.name, description: text, variant: p.kind === 'error' ? 'destructive' : undefined });
        return null;
      }
      case 'state.get':
        return frameState.get(tabId) ?? null;
      case 'state.set': {
        const size = JSON.stringify(p.value ?? null).length;
        if (size > MAX_STATE) throw new Error(`state over ${MAX_STATE} bytes`);
        frameState.set(tabId, p.value ?? null);
        return null;
      }
    }
    throw new Error('unknown method');
  };

  const onLoad = () => {
    loads.current += 1;
    if (loads.current > 1) {
      // The frame navigated after the plugin page loaded: drop it.
      port.current?.close();
      port.current = null;
      setBroken(true);
      return;
    }
    const win = frame.current?.contentWindow;
    if (!win) return;
    const ch = new MessageChannel();
    port.current = ch.port1;
    let inflight = 0;
    ch.port1.onmessage = async (e: MessageEvent) => {
      const msg = e.data as { id?: unknown; method?: unknown };
      if (!msg || typeof msg !== 'object' || typeof msg.id !== 'number' || typeof msg.method !== 'string' || !METHODS.has(msg.method)) return;
      let size = 0;
      try { size = JSON.stringify(msg).length; } catch { size = MAX_MESSAGE + 1; }
      const id = msg.id;
      if (size > MAX_MESSAGE) return ch.port1.postMessage({ id, error: 'message too large' });
      if (inflight >= MAX_INFLIGHT) return ch.port1.postMessage({ id, error: 'too many requests' });
      inflight += 1;
      try {
        const result = await handle(msg);
        ch.port1.postMessage({ id, result: JSON.parse(JSON.stringify(result ?? null)) });
      } catch (err) {
        ch.port1.postMessage({ id, error: errorMessage(err) });
      } finally {
        inflight -= 1;
      }
    };
    // An opaque-origin frame can only be addressed with '*'; only the port
    // travels in this message, nothing else.
    win.postMessage({ type: 'pm:connect', v: 1 }, '*', [ch.port2]);
  };

  // Detached windows are created from JS without the shell's navigation
  // handler, so a plugin frame there could navigate away: main window only.
  // Windows (WebView2): init scripts also run in subframes and frame
  // navigation is not hooked yet — custom UI stays off (RFC §14.5).
  if (/Windows/i.test(navigator.userAgent)) {
    return <div className="p-6 text-sm text-muted-foreground">{t('frame.windowsOff')}</div>;
  }
  if (new URLSearchParams(window.location.search).has('detached')) {
    return <div className="p-6 text-sm text-muted-foreground">{t('frame.mainWindowOnly')}</div>;
  }
  if (!src) return <div className="p-6 text-sm text-muted-foreground">{t('frame.unavailable')}</div>;
  if (broken) {
    return (
      <div className="flex items-start gap-2 p-6 text-sm text-destructive">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>{t('frame.navigated')}</span>
      </div>
    );
  }
  return (
    <iframe
      ref={frame}
      key={src}
      title={t('frame.title', { name: plugin.name })}
      src={src}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; display-capture 'none'"
      onLoad={onLoad}
      className="h-full w-full border-0 bg-background"
    />
  );
}
