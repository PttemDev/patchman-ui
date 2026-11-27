// Settings → Keymap: every shortcut in the app (lib/keymap.ts), grouped by
// where it works. Click a binding to record a new one; conflicts in the same
// scope are flagged, OS-reserved chords refused, browser-reserved ones warned
// about on the web build; keys the terminal owns are refused for terminal
// shortcuts, which are listed on desktop only. Presets (JetBrains / VS Code) set the defaults;
// per-action overrides sit on top and can be reset one by one or all at once.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Plus, RotateCcw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { confirmDialog } from '@/components/ui/confirm';
import { isDesktop } from '@/lib/platform';
import { cn } from '@/lib/utils';
import {
  KEYMAP, bindingFromEvent, browserReserved, chordLabel, defaultBindings, osReserved, resolveBindings, sameBinding, terminalReserved,
  useKeymapStore, type KeyBinding, type KeymapAction, type KeymapPreset, type KeymapScope,
} from '@/lib/keymap';

function Chord({ keys, muted }: { keys: string[]; muted?: boolean }) {
  return (
    <span className={cn('flex items-center gap-1', muted && 'opacity-60')}>
      {keys.map((k, i) => (
        <kbd key={i} className="min-w-[1.5rem] rounded border bg-muted px-1.5 py-0.5 text-center text-[11px] font-medium text-foreground shadow-sm">{k}</kbd>
      ))}
    </span>
  );
}

const SCOPES: KeymapScope[] = ['global', 'git', 'editor', 'terminal'];

export function KeymapSection() {
  const { t } = useTranslation('settings');
  const { preset, overrides, setPreset, setBindings, reset, resetAll } = useKeymapStore();
  const [query, setQuery] = useState('');
  const [recording, setRecording] = useState<{ id: string; index: number } | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string; warn?: boolean; binding?: KeyBinding; clash?: string[] } | null>(null);
  const desktop = isDesktop();

  // Re-render on store changes: resolveBindings reads the store directly.
  void overrides; void preset;

  // Terminal shortcuts all fire while the terminal has focus, so they clash across scopes too.
  const conflictsOf = (a: KeymapAction, b: KeyBinding) =>
    KEYMAP.filter((x) => x.id !== a.id && !x.fixed && (x.scope === a.scope || (x.inTerminal && a.inTerminal)) && resolveBindings(x.id).some((y) => sameBinding(y, b)));

  // Capture the next chord while recording.
  useEffect(() => {
    if (!recording) return;
    const action = KEYMAP.find((x) => x.id === recording.id)!;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) { setRecording(null); return; }
      const b = bindingFromEvent(e);
      if (!b) return;
      if (osReserved(b)) { setNotice({ id: action.id, text: t('keymap.osReserved', { chord: chordLabel(b).join(' ') }) }); return; }
      if (action.inTerminal && terminalReserved(b)) { setNotice({ id: action.id, text: t('keymap.terminalReserved', { chord: chordLabel(b).join(' ') }) }); return; }
      const list = [...resolveBindings(action.id)];
      if (recording.index < list.length) list[recording.index] = b; else list.push(b);
      setBindings(action.id, list.filter((x, i, arr) => arr.findIndex((y) => sameBinding(x, y)) === i));
      setRecording(null);
      const clash = conflictsOf(action, b);
      if (clash.length) setNotice({ id: action.id, warn: true, binding: b, clash: clash.map((c) => c.id), text: t('keymap.conflict', { chord: chordLabel(b).join(' '), names: clash.map((c) => t(c.labelKey)).join(', ') }) });
      else if (!desktop && browserReserved(b)) setNotice({ id: action.id, warn: true, text: t('keymap.browserReserved') });
      else setNotice(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, setBindings, t, desktop]);

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => SCOPES.map((scope) => ({
    scope,
    items: KEYMAP.filter((a) => a.scope === scope && (desktop || (!a.inTerminal && a.scope !== 'terminal')) && (!q || t(a.labelKey).toLowerCase().includes(q)
      || resolveBindings(a.id).some((b) => chordLabel(b).join('').toLowerCase().includes(q)))),
  })), [q, t, overrides, preset, desktop]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeBinding = (a: KeymapAction, i: number) => setBindings(a.id, resolveBindings(a.id).filter((_, j) => j !== i));
  const changed = (a: KeymapAction) => !!overrides[a.id];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('keymap.heading')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('keymap.descriptionEditable')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('keymap.search')} className="h-8 pl-7 text-xs" />
        </div>
        <span className="text-xs text-muted-foreground">{t('keymap.preset')}</span>
        <Select value={preset} onValueChange={(v) => setPreset(v as KeymapPreset)}>
          <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="jetbrains" className="text-xs">JetBrains</SelectItem>
            <SelectItem value="vscode" className="text-xs">VS Code</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={Object.keys(overrides).length === 0}
          onClick={async () => { if (await confirmDialog({ title: t('keymap.resetAllTitle'), description: t('keymap.resetAllBody'), destructive: true })) resetAll(); }}>
          <RotateCcw className="h-3.5 w-3.5" /> {t('keymap.resetAll')}
        </Button>
      </div>

      <div className="space-y-4">
        {groups.filter((g) => g.items.length).map((group) => (
          <div key={group.scope}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t(`keymap.scope.${group.scope}`)}</div>
            <div className="divide-y rounded-md border">
              {group.items.map((a) => {
                const binds = resolveBindings(a.id);
                return (
                  <div key={a.id}>
                    <div className="flex items-center justify-between gap-3 px-3 py-1.5">
                      <span className={cn('min-w-0 truncate text-sm text-foreground', changed(a) && 'font-medium')}>
                        {t(a.labelKey)}
                        {changed(a) && <span className="ml-1.5 text-[10px] text-primary">{t('keymap.custom')}</span>}
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {a.fixed ? (
                          (a.display ?? binds.map(chordLabel)).map((c, i) => (
                            <span key={i} className="flex items-center">
                              {i > 0 && <span className="mr-1.5 text-[11px] text-muted-foreground">/</span>}
                              <Chord keys={c} muted />
                            </span>
                          ))
                        ) : (
                          <>
                            {binds.map((b, i) => (
                              recording?.id === a.id && recording.index === i ? (
                                <span key={i} className="animate-pulse rounded border border-primary px-2 py-0.5 text-[11px] text-primary">{t('keymap.pressKeys')}</span>
                              ) : (
                                <span key={i} className="group flex items-center">
                                  {i > 0 && <span className="mr-1.5 text-[11px] text-muted-foreground">/</span>}
                                  <button type="button" onClick={() => { setNotice(null); setRecording({ id: a.id, index: i }); }} title={t('keymap.clickToChange')}>
                                    <Chord keys={chordLabel(b)} />
                                  </button>
                                  {!b.double && (
                                    <button type="button" onClick={() => removeBinding(a, i)} aria-label={t('keymap.remove')} className="ml-0.5 hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block">
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </span>
                              )
                            ))}
                            {recording?.id === a.id && recording.index >= binds.length ? (
                              <span className="animate-pulse rounded border border-primary px-2 py-0.5 text-[11px] text-primary">{t('keymap.pressKeys')}</span>
                            ) : (
                              <button type="button" onClick={() => { setNotice(null); setRecording({ id: a.id, index: binds.length }); }}
                                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" title={t('keymap.add')} aria-label={t('keymap.add')}>
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {binds.length === 0 && recording?.id !== a.id && <span className="text-[11px] text-muted-foreground">{t('keymap.none')}</span>}
                            {changed(a) && (
                              <button type="button" onClick={() => reset(a.id)} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                title={t('keymap.resetOne', { chord: defaultBindings(a).map((b) => chordLabel(b).join('')).join(', ') || '—' })} aria-label={t('keymap.reset')}>
                                <RotateCcw className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                    {notice?.id === a.id && (
                      <div className={cn('flex items-start gap-1.5 px-3 pb-1.5 text-[11px]', notice.warn ? 'text-amber-600 dark:text-amber-400' : 'text-destructive')}>
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> <span className="flex-1">{notice.text}</span>
                        {notice.clash && notice.binding && (
                          <button type="button" className="shrink-0 rounded border border-current px-1.5 font-medium hover:bg-amber-500/10"
                            onClick={() => {
                              for (const id of notice.clash!) setBindings(id, resolveBindings(id).filter((y) => !sameBinding(y, notice.binding!)));
                              setNotice(null);
                            }}>
                            {t('keymap.clearOthers')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('keymap.footer')}</p>
    </div>
  );
}
