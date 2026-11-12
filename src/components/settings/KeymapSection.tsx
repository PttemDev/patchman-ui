// Read-only keyboard-shortcut reference. v1 just LISTS the shortcuts the app
// registers (see useKeyboardShortcuts + CommandPalette); remapping is a future
// step. Platform-aware key glyphs (⌘/⌥/⇧ on macOS, Ctrl/Alt/Shift elsewhere).

import { useTranslation } from 'react-i18next';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';
const ALT = isMac ? '⌥' : 'Alt';
const SHIFT = isMac ? '⇧' : 'Shift';
const ENTER = isMac ? '↵' : 'Enter';

interface Shortcut {
  // Each inner array is one key-combo. An action bound to more than one
  // combo (e.g. new-tab on ⌘N *and* ⌘T) lists them here so it stays a
  // single row, its combos shown comma-separated.
  chords: string[][];
  labelKey: string;
}

const GROUPS: { titleKey: string; items: Shortcut[] }[] = [
  {
    titleKey: 'keymap.groupTabs',
    items: [
      { chords: [[MOD, 'N'], [MOD, 'T']], labelKey: 'keymap.newTab' },
      { chords: [[MOD, 'W']], labelKey: 'keymap.closeTab' },
      { chords: [[MOD, 'D']], labelKey: 'keymap.detachTab' },
      { chords: [[ALT, '1–9']], labelKey: 'keymap.jumpToTab' },
    ],
  },
  {
    titleKey: 'keymap.groupRequests',
    items: [
      { chords: [[MOD, ENTER]], labelKey: 'keymap.sendRequest' },
      { chords: [[MOD, 'S']], labelKey: 'keymap.saveToCollection' },
      { chords: [[MOD, SHIFT, 'S']], labelKey: 'keymap.saveAsNew' },
      { chords: [[MOD, 'L']], labelKey: 'keymap.focusUrlBar' },
    ],
  },
  {
    titleKey: 'keymap.groupNavigation',
    items: [
      { chords: [[MOD, 'K']], labelKey: 'keymap.commandPalette' },
      { chords: [[MOD, 'P']], labelKey: 'keymap.globalSearch' },
      { chords: [[MOD, 'B']], labelKey: 'keymap.toggleSidebar' },
      { chords: [[MOD, 'E']], labelKey: 'keymap.environmentManager' },
    ],
  },
  {
    titleKey: 'keymap.groupTools',
    items: [{ chords: [[MOD, ALT, 'V']], labelKey: 'keymap.pasteHistory' }],
  },
  {
    titleKey: 'keymap.groupApp',
    items: [{ chords: [[MOD, 'Q']], labelKey: 'keymap.quit' }],
  },
];

function Chord({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="min-w-[1.5rem] rounded border bg-muted px-1.5 py-0.5 text-center text-[11px] font-medium text-foreground shadow-sm"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

// Renders one or more key-combos for a single action, separated by a comma
// so alternative bindings read as "⌘N , ⌘T" on one line.
function Chords({ chords }: { chords: string[][] }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      {chords.map((chord, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-muted-foreground text-xs">,</span>}
          <Chord keys={chord} />
        </span>
      ))}
    </span>
  );
}

export function KeymapSection() {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('keymap.heading')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t('keymap.description')}
        </p>
      </div>

      <div className="space-y-4">
        {GROUPS.map((group) => (
          <div key={group.titleKey}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {t(group.titleKey)}
            </div>
            <div className="rounded-md border divide-y">
              {group.items.map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-4 px-3 py-1.5">
                  <span className="text-sm text-foreground min-w-0 truncate">{t(s.labelKey)}</span>
                  <Chords chords={s.chords} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
