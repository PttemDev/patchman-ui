// Self-check for the terminal shortcut rules in src/lib/keymap.ts.
// Run: node scripts/check-terminal-keymap.mjs (Node ≥ 22.18 strips the TS types).
import { ok } from 'node:assert/strict';
import { KEYMAP, isTabSwitchKey, terminalReserved } from '../src/lib/keymap.ts';

// other platforms (mod = Ctrl)
ok(terminalReserved({ code: 'KeyR', mod: true }, false));                   // Ctrl-R history search
ok(!terminalReserved({ code: 'KeyT', mod: true, shift: true }, false));     // Ctrl+Shift+T
ok(!terminalReserved({ code: 'Backquote', mod: true }, false));             // Ctrl+`
ok(terminalReserved({ code: 'KeyF', alt: true }, false));                   // Alt-F word forward
ok(terminalReserved({ code: 'KeyA' }, false));                              // plain typing
ok(terminalReserved({ code: 'F5' }, false));                                // no modifier
ok(terminalReserved({ code: 'ArrowLeft', mod: true, shift: true }, false)); // line editing
ok(!terminalReserved({ code: 'BracketRight', mod: true, shift: true }, false));
// macOS (mod = ⌘, ctrl = ⌃)
ok(terminalReserved({ code: 'KeyR', ctrl: true }, true));
ok(!terminalReserved({ code: 'Backquote', ctrl: true }, true));
ok(!terminalReserved({ code: 'KeyT', mod: true, shift: true }, true));
ok(terminalReserved({ code: 'ArrowLeft', mod: true }, true));               // ⌘← line start
ok(terminalReserved({ code: 'Backspace', mod: true }, true));               // ⌘⌫ kill line
ok(terminalReserved({ code: 'KeyC', mod: true }, true));                    // copy
ok(terminalReserved({ code: 'KeyV', mod: true }, true));                    // paste
ok(terminalReserved({ code: 'KeyF', alt: true }, true));                    // ⌥F composes ƒ
ok(!terminalReserved({ code: 'KeyK', mod: true }, true));
// every default of every inTerminal action is allowed on both platforms
const actions = KEYMAP.filter((x) => x.inTerminal && !x.fixed);
ok(actions.length === 5, `expected 5 terminal actions, got ${actions.length}`);
for (const a of actions)
  for (const [mac, list] of [[true, a.mac], [false, a.other]])
    for (const b of list) ok(!terminalReserved(b, mac), `${a.id} default reserved`);
// ⌥/Alt+1–9 (switch tab) is the app's even inside a terminal
const ev = (code, m = {}) => ({ code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...m });
ok(isTabSwitchKey(ev('Digit1', { altKey: true })));
ok(isTabSwitchKey(ev('Digit9', { altKey: true })));
ok(!isTabSwitchKey(ev('Digit0', { altKey: true })));
ok(!isTabSwitchKey(ev('Digit1', { altKey: true, shiftKey: true })));
ok(!isTabSwitchKey(ev('Digit1', { altKey: true, ctrlKey: true })));
ok(!isTabSwitchKey(ev('KeyF', { altKey: true })));
ok(!isTabSwitchKey(ev('Digit1')));
console.log('check-terminal-keymap: OK');
