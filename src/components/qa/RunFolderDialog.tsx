import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, FolderOpen, Loader2, Play, SkipForward } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { testFoldersAPI, type FolderRunCaseResult, type FolderRunResponse } from '@/services/api';
import { useEnvironmentStore } from '@/stores/environmentStore';
import type { TestCaseFolder, TestExecutionResult } from '@/types';
import { CompactStepList, StatusIcon } from './TestRunView';
import { type FolderIndex, folderCasesInOrder, folderPath } from './folderTree';
import { isExecutableCase } from './stepVars';

// "Run all" for a test-case folder: pick an environment (defaults to the
// active one — the env the step editors' {{var}} autocomplete shows) and
// whether to include subfolders, preview exactly which cases will run in which
// order, then run them on the BE in one call (it records a TestRun, so the run
// also lands in Planning → Runs → History). Mirrors the plan-run view: every
// case shows "running" until the batch returns, then per-case status with the
// step details one click away, plus an overall pass/fail bar.

const NO_ENV = '__none__';

interface Props {
  folder: TestCaseFolder | null;
  index: FolderIndex;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Per-case results of a finished run, so the list rows can show them. */
  onResults: (results: Record<string, TestExecutionResult>) => void;
}

export function RunFolderDialog({ folder, index, open, onOpenChange, onResults }: Props) {
  const { t } = useTranslation('qa');
  const environments = useEnvironmentStore((s) => s.environments);
  const [envId, setEnvId] = useState<string>(NO_ENV);
  const [recursive, setRecursive] = useState(true);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [response, setResponse] = useState<FolderRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedCase, setExpandedCase] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // Fresh state every time the dialog opens on a folder.
  useEffect(() => {
    if (!open) return;
    setEnvId(useEnvironmentStore.getState().activeEnvironment?.id ?? NO_ENV);
    setRecursive(true);
    setResponse(null);
    setError(null);
    setExpandedCase(null);
    setElapsed(0);
  }, [open, folder?.id]);

  useEffect(() => () => window.clearInterval(timer.current), []);

  const ordered = useMemo(
    () => (folder ? folderCasesInOrder(index, folder.id, recursive) : []),
    [folder, index, recursive],
  );
  const runnable = useMemo(() => ordered.filter(isExecutableCase), [ordered]);
  const skippedCount = ordered.length - runnable.length;

  const resultById = useMemo(() => {
    const m = new Map<string, FolderRunCaseResult>();
    for (const c of response?.testCases ?? []) m.set(c.testCaseId, c);
    return m;
  }, [response]);

  const run = async () => {
    if (!folder || running) return;
    setRunning(true);
    setResponse(null);
    setError(null);
    setExpandedCase(null);
    setElapsed(0);
    const started = Date.now();
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => setElapsed(Date.now() - started), 250);
    try {
      const res = await testFoldersAPI.execute(folder.id, {
        ...(envId !== NO_ENV ? { environmentId: envId } : {}),
        recursive,
      });
      setResponse(res.data);
      const byCase: Record<string, TestExecutionResult> = {};
      for (const c of res.data.testCases ?? []) if (c.result) byCase[c.testCaseId] = c.result;
      onResults(byCase);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || t('folders.runFailed', { defaultValue: 'The run failed.' }));
    } finally {
      window.clearInterval(timer.current);
      setElapsed(Date.now() - started);
      setRunning(false);
    }
  };

  const summary = response?.summary;
  const pathOf = (folderId: string | null | undefined) =>
    folderId && folderId !== folder?.id ? folderPath(index, folderId) : '';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!running) onOpenChange(o); }}>
      <DialogContent className="max-w-xl !grid-rows-[auto_1fr_auto] max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="truncate">
              {t('folders.runTitle', { defaultValue: 'Run all in “{{name}}”', name: folder?.name ?? '' })}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('folders.runHint', { defaultValue: 'Runs every executable test case in this folder, one after another, and records the run in Planning → Runs.' })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 overflow-y-auto pr-1 min-h-0">
          {/* Options */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-1 min-w-0">
              <Label className="text-xs text-muted-foreground">{t('run.environmentLabel')}</Label>
              <Select value={envId} onValueChange={setEnvId} disabled={running}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ENV} className="text-sm">
                    {t('folders.noEnvironment', { defaultValue: 'No environment' })}
                  </SelectItem>
                  {environments.map((env) => (
                    <SelectItem key={env.id} value={env.id} className="text-sm">{env.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-xs h-8 cursor-pointer select-none">
              <Switch checked={recursive} onCheckedChange={setRecursive} disabled={running} />
              {t('folders.includeSubfolders', { defaultValue: 'Include subfolders' })}
            </label>
          </div>

          {/* Progress / overall */}
          {running && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                <span>
                  {t('folders.runningProgress', {
                    defaultValue: 'Running… {{seconds}}s · cases: {{count}}',
                    count: runnable.length,
                    seconds: (elapsed / 1000).toFixed(1),
                  })}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full w-1/3 rounded-full bg-blue-500/70 animate-[qa-indeterminate_1.2s_ease-in-out_infinite]" />
              </div>
              <style>{'@keyframes qa-indeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}'}</style>
            </div>
          )}

          {error && (
            <div className="p-2.5 rounded-md border border-red-500/30 bg-red-500/5 text-xs text-red-600 dark:text-red-400 break-words">
              {error}
            </div>
          )}

          {summary && response && (
            <div className={`p-2.5 rounded-lg border ${summary.failed === 0 && response.overallStatus !== 'cancelled' ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
              <div className="flex items-center gap-2">
                <StatusIcon status={summary.failed === 0 ? 'passed' : 'failed'} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">
                    {response.overallStatus === 'cancelled'
                      ? t('runStatus.cancelled')
                      : summary.failed === 0
                        ? t('run.allTestsPassed')
                        : summary.failed === 1
                          ? t('run.testsFailedOne', { count: summary.failed })
                          : t('run.testsFailedOther', { count: summary.failed })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('run.overallPassedIn', { passed: summary.passed, total: summary.total, duration: response.totalDuration })}
                    {summary.skipped > 0 && ` · ${t('folders.skippedCount', { defaultValue: 'skipped (no executable steps): {{count}}', count: summary.skipped })}`}
                  </p>
                </div>
              </div>
              {summary.total > 0 && (
                <div className="flex h-1.5 rounded-full overflow-hidden mt-2 bg-muted">
                  <div className="bg-green-500 transition-all" style={{ width: `${(summary.passed / summary.total) * 100}%` }} />
                  <div className="bg-red-500 transition-all" style={{ width: `${(summary.failed / summary.total) * 100}%` }} />
                </div>
              )}
            </div>
          )}

          {/* Cases, in run order */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t('folders.casesToRun', { defaultValue: 'Cases to run: {{count}}', count: runnable.length })}
              {skippedCount > 0 && !summary && (
                <span className="ml-1 font-normal">
                  · {t('folders.skippedCount', { defaultValue: 'skipped (no executable steps): {{count}}', count: skippedCount })}
                </span>
              )}
            </p>
            {ordered.length === 0 && (
              <p className="text-xs text-muted-foreground italic py-2">
                {t('folders.emptyFolder', { defaultValue: 'This folder has no test cases.' })}
              </p>
            )}
            {ordered.map((tc) => {
              const executable = isExecutableCase(tc);
              const r = resultById.get(tc.id);
              const status = !executable ? 'skipped' : r ? r.status : running ? 'running' : undefined;
              const expandable = !!r?.result;
              const isOpen = expandedCase === tc.id;
              const path = pathOf(tc.folderId);
              return (
                <div
                  key={tc.id}
                  className={`rounded-md overflow-hidden ${
                    status === 'running' ? 'bg-blue-500/5 border border-blue-500/20'
                      : status === 'passed' ? 'bg-green-500/5'
                      : status === 'failed' || status === 'error' ? 'bg-red-500/5'
                      : 'bg-card'
                  } ${!executable ? 'opacity-60' : ''}`}
                >
                  <button
                    type="button"
                    disabled={!expandable}
                    onClick={() => setExpandedCase(isOpen ? null : tc.id)}
                    className={`w-full flex items-center gap-2 p-1.5 text-left ${expandable ? 'cursor-pointer hover:bg-accent/30' : 'cursor-default'}`}
                  >
                    {status ? <StatusIcon status={status} /> : <div className="w-3 shrink-0" />}
                    <Badge variant="outline" className="text-[8px] px-1 py-0 shrink-0">
                      {t(`priorityShort.${tc.priority}`, { defaultValue: tc.priority })}
                    </Badge>
                    <span className="text-sm truncate flex-1 min-w-0">
                      {tc.title}
                      {path && <span className="ml-1.5 text-[10px] text-muted-foreground">{path}</span>}
                    </span>
                    {!executable && (
                      <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-0.5">
                        <SkipForward className="h-2.5 w-2.5" />
                        {t('folders.noExecutableSteps', { defaultValue: 'no executable steps' })}
                      </span>
                    )}
                    {r?.result?.summary && (
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                        {r.result.summary.passed}/{r.result.summary.total}
                      </span>
                    )}
                    {r && <span className="text-[10px] text-muted-foreground shrink-0">{r.duration}ms</span>}
                    {expandable && (isOpen ? <ChevronUp className="h-2.5 w-2.5 shrink-0" /> : <ChevronDown className="h-2.5 w-2.5 shrink-0" />)}
                  </button>
                  {expandable && isOpen && r?.result && (
                    <div className="px-2 pb-2 pt-1 border-t bg-card/40">
                      <CompactStepList result={r.result} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" className="h-8" disabled={running} onClick={() => onOpenChange(false)}>
            {t('folders.close', { defaultValue: 'Close' })}
          </Button>
          <Button size="sm" className="h-8" disabled={running || runnable.length === 0} onClick={run}>
            {running ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
            {response
              ? t('folders.runAgain', { defaultValue: 'Run again' })
              : t('run.runAll', { count: runnable.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
