import { Fragment, useMemo, useState } from 'react';
import { MarkdownView } from '@/components/notes/MarkdownView';
import { useTranslation } from 'react-i18next';
import { Check, CornerDownRight, MessageSquarePlus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { GitFileDiff, GitMRDiscussion } from '@/types';
import { timeAgo } from './util';

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

export function GitMRDiff({ file, threads, canComment, onComment, onReply, onResolve }: {
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
                      {lineThreads.map((d) => <Thread key={d.id} d={d} canReply={canComment} onReply={onReply} onResolve={onResolve} />)}
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

export function Thread({ d, canReply, onReply, onResolve }: {
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
            <div key={n.id} className={cn('px-3 py-2', i > 0 && 'border-t')}>
              <div className="mb-0.5 flex items-center gap-2">
                {n.avatarUrl ? <img src={n.avatarUrl} alt="" className="h-4 w-4 rounded-full" /> : <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[9px]">{n.author.slice(0, 1)}</span>}
                <span className="font-medium">{n.author}</span>
                <span className="text-[10px] text-muted-foreground">@{n.username} · {timeAgo(n.createdAt)}</span>
              </div>
              {/* GitLab / GitHub comments are markdown (links, headings, code). */}
              <MarkdownView markdown={n.body} className="md-compact break-words" />
            </div>
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

export function Composer({ onSubmit, onCancel, immediate }: { onSubmit: (body: string) => Promise<void>; onCancel?: () => void; immediate?: boolean }) {
  const { t } = useTranslation('git');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try { await onSubmit(body.trim()); setBody(''); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-1.5">
      <Textarea autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('mr.commentPlaceholder')}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }}
        className="min-h-[64px] text-xs" />
      <div className="flex justify-end gap-2">
        {onCancel && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>{t('vcs.cancel')}</Button>}
        <Button size="sm" className="h-7 text-xs" disabled={busy || !body.trim()} onClick={() => void send()}>
          {immediate ? t('mr.reply') : t('mr.comment')}
        </Button>
      </div>
    </div>
  );
}
