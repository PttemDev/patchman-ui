// Settings → Terminal: cursor and font for the embedded terminals (Terminal tab,
// Claude, K8s). Per device (stores/terminalPrefsStore.ts); colors follow the theme unless a scheme is chosen.

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TERMINAL_SCHEMES, xtermTheme } from '@/lib/ptyTerminal';
import { useThemeStore } from '@/stores/themeStore';
import {
  TERMINAL_FONT_MAX, TERMINAL_FONT_MIN, useTerminalPrefsStore, type CursorStyle, type TerminalColorScheme,
} from '@/stores/terminalPrefsStore';

// Scheme names are proper nouns (not translated); 'app' is labelled via i18n.
const SCHEME_NAMES: Record<Exclude<TerminalColorScheme, 'app'>, string> = {
  dracula: 'Dracula', oneDark: 'One Dark', nord: 'Nord',
  solarizedDark: 'Solarized Dark', solarizedLight: 'Solarized Light', githubLight: 'GitHub Light',
};
const SCHEME_IDS = Object.keys(SCHEME_NAMES) as Exclude<TerminalColorScheme, 'app'>[];
const CURSOR_STYLES: CursorStyle[] = ['block', 'bar', 'underline'];
const FONT_SIZES = Array.from({ length: TERMINAL_FONT_MAX - TERMINAL_FONT_MIN + 1 }, (_, i) => TERMINAL_FONT_MIN + i);

// <input type="color"> needs #rrggbb; the theme cursor comes back as rgba(r, g, b, a).
const toHex = (rgba: string) =>
  '#' + (rgba.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');

export function TerminalSection() {
  const { t } = useTranslation('settings');
  const { colorScheme, cursorStyle, cursorBlink, cursorColor, fontSize, setColorScheme, setCursorStyle, setCursorBlink, setCursorColor, setFontSize } =
    useTerminalPrefsStore();
  useThemeStore((s) => s.preset); // re-read the theme cursor color on preset change
  const themeCursor = toHex(String(xtermTheme().foreground));
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('terminal.heading')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('terminal.description')}</p>
      </div>
      <div className="max-w-xl space-y-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">{t('terminal.colorScheme')}</span>
          <Select value={colorScheme} onValueChange={(v) => setColorScheme(v as TerminalColorScheme)}>
            <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="app" className="text-xs">{t('terminal.schemeApp')}</SelectItem>
              {SCHEME_IDS.map((id) => (
                <SelectItem key={id} value={id} className="text-xs">
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-sm border" style={{ background: TERMINAL_SCHEMES[id].background }} />
                    {SCHEME_NAMES[id]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">{t('terminal.cursorStyle')}</span>
          <Select value={cursorStyle} onValueChange={(v) => setCursorStyle(v as CursorStyle)}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURSOR_STYLES.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">{t(`terminal.style.${s}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">{t('terminal.cursorBlink')}</span>
          <Switch checked={cursorBlink} onCheckedChange={setCursorBlink} aria-label={t('terminal.cursorBlink')} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">{t('terminal.cursorColor')}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{cursorColor ? t('terminal.custom') : t('terminal.themeColor')}</span>
            <input type="color" value={cursorColor ?? themeCursor} onChange={(e) => setCursorColor(e.target.value)}
              aria-label={t('terminal.cursorColor')} className="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5" />
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled={cursorColor === null} onClick={() => setCursorColor(null)}>
              {t('terminal.useThemeColor')}
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">{t('terminal.fontSize')}</span>
          <Select value={String(fontSize)} onValueChange={(v) => setFontSize(Number(v))}>
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FONT_SIZES.map((n) => <SelectItem key={n} value={String(n)} className="text-xs">{n} px</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
