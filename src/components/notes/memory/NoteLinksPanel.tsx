import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Boxes, Link2, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { notesAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import type { NoteLinkType, NoteLinkView, NoteSearchHit } from '@/types';
import { LINK_TYPES } from './linkTypes';

interface Links { outgoing: NoteLinkView[]; incoming: NoteLinkView[] }

// NoteLinksPanel shows a note's typed links both ways, grouped by type —
// "Depends on" (outgoing) next to "Needed by" (incoming) — plus the PatchMan
// items it refers to. Body links ([text](note:…)) show as "Related" and are
// removed by editing the text; the others have a remove button.
export function NoteLinksPanel({ noteId, canEdit, onOpen }: { noteId: string; canEdit: boolean; onOpen: (id: string) => void }) {
  const { t } = useTranslation('notes');
  const { toast } = useToast();
  const [links, setLinks] = useState<Links | null>(null);

  const load = useCallback(() => {
    notesAPI.links(noteId).then((r) => setLinks(r.data as Links)).catch(() => setLinks({ outgoing: [], incoming: [] }));
  }, [noteId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onEvent = (e: Event) => {
      if ((e as CustomEvent<{ noteId?: string }>).detail?.noteId === noteId) load();
    };
    window.addEventListener('patchman:note-event', onEvent);
    return () => window.removeEventListener('patchman:note-event', onEvent);
  }, [noteId, load]);

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: (NoteLinkView & { out: boolean })[] }[] = [];
    const add = (key: string, label: string, item: NoteLinkView & { out: boolean }) => {
      let g = out.find((x) => x.key === key);
      if (!g) { g = { key, label, items: [] }; out.push(g); }
      g.items.push(item);
    };
    for (const l of links?.outgoing ?? []) add(`out:${l.type}`, t(`memory.links.types.${l.type}`), { ...l, out: true });
    for (const l of links?.incoming ?? []) add(`in:${l.type}`, t(`memory.links.inverse.${l.type}`), { ...l, out: false });
    return out;
  }, [links, t]);

  const remove = async (l: NoteLinkView) => {
    try {
      await notesAPI.deleteLink(noteId, l.uri ?? l.noteId ?? '', l.type);
      load();
    } catch {
      toast({ title: t('memory.links.removeFailed'), variant: 'destructive' });
    }
  };

  if (!links) return null;
  if (groups.length === 0 && !canEdit) return null;
  return (
    <div className="mt-10 pt-4 border-t">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{t('memory.links.title')}</span>
        {canEdit && <AddLink noteId={noteId} onAdded={load} />}
      </div>
      {groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('memory.links.none')}</p>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.key} className="flex items-start gap-2">
              <span className="w-28 shrink-0 pt-1 text-[11px] text-muted-foreground">{g.label}</span>
              <div className="flex flex-wrap gap-1.5 min-w-0">
                {g.items.map((l) => (
                  <span key={`${l.out}-${l.noteId ?? l.uri}-${l.type}`} className="group inline-flex items-center max-w-full">
                    {l.uri ? (
                      <span className="inline-flex items-center gap-1 text-xs border rounded-full px-2.5 py-1 font-mono truncate max-w-[320px]" title={l.uri}>
                        <Boxes className="h-3 w-3 shrink-0 text-muted-foreground" /> {l.uri.replace('patchman://', '')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => l.noteId && onOpen(l.noteId)}
                        className={cn('text-xs border rounded-full px-2.5 py-1 hover:bg-accent/50 truncate max-w-[280px]', l.stale && 'opacity-60 line-through')}
                        title={l.source === 'agent' ? t('memory.links.byAgent') : undefined}
                      >
                        {l.icon ? `${l.icon} ` : ''}{l.title}
                      </button>
                    )}
                    {canEdit && l.out && l.source !== 'body' && (
                      <button
                        type="button"
                        onClick={() => void remove(l)}
                        className="ml-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive"
                        aria-label={t('memory.links.remove')}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddLink({ noteId, onAdded }: { noteId: string; onAdded: () => void }) {
  const { t } = useTranslation('notes');
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<NoteLinkType>('related');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<NoteSearchHit[] | null>(null);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!open || !q.trim()) { setHits(null); return; }
    const mine = ++seq.current;
    const timer = window.setTimeout(() => {
      notesAPI.search(q.trim(), 12)
        .then((r) => { if (mine === seq.current) setHits(((r.data as NoteSearchHit[]) ?? []).filter((h) => h.id !== noteId && h.type !== 'folder')); })
        .catch(() => { if (mine === seq.current) setHits([]); });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [q, open, noteId]);

  const pick = async (h: NoteSearchHit) => {
    setSaving(true);
    try {
      await notesAPI.addLink(noteId, h.id, type);
      setOpen(false);
      setQ('');
      onAdded();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      toast({ title: t('memory.links.addFailed'), description: msg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px] gap-1 text-muted-foreground">
          <Plus className="h-3 w-3" /> {t('memory.links.add')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2 space-y-2">
        <Select value={type} onValueChange={(v) => setType(v as NoteLinkType)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LINK_TYPES.map((lt) => <SelectItem key={lt} value={lt} className="text-xs">{t(`memory.links.types.${lt}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('memory.links.search')}
          className="w-full h-8 px-2 rounded-md border bg-transparent text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="max-h-56 overflow-y-auto">
          {saving ? (
            <div className="flex justify-center py-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /></div>
          ) : hits?.length === 0 ? (
            <p className="px-1 py-1.5 text-[11px] text-muted-foreground">{t('noResults')}</p>
          ) : (
            hits?.map((h) => (
              <button key={h.id} type="button" onClick={() => void pick(h)} className="w-full text-left px-2 py-1.5 rounded hover:bg-accent/50">
                <div className="flex items-center gap-1.5 text-xs font-medium truncate"><Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />{h.title}</div>
                {(h.breadcrumb?.length ?? 0) > 0 && <div className="pl-4 text-[10px] text-muted-foreground truncate">{h.breadcrumb.join(' / ')}</div>}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
