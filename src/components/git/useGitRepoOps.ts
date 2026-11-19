import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { gitOpsToken } from '@/stores/gitConnectionStore';
import { useToast } from '@/components/ui/use-toast';
import type { GitHistoryOpResult } from '@/types';
import { extractErr } from './util';

export interface GitLocalRepoRef {
  id: string;
  connectionId: string;
}

export type OpOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; body: Record<string, unknown> };

/**
 * Wraps the local branch / update ops: mints the push token when the op may
 * touch the network (blobless clones fetch lazily), tracks which op is busy,
 * and turns "stopped on conflicts" into a toast + onConflicts.
 */
export function useGitRepoOps(
  repo: GitLocalRepoRef | null,
  { onDone, onConflicts }: { onDone: () => void; onConflicts: () => void },
) {
  const { t } = useTranslation('git');
  const { toast } = useToast();
  const [busy, setBusy] = useState('');

  const run = useCallback(
    async <T = GitHistoryOpResult>(
      key: string,
      fn: (accessToken: string) => Promise<{ data: unknown }>,
      opts: { needsToken?: boolean; success?: string; quietError?: boolean } = {},
    ): Promise<OpOutcome<T>> => {
      if (!repo) return { ok: false, error: 'no local clone', body: {} };
      setBusy(key);
      try {
        let token = '';
        if (opts.needsToken !== false) {
          try {
            token = await gitOpsToken(repo.connectionId);
          } catch {
            token = ''; // offline: work with what is on disk
          }
        }
        const res = await fn(token);
        const data = res.data as T;
        const r = data as GitHistoryOpResult;
        if (r && (r.conflicts || r.stashConflict)) {
          toast({
            title: r.stashConflict ? t('vcs.stashConflictTitle') : t('vcs.conflictsTitle'),
            description: t('vcs.conflictsDesc', { count: r.state?.conflicted.length ?? 0 }),
            variant: 'destructive',
          });
          onConflicts();
        } else if (opts.success) {
          toast({ title: opts.success });
        }
        onDone();
        return { ok: true, data };
      } catch (err) {
        const body = ((err as { response?: { data?: Record<string, unknown> } })?.response?.data ?? {}) as Record<string, unknown>;
        const error = extractErr(err, t('vcs.failed'));
        if (!opts.quietError) toast({ title: t('vcs.failed'), description: error, variant: 'destructive' });
        onDone();
        return { ok: false, error, body };
      } finally {
        setBusy('');
      }
    },
    [repo, toast, t, onDone, onConflicts],
  );

  return { run, busy };
}
