// Push collection edits back to its bound GitLab file as an MR (or, with
// the Advanced toggle, a direct commit). Flow:
//   1. Open dialog → DryRun fires automatically → diff renders
//   2. User reviews + edits commit message / MR title / target branch
//   3. Push → real commit + MR → toast with MR URL
//
// All conflict / fidelity gating lives BE-side; this component just renders
// the response.

import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Loader2,
  GitBranch,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { gitIntegrationAPI, type GitLabBinding, type GitLabPushResult } from '@/services/api';
import { useGitIntegrationStore } from '@/stores/gitIntegrationStore';
import { GitLabConnectCard } from '@/components/settings/GitLabConnectCard';
import { toast } from '@/components/ui/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Collection } from '@/types';
import type { AxiosError } from 'axios';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collection: Collection;
}

export function PushToGitLabDialog({ open, onOpenChange, collection }: Props) {
  const { t } = useTranslation('collections');
  const gitlabStatus = useGitIntegrationStore((s) => s.status);
  const refreshGitlab = useGitIntegrationStore((s) => s.refresh);

  const [binding, setBinding] = useState<GitLabBinding | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [preview, setPreview] = useState<GitLabPushResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushResult, setPushResult] = useState<GitLabPushResult | null>(null);

  // Form state — defaults filled from binding / collection name when the
  // dialog opens.
  const [commitMessage, setCommitMessage] = useState('');
  const [mrTitle, setMrTitle] = useState('');
  const [mrDescription, setMrDescription] = useState('');
  const [targetBranch, setTargetBranch] = useState('');
  const [directCommit, setDirectCommit] = useState(false);

  const reset = () => {
    setPreview(null);
    setPushResult(null);
    setError(null);
    setCommitMessage('');
    setMrTitle('');
    setMrDescription('');
    setTargetBranch('');
    setDirectCommit(false);
  };

  const runDryRun = async () => {
    setDryRunLoading(true);
    setError(null);
    setPreview(null);
    try {
      const res = await gitIntegrationAPI.push(collection.id, { dryRun: true });
      setPreview(res.data);
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      setError(ax.response?.data?.error || ax.message || t('push.diffFailed'));
    } finally {
      setDryRunLoading(false);
    }
  };

  // Load binding + run dry-run automatically when the dialog opens.
  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    refreshGitlab();
    setDryRunLoading(true);
    gitIntegrationAPI
      .binding(collection.id)
      .then((res) => {
        const b = res.data ?? null;
        setBinding(b);
        if (b) {
          setMrTitle(t('push.defaultMrTitle', { name: collection.name }));
          setCommitMessage(t('push.defaultCommitMessage', { file: b.filePath }));
          setTargetBranch(b.branch);
        }
      })
      .catch(() => setBinding(null))
      .finally(() => {
        // Now that binding info is loaded, kick off the diff.
        runDryRun();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, collection.id]);

  const handlePush = async () => {
    setPushLoading(true);
    setError(null);
    // Started toast first so the user has visible feedback during the
    // commit + MR round-trip (typically 1–3s on a fast network, longer
    // when notarising via the BE proxy).
    const tt = toast({
      title: directCommit ? t('push.committingToast') : t('push.openingMrToast'),
      description: t('push.pushingDesc'),
    });
    try {
      const res = await gitIntegrationAPI.push(collection.id, {
        commitMessage,
        mrTitle,
        mrDescription,
        targetBranch,
        directCommit,
      });
      setPushResult(res.data);
      tt.update({
        id: tt.id,
        title: directCommit ? t('push.committedToast') : t('push.mrOpenedToast'),
        description: res.data.mrUrl
          ? t('push.branchInfo', { branch: res.data.branchName })
          : t('push.branchCommitInfo', { branch: res.data.branchName, commit: (res.data.commitId || '').slice(0, 8) }),
      });
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      const msg = ax.response?.data?.error || ax.message || t('push.failed');
      setError(msg);
      tt.update({ id: tt.id, title: t('push.failed'), description: msg, variant: 'destructive' });
    } finally {
      setPushLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('push.title')}</DialogTitle>
          <DialogDescription>
            {binding
              ? t('push.descriptionBound', { name: collection.name, project: binding.projectId })
              : t('push.descriptionUnbound', { name: collection.name })}
          </DialogDescription>
        </DialogHeader>

        {!gitlabStatus ? (
          <div className="rounded-md border p-3">
            <div className="text-sm font-medium mb-2">{t('push.connectPrompt')}</div>
            <GitLabConnectCard variant="embedded" />
          </div>
        ) : !binding ? (
          <div className="rounded-md border p-3 text-sm text-muted-foreground">
            {t('push.notBound')}
          </div>
        ) : pushResult ? (
          // Success terminal state — show what landed and a link to the MR.
          <div className="space-y-3">
            {pushResult.mrUrl ? (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  {t('push.mrOpenedToast')}
                </div>
                <a
                  href={pushResult.mrUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  {t('push.openMr')}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <div className="text-xs text-muted-foreground">
                  <Trans
                    t={t}
                    i18nKey="push.branchCommit"
                    values={{ branch: pushResult.branchName, commit: (pushResult.commitId || '').slice(0, 8) }}
                    components={{ code: <code className="text-[11px]" /> }}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-md border p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <Trans
                    t={t}
                    i18nKey="push.committedTo"
                    values={{ branch: pushResult.branchName }}
                    components={{ code: <code className="text-[11px]" /> }}
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  <Trans
                    t={t}
                    i18nKey="push.commitLine"
                    values={{ commit: (pushResult.commitId || '').slice(0, 8) }}
                    components={{ code: <code className="text-[11px]" /> }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 min-w-0">
            <div className="rounded-md bg-muted/30 border px-3 py-2 text-xs flex items-center gap-2 min-w-0">
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium shrink-0">{binding.projectId}</span>
              <span className="text-muted-foreground shrink-0">·</span>
              <span className="font-mono text-[11px] truncate min-w-0" title={binding.filePath}>
                {binding.filePath}
              </span>
              <span className="text-muted-foreground shrink-0">·</span>
              <span className="shrink-0">
                {t('push.basePrefix')} <span className="font-medium">{binding.branch}</span>
              </span>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="break-words">{error}</span>
              </div>
            )}

            {/* Diff preview */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs">{t('push.diff')}</Label>
                <Button variant="ghost" size="sm" onClick={runDryRun} disabled={dryRunLoading}>
                  <RefreshCw className={cn('h-3.5 w-3.5 mr-1', dryRunLoading && 'animate-spin')} />
                  {t('push.recompute')}
                </Button>
              </div>
              <div className="relative h-56 rounded-md border bg-muted/30 min-w-0 w-full">
                <div className="absolute inset-0 overflow-auto">
                  {dryRunLoading ? (
                    <div className="p-4 flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('push.computingDiff')}
                    </div>
                  ) : preview?.noChanges ? (
                    <div className="p-4 text-xs text-muted-foreground">
                      {t('push.noChanges')}
                    </div>
                  ) : preview?.diff ? (
                    <pre className="p-3 text-[11px] font-mono leading-snug whitespace-pre">
                      {preview.diff.split('\n').map((line, i) => (
                        <div
                          key={i}
                          className={cn(
                            line.startsWith('+') && !line.startsWith('+++')
                              ? 'text-green-500'
                              : line.startsWith('-') && !line.startsWith('---')
                                ? 'text-red-500'
                                : line.startsWith('@@')
                                  ? 'text-blue-400'
                                  : 'text-muted-foreground',
                          )}
                        >
                          {line || ' '}
                        </div>
                      ))}
                    </pre>
                  ) : (
                    <div className="p-4 text-xs text-muted-foreground">{t('push.noDiff')}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Commit + MR fields */}
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="commit-message" className="text-xs">{t('push.commitMessage')}</Label>
                <Input
                  id="commit-message"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                />
              </div>

              {!directCommit && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="mr-title" className="text-xs">{t('push.mrTitle')}</Label>
                    <Input id="mr-title" value={mrTitle} onChange={(e) => setMrTitle(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="mr-description" className="text-xs">{t('push.mrDescription')}</Label>
                    <Textarea
                      id="mr-description"
                      rows={3}
                      value={mrDescription}
                      onChange={(e) => setMrDescription(e.target.value)}
                      placeholder={t('push.mrDescriptionPlaceholder')}
                    />
                  </div>
                </>
              )}

              <div className="grid gap-1.5">
                <Label htmlFor="target-branch" className="text-xs">{t('push.targetBranch')}</Label>
                <Input
                  id="target-branch"
                  value={targetBranch}
                  onChange={(e) => setTargetBranch(e.target.value)}
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
                <input
                  type="checkbox"
                  checked={directCommit}
                  onChange={(e) => setDirectCommit(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>
                  <Trans
                    t={t}
                    i18nKey="push.advanced"
                    values={{ branch: targetBranch || binding.branch }}
                    components={{ code: <code className="text-[11px]" /> }}
                  />
                </span>
              </label>
            </div>
          </div>
        )}

        <DialogFooter>
          {pushResult ? (
            <Button onClick={() => onOpenChange(false)}>{t('push.done')}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pushLoading}>
                {t('common:cancel')}
              </Button>
              <Button
                onClick={handlePush}
                disabled={
                  !binding ||
                  !gitlabStatus ||
                  pushLoading ||
                  dryRunLoading ||
                  preview?.noChanges ||
                  !!error
                }
              >
                {pushLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {directCommit ? t('push.commit') : t('push.openMergeRequest')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
