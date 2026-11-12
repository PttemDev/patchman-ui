// Theme presets. Each preset maps to a BASE mode ('light' | 'dark') — the base
// is what Monaco (vs-dark/light), the xterm terminal, and charts read, so those
// keep working unchanged. The preset id additionally drives a `data-theme`
// attribute whose CSS overrides a few surface tokens (see index.css) to give a
// distinct look. The two default presets ('light' / 'dark') set NO data-theme
// and render the original :root / .dark tokens — so existing users, whose stored
// value is just 'light'/'dark', are byte-for-byte unchanged.

export type ThemeBase = 'light' | 'dark';

export interface ThemePreset {
  id: string;
  base: ThemeBase;
  /** Representative color for the settings swatch (approximate background). */
  swatch: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  // Light — a ramp from pure white to a dim, low-glare gray "paper".
  { id: 'light', base: 'light', swatch: '#ffffff' },
  { id: 'warm', base: 'light', swatch: '#f1e8d5' },
  { id: 'slate', base: 'light', swatch: '#e2e9f2' },
  { id: 'paper', base: 'light', swatch: '#dedbd3' },
  // Dark
  { id: 'dark', base: 'dark', swatch: '#242424' },
  { id: 'dim', base: 'dark', swatch: '#33373d' },
  { id: 'ocean', base: 'dark', swatch: '#0e2030' },
  { id: 'grape', base: 'dark', swatch: '#211a30' },
];

/** BARE_PRESET renders with NO `data-theme` attribute — the original :root /
 * .dark tokens. Kept separate from DEFAULT_PRESET so the "no data-theme = the
 * original look" CSS contract, and existing users whose stored value is plain
 * 'light'/'dark', stay byte-for-byte unchanged. */
export const BARE_PRESET: Record<ThemeBase, string> = { light: 'light', dark: 'dark' };

/** The default preset a BRAND-NEW user lands on, and the fallback the light/dark
 * toggle resolves to. Both are user-overridable in Appearance (⭐), so this only
 * sets the out-of-the-box look. */
export const DEFAULT_PRESET: Record<ThemeBase, string> = { light: 'warm', dark: 'ocean' };

export function isValidPreset(id: string): boolean {
  return THEME_PRESETS.some((p) => p.id === id);
}

export function presetBase(id: string): ThemeBase {
  return THEME_PRESETS.find((p) => p.id === id)?.base ?? 'dark';
}
