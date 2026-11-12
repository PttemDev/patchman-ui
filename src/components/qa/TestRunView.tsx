import { useEffect, useState, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import {
  Play,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Send,
  ShieldCheck,
  Variable,
  SkipForward,
  BarChart3,
  History,
  Zap,
  Info,
  Trash2,
} from 'lucide-react';
import { testCasesAPI, testPlansAPI, testRunsAPI, environmentsAPI, testFoldersAPI } from '@/services/api';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { TestCase, TestCaseFolder, TestPlan, TestRun, TestExecutionResult, Environment } from '@/types';

// ── Status helpers ──

export function StatusIcon({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const cls = size === 'md' ? 'h-4 w-4' : 'h-3 w-3';
  switch (status) {
    case 'passed':
      return <CheckCircle2 className={`${cls} text-green-500`} />;
    case 'failed':
      return <XCircle className={`${cls} text-red-500`} />;
    case 'error':
      return <AlertCircle className={`${cls} text-orange-500`} />;
    case 'skipped':
      return <SkipForward className={`${cls} text-gray-400`} />;
    case 'running':
      return <Loader2 className={`${cls} text-blue-500 animate-spin`} />;
    default:
      return <Clock className={`${cls} text-muted-foreground`} />;
  }
}

function statusBadgeVariant(status: string): 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'passed':
      return 'secondary';
    case 'failed':
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

function StepTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'request':
      return <Send className="h-2.5 w-2.5 text-blue-500" />;
    case 'assertion':
      return <ShieldCheck className="h-2.5 w-2.5 text-green-500" />;
    case 'extract':
      return <Variable className="h-2.5 w-2.5 text-purple-500" />;
    case 'wait':
      return <Clock className="h-2.5 w-2.5 text-gray-500" />;
    default:
      return <Info className="h-2.5 w-2.5 text-muted-foreground" />;
  }
}

// ── Sub-tabs ──

type RunTab = 'run-test' | 'run-plan' | 'history';

export function TestRunView() {
  const { t } = useTranslation('qa');
  const [activeTab, setActiveTab] = useState<RunTab>('run-test');
  // Bump after a plan execution so the History tab refetches without the
  // user having to leave and come back.
  const [historyVersion, setHistoryVersion] = useState(0);
  const bumpHistory = useCallback(() => setHistoryVersion((v) => v + 1), []);

  return (
    <div className="space-y-2">
      {/* Tab selector */}
      <div className="flex gap-0.5 p-0.5 bg-muted rounded-lg">
        {([
          { id: 'run-test' as RunTab, label: t('run.testCaseLabel'), icon: Zap },
          { id: 'run-plan' as RunTab, label: t('run.testPlanLabel'), icon: BarChart3 },
          { id: 'history' as RunTab, label: t('run.tabHistory'), icon: History },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-md text-sm font-medium transition-all ${
              activeTab === id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'run-test' && <RunTestCaseSection />}
      {activeTab === 'run-plan' && <RunTestPlanSection onPlanRan={bumpHistory} />}
      {activeTab === 'history' && <RunHistorySection version={historyVersion} />}
    </div>
  );
}

// ── Run Test Case Section ──

function RunTestCaseSection() {
  const { t } = useTranslation('qa');
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('');
  const [selectedEnvId, setSelectedEnvId] = useState<string>(() => useEnvironmentStore.getState().activeEnvironment?.id ?? '');
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [executionResult, setExecutionResult] = useState<TestExecutionResult | null>(null);
  const [runningStepIndex, setRunningStepIndex] = useState(-1);
  const [expandedResultSteps, setExpandedResultSteps] = useState<Set<number>>(new Set());

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [casesRes, envRes] = await Promise.allSettled([
          testCasesAPI.list(),
          environmentsAPI.list(),
        ]);
        if (casesRes.status === 'fulfilled') setTestCases(casesRes.value.data || []);
        if (envRes.status === 'fulfilled') setEnvironments(envRes.value.data || []);
      } catch {
        // silently fail
      }
      setIsLoading(false);
    };
    load();
  }, []);

  const runTest = useCallback(async () => {
    if (!selectedCaseId) return;
    setIsRunning(true);
    setExecutionResult(null);
    setExpandedResultSteps(new Set());

    const selectedCase = testCases.find((c) => c.id === selectedCaseId);
    const totalSteps = selectedCase?.steps?.length || 0;

    // Simulate step-by-step progress
    for (let i = 0; i < totalSteps; i++) {
      setRunningStepIndex(i);
      await new Promise((r) => setTimeout(r, 300));
    }

    try {
      // "default" is the placeholder value for "no environment"; only forward
      // a real environment id to the BE so it doesn't 404 trying to look it up.
      const envParam = selectedEnvId && selectedEnvId !== 'default'
        ? { environmentId: selectedEnvId }
        : undefined;
      const res = await testCasesAPI.execute(selectedCaseId, envParam);
      setExecutionResult(res.data);
    } catch (err: unknown) {
      // Build a synthetic failed result if server errors out
      const errMsg = err instanceof Error ? err.message : 'Unknown execution error';
      setExecutionResult({
        status: 'error',
        duration: 0,
        steps: [],
        variables: {},
        summary: { total: totalSteps, passed: 0, failed: 0, skipped: totalSteps },
      });
      console.error('Test execution error:', errMsg);
    }

    setRunningStepIndex(-1);
    setIsRunning(false);
  }, [selectedCaseId, selectedEnvId, testCases]);

  const toggleResultStep = (idx: number) => {
    setExpandedResultSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Selectors */}
      <div className="space-y-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('run.testCaseLabel')}</label>
          <Select value={selectedCaseId} onValueChange={setSelectedCaseId}>
            <SelectTrigger className="h-7 text-sm">
              <SelectValue placeholder={t('run.selectTestCase')} />
            </SelectTrigger>
            <SelectContent>
              {testCases.map((tc) => (
                <SelectItem key={tc.id} value={tc.id} className="text-sm">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[8px] px-1 py-0">{t(`priorityShort.${tc.priority}`, { defaultValue: tc.priority })}</Badge>
                    <span className="truncate">{tc.title}</span>
                  </div>
                </SelectItem>
              ))}
              {testCases.length === 0 && (
                <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                  {t('run.noCasesFound')}
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('run.environmentLabel')}</label>
          <Select value={selectedEnvId} onValueChange={setSelectedEnvId}>
            <SelectTrigger className="h-7 text-sm">
              <SelectValue placeholder={t('run.defaultEnvPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default" className="text-sm">{t('run.defaultEnv')}</SelectItem>
              {environments.map((env) => (
                <SelectItem key={env.id} value={env.id} className="text-sm">
                  {env.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          size="sm"
          className="w-full h-8 text-sm"
          disabled={!selectedCaseId || isRunning}
          onClick={runTest}
        >
          {isRunning ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              {t('run.running')}
            </>
          ) : (
            <>
              <Play className="h-3 w-3 mr-1" />
              {t('run.runTest')}
            </>
          )}
        </Button>
      </div>

      {/* Execution progress / results */}
      {(isRunning || executionResult) && (
        <div className="space-y-2">
          {/* Summary bar */}
          {executionResult && (
            <div className={`p-2.5 rounded-lg border ${
              executionResult.status === 'passed'
                ? 'bg-green-500/5 border-green-500/20'
                : executionResult.status === 'failed'
                  ? 'bg-red-500/5 border-red-500/20'
                  : 'bg-orange-500/5 border-orange-500/20'
            }`}>
              <div className="flex items-center gap-2">
                <StatusIcon status={executionResult.status} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">
                    {executionResult.status === 'passed' ? t('run.allChecksPassed') :
                     executionResult.status === 'failed' ? t('run.someChecksFailed') :
                     t('run.executionError')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {executionResult.duration > 0
                      ? t('run.passedSummaryDuration', { passed: executionResult.summary.passed, total: executionResult.summary.total, duration: executionResult.duration })
                      : t('run.passedSummary', { passed: executionResult.summary.passed, total: executionResult.summary.total })}
                  </p>
                </div>
              </div>
              {/* Progress bar */}
              {executionResult.summary.total > 0 && (
                <div className="flex h-1.5 rounded-full overflow-hidden mt-2 bg-muted">
                  {executionResult.summary.passed > 0 && (
                    <div
                      className="bg-green-500 transition-all"
                      style={{ width: `${(executionResult.summary.passed / executionResult.summary.total) * 100}%` }}
                    />
                  )}
                  {executionResult.summary.failed > 0 && (
                    <div
                      className="bg-red-500 transition-all"
                      style={{ width: `${(executionResult.summary.failed / executionResult.summary.total) * 100}%` }}
                    />
                  )}
                  {executionResult.summary.skipped > 0 && (
                    <div
                      className="bg-gray-400 transition-all"
                      style={{ width: `${(executionResult.summary.skipped / executionResult.summary.total) * 100}%` }}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Live step progress or final results */}
          <div className="space-y-1 max-h-[50vh] overflow-y-auto pr-1">
              {isRunning && !executionResult && (() => {
                const selectedCase = testCases.find((c) => c.id === selectedCaseId);
                return (selectedCase?.steps || []).map((step, i) => {
                  let stepStatus: string;
                  if (i < runningStepIndex) stepStatus = 'passed';
                  else if (i === runningStepIndex) stepStatus = 'running';
                  else stepStatus = 'pending';

                  return (
                    <div key={i} className={`flex items-center gap-2 p-2 rounded-md transition-all ${
                      stepStatus === 'running' ? 'bg-blue-500/5 border border-blue-500/20' : 'bg-card'
                    }`}>
                      <StatusIcon status={stepStatus} />
                      <StepTypeIcon type={step.type} />
                      <span className="text-sm flex-1 truncate">
                        {t('run.stepLabel', { n: step.stepNo, label: step.action || t(`stepType.${step.type}`, { defaultValue: step.type }) })}
                        {step.type === 'request' && step.request && (
                          <span className="ml-1 opacity-60">{step.request.method} {step.request.url?.substring(0, 20)}</span>
                        )}
                      </span>
                      {stepStatus === 'running' && (
                        <span className="text-[8px] text-blue-500 animate-pulse">{t('run.running')}</span>
                      )}
                    </div>
                  );
                });
              })()}

              {executionResult && executionResult.steps.map((stepResult, i) => {
                const isExpanded = expandedResultSteps.has(i);
                return (
                  <div key={i} className="rounded-lg overflow-hidden border">
                    {/* Step header */}
                    <button
                      onClick={() => toggleResultStep(i)}
                      className={`w-full flex items-center gap-2 p-2 transition-all text-left ${
                        stepResult.status === 'passed' ? 'bg-green-500/5' :
                        stepResult.status === 'failed' ? 'bg-red-500/5' :
                        stepResult.status === 'error' ? 'bg-orange-500/5' :
                        'bg-muted/50'
                      }`}
                    >
                      <StatusIcon status={stepResult.status} />
                      <StepTypeIcon type={stepResult.type} />
                      <span className="text-sm flex-1 truncate font-medium">
                        {t('run.step', { n: stepResult.stepNo })}
                        {stepResult.request && (
                          <span className="font-normal ml-1 opacity-70">
                            {stepResult.request.method} {stepResult.request.url?.substring(0, 25)}
                          </span>
                        )}
                      </span>
                      <span className="text-[8px] text-muted-foreground">{stepResult.duration}ms</span>
                      {isExpanded ? <ChevronUp className="h-2.5 w-2.5 shrink-0" /> : <ChevronDown className="h-2.5 w-2.5 shrink-0" />}
                    </button>

                    {/* Step details */}
                    {isExpanded && (
                      <div className="p-2 space-y-2 bg-card">
                        {/* Response info */}
                        {stepResult.response && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">{t('run.response')}</p>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={stepResult.response.statusCode < 400 ? 'secondary' : 'destructive'}
                                className="text-xs px-1 py-0"
                              >
                                {stepResult.response.statusCode}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {stepResult.duration}ms
                              </span>
                            </div>
                            {stepResult.response.body && (
                              <pre className="text-[8px] bg-muted p-1.5 rounded max-h-[60px] overflow-auto font-mono break-all whitespace-pre-wrap">
                                {stepResult.response.body.substring(0, 200)}
                                {stepResult.response.body.length > 200 && '...'}
                              </pre>
                            )}
                          </div>
                        )}

                        {/* Assertion results */}
                        {stepResult.assertions && stepResult.assertions.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">{t('run.assertions')}</p>
                            {stepResult.assertions.map((a, aIdx) => (
                              <div
                                key={aIdx}
                                className={`flex items-start gap-1.5 p-1.5 rounded text-xs ${
                                  a.passed
                                    ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                                    : 'bg-red-500/10 text-red-700 dark:text-red-400'
                                }`}
                              >
                                {a.passed ? (
                                  <CheckCircle2 className="h-2.5 w-2.5 shrink-0 mt-0.5" />
                                ) : (
                                  <XCircle className="h-2.5 w-2.5 shrink-0 mt-0.5" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p>{t('run.assertExpected', { type: a.type, expected: a.expected })}</p>
                                  {!a.passed && (
                                    <p className="font-medium">{t('run.got', { actual: a.actual })}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Extraction results */}
                        {stepResult.extractions && stepResult.extractions.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-xs font-medium text-muted-foreground">{t('run.extractedVariables')}</p>
                            {stepResult.extractions.map((ex, eIdx) => (
                              <div key={eIdx} className="flex items-center gap-1.5 p-1.5 rounded bg-purple-500/10 text-xs">
                                <Variable className="h-2.5 w-2.5 text-purple-500 shrink-0" />
                                <span className="font-mono text-purple-700 dark:text-purple-400">
                                  {`{{${ex.variable}}}`} = {ex.value}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Error */}
                        {stepResult.error && (
                          <div className="p-1.5 rounded bg-orange-500/10 text-xs text-orange-700 dark:text-orange-400">
                            <p className="font-medium">{t('run.errorLabel', { message: stepResult.error })}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Variables summary */}
              {executionResult && Object.keys(executionResult.variables).length > 0 && (
                <div className="mt-2 p-2 rounded-lg border bg-purple-500/5 border-purple-500/10">
                  <p className="text-xs font-medium text-purple-700 dark:text-purple-400 mb-1">{t('run.extractedVariables')}</p>
                  {Object.entries(executionResult.variables).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-1 text-xs font-mono">
                      <span className="text-purple-600 dark:text-purple-400">{`{{${key}}}`}</span>
                      <span className="text-muted-foreground">=</span>
                      <span className="text-foreground truncate">{val}</span>
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

// Compact step-by-step renderer used inside the plan-run case expander. Kept
// minimal on purpose — a full step inspector lives in the Test Case run view.
export function CompactStepList({ result }: { result: TestExecutionResult }) {
  const { t } = useTranslation('qa');
  if (!result.steps || result.steps.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground italic px-2 py-1">
        {t('run.noStepDetails')}
      </p>
    );
  }
  return (
    <div className="space-y-1">
      {result.steps.map((s, i) => (
        <div
          key={i}
          className={`rounded px-2 py-1.5 text-[11px] ${
            s.status === 'passed'
              ? 'bg-green-500/5'
              : s.status === 'failed'
                ? 'bg-red-500/5'
                : s.status === 'error'
                  ? 'bg-orange-500/5'
                  : 'bg-muted/40'
          }`}
        >
          <div className="flex items-center gap-1.5">
            <StatusIcon status={s.status} />
            <StepTypeIcon type={s.type} />
            <span className="font-medium">{t('run.step', { n: s.stepNo })}</span>
            <Badge variant="outline" className="text-[8px] px-1 py-0">{t(`stepType.${s.type}`, { defaultValue: s.type })}</Badge>
            {s.request && (
              <span className="text-[10px] text-muted-foreground truncate ml-1">
                {s.request.method} {s.request.url}
              </span>
            )}
            {s.response && (
              <span className={`ml-auto font-mono text-[10px] shrink-0 ${
                s.response.statusCode >= 200 && s.response.statusCode < 300
                  ? 'text-green-500'
                  : s.response.statusCode >= 400
                    ? 'text-red-500'
                    : 'text-yellow-500'
              }`}>
                {s.response.statusCode}
              </span>
            )}
            <span className="text-[9px] text-muted-foreground shrink-0 ml-auto">{s.duration}ms</span>
          </div>
          {s.assertions && s.assertions.length > 0 && (
            <div className="pl-5 mt-1 space-y-0.5">
              {s.assertions.map((a, ai) => (
                <div key={ai} className="flex items-start gap-1.5 text-[10px]">
                  {a.passed ? (
                    <CheckCircle2 className="h-2.5 w-2.5 text-green-500 shrink-0 mt-px" />
                  ) : (
                    <XCircle className="h-2.5 w-2.5 text-red-500 shrink-0 mt-px" />
                  )}
                  <span className="text-muted-foreground">{a.type}:</span>
                  {a.passed ? (
                    <span className="text-green-600 dark:text-green-400 truncate">
                      {a.expected}
                    </span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">
                      <Trans
                        t={t}
                        i18nKey="dashboard.assertExpectedGot"
                        values={{ expected: a.expected, actual: a.actual }}
                        components={{ c: <code className="bg-muted px-0.5 rounded" /> }}
                      />
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {s.extractions && s.extractions.length > 0 && (
            <div className="pl-5 mt-1 space-y-0.5">
              {s.extractions.map((ex, ei) => (
                <div key={ei} className="text-[10px] text-muted-foreground">
                  <span className="font-mono text-purple-500">${`{${ex.variable}}`}</span>
                  <span className="mx-1">=</span>
                  <span className="font-mono truncate">{ex.value}</span>
                </div>
              ))}
            </div>
          )}
          {s.error && (
            <div className="pl-5 mt-1 text-[10px] text-red-500">{s.error}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Run Test Plan Section ──

interface PlanExecuteCaseResult {
  testCaseId: string;
  title: string;
  status: string;
  duration: number;
  // Full per-step execution result so the user can drill into a case after a
  // plan run and see exactly which step passed or failed.
  result?: TestExecutionResult;
}

function RunTestPlanSection({ onPlanRan }: { onPlanRan: () => void }) {
  const { t } = useTranslation('qa');
  const [testPlans, setTestPlans] = useState<TestPlan[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [selectedEnvId, setSelectedEnvId] = useState<string>(() => useEnvironmentStore.getState().activeEnvironment?.id ?? '');
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [caseResults, setCaseResults] = useState<Record<string, PlanExecuteCaseResult>>({});
  const [caseStatuses, setCaseStatuses] = useState<Record<string, string>>({});
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);
  const [overallResult, setOverallResult] = useState<{ passed: number; failed: number; total: number; duration: number } | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [plansRes, casesRes, envRes] = await Promise.allSettled([
          testPlansAPI.list(),
          testCasesAPI.list(),
          environmentsAPI.list(),
        ]);
        if (plansRes.status === 'fulfilled') setTestPlans(plansRes.value.data || []);
        if (casesRes.status === 'fulfilled') setTestCases(casesRes.value.data || []);
        if (envRes.status === 'fulfilled') setEnvironments(envRes.value.data || []);
      } catch {
        // silently fail
      }
      setIsLoading(false);
    };
    load();
  }, []);

  const selectedPlan = testPlans.find((p) => p.id === selectedPlanId);
  const planCases = selectedPlan && Array.isArray(selectedPlan.testCaseIds)
    ? testCases.filter((tc) => selectedPlan.testCaseIds.includes(tc.id))
    : [];

  const runPlan = useCallback(async () => {
    if (!selectedPlanId || !selectedPlan) return;
    setIsRunning(true);
    setCaseResults({});
    setExpandedCaseId(null);
    setOverallResult(null);

    // Mark every case as running up-front so the user sees progress while the
    // BE executes them serially.
    const initial: Record<string, string> = {};
    for (const id of selectedPlan.testCaseIds) initial[id] = 'running';
    setCaseStatuses(initial);

    const startTime = Date.now();
    try {
      // Use the BE plan-execute endpoint — it persists a TestRun row, mirrors
      // upstream via the forwarder, and returns per-case status. Doing this
      // server-side is what makes runs show up in the History tab. Skip the
      // "default" placeholder so the BE doesn't 404 looking it up.
      const envParam = selectedEnvId && selectedEnvId !== 'default'
        ? { environmentId: selectedEnvId }
        : undefined;
      const res = await testPlansAPI.execute(selectedPlanId, envParam);
      const data = (res.data as { testCases?: PlanExecuteCaseResult[] }) || {};
      const cases = Array.isArray(data.testCases) ? data.testCases : [];

      const nextStatuses: Record<string, string> = {};
      const nextResults: Record<string, PlanExecuteCaseResult> = {};
      let passed = 0;
      let failed = 0;
      for (const c of cases) {
        nextStatuses[c.testCaseId] = c.status;
        nextResults[c.testCaseId] = c;
        if (c.status === 'passed') passed++;
        else failed++;
      }
      setCaseStatuses(nextStatuses);
      setCaseResults(nextResults);
      setOverallResult({
        passed,
        failed,
        total: cases.length || selectedPlan.testCaseIds.length,
        duration: Date.now() - startTime,
      });
    } catch {
      // Mark everything as error on a network/server failure.
      const errored: Record<string, string> = {};
      for (const id of selectedPlan.testCaseIds) errored[id] = 'error';
      setCaseStatuses(errored);
      setCaseResults({});
      setOverallResult({
        passed: 0,
        failed: selectedPlan.testCaseIds.length,
        total: selectedPlan.testCaseIds.length,
        duration: Date.now() - startTime,
      });
    }
    setIsRunning(false);
    onPlanRan();
  }, [selectedPlanId, selectedPlan, selectedEnvId, onPlanRan]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Plan selector */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('run.testPlanLabel')}</label>
        <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
          <SelectTrigger className="h-7 text-sm">
            <SelectValue placeholder={t('run.selectTestPlan')} />
          </SelectTrigger>
          <SelectContent>
            {testPlans.map((tp) => (
              <SelectItem key={tp.id} value={tp.id} className="text-sm">
                {t('run.planCasesCount', { name: tp.name, count: tp.testCaseIds.length })}
              </SelectItem>
            ))}
            {testPlans.length === 0 && (
              <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                {t('run.noPlansFound')}
              </div>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('run.environmentLabel')}</label>
        <Select value={selectedEnvId} onValueChange={setSelectedEnvId}>
          <SelectTrigger className="h-7 text-sm">
            <SelectValue placeholder={t('run.defaultEnvPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default" className="text-sm">{t('run.defaultEnv')}</SelectItem>
            {environments.map((env) => (
              <SelectItem key={env.id} value={env.id} className="text-sm">
                {env.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Plan cases preview */}
      {selectedPlan && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {planCases.length === 1
              ? t('run.casesInPlanOne', { count: planCases.length })
              : t('run.casesInPlanOther', { count: planCases.length })}
          </p>
          <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
            {planCases.map((tc) => {
                const status = caseStatuses[tc.id];
                const result = caseResults[tc.id];
                const expandable = !!result?.result;
                const isExpanded = expandedCaseId === tc.id;
                const summary = result?.result?.summary;
                return (
                  <div
                    key={tc.id}
                    className={`rounded-md transition-all overflow-hidden ${
                      status === 'running' ? 'bg-blue-500/5 border border-blue-500/20' :
                      status === 'passed' ? 'bg-green-500/5' :
                      status === 'failed' || status === 'error' ? 'bg-red-500/5' :
                      'bg-card'
                    }`}
                  >
                    <button
                      type="button"
                      disabled={!expandable}
                      onClick={() => setExpandedCaseId(isExpanded ? null : tc.id)}
                      className={`w-full flex items-center gap-2 p-1.5 text-left ${
                        expandable ? 'cursor-pointer hover:bg-accent/30' : 'cursor-default'
                      }`}
                    >
                      {status ? <StatusIcon status={status} /> : <div className="w-3" />}
                      <Badge variant="outline" className="text-[8px] px-1 py-0 shrink-0">
                        {t(`priorityShort.${tc.priority}`, { defaultValue: tc.priority })}
                      </Badge>
                      <span className="text-sm truncate flex-1">{tc.title}</span>
                      {status === 'running' && (
                        <span className="text-[8px] text-blue-500 animate-pulse shrink-0">{t('run.running')}</span>
                      )}
                      {summary && (
                        <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                          {summary.passed}/{summary.total}
                        </span>
                      )}
                      {result?.duration !== undefined && status !== 'running' && (
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {result.duration}ms
                        </span>
                      )}
                      {expandable && (
                        isExpanded
                          ? <ChevronUp className="h-2.5 w-2.5 shrink-0" />
                          : <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                      )}
                    </button>
                    {expandable && isExpanded && result?.result && (
                      <div className="px-2 pb-2 pt-1 border-t bg-card/40">
                        <CompactStepList result={result.result} />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <Button
        size="sm"
        className="w-full h-8 text-sm"
        disabled={!selectedPlanId || isRunning || planCases.length === 0}
        onClick={runPlan}
      >
        {isRunning ? (
          <>
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            {t('run.runningPlan')}
          </>
        ) : (
          <>
            <Play className="h-3 w-3 mr-1" />
            {t('run.runAll', { count: planCases.length })}
          </>
        )}
      </Button>

      {/* Overall result */}
      {overallResult && (
        <div className={`p-2.5 rounded-lg border ${
          overallResult.failed === 0
            ? 'bg-green-500/5 border-green-500/20'
            : 'bg-red-500/5 border-red-500/20'
        }`}>
          <div className="flex items-center gap-2">
            <StatusIcon status={overallResult.failed === 0 ? 'passed' : 'failed'} size="md" />
            <div className="flex-1">
              <p className="text-sm font-semibold">
                {overallResult.failed === 0
                  ? t('run.allTestsPassed')
                  : overallResult.failed === 1
                    ? t('run.testsFailedOne', { count: overallResult.failed })
                    : t('run.testsFailedOther', { count: overallResult.failed })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('run.overallPassedIn', { passed: overallResult.passed, total: overallResult.total, duration: overallResult.duration })}
              </p>
            </div>
          </div>
          <div className="flex h-1.5 rounded-full overflow-hidden mt-2 bg-muted">
            <div
              className="bg-green-500 transition-all"
              style={{ width: `${(overallResult.passed / overallResult.total) * 100}%` }}
            />
            <div
              className="bg-red-500 transition-all"
              style={{ width: `${(overallResult.failed / overallResult.total) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Run History Section ──

function RunHistorySection({ version }: { version: number }) {
  const { t } = useTranslation('qa');
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [testPlans, setTestPlans] = useState<TestPlan[]>([]);
  const [testFolders, setTestFolders] = useState<TestCaseFolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  // Tracks the per-case expansion inside an open run. Encoded as
  // `${runId}::${index}` so cases across runs can be expanded independently.
  const [expandedCaseKey, setExpandedCaseKey] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reloadCounter, setReloadCounter] = useState(0);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [runsRes, casesRes, plansRes, foldersRes] = await Promise.allSettled([
          testRunsAPI.list(),
          testCasesAPI.list(),
          testPlansAPI.list(),
          testFoldersAPI.list(),
        ]);
        if (runsRes.status === 'fulfilled') setRuns(runsRes.value.data || []);
        if (casesRes.status === 'fulfilled') setTestCases(casesRes.value.data || []);
        if (plansRes.status === 'fulfilled') setTestPlans(plansRes.value.data || []);
        if (foldersRes.status === 'fulfilled') setTestFolders(foldersRes.value.data || []);
      } catch {
        // silently fail
      }
      setIsLoading(false);
    };
    load();
  }, [version, reloadCounter]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await testRunsAPI.delete(id);
      setReloadCounter((c) => c + 1);
    } catch {
      // surfaced via interceptor
    }
    setDeletingId(null);
    setConfirmDeleteId(null);
    if (expandedRun === id) setExpandedRun(null);
  };

  const getRunLabel = (run: TestRun) => {
    const plan = testPlans.find((p) => p.id === run.testPlanId);
    if (plan?.name) return plan.name;
    // Folder "Run all" (testPlanId empty).
    const folder = run.testFolderId ? testFolders.find((f) => f.id === run.testFolderId) : undefined;
    if (folder) return t('folders.runLabel', { defaultValue: 'Folder: {{name}}', name: folder.name });
    return t('run.runLabelFallback', { id: run.id.substring(0, 8) });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-8">
        <History className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">{t('run.noTestRuns')}</p>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t('run.noTestRunsHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
      {runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).map((run) => {
          const passedCount = run.results.filter((r) => r.status === 'passed').length;
          const totalCount = run.results.length;
          const isExpanded = expandedRun === run.id;

          const isConfirming = confirmDeleteId === run.id;
          return (
            <div key={run.id} className="group rounded-lg border overflow-hidden">
              <div className="flex items-center gap-1 pr-1.5 hover:bg-accent/30 transition-colors">
                <button
                  onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                  className="flex items-center gap-2 p-2 flex-1 min-w-0 text-left cursor-pointer"
                >
                  <StatusIcon status={run.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{getRunLabel(run)}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(run.startedAt).toLocaleString('tr-TR', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={statusBadgeVariant(run.status)} className="text-[8px] px-1 py-0">
                      {t(`runStatus.${run.status}`, { defaultValue: run.status })}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">
                      {passedCount}/{totalCount}
                    </span>
                  </div>
                  {isExpanded ? <ChevronUp className="h-2.5 w-2.5 shrink-0" /> : <ChevronDown className="h-2.5 w-2.5 shrink-0" />}
                </button>
                {isConfirming ? (
                  <div className="flex gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[10px] px-1.5 text-red-500"
                      onClick={() => handleDelete(run.id)}
                      disabled={deletingId === run.id}
                    >
                      {deletingId === run.id ? '...' : t('run.confirm')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[10px] px-1.5"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      {t('common:cancel')}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0 text-red-500 hover:text-red-600 opacity-0 group-hover:opacity-100"
                    onClick={() => setConfirmDeleteId(run.id)}
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </Button>
                )}
              </div>

              {isExpanded && (
                <div className="p-2 border-t bg-card space-y-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
                    {run.environment && <span>{t('run.environment', { value: run.environment })}</span>}
                    {run.completedAt && (() => {
                      const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
                      return (
                        <span>
                          {t('run.duration', { value: ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s` })}
                        </span>
                      );
                    })()}
                  </div>
                  {totalCount > 0 && (
                    <div className="flex h-1 rounded-full overflow-hidden bg-muted mb-2">
                      <div className="bg-green-500" style={{ width: `${(passedCount / totalCount) * 100}%` }} />
                      <div className="bg-red-500" style={{ width: `${((totalCount - passedCount) / totalCount) * 100}%` }} />
                    </div>
                  )}
                  {run.results.map((result, rIdx) => {
                    const tc = testCases.find((c) => c.id === result.testCaseId);
                    const label = tc?.title || result.title || result.testCaseId;
                    const caseKey = `${run.id}::${rIdx}`;
                    const isCaseExpanded = expandedCaseKey === caseKey;
                    const expandable = !!result.result?.steps?.length;
                    const summary = result.result?.summary;
                    return (
                      <div
                        key={rIdx}
                        className={`rounded overflow-hidden ${
                          result.status === 'passed' ? 'bg-green-500/5' :
                          result.status === 'failed' ? 'bg-red-500/5' :
                          result.status === 'error' ? 'bg-orange-500/5' :
                          'bg-muted/50'
                        }`}
                      >
                        <button
                          type="button"
                          disabled={!expandable}
                          onClick={() => setExpandedCaseKey(isCaseExpanded ? null : caseKey)}
                          className={`w-full flex items-center gap-1.5 p-1.5 text-xs text-left ${
                            expandable ? 'cursor-pointer hover:bg-accent/30' : 'cursor-default'
                          }`}
                        >
                          <StatusIcon status={result.status} />
                          <span className="flex-1 truncate">{label}</span>
                          {summary && (
                            <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                              {summary.passed}/{summary.total}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {result.duration}ms
                          </span>
                          {expandable && (
                            isCaseExpanded
                              ? <ChevronUp className="h-2.5 w-2.5 shrink-0" />
                              : <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                          )}
                        </button>
                        {expandable && isCaseExpanded && result.result && (
                          <div className="px-2 pb-2 pt-1 border-t bg-card/40">
                            <CompactStepList result={result.result} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {run.results.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">{t('run.noResultsRecorded')}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
