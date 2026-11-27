import { Fragment, useMemo, useState } from 'react';
import { MarkdownView } from '@/components/notes/MarkdownView';
import { useTranslation } from 'react-i18next';
import { Check, CornerDownRight, MessageSquarePlus, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import type { GitFileDiff, GitMRDiscussion, GitMRNote } from '@/types';
import { MarkdownEditor } from './GitMRMarkdown';
import { timeAgo } from './util';

/** Edit / delete one of your own comments (GitLab-style). */
export interface NoteActions {
  onEditNote?: (discussionId: string, noteId: number, body: string) => Promise<void>;
  onDeleteNote?: (discussionId: string, noteId: number) => Promise<void>;
}

// One file of an MR as a unified diff with old / new line numbers, inline
// threads under their lines, and a "+" on every line to start a comment
// (added + context lines anchor on the new side, removed on the old side).

export interface LineRef { newLine?: number; oldLine?: number }
type Row =
  | { kind: 'hunk'; text: string }
  | { kind: 'ctx' | 'add' | 'del'; text: string; oldNo?: number; newNo?: number };

function parseUnified(patch: string): Row[] {
  const rows: Row[] = [];
  let o = 0;
  let n = 0;
  for (const line of patch.split('\n')) {
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (h) { o = Number(h[1]); n = Number(h[2]); rows.push({ kind: 'hunk', text: line }); continue; }
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    if (line.startsWith('+')) rows.push({ kind: 'add', text: line.slice(1), newNo: n++ });
    else if (line.startsWith('-')) rows.push({ kind: 'del', text: line.slice(1), oldNo: o++ });
    else if (rows.length) rows.push({ kind: 'ctx', text: line.slice(1), oldNo: o++, newNo: n++ });
  }
  return rows;
}

const keyFor = (r: LineRef) => (r.newLine != null ? `n${r.newLine}` : `o${r.oldLine}`);

export function GitMRDiff({ file, threads, canComment, onComment, onReply, onResolve, onEditNote, onDeleteNote }: NoteActions & {
  file: GitFileDiff;
  threads: GitMRDiscussion[];
  canComment: boolean;
  /** Starts a thread (or queues it into the pending review). */
  onComment: (line: LineRef, body: string) => Promise<void>;
  onReply: (discussionId: string, body: string) => Promise<void>;
  onResolve: (discussionId: string, resolved: boolean) => Promise<void>;
}) {
  const { t } = useTranslation('git');
  const rows = useMemo(() => parseUnified(file.patch), [file.patch]);
  const [composer, setComposer] = useState<string | null>(null); // row key
  const byLine = useMemo(() => {
    const m = new Map<string, GitMRDiscussion[]>();
    for (const d of threads) {
      const p = d.position;
      if (!p || (p.newPath !== file.newPath && p.oldPath !== file.oldPath)) continue;
      const k = keyFor({ newLine: p.newLine ?? undefined, oldLine: p.newLine == null ? p.oldLine ?? undefined : undefined });
      m.set(k, [...(m.get(k) ?? []), d]);
    }
    return m;
  }, [threads, file.newPath, file.oldPath]);

  if (file.binary) return <p className="p-4 text-xs text-muted-foreground">{t('mr.binary')}</p>;

  return (
    <table className="w-full border-collapse font-mono text-[12px] leading-5">
      <tbody>
        {rows.map((r, i) => {
          if (r.kind === 'hunk') {
            return <tr key={i}><td colSpan={4} className="bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-700 dark:text-sky-300">{r.text}</td></tr>;
          }
          const ref: LineRef = r.kind === 'del' ? { oldLine: r.oldNo } : { newLine: r.newNo };
          const k = keyFor(ref);
          const lineThreads = byLine.get(k) ?? [];
          return (
            <Fragment key={i}>
              <tr className={cn('group', r.kind === 'add' && 'bg-emerald-500/10', r.kind === 'del' && 'bg-red-500/10')}>
                <td className="w-10 select-none px-1 text-right text-[10px] text-muted-foreground">{r.oldNo ?? ''}</td>
                <td className="w-10 select-none px-1 text-right text-[10px] text-muted-foreground">{r.newNo ?? ''}</td>
                <td className="w-5 p-0 text-center">
                  {canComment && (
                    <button type="button" onClick={() => setComposer(k)} aria-label={t('mr.addComment')}
                      className="invisible rounded bg-primary p-0.5 text-primary-foreground group-hover:visible">
                      <MessageSquarePlus className="h-3 w-3" />
                    </button>
                  )}
                </td>
                <td className="whitespace-pre-wrap break-all pr-2">
                  <span className="select-none text-muted-foreground">{r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}</span>{r.text}
                </td>
              </tr>
              {(lineThreads.length > 0 || composer === k) && (
                <tr>
                  <td colSpan={4} className="border-y bg-muted/30 px-3 py-2 font-sans">
                    <div className="space-y-2">
                      {lineThreads.map((d) => <Thread key={d.id} d={d} canReply={canComment} onReply={onReply} onResolve={onResolve} onEditNote={onEditNote} onDeleteNote={onDeleteNote} />)}
                      {composer === k && (
                        <Composer
                          onCancel={() => setComposer(null)}
                          onSubmit={async (body) => { await onComment(ref, body); setComposer(null); }}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export function Thread({ d, canReply, onReply, onResolve, onEditNote, onDeleteNote }: NoteActions & {
  d: GitMRDiscussion;
  canReply: boolean;
  onReply: (discussionId: string, body: string) => Promise<void>;
  onResolve: (discussionId: string, resolved: boolean) => Promise<void>;
}) {
  const { t } = useTranslation('git');
  const [replying, setReplying] = useState(false);
  const [open, setOpen] = useState(!d.resolved);
  return (
    <div className={cn('rounded-md border bg-card text-xs', d.resolved && 'opacity-70')}>
      {d.resolved && !open ? (
        <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted-foreground" onClick={() => setOpen(true)}>
          <Check className="h-3.5 w-3.5 text-emerald-600" /> {t('mr.resolvedThread', { author: d.notes[0]?.author, count: d.notes.length })}
        </button>
      ) : (
        <>
          {d.notes.map((n, i) => (
            <NoteRow key={n.id} n={n} first={i === 0} discussionId={d.id}
              onEditNote={canReply ? onEditNote : undefined} onDeleteNote={canReply ? onDeleteNote : undefined} />
          ))}
          <div className="flex items-center gap-2 border-t px-3 py-1.5">
            {canReply && !replying && (
              <Button size="sm" variant="ghost" className="h-6 gap-1 text-[11px]" onClick={() => setReplying(true)}>
                <CornerDownRight className="h-3 w-3" /> {t('mr.reply')}
              </Button>
            )}
            {canReply && d.resolvable && (
              <Button size="sm" variant="ghost" className="h-6 gap-1 text-[11px]" onClick={() => void onResolve(d.id, !d.resolved)}>
                {d.resolved ? <RotateCcw className="h-3 w-3" /> : <Check className="h-3 w-3" />} {d.resolved ? t('mr.unresolve') : t('mr.resolve')}
              </Button>
            )}
          </div>
          {replying && (
            <div className="border-t p-2">
              <Composer onCancel={() => setReplying(false)} onSubmit={async (b) => { await onReply(d.id, b); setReplying(false); }} immediate />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One comment: author line, markdown body, and edit / delete on your own. */
function NoteRow({ n, first, discussionId, onEditNote, onDeleteNote }: NoteActions & { n: GitMRNote; first: boolean; discussionId: string }) {
  const { t } = useTranslation('git');
  const [editing, setEditing] = useState(false);
  // Pending review comments have negative ids: local only, never sent.
  const mine = !!n.canEdit && n.id > 0;
  return (
    <div className={cn('group/note px-3 py-2', !first && 'border-t')}>
      <div className="mb-0.5 flex items-center gap-2">
        {n.avatarUrl ? <img src={n.avatarUrl} alt="" className="h-4 w-4 rounded-full" /> : <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[9px]">{n.author.slice(0, 1)}</span>}
        <span className="font-medium">{n.author}</span>
        <span className="text-[10px] text-muted-foreground">@{n.username} · {timeAgo(n.createdAt)}{n.edited && ` · ${t('mr.note.edited')}`}</span>
        {mine && !editing && (
          <span className="ml-auto flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/note:opacity-100">
            {onEditNote && (
              <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" title={t('mr.note.edit')} aria-label={t('mr.note.edit')} onClick={() => setEditing(true)}>
                <Pencil className="h-3 w-3" />
              </button>
            )}
            {onDeleteNote && (
              <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive" title={t('mr.note.delete')} aria-label={t('mr.note.delete')}
                onClick={async () => { if (await confirmDialog({ title: t('mr.note.deleteTitle'), description: t('mr.note.deleteDesc'), destructive: true })) await onDeleteNote(discussionId, n.id); }}>
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </span>
        )}
      </div>
      {editing && onEditNote ? (
        <Composer initial={n.body} submitLabel={t('mr.note.save')} onCancel={() => setEditing(false)}
          onSubmit={async (b) => { await onEditNote(discussionId, n.id, b); setEditing(false); }} />
      ) : (
        /* GitLab / GitHub comments are markdown (links, headings, code). */
        <MarkdownView markdown={n.body} className="md-compact break-words" />
      )}
    </div>
  );
}

export function Composer({ onSubmit, onCancel, immediate, initial = '', submitLabel }: {
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  immediate?: boolean;
  initial?: string;
  submitLabel?: string;
}) {
  const { t } = useTranslation('git');
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    // A failed submit keeps the text; the caller already reported the error.
    try { await onSubmit(body.trim()); setBody(''); } catch { /* reported by the caller */ } finally { setBusy(false); }
  };
  return (
    <div className="space-y-1.5">
      <MarkdownEditor autoFocus value={body} onChange={setBody} onSubmit={() => void send()} placeholder={t('mr.commentPlaceholder')} />
      <div className="flex justify-end gap-2">
        {onCancel && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>{t('vcs.cancel')}</Button>}
        <Button size="sm" className="h-7 text-xs" disabled={busy || !body.trim() || body.trim() === initial.trim()} onClick={() => void send()}>
          {submitLabel ?? (immediate ? t('mr.reply') : t('mr.comment'))}
        </Button>
      </div>
    </div>
  );
}

/** GitLab system notes mix markdown, raw HTML lists ("added 2 commits <ul><li>…")
 *  and root-relative links. Shown as plain text: no link can navigate the app away. */
function systemNoteLines(body: string): string[] {
  return body
    .replace(/<\/li>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|`/g, '')
    .split('\n').map((l) => l.trim()).filter(Boolean);
}

/** A system note ("added 1 commit", "approved this merge request") on the timeline. */
export function SystemNote({ n }: { n: GitMRNote }) {
  const [head, ...rest] = systemNoteLines(n.body);
  return (
    <div className="flex items-start gap-2 px-1 text-[11px] text-muted-foreground">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
      <span className="min-w-0 flex-1 break-words">
        <span className="font-medium text-foreground">{n.author}</span> {head}
        <span className="ml-1 text-[10px]">· {timeAgo(n.createdAt)}</span>
        {rest.map((l, i) => <span key={i} className="block truncate pl-2 font-mono text-[10px]" title={l}>{l}</span>)}
      </span>
    </div>
  );
}
