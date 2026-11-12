import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, GitMerge, History, Link2, Loader2, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useMemoryStore } from '@/stores/memoryStore';
import { cn } from '@/lib/utils';
import type { NoteSuggestion } from '@/types';
import { openNoteTab } from '../useOpenNote';
import { formatWhen } from '../time';

// SuggestionsDialog is the review inbox: changes an agent proposed instead of
// making them (it never rewrites what a person wrote). Edits and merges show
// the note as it is NOW next to the suggestion — accepting saves on top of
// the current text, so a merge result can be adjusted first.
export function SuggestionsDialog({ open, onOpenChange, folderId }: { open: boolean; onOpenChange: (o: boolean) => void; folderId?: string }) {
  const { t } = useTranslation('notes');
  const { toast } = useToast();
  const all = useMemoryStore((s) => s.suggestions);
  const fetchSuggestions = useMemoryStore((s) => s.fetchSuggestions);
  const accept = useMemoryStore((s) => s.accept);
  const reject = useMemoryStore((s) => s.reject);
  const items = useMemo(() => all.filter((s) => !folderId || s.folderId === folderId), [all, folderId]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => { if (open) void fetchSuggestions(); }, [open, fetchSuggestions]);
  useEffect(() => {
    setSelected((cur) => new Set([...cur].filter((id) => items.some((s) => s.id === id))));
  }, [items]);

  const run = async (ids: string[], fn: (id: string) => Promise<void>) => {
    setBusy((b) => new Set([...b, ...ids]));
    let failed = 0;
    for (const id of ids) {
      try { await fn(id); } catch { failed++; }
    }
    setBusy((b) => new Set([...b].filter((x) => !ids.includes(x))));
    if (failed) toast({ title: t('memory.decideFailed'), variant: 'destructive' });
  };
  const acceptOne = (s: NoteSuggestion) => (id: string) => accept(id, s.kind === 'merge' && drafts[id] !== undefined ? { body: drafts[id] } : undefined);
  const toggle = (id: string) => setSelected((cur) => {
    const n = new Set(cur);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] w-[min(760px,calc(100vw-2rem))] max-h-[min(720px,calc(100vh-4rem))] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('memory.inboxTitle')}</DialogTitle>
          <DialogDescription>{t('memory.inboxHint')}</DialogDescription>
        </DialogHeader>
        {items.length > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.size === items.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(items.map((s) => s.id)) : new Set())}
              />
              {t('memory.selectAll')}
            </label>
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!selected.size} onClick={() => void run([...selected], reject)}>
                {t('memory.rejectSelected', { count: selected.size })}
              </Button>
              <Button size="sm" className="h-7 text-xs" disabled={!selected.size}
                onClick={() => void run([...selected], (id) => acceptOne(items.find((s) => s.id === id)!)(id))}
              >
                {t('memory.acceptSelected', { count: selected.size })}
              </Button>
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 space-y-2">
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t('memory.inboxEmpty')}</p>
          ) : items.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              selected={selected.has(s.id)}
              onSelect={() => toggle(s.id)}
              busy={busy.has(s.id)}
              draft={drafts[s.id]}
              setDraft={(v) => setDrafts((d) => ({ ...d, [s.id]: v }))}
              onAccept={() => void run([s.id], acceptOne(s))}
              onReject={() => void run([s.id], reject)}
              onOpen={(id, title) => { openNoteTab(id, title); onOpenChange(false); }}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SuggestionCard({ s, selected, onSelect, busy, draft, setDraft, onAccept, onReject, onOpen }: {
  s: NoteSuggestion;
  selected: boolean;
  onSelect: () => void;
  busy: boolean;
  draft?: string;
  setDraft: (v: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onOpen: (id: string, title: string) => void;
}) {
  const { t, i18n } = useTranslation('notes');
  const Icon = s.kind === 'edit' ? Pencil : s.kind === 'merge' ? GitMerge : s.kind === 'link' ? Link2 : History;
  const p = s.payload as Record<string, string | number | null | undefined>;
  const noteBtn = <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => onOpen(s.noteId, s.noteTitle)}>{s.noteTitle}</button>;
  const targetLabel = s.target?.title ?? s.target?.uri?.replace('patchman://', '') ?? '—';
  const targetBtn = s.target?.id
    ? <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => onOpen(s.target!.id!, s.target!.title ?? '')}>{targetLabel}</button>
    : <span className="font-mono">{targetLabel}</span>;
  const merged = draft ?? [s.current?.body?.trimEnd(), String(p.text ?? '')].filter(Boolean).join('\n\n');

  return (
    <div className={cn('rounded-md border p-3 text-xs space-y-2', selected && 'ring-1 ring-primary/50')}>
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={selected} onChange={onSelect} aria-label={t('memory.select')} />
        <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="rounded bg-muted px-1.5 py-px text-[10px] uppercase tracking-wide">{t(`memory.kind.${s.kind}`)}</span>
            {s.kind === 'link' ? (
              <span className="flex items-center gap-1 flex-wrap">{noteBtn}<ArrowRight className="h-3 w-3" /><span className="text-muted-foreground">{t(`memory.links.types.${String(p.type ?? 'related')}`)}</span><ArrowRight className="h-3 w-3" />{targetBtn}</span>
            ) : s.kind === 'supersede' ? (
              <span>{t('memory.supersedeDesc')} {noteBtn} · {t('memory.replacedBy')} {targetBtn}</span>
            ) : (
              <span>{t(s.kind === 'edit' ? 'memory.editDesc' : 'memory.mergeDesc')} {noteBtn}</span>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {s.agent ? `${s.agent} · ` : ''}{t('memory.by', { name: s.createdByName || t('someone'), when: formatWhen(s.createdAt, i18n.language) })}
            {s.folderTitle ? ` · ${s.folderTitle}` : ''}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={busy} onClick={onReject}><X className="h-3.5 w-3.5" />{t('memory.reject')}</Button>
          <Button size="sm" className="h-7 text-xs gap-1" disabled={busy} onClick={onAccept}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{t('memory.accept')}
          </Button>
        </div>
      </div>

      {s.kind === 'edit' && s.current && (
        <div className="space-y-1.5 pl-6">
          {(['title', 'summary', 'body'] as const).filter((k) => typeof p[k] === 'string').map((k) => (
            <div key={k} className="grid grid-cols-2 gap-2">
              <Block label={`${t(`memory.field.${k}`)} · ${t('memory.current')}`} text={s.current![k]} />
              <Block label={`${t(`memory.field.${k}`)} · ${t('memory.suggested')}`} text={String(p[k])} accent />
            </div>
          ))}
        </div>
      )}
      {s.kind === 'merge' && (
        <div className="space-y-1.5 pl-6">
          <Block label={t('memory.newText')} text={String(p.text ?? '')} accent />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{t('memory.result')}</div>
            <Textarea value={merged} onChange={(e) => setDraft(e.target.value)} className="min-h-[96px] text-xs font-mono" />
          </div>
        </div>
      )}
    </div>
  );
}

function Block({ label, text, accent }: { label: string; text: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <pre className={cn('whitespace-pre-wrap break-words rounded border px-2 py-1.5 max-h-40 overflow-y-auto font-mono text-[11px]', accent ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-muted/30')}>
        {text || '—'}
      </pre>
    </div>
  );
}
