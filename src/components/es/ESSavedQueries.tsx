import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, Plus, Save, Edit3, Trash2, Bookmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { confirmDialog } from '@/components/ui/confirm';
import { useESConsoleStore, type ESSavedQuery } from '@/stores/esConsoleStore';

interface ESSavedQueriesProps {
  connId: string;
  /** Current editor text (read at action time, so it's never stale). */
  getCurrentText: () => string;
  /** Replace the editor content with a saved query. */
  onOpen: (text: string) => void;
  /** Append a saved query after the editor content. */
  onInsert: (text: string) => void;
  onClose: () => void;
  /** Bumped by ⌘S — focuses the name field to save right away. */
  focusNonce: number;
}

// First request line ("GET my-index/_search") — the default name for a save
// and the preview line in the list.
function firstRequestLine(text: string): string {
  return text.split('\n').map((l) => l.trim()).find((l) => /^(GET|POST|PUT|DELETE|HEAD|PATCH)\s/i.test(l)) ?? '';
}

// ESSavedQueries — the console's "Saved" side panel: name + save the current
// editor, then open / insert / overwrite / rename / delete per connection.
// Stored on this device (esConsoleStore).
export function ESSavedQueries({ connId, getCurrentText, onOpen, onInsert, onClose, focusNonce }: ESSavedQueriesProps) {
  const { t } = useTranslation('es');
  const all = useESConsoleStore((s) => s.saved);
  const addSaved = useESConsoleStore((s) => s.addSaved);
  const updateSaved = useESConsoleStore((s) => s.updateSaved);
  const removeSaved = useESConsoleStore((s) => s.removeSaved);
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusNonce > 0) nameRef.current?.focus();
  }, [focusNonce]);

  const mine = useMemo(
    () => all.filter((q) => q.connectionId === connId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [all, connId],
  );
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? mine.filter((q) => q.name.toLowerCase().includes(f) || q.queryText.toLowerCase().includes(f)) : mine;
  }, [mine, filter]);

  const save = () => {
    const text = getCurrentText();
    if (!text.trim()) return;
    addSaved(connId, name.trim() || firstRequestLine(text) || t('saved.untitled'), text);
    setName('');
  };

  const commitRename = (q: ESSavedQuery) => {
    const n = renameText.trim();
    if (n && n !== q.name) updateSaved(q.id, { name: n });
    setRenamingId(null);
  };

  const remove = async (q: ESSavedQuery) => {
    if (await confirmDialog({ title: t('saved.deleteConfirm', { name: q.name }), destructive: true })) removeSaved(q.id);
  };

  return (
    <div className="w-80 shrink-0 border-r flex flex-col min-h-0 bg-muted/20">
      <div className="shrink-0 px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t('saved.title')}</span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose} title={t('saved.close')}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="shrink-0 px-3 pb-2 flex items-center gap-1.5">
        <Input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
          placeholder={t('saved.namePlaceholder')}
          className="h-8 text-xs"
        />
        <Button size="sm" className="h-8 text-xs gap-1 shrink-0" onClick={save}>
          <Save className="h-3.5 w-3.5" /> {t('saved.save')}
        </Button>
      </div>

      {mine.length > 5 && (
        <div className="shrink-0 px-3 pb-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('saved.filter')} className="h-8 text-xs pl-7" />
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2 space-y-0.5">
        {shown.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            <Bookmark className="h-4 w-4 mx-auto mb-1.5 opacity-60" />
            {t('saved.empty')}
          </div>
        ) : (
          shown.map((q) => (
            <div key={q.id} className="group rounded px-2 py-1.5 hover:bg-accent/50 transition-colors">
              {renamingId === q.id ? (
                <Input
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => commitRename(q)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(q);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  className="h-7 text-xs"
                />
              ) : (
                <div className="flex items-start gap-1">
                  <button type="button" onClick={() => onOpen(q.queryText)} title={t('saved.open')} className="flex-1 min-w-0 text-left">
                    <p className="text-xs font-medium text-foreground truncate">{q.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground truncate">{firstRequestLine(q.queryText) || q.queryText.split('\n')[0]}</p>
                  </button>
                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <RowBtn title={t('saved.insert')} onClick={() => onInsert(q.queryText)}><Plus className="h-3 w-3" /></RowBtn>
                    <RowBtn title={t('saved.overwrite')} onClick={() => updateSaved(q.id, { queryText: getCurrentText() })}><Save className="h-3 w-3" /></RowBtn>
                    <RowBtn title={t('saved.rename')} onClick={() => { setRenamingId(q.id); setRenameText(q.name); }}><Edit3 className="h-3 w-3" /></RowBtn>
                    <RowBtn title={t('saved.delete')} onClick={() => void remove(q)} className="hover:text-destructive"><Trash2 className="h-3 w-3" /></RowBtn>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <p className="shrink-0 px-3 py-2 border-t text-[10px] text-muted-foreground">{t('saved.localHint')}</p>
    </div>
  );
}

function RowBtn({ title, onClick, className, children }: { title: string; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent ${className ?? ''}`}
    >
      {children}
    </button>
  );
}
