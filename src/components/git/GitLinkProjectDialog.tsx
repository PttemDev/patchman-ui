import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { gitAPI } from '@/services/api';
import { useGitConnectionStore } from '@/stores/gitConnectionStore';
import { cn } from '@/lib/utils';
import { extractErr, usableForFolder } from './util';
import type { GitRepoSummary } from '@/types';

export interface LinkedRepo { id: string; connectionId: string; projectRef: string; projectName: string; localPath: string }

// Ties a folder opened from disk (no matching connection) to a git
// connection's project, so the panel shows its MRs / CI on top of the local
// working tree — no second clone. The BE only accepts a connection on the
// folder's origin host.
export function GitLinkProjectDialog({ open, onOpenChange, repoId, origin, currentConnectionId, onLinked }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoId: string;
  /** The folder's origin URL (shown as a hint). */
  origin?: string;
  /** The connection it is tied to now (preselected when still usable). */
  currentConnectionId?: string;
  onLinked: (repo: LinkedRepo) => void;
}) {
  const { t } = useTranslation('git');
  const allConnections = useGitConnectionStore((s) => s.connections);
  const connections = useMemo(() => allConnections.filter(usableForFolder), [allConnections]);
  const [connId, setConnId] = useState('');
  const [query, setQuery] = useState('');
  const [repos, setRepos] = useState<GitRepoSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && !connId && connections.length > 0) {
      setConnId(connections.find((c) => c.id === currentConnectionId)?.id ?? connections[0].id);
    }
  }, [open, connId, connections, currentConnectionId]);

  // Search the connection's projects; seeded with the origin's project name.
  useEffect(() => {
    if (!open || !connId) return;
    let cancelled = false;
    const h = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const res = await gitAPI.repos(connId, { search: query.trim() || undefined });
        if (!cancelled) setRepos(((res.data as GitRepoSummary[] | undefined) ?? []).slice(0, 50));
      } catch (err) {
        if (!cancelled) { setRepos([]); setError(extractErr(err, t('link.loadFailed'))); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(h); };
  }, [open, connId, query, t]);

  useEffect(() => {
    if (!open) return;
    // "…/group/project.git" → "project" as a starting search.
    const m = origin?.replace(/\.git$/, '').match(/[/:]([^/:]+)$/);
    setQuery(m ? m[1] : '');
  }, [open, origin]);

  const link = async (r: GitRepoSummary) => {
    setSaving(true);
    setError('');
    try {
      const res = await gitAPI.linkRepo(repoId, {
        connectionId: connId,
        projectRef: String(r.id),
        projectName: r.fullPath || r.name,
      });
      onLinked((res.data as { repo: LinkedRepo }).repo);
      onOpenChange(false);
    } catch (err) {
      setError(extractErr(err, t('link.failed')));
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('link.title')}</DialogTitle>
          <DialogDescription>{t('link.desc')}</DialogDescription>
        </DialogHeader>
        {origin && <p className="truncate font-mono text-[11px] text-muted-foreground" title={origin}>origin: {origin}</p>}
        {connections.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('link.noConnections')}</p>
        ) : (
          <div className="space-y-2">
            <select
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              value={connId}
              onChange={(e) => setConnId(e.target.value)}
              aria-label={t('link.connection')}
            >
              {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-8 pl-7 text-xs" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('link.search')} />
            </div>
            <div className="max-h-64 overflow-auto rounded-md border">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t('common:loading')}</div>
              ) : repos.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">{t('repoPicker.noResults')}</p>
              ) : repos.map((r) => (
                <button
                  key={String(r.id)}
                  type="button"
                  disabled={saving}
                  onClick={() => void link(r)}
                  className={cn('block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50')}
                  title={r.fullPath}
                >
                  {r.fullPath || r.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {error && <p className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</p>}
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>{t('common:cancel')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
