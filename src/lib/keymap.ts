// One keymap for the whole app: every shortcut is an action with default
// bindings per platform, a scope, and an optional user override (Settings →
// Keymap). Scoped bindings (git, editor) win over global ones while their
// surface is active: they listen on `window` in the capture phase, which
// runs before the global `document` listener.

import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const isMacPlatform =
  typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

export interface KeyBinding {
  /** KeyboardEvent.code (layout-independent, survives ⌥ composition). For a
   *  double tap: the modifier's key name (Shift, Control, Alt, Meta). */
  code: string;
  mod?: boolean; // ⌘ on macOS, Ctrl elsewhere
  ctrl?: boolean; // the real Control key (macOS-only chords like ⌃V)
  alt?: boolean;
  shift?: boolean;
  /** tap `code` twice (⇧⇧) */
  double?: boolean;
}

export type KeymapScope = 'global' | 'git' | 'editor';

export interface KeymapAction {
  id: string;
  /** settings:keymap.* label key */
  labelKey: string;
  scope: KeymapScope;
  mac: KeyBinding[];
  other: KeyBinding[];
  /** shown but not rebindable (OS-owned or not a key chord) */
  fixed?: boolean;
  /** display-only text for fixed actions (e.g. "⌘+click") */
  display?: string[][];
}

const k = (code: string, m: Omit<KeyBinding, 'code'> = {}): KeyBinding => ({ code, ...m });
const same = (b: KeyBinding[]) => ({ mac: b, other: b });

export const KEYMAP: KeymapAction[] = [
  // ── global ──
  { id: 'global.newTab', labelKey: 'keymap.newTab', scope: 'global', ...same([k('KeyN', { mod: true }), k('KeyT', { mod: true })]) },
  { id: 'global.closeTab', labelKey: 'keymap.closeTab', scope: 'global', ...same([k('KeyW', { mod: true })]) },
  { id: 'global.detachTab', labelKey: 'keymap.detachTab', scope: 'global', ...same([k('KeyD', { mod: true })]) },
  { id: 'global.jumpToTab', labelKey: 'keymap.jumpToTab', scope: 'global', fixed: true, mac: [], other: [], display: [['⌥', '1–9']] },
  { id: 'global.sendRequest', labelKey: 'keymap.sendRequest', scope: 'global', ...same([k('Enter', { mod: true })]) },
  { id: 'global.saveToCollection', labelKey: 'keymap.saveToCollection', scope: 'global', ...same([k('KeyS', { mod: true })]) },
  { id: 'global.saveAsNew', labelKey: 'keymap.saveAsNew', scope: 'global', ...same([k('KeyS', { mod: true, shift: true })]) },
  { id: 'global.focusUrl', labelKey: 'keymap.focusUrlBar', scope: 'global', ...same([k('KeyL', { mod: true })]) },
  { id: 'global.commandPalette', labelKey: 'keymap.commandPalette', scope: 'global', ...same([k('KeyK', { mod: true })]) },
  { id: 'global.globalSearch', labelKey: 'keymap.globalSearch', scope: 'global', ...same([k('KeyP', { mod: true })]) },
  { id: 'global.toggleSidebar', labelKey: 'keymap.toggleSidebar', scope: 'global', ...same([k('KeyB', { mod: true })]) },
  { id: 'global.envManager', labelKey: 'keymap.environmentManager', scope: 'global', ...same([k('KeyE', { mod: true })]) },
  { id: 'global.pasteHistory', labelKey: 'keymap.pasteHistory', scope: 'global', mac: [k('KeyV', { mod: true, alt: true })], other: [k('KeyV', { mod: true, alt: true })] },
  { id: 'global.quit', labelKey: 'keymap.quit', scope: 'global', fixed: true, mac: [k('KeyQ', { mod: true })], other: [k('KeyQ', { mod: true })] },
  // ── git tab ──
  { id: 'git.commit', labelKey: 'keymap.gitCommit', scope: 'git', ...same([k('KeyK', { mod: true })]) },
  { id: 'git.push', labelKey: 'keymap.gitPush', scope: 'git', ...same([k('KeyK', { mod: true, shift: true })]) },
  { id: 'git.update', labelKey: 'keymap.gitUpdate', scope: 'git', ...same([k('KeyT', { mod: true })]) },
  { id: 'git.vcsOperations', labelKey: 'keymap.gitVcsOperations', scope: 'git', mac: [k('KeyV', { ctrl: true })], other: [k('Backquote', { alt: true })] },
  { id: 'git.branches', labelKey: 'keymap.gitBranches', scope: 'git', mac: [k('Backquote', { ctrl: true, shift: true })], other: [k('Backquote', { mod: true, shift: true })] },
  { id: 'git.findInFiles', labelKey: 'keymap.gitFindInFiles', scope: 'git', ...same([k('KeyF', { mod: true, shift: true })]) },
  { id: 'git.gotoFile', labelKey: 'keymap.gitGotoFile', scope: 'git', mac: [k('KeyO', { mod: true, shift: true })], other: [k('KeyN', { mod: true, shift: true })] },
  { id: 'git.gotoSymbol', labelKey: 'keymap.gitGotoSymbol', scope: 'git', mac: [k('KeyO', { mod: true, alt: true })], other: [k('KeyN', { mod: true, alt: true, shift: true })] },
  { id: 'git.searchEverywhere', labelKey: 'keymap.gitSearchEverywhere', scope: 'git', ...same([k('Shift', { double: true })]) },
  { id: 'git.back', labelKey: 'keymap.gitBack', scope: 'git', mac: [k('BracketLeft', { mod: true })], other: [k('ArrowLeft', { mod: true, alt: true })] },
  { id: 'git.forward', labelKey: 'keymap.gitForward', scope: 'git', mac: [k('BracketRight', { mod: true })], other: [k('ArrowRight', { mod: true, alt: true })] },
  // ── git editor ──
  { id: 'editor.save', labelKey: 'keymap.gitSave', scope: 'editor', ...same([k('KeyS', { mod: true })]) },
  { id: 'editor.declaration', labelKey: 'keymap.gitDeclaration', scope: 'editor', ...same([k('KeyB', { mod: true }), k('F12')]) },
  { id: 'editor.usages', labelKey: 'keymap.gitUsages', scope: 'editor', ...same([k('F7', { alt: true })]) },
  { id: 'editor.ctrlClick', labelKey: 'keymap.gitCtrlClick', scope: 'editor', fixed: true, mac: [], other: [], display: [[isMacPlatform ? '⌘' : 'Ctrl', 'click']] },
];

// Presets change only the actions that differ from the JetBrains defaults.
export type KeymapPreset = 'jetbrains' | 'vscode';
export const PRESETS: Record<KeymapPreset, Record<string, { mac: KeyBinding[]; other: KeyBinding[] }>> = {
  jetbrains: {},
  vscode: {
    'git.commit': same([k('Enter', { mod: true })]),
    'git.searchEverywhere': same([k('KeyP', { mod: true, shift: true })]),
    'git.gotoFile': same([k('KeyP', { mod: true })]),
    'git.gotoSymbol': same([k('KeyT', { mod: true })]),
    'git.update': same([]),
    'git.back': { mac: [k('Minus', { ctrl: true })], other: [k('ArrowLeft', { alt: true })] },
    'git.forward': { mac: [k('Minus', { ctrl: true, shift: true })], other: [k('ArrowRight', { alt: true })] },
    'editor.declaration': same([k('F12')]),
    'editor.usages': same([k('F12', { shift: true })]),
  },
};

interface KeymapState {
  preset: KeymapPreset;
  overrides: Record<string, KeyBinding[]>;
  setPreset: (p: KeymapPreset) => void;
  setBindings: (id: string, b: KeyBinding[]) => void;
  reset: (id: string) => void;
  resetAll: () => void;
}

export const useKeymapStore = create<KeymapState>()(persist((set) => ({
  preset: 'jetbrains',
  overrides: {},
  setPreset: (preset) => set({ preset }),
  setBindings: (id, b) => set((s) => ({ overrides: { ...s.overrides, [id]: b } })),
  reset: (id) => set((s) => { const o = { ...s.overrides }; delete o[id]; return { overrides: o }; }),
  resetAll: () => set({ overrides: {} }),
}), { name: 'patchman.keymap.v1' }));

export const actionById = (id: string) => KEYMAP.find((a) => a.id === id);

export function defaultBindings(a: KeymapAction, preset: KeymapPreset = useKeymapStore.getState().preset): KeyBinding[] {
  const p = PRESETS[preset]?.[a.id];
  const src = p ?? a;
  return isMacPlatform ? src.mac : src.other;
}

/** The bindings in force for an action (override, else preset, else default). */
export function resolveBindings(id: string): KeyBinding[] {
  const a = actionById(id);
  if (!a) return [];
  if (a.fixed) return isMacPlatform ? a.mac : a.other;
  const { overrides, preset } = useKeymapStore.getState();
  return overrides[id] ?? defaultBindings(a, preset);
}

export function bindingFor(a: KeymapAction): KeyBinding {
  return resolveBindings(a.id)[0] ?? { code: '' };
}

export function matches(e: KeyboardEvent, b: KeyBinding): boolean {
  if (b.double || !b.code || e.code !== b.code) return false;
  const modKey = isMacPlatform ? e.metaKey : e.ctrlKey;
  // On macOS ctrl is its own modifier; elsewhere ctrl IS mod.
  const ctrlWanted = isMacPlatform ? !!b.ctrl : !!(b.ctrl || b.mod);
  const metaWanted = isMacPlatform ? !!b.mod : false;
  return (
    modKey === !!b.mod &&
    e.ctrlKey === ctrlWanted &&
    e.metaKey === metaWanted &&
    e.altKey === !!b.alt &&
    e.shiftKey === !!b.shift
  );
}

export const matchesAction = (e: KeyboardEvent, id: string) => resolveBindings(id).some((b) => matches(e, b));

const KEY_NAMES: Record<string, string> = {
  Backquote: '`', BracketLeft: '[', BracketRight: ']', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'",
  Enter: isMacPlatform ? '↵' : 'Enter', Space: 'Space', Escape: 'Esc', Backspace: '⌫', Tab: 'Tab',
};

/** Key glyphs for Settings → Keymap / tooltips. */
export function chordLabel(b: KeyBinding): string[] {
  if (b.double) {
    const g = isMacPlatform ? ({ Shift: '⇧', Control: '⌃', Alt: '⌥', Meta: '⌘' } as Record<string, string>)[b.code] ?? b.code : b.code;
    return [g, g];
  }
  const keyName = KEY_NAMES[b.code] ?? b.code.replace(/^Key|^Digit|^Numpad/, '');
  const out: string[] = [];
  if (isMacPlatform) {
    if (b.ctrl) out.push('⌃');
    if (b.alt) out.push('⌥');
    if (b.shift) out.push('⇧');
    if (b.mod) out.push('⌘');
  } else {
    if (b.mod || b.ctrl) out.push('Ctrl');
    if (b.alt) out.push('Alt');
    if (b.shift) out.push('Shift');
  }
  out.push(keyName);
  return out;
}

export const sameBinding = (a: KeyBinding, b: KeyBinding) =>
  a.code === b.code && !!a.mod === !!b.mod && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.double === !!b.double;

/** Hint text for an action id (first binding), e.g. "⇧⌘K". */
export function shortcutHint(_actions: KeymapAction[] | undefined, id: string): string {
  const b = resolveBindings(id)[0];
  return b ? chordLabel(b).join(isMacPlatform ? '' : '+') : '';
}

export const GIT_KEYMAP = KEYMAP.filter((a) => a.scope === 'git');
export const EDITOR_KEYMAP = KEYMAP.filter((a) => a.scope === 'editor');

/** Builds a binding from a keydown (Settings capture). null for a bare modifier. */
export function bindingFromEvent(e: KeyboardEvent): KeyBinding | null {
  if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return null;
  const mod = isMacPlatform ? e.metaKey : e.ctrlKey;
  return {
    code: e.code,
    mod: mod || undefined,
    ctrl: isMacPlatform && e.ctrlKey ? true : undefined,
    alt: e.altKey || undefined,
    shift: e.shiftKey || undefined,
  };
}

/** Chords the OS keeps for itself (never reach the app). */
export function osReserved(b: KeyBinding): boolean {
  if (!isMacPlatform) return (b.alt && b.code === 'F4') || (b.alt && b.code === 'Tab') || false;
  return !!b.mod && !b.shift && !b.alt && !b.ctrl && ['KeyQ', 'Tab', 'Space', 'KeyH', 'KeyM', 'Backquote'].includes(b.code);
}

/** Chords a browser tab cannot reliably capture (web build only). */
export function browserReserved(b: KeyBinding): boolean {
  return !!b.mod && !b.alt && !b.ctrl && ['KeyT', 'KeyW', 'KeyN', 'KeyL', 'KeyR', 'KeyQ'].includes(b.code) && !b.shift;
}

/**
 * Runs handlers[id] for a matching binding while `active` is true. Handlers
 * are read through a ref so callers can pass a fresh object each render;
 * bindings are read live, so a change in Settings applies at once. Double-tap
 * bindings (⇧⇧) are handled too.
 */
export function useScopedKeymap(actions: KeymapAction[], active: boolean, handlers: Record<string, () => void>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!active) return;
    const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
    let tapKey = '';
    let tapAt = 0;
    let clean = false;
    const onKey = (e: KeyboardEvent) => {
      clean = ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) && !e.repeat;
      if (!clean) tapKey = '';
      if (dialogOpen()) return;
      for (const a of actions) {
        const fn = ref.current[a.id];
        if (fn && matchesAction(e, a.id)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          fn();
          return;
        }
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (!clean || dialogOpen()) return;
      const now = Date.now();
      if (tapKey === e.key && now - tapAt < 400) {
        tapKey = '';
        for (const a of actions) {
          const fn = ref.current[a.id];
          if (fn && resolveBindings(a.id).some((b) => b.double && b.code === e.key)) { fn(); return; }
        }
      } else {
        tapKey = e.key;
        tapAt = now;
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onUp, true); };
  }, [actions, active]);
}
