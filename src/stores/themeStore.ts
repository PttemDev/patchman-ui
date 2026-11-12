import { create } from 'zustand';
import {
  BARE_PRESET,
  DEFAULT_PRESET,
  isValidPreset,
  presetBase,
  type ThemeBase,
} from '@/lib/themes';

// Theme store. `theme` is the BASE mode ('light'|'dark') that Monaco (vs-dark),
// the xterm terminal, and charts read — kept exactly as before so those don't
// change. `preset` is the selected variant id; a non-default preset also stamps
// a `data-theme` attribute whose CSS overrides a few surface tokens (index.css).
//
// `switchDefault` is the per-base preset the light/dark TOGGLE resolves to — the
// user picks, in Appearance, which dark and which light the switch lands on
// (e.g. make the toggle's dark = Ocean). It falls back to DEFAULT_PRESET, so a
// user who never sets it keeps the original toggle behavior.
//
// Backward compatible: legacy users only have `patchman_theme` ('light'/'dark'),
// which resolves to that base's DEFAULT preset (no data-theme) → identical look.

const PRESET_KEY = 'patchman_theme_preset';
const BASE_KEY = 'patchman_theme'; // legacy; kept in sync so old readers still work
const SWITCH_KEY = 'patchman_theme_switch_defaults'; // JSON {light,dark}

type SwitchDefaults = Record<ThemeBase, string>;

interface ThemeState {
  theme: ThemeBase;
  preset: string;
  switchDefault: SwitchDefaults;
  toggle: () => void;
  setTheme: (theme: ThemeBase) => void;
  setPreset: (id: string) => void;
  setSwitchDefault: (base: ThemeBase, id: string) => void;
}

const getInitialPreset = (): string => {
  const storedPreset = localStorage.getItem(PRESET_KEY);
  if (storedPreset && isValidPreset(storedPreset)) return storedPreset;
  // Existing (pre-preset) users only have the legacy base key — keep them on the
  // ORIGINAL bare look, don't upgrade them to the new default preset.
  const legacy = localStorage.getItem(BASE_KEY);
  if (legacy === 'dark' || legacy === 'light') return BARE_PRESET[legacy];
  // Brand-new users get the nicer default (warm / ocean).
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return DEFAULT_PRESET.dark;
  return DEFAULT_PRESET.light;
};

// Reads the persisted per-base toggle defaults, validating each is a real preset
// of the matching base; anything missing/invalid falls back to DEFAULT_PRESET.
const getInitialSwitchDefaults = (): SwitchDefaults => {
  const out: SwitchDefaults = { light: DEFAULT_PRESET.light, dark: DEFAULT_PRESET.dark };
  try {
    const raw = localStorage.getItem(SWITCH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SwitchDefaults>;
      (['light', 'dark'] as ThemeBase[]).forEach((base) => {
        const id = parsed[base];
        if (id && isValidPreset(id) && presetBase(id) === base) out[base] = id;
      });
    }
  } catch {
    /* corrupt/absent — defaults apply */
  }
  return out;
};

const applyPreset = (id: string) => {
  const base = presetBase(id);
  const root = document.documentElement;
  if (base === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
  // Only the BARE presets (plain light/dark) carry no data-theme attribute and
  // render the original :root / .dark tokens; every other preset stamps one.
  if (id === BARE_PRESET[base]) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', id);
  try {
    localStorage.setItem(PRESET_KEY, id);
    localStorage.setItem(BASE_KEY, base);
  } catch {
    /* private mode / quota — in-memory state still applies */
  }
};

// Applied at module import (before React mounts) → no theme flash.
const initialPreset = getInitialPreset();
applyPreset(initialPreset);

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: presetBase(initialPreset),
  preset: initialPreset,
  switchDefault: getInitialSwitchDefaults(),

  toggle: () =>
    set((state) => {
      const nextBase: ThemeBase = state.theme === 'light' ? 'dark' : 'light';
      const id = state.switchDefault[nextBase];
      applyPreset(id);
      return { theme: nextBase, preset: id };
    }),

  setTheme: (theme) => {
    const id = get().switchDefault[theme];
    applyPreset(id);
    set({ theme, preset: id });
  },

  setPreset: (id) => {
    if (!isValidPreset(id)) return;
    applyPreset(id);
    set({ theme: presetBase(id), preset: id });
  },

  setSwitchDefault: (base, id) => {
    if (!isValidPreset(id) || presetBase(id) !== base) return;
    set((state) => {
      const next = { ...state.switchDefault, [base]: id };
      try {
        localStorage.setItem(SWITCH_KEY, JSON.stringify(next));
      } catch {
        /* private mode / quota — in-memory only */
      }
      return { switchDefault: next };
    });
  },
}));
