import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, ExternalLink, FileDiff, Folder, GitCommit, Loader2, MessageSquare, Search } from 'lucide-react';
import { gitAPI } from '@/services/api';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import type { GitFileDiff, GitMRPipeline, GitCommit as GitCommitDTO } from '@/types';
import { extractErr, timeAgo } from './util';

// The Commits and Pipelines tabs of an MR, and the Changes tab's file tree
// (filter + per-file "Viewed", like GitLab).

export function MRCommitsTab({ connId, project, iid }: { connId: string; project: string; iid: number }) {
  const { t } = useTranslation('git');
  const { toast } = useToast();
  const [list, setList] = useState<GitCommitDTO[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    gitAPI.mrCommits(connId, { project, iid })
      .then((r) => setList((r.data as GitCommitDTO[]) ?? []))
      .catch((e) => { setErr(extractErr(e, t('mr.loadFailed'))); setList([]); });
  }, [connId, project, iid, t]);
  if (!list) return <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  return (
    <div className="mx-auto max-w-4xl space-y-2">
      {err && <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">{err}</p>}
      {list.length === 0 && !err && <p className="py-6 text-center text-xs text-muted-foreground">{t('mr.commits.none')}</p>}
      <div className="divide-y rounded-md border bg-card">
        {list.map((c) => (
          <div key={c.sha} className="flex items-start gap-2 px-3 py-2 text-xs">
            <GitCommit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium" title={c.message}>{c.title || c.message}</div>
              <div className="text-[10px] text-muted-foreground">{c.authorName} · {timeAgo(c.authoredAt)}</div>
            </div>
            <button type="button" className="flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] hover:bg-accent/50"
              title={t('mr.commits.copySha')} aria-label={t('mr.commits.copySha')}
              onClick={() => void navigator.clipboard.writeText(c.sha).then(() => toast({ title: t('mr.copy.done', { what: c.shortSha || c.sha.slice(0, 8) }) }))}>
              {c.shortSha || c.sha.slice(0, 8)}<Copy className="h-2.5 w-2.5" />
            </button>
            {c.webUrl && (
              <a href={c.webUrl} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" title={t('mr.commits.open')} aria-label={t('mr.commits.open')}>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const statusTone = (s: string) =>
  s === 'success' ? 'border-emerald-500/40 text-emerald-600' : s === 'failed' ? 'border-red-500/40 text-red-500'
    : s === 'canceled' || s === 'skipped' ? 'text-muted-foreground' : 'border-amber-500/40 text-amber-600';

export function MRPipelinesTab({ connId, project, iid, pr }: { connId: string; project: string; iid: number; pr?: string }) {
  const { t } = useTranslation('git');
  const [list, setList] = useState<GitMRPipeline[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    gitAPI.mrPipelines(connId, { project, iid, limit: 30 })
      .then((r) => setList((r.data as GitMRPipeline[]) ?? []))
      .catch((e) => { setErr(extractErr(e, t('mr.loadFailed'))); setList([]); });
  }, [connId, project, iid, t]);
  if (!list) return <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  return (
    <div className="mx-auto max-w-4xl space-y-2">
      {err && <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">{err}</p>}
      {list.length === 0 && !err && <p className="py-6 text-center text-xs text-muted-foreground">{t('mr.pipelines.none', { context: pr })}</p>}
      {list.length > 0 && (
        <table className="w-full rounded-md border bg-card text-xs">
          <thead className="text-left text-[10px] uppercase text-muted-foreground">
            <tr><th className="px-3 py-1.5">{t('mr.pipelines.status')}</th><th className="px-3 py-1.5">{t('mr.pipelines.pipeline', { context: pr })}</th><th className="px-3 py-1.5">{t('mr.pipelines.commit')}</th><th className="px-3 py-1.5">{t('mr.pipelines.created')}</th></tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={`${p.id}-${p.sha}`} className="border-t">
                <td className="px-3 py-1.5"><span className={cn('rounded-full border px-1.5 py-px text-[10px]', statusTone(p.status))}>{p.status}</span></td>
                <td className="px-3 py-1.5">
                  <a href={p.webUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    {p.id ? `#${p.id}` : t('mr.pipelines.checks')}<ExternalLink className="h-3 w-3" />
                  </a>
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">{p.ref}</span>
                </td>
                <td className="px-3 py-1.5 font-mono text-[10px]">{p.sha.slice(0, 8)}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{timeAgo(p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Changes: file tree with filter + Viewed ─────────────────────────────

export function MRFileTree({ diffs, file, onPick, commentCount, isViewed, onToggleViewed, viewedCount }: {
  diffs: GitFileDiff[] | null;
  file: string;
  onPick: (path: string) => void;
  commentCount: (path: string) => number;
  isViewed: (d: GitFileDiff) => boolean;
  onToggleViewed: (d: GitFileDiff) => void;
  viewedCount: number;
}) {
  const { t } = useTranslation('git');
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const m = new Map<string, GitFileDiff[]>();
    for (const d of diffs ?? []) {
      if (q && !d.newPath.toLowerCase().includes(q) && !d.oldPath.toLowerCase().includes(q)) continue;
      const i = d.newPath.lastIndexOf('/');
      const dir = i >= 0 ? d.newPath.slice(0, i) : '';
      m.set(dir, [...(m.get(dir) ?? []), d]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [diffs, filter]);
  const total = diffs?.length ?? 0;
  const adds = (diffs ?? []).reduce((n, d) => n + (d.additions ?? 0), 0);
  const dels = (diffs ?? []).reduce((n, d) => n + (d.deletions ?? 0), 0);
  return (
    <div className="flex w-64 shrink-0 flex-col border-r">
      <div className="space-y-1.5 border-b p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('mr.files.filter')} className="h-7 pl-7 text-xs" />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{t('mr.files.count', { count: total })}</span>
          <span className="font-mono text-emerald-600">+{adds}</span><span className="font-mono text-red-500">−{dels}</span>
          <span className="ml-auto">{t('mr.files.viewed', { done: viewedCount, total })}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1 text-xs">
        {!diffs ? <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div> : groups.length === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-muted-foreground">{t('mr.files.noMatch')}</p>
        ) : groups.map(([dir, files]) => (
          <div key={dir || '.'}>
            {dir && <div className="flex items-center gap-1 truncate px-2 pt-1.5 text-[10px] text-muted-foreground" title={dir}><Folder className="h-3 w-3 shrink-0" />{dir}</div>}
            {files.map((d) => {
              const name = d.newPath.slice(d.newPath.lastIndexOf('/') + 1);
              const n = commentCount(d.newPath);
              const viewed = isViewed(d);
              return (
                <div key={d.newPath} className={cn('group flex items-center gap-1.5 py-0.5 pr-2', dir ? 'pl-4' : 'pl-2', file === d.newPath ? 'bg-accent' : 'hover:bg-accent/40')}>
                  <input type="checkbox" checked={viewed} onChange={() => onToggleViewed(d)} title={t('mr.files.markViewed')} aria-label={t('mr.files.markViewed')} className="h-3 w-3 shrink-0" />
                  <button type="button" onClick={() => onPick(d.newPath)} title={d.newPath} className={cn('flex min-w-0 flex-1 items-center gap-1 text-left', viewed && 'text-muted-foreground')}>
                    <FileDiff className={cn('h-3.5 w-3.5 shrink-0', d.status === 'added' ? 'text-emerald-500' : d.status === 'deleted' ? 'text-red-500' : d.status === 'renamed' ? 'text-violet-500' : 'text-sky-500')} />
                    <span className="truncate">{name}</span>
                  </button>
                  {!!n && <span className="flex items-center gap-0.5 text-[10px] text-amber-600"><MessageSquare className="h-2.5 w-2.5" />{n}</span>}
                  {d.additions != null && <span className="font-mono text-[10px] text-emerald-600">+{d.additions}</span>}
                  {d.deletions != null && <span className="font-mono text-[10px] text-red-500">−{d.deletions}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
