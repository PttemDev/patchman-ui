import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Search, Trash2, ClipboardList } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { usePasteHistoryStore, type PasteEntry } from '@/stores/pasteHistoryStore';
import { usePasteHistoryUiStore } from '@/stores/pasteHistoryUiStore';
import { insertIntoTarget } from '@/lib/paste/insertIntoTarget';
import { cn } from '@/lib/utils';

function relativeTime(ts: number, t: TFunction): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return t('relativeTime.justNow');
  if (s < 60) return t('relativeTime.secondsAgo', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('relativeTime.minutesAgo', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('relativeTime.hoursAgo', { n: h });
  const d = Math.floor(h / 24);
  if (d < 7) return t('relativeTime.daysAgo', { n: d });
  return new Date(ts).toLocaleDateString();
}

function previewOf(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let preview = lines.slice(0, 2).join('\n');
  if (preview.length > 200) preview = preview.slice(0, 200) + '…';
  else if (lines.length > 2) preview += ' …';
  return preview;
}

interface PendingInsert {
  target: HTMLElement;
  selStart: number | null;
  selEnd: number | null;
  text: string;
}

/**
 * Spotlight-style overlay listing the last 100 pastes. Opened by the
 * Cmd+Option+V / Ctrl+Alt+V chord (see useKeyboardShortcuts). Picking an
 * entry inserts it into the field the chord was fired from.
 */
export function PasteHistoryOverlay() {
  const { t } = useTranslation('paste');
  const open = usePasteHistoryUiStore((s) => s.open);
  const closeUi = usePasteHistoryUiStore((s) => s.close);
  const entries = usePasteHistoryStore((s) => s.entries);
  const remove = usePasteHistoryStore((s) => s.remove);
  const clearAll = usePasteHistoryStore((s) => s.clear);

  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // The insert is deferred until Radix's close-focus phase (see
  // onCloseAutoFocus) so the FocusScope trap is gone before we refocus.
  const pending = useRef<PendingInsert | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.text.toLowerCase().includes(q));
  }, [entries, search]);

  // Reset transient state each time the overlay opens.
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Keep the selection in range as the list shrinks (search/delete).
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  // Scroll the selected row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const commit = useCallback(
    (entry: PasteEntry) => {
      const ui = usePasteHistoryUiStore.getState();
      if (ui.target) {
        // Stash into a ref: closeUi() clears the store, and the actual insert
        // runs later in onCloseAutoFocus.
        pending.current = {
          target: ui.target,
          selStart: ui.selStart,
          selEnd: ui.selEnd,
          text: entry.text,
        };
      }
      closeUi();
    },
    [closeUi],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % Math.max(1, filtered.length));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length));
          break;
        case 'Enter': {
          e.preventDefault();
          const entry = filtered[selectedIndex];
          if (entry) commit(entry);
          break;
        }
        case 'Escape':
          e.preventDefault();
          closeUi();
          break;
      }
    },
    [filtered, selectedIndex, commit, closeUi],
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) closeUi(); }}>
      {/* Spotlight-style overlay: hide DialogContent's built-in close X — it
          overlaps the ESC badge in the search row; Esc / click-outside + the
          ESC hint already convey how to close. */}
      <DialogContent
        data-paste-history
        className="p-0 gap-0 max-w-[560px] overflow-hidden border-border/50 shadow-2xl [&>button.absolute]:hidden"
        onKeyDown={handleKeyDown}
        onCloseAutoFocus={(e) => {
          // If the user picked an entry, refocus the original field and insert
          // here — Radix's focus trap has torn down by this point. Preventing
          // default stops Radix from restoring focus to the origin itself
          // (insertIntoTarget refocuses it). On a plain close (Esc / click
          // away) pending is null, so we let Radix restore focus normally.
          const p = pending.current;
          if (p) {
            e.preventDefault();
            insertIntoTarget(p.target, p.selStart, p.selEnd, p.text);
            pending.current = null;
          }
        }}
      >
        <DialogTitle className="sr-only">{t('title')}</DialogTitle>

        {/* Search */}
        <div className="flex items-center gap-3 px-4 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelectedIndex(0); }}
            placeholder={t('searchPlaceholder')}
            className="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            spellCheck={false}
          />
          {entries.length > 0 && (
            <button
              onClick={() => { clearAll(); setSelectedIndex(0); }}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0 cursor-pointer"
            >
              {t('clearAll')}
            </button>
          )}
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* List */}
        <div
          ref={listRef}
          className="max-h-[min(400px,60vh)] overflow-y-auto overflow-x-hidden py-2 overscroll-contain"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <ClipboardList className="h-6 w-6 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground mt-2">
                {entries.length === 0 ? t('empty.titleEmpty') : t('empty.titleNoMatch')}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {entries.length === 0
                  ? t('empty.hintEmpty')
                  : t('empty.hintNoMatch')}
              </p>
            </div>
          ) : (
            filtered.map((entry, index) => (
              <div
                key={entry.id}
                data-index={index}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => commit(entry)}
                className={cn(
                  'group w-full flex items-start gap-3 px-4 py-2 text-sm cursor-pointer transition-colors duration-75',
                  selectedIndex === index
                    ? 'bg-accent text-accent-foreground'
                    : 'text-foreground/80 hover:bg-accent/50',
                )}
              >
                <pre className="flex-1 min-w-0 m-0 text-left font-mono text-xs whitespace-pre-wrap break-all line-clamp-2 leading-snug">
                  {previewOf(entry.text)}
                </pre>
                <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5 tabular-nums whitespace-nowrap">
                  {relativeTime(entry.ts, t)}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); remove(entry.id); }}
                  className="shrink-0 rounded p-1 text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-opacity cursor-pointer"
                  aria-label={t('deleteEntry')}
                  title={t('common:delete')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between gap-4 px-4 py-2 border-t bg-muted/30 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center h-4 min-w-[16px] rounded border bg-muted px-1 font-mono text-[10px]">&uarr;</kbd>
              <kbd className="inline-flex items-center justify-center h-4 min-w-[16px] rounded border bg-muted px-1 font-mono text-[10px]">&darr;</kbd>
              <span className="ml-0.5">{t('hints.navigate')}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center h-4 min-w-[16px] rounded border bg-muted px-1 font-mono text-[10px]">&crarr;</kbd>
              <span className="ml-0.5">{t('hints.insert')}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center h-4 rounded border bg-muted px-1 font-mono text-[10px]">esc</kbd>
              <span className="ml-0.5">{t('common:close')}</span>
            </span>
          </div>
          <span className="text-muted-foreground/60">{t('title')}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
