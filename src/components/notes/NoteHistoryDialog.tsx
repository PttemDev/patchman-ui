import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, GitCommit, History, Loader2, RotateCcw, User } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CodeDiffEditor } from '@/components/ui/CodeEditor';
import { useThemeStore } from '@/stores/themeStore';
import { notesAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import type { Note, NoteRevisionMeta } from '@/types';
import { formatWhen } from './time';

// Page history: revisions on the left, a diff of the picked one against the
// current text on the right, and Restore (which itself becomes a revision).
export function NoteHistoryDialog({
  noteId,
  currentBody,
  canRestore,
  open,
  onOpenChange,
  onRestored,
}: {
  noteId: string;
  currentBody: string;
  canRestore: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: (note: Note) => void;
}) {
  const { t, i18n } = useTranslation('notes');
  const theme = useThemeStore((s) => s.theme);
  const [revs, setRevs] = useState<NoteRevisionMeta[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRevs(null);
    setSelected(null);
    notesAPI.revisions(noteId).then((res) => {
      const list = (res.data as NoteRevisionMeta[]) ?? [];
      setRevs(list);
      if (list[1]) setSelected(list[1].id); // the newest is the current text
      else if (list[0]) setSelected(list[0].id);
    }).catch(() => setRevs([]));
  }, [open, noteId]);

  useEffect(() => {
    if (!selected) { setBody(null); return; }
    let cancelled = false;
    setBody(null);
    notesAPI.revision(noteId, selected).then((res) => {
      if (!cancelled) setBody((res.data as { body?: string }).body ?? '');
    }).catch(() => { if (!cancelled) setBody(''); });
    return () => { cancelled = true; };
  }, [noteId, selected]);

  const restore = async () => {
    if (!selected) return;
    setRestoring(true);
    try {
      const res = await notesAPI.restore(noteId, selected);
      onRestored(res.data as Note);
      onOpenChange(false);
    } finally {
      setRestoring(false);
    }
  };

  const sourceIcon = (s: NoteRevisionMeta['source']) =>
    s === 'mcp' ? <Bot className="h-3 w-3" /> : s.startsWith('git') ? <GitCommit className="h-3 w-3" /> : s === 'restore' ? <RotateCcw className="h-3 w-3" /> : <User className="h-3 w-3" />;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1000px] w-[min(1000px,calc(100vw-2rem))] h-[min(680px,calc(100vh-4rem))] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" /> {t('history.title')}</DialogTitle>
          <DialogDescription>{t('history.description')}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex gap-3">
          <div className="w-60 shrink-0 overflow-y-auto border rounded-md p-1">
            {!revs ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : revs.length === 0 ? (
              <p className="p-2 text-xs text-muted-foreground">{t('history.empty')}</p>
            ) : revs.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r.id)}
                className={cn('w-full text-left rounded px-2 py-1.5 text-xs hover:bg-accent/50', selected === r.id && 'bg-accent')}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  {sourceIcon(r.source)}
                  <span className="truncate">{r.authorName || t('history.unknownAuthor')}</span>
                  {i === 0 && <span className="ml-auto text-[10px] text-primary">{t('history.current')}</span>}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {formatWhen(r.updatedAt, i18n.language)} · v{r.version} · {t(`history.source.${r.source}`)}
                </div>
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{t('history.diffLegend')}</span>
              {canRestore && selected && revs && revs[0]?.id !== selected && (
                <Button size="sm" className="h-7 gap-1" onClick={restore} disabled={restoring || body === null}>
                  {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  {t('history.restore')}
                </Button>
              )}
            </div>
            <div className="flex-1 min-h-0 border rounded-md overflow-hidden">
              {body === null ? (
                <div className="h-full flex items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : (
                <CodeDiffEditor
                  height="100%"
                  language="markdown"
                  theme={theme === 'dark' ? 'vs-dark' : 'light'}
                  original={body}
                  modified={currentBody}
                  options={{ readOnly: true, originalEditable: false, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12, wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true }}
                />
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
