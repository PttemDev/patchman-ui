import { useState, useEffect, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  LayoutList,
  Play,
  Bug,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Wand2,
  Target,
  Zap,
  Loader2,
  Flame,
  Layers,
  Upload,
  History,
  Trash2,
  ChevronDown,
} from 'lucide-react';

import { TestCaseList } from './TestCaseList';
import { TestPlanList } from './TestPlanList';
import { TestRunView } from './TestRunView';
import { DefectList } from './DefectList';
import { RequirementsList } from './RequirementsList';
import { SharedStepsList } from './SharedStepsList';
import { TestCaseWizard } from './TestCaseWizard';
import { LoadTestPanel } from './LoadTestPanel';
import { JUnitImportDialog } from './JUnitImportDialog';

import { testCasesAPI, loadTestAPI } from '@/services/api';
import { activeRunEnv, runErrorResult } from './stepVars';
import type { TestCase, TestExecutionResult } from '@/types';

// ── Quick Run History (localStorage) ──

interface QuickRunEntry {
  id: string;
  testCaseId: string;
  testCaseTitle: string;
  result: TestExecutionResult;
  timestamp: string;
}

const HISTORY_KEY = 'patchman_quick_run_history';
const MAX_HISTORY = 50;

function loadHistory(): QuickRunEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
}

function saveHistory(entries: QuickRunEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
}

// ── Shared Result Detail Component ──

function QuickRunResultDetail({ result }: { result: TestExecutionResult }) {
  const { t } = useTranslation('qa');
  return (
    <div className={`p-2.5 rounded-md space-y-2 mt-2 ${
      result.status === 'passed' ? 'bg-green-500/10 border border-green-500/20'
        : result.status === 'failed' ? 'bg-red-500/10 border border-red-500/20'
        : 'bg-orange-500/10 border border-orange-500/20'
    }`}>
      <div className="flex items-center gap-2">
        {result.status === 'passed' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
        {result.status === 'failed' && <XCircle className="h-3.5 w-3.5 text-red-500" />}
        {result.status === 'error' && <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />}
        <span className="text-xs font-semibold">
          {result.status === 'passed' ? t('runStatus.passed') : result.status === 'failed' ? t('runStatus.failed') : t('runStatus.error')}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {t('dashboard.stepsSummary', { passed: result.summary.passed, total: result.summary.total })}
          {result.duration > 0 && ` | ${result.duration}ms`}
        </span>
      </div>

      {result.steps && result.steps.length > 0 && (
        <div className="space-y-1.5">
          {result.steps.map((s, i) => (
            <div key={i} className="rounded bg-background/50 px-2 py-1.5 space-y-0.5">
              <div className="flex items-center gap-1.5 text-[11px]">
                {s.status === 'passed' ? <CheckCircle2 className="h-2.5 w-2.5 text-green-500 shrink-0" />
                  : s.status === 'failed' ? <XCircle className="h-2.5 w-2.5 text-red-500 shrink-0" />
                  : <Clock className="h-2.5 w-2.5 text-muted-foreground shrink-0" />}
                <span className="font-medium">{t('caseList.step', { n: s.stepNo })}</span>
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">{t(`stepType.${s.type}`, { defaultValue: s.type })}</Badge>
                <span className="ml-auto text-[10px] text-muted-foreground">{s.duration}ms</span>
              </div>

              {s.request && (
                <div className="flex items-center gap-1.5 text-[10px] pl-4">
                  <span className={`font-bold uppercase ${
                    s.request.method === 'GET' ? 'text-green-500'
                      : s.request.method === 'POST' ? 'text-yellow-500'
                      : s.request.method === 'PUT' ? 'text-blue-500'
                      : s.request.method === 'DELETE' ? 'text-red-500'
                      : 'text-muted-foreground'
                  }`}>{s.request.method}</span>
                  <span className="text-muted-foreground truncate">{s.request.url}</span>
                  {s.response && (
                    <span className={`ml-auto font-mono shrink-0 ${
                      s.response.statusCode >= 200 && s.response.statusCode < 300 ? 'text-green-500'
                        : s.response.statusCode >= 400 ? 'text-red-500'
                        : 'text-yellow-500'
                    }`}>{s.response.statusCode}</span>
                  )}
                </div>
              )}

              {s.assertions && s.assertions.length > 0 && (
                <div className="pl-4 space-y-0.5">
                  {s.assertions.map((a, ai) => (
                    <div key={ai} className="flex items-start gap-1.5 text-[10px]">
                      {a.passed
                        ? <CheckCircle2 className="h-2.5 w-2.5 text-green-500 shrink-0 mt-px" />
                        : <XCircle className="h-2.5 w-2.5 text-red-500 shrink-0 mt-px" />}
                      <span className="text-muted-foreground">{a.type}:</span>
                      {a.passed ? (
                        <span className="text-green-600 dark:text-green-400 truncate">{a.expected}</span>
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
                <div className="pl-4 space-y-0.5">
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
                <div className="pl-4 text-[10px] text-red-500">{s.error}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Overview Tab ──

function OverviewSection() {
  const { t } = useTranslation('qa');
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [loadTests, setLoadTests] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Quick Run
  const [selectedId, setSelectedId] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<TestExecutionResult | null>(null);
  const [quickRunTab, setQuickRunTab] = useState<'run' | 'history'>('run');
  const [history, setHistory] = useState<QuickRunEntry[]>(() => loadHistory());
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [casesRes, loadRes] = await Promise.allSettled([
        testCasesAPI.list(),
        loadTestAPI.list(),
      ]);
      setTestCases(casesRes.status === 'fulfilled' ? (casesRes.value.data || []) : []);
      setLoadTests(loadRes.status === 'fulfilled' ? (loadRes.value.data || []) : []);
    } catch {
      // keep defaults
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleQuickRun = async () => {
    if (!selectedId) return;
    setIsRunning(true);
    setLastResult(null);
    const tc = testCases.find(t => t.id === selectedId);
    try {
      const res = await testCasesAPI.execute(selectedId, activeRunEnv());
      setLastResult(res.data);
      const entry: QuickRunEntry = {
        id: crypto.randomUUID(),
        testCaseId: selectedId,
        testCaseTitle: tc?.title || t('dashboard.unknownCase'),
        result: res.data,
        timestamp: new Date().toISOString(),
      };
      const updated = [entry, ...history].slice(0, MAX_HISTORY);
      setHistory(updated);
      saveHistory(updated);
    } catch (err) {
      const errResult: TestExecutionResult = runErrorResult(err);
      setLastResult(errResult);
      const entry: QuickRunEntry = {
        id: crypto.randomUUID(),
        testCaseId: selectedId,
        testCaseTitle: tc?.title || t('dashboard.unknownCase'),
        result: errResult,
        timestamp: new Date().toISOString(),
      };
      const updated = [entry, ...history].slice(0, MAX_HISTORY);
      setHistory(updated);
      saveHistory(updated);
    }
    setIsRunning(false);
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
    setExpandedHistoryId(null);
  };

  const removeHistoryEntry = (id: string) => {
    const updated = history.filter(h => h.id !== id);
    setHistory(updated);
    saveHistory(updated);
    if (expandedHistoryId === id) setExpandedHistoryId(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Compute real stats
  const totalCases = testCases.length;
  const byPriority = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 } as Record<string, number>;
  const byStatus = { draft: 0, active: 0, deprecated: 0 } as Record<string, number>;
  for (const tc of testCases) {
    byPriority[tc.priority] = (byPriority[tc.priority] || 0) + 1;
    byStatus[tc.status] = (byStatus[tc.status] || 0) + 1;
  }
  const hasSteps = testCases.filter(tc => tc.steps && tc.steps.length > 0).length;

  const totalLoadTests = loadTests.length;
  const completedLoadTests = loadTests.filter((lt: { status: string }) => lt.status === 'completed').length;
  const lastLoadTest = loadTests[0]; // already sorted DESC

  return (
    <div className="space-y-3">
      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-2.5 border rounded-lg bg-card">
          <div className="flex items-center gap-1.5">
            <ClipboardList className="h-3 w-3 text-blue-500" />
            <span className="text-xs text-muted-foreground">{t('dashboard.statTestCases')}</span>
          </div>
          <p className="text-lg font-bold mt-1 leading-none">{totalCases}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{t('dashboard.executableCount', { count: hasSteps })}</p>
        </div>
        <div className="p-2.5 border rounded-lg bg-card">
          <div className="flex items-center gap-1.5">
            <Flame className="h-3 w-3 text-orange-500" />
            <span className="text-xs text-muted-foreground">{t('dashboard.statLoadTests')}</span>
          </div>
          <p className="text-lg font-bold mt-1 leading-none">{totalLoadTests}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{t('dashboard.completedCount', { count: completedLoadTests })}</p>
        </div>
        <div className="p-2.5 border rounded-lg bg-card">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3 w-3 text-green-500" />
            <span className="text-xs text-muted-foreground">{t('dashboard.statWithSteps')}</span>
          </div>
          <p className="text-lg font-bold mt-1 leading-none">
            {totalCases > 0 ? Math.round((hasSteps / totalCases) * 100) : 0}%
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{t('dashboard.executableRate')}</p>
        </div>
      </div>

      {/* Test Cases by Status */}
      {totalCases > 0 && (
        <div className="border rounded-lg p-3 bg-card">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {t('dashboard.casesByStatus')}
          </p>
          <div className="space-y-1.5">
            {[
              { key: 'draft', labelKey: 'caseStatus.draft', color: 'bg-gray-400', icon: Clock },
              { key: 'active', labelKey: 'caseStatus.active', color: 'bg-green-500', icon: CheckCircle2 },
              { key: 'deprecated', labelKey: 'caseStatus.deprecated', color: 'bg-yellow-500', icon: AlertTriangle },
            ].map(({ key, labelKey, color, icon: Icon }) => {
              const count = byStatus[key] || 0;
              if (count === 0) return null;
              const pct = totalCases > 0 ? Math.round((count / totalCases) * 100) : 0;
              return (
                <div key={key} className="flex items-center gap-2">
                  <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-xs w-12 shrink-0">{t(labelKey)}</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-mono text-muted-foreground w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cases by Priority */}
      {totalCases > 0 && (
        <div className="border rounded-lg p-3 bg-card">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {t('dashboard.casesByPriority')}
          </p>
          <div className="flex items-center gap-1.5">
            {[
              { key: 'P0', labelKey: 'dashPriority.P0', color: 'bg-red-500 text-white' },
              { key: 'P1', labelKey: 'dashPriority.P1', color: 'bg-orange-500 text-white' },
              { key: 'P2', labelKey: 'dashPriority.P2', color: 'bg-yellow-500 text-black' },
              { key: 'P3', labelKey: 'dashPriority.P3', color: 'bg-blue-500 text-white' },
              { key: 'P4', labelKey: 'dashPriority.P4', color: 'bg-gray-400 text-white' },
            ].map(({ key, labelKey, color }) => {
              const count = byPriority[key] || 0;
              if (count === 0) return null;
              return (
                <Badge key={key} className={`text-[10px] px-1.5 py-0 ${color}`}>
                  {t(labelKey)}: {count}
                </Badge>
              );
            })}
            {totalCases === 0 && <span className="text-xs text-muted-foreground">{t('dashboard.noCasesYet')}</span>}
          </div>
        </div>
      )}

      {/* Last Load Test */}
      {lastLoadTest && lastLoadTest.results && (
        <div className="border rounded-lg p-3 bg-card">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {t('dashboard.lastLoadTest')}
          </p>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-medium truncate flex-1">{lastLoadTest.name}</span>
            <Badge variant={lastLoadTest.status === 'completed' ? 'secondary' : 'destructive'} className="text-[10px] px-1.5 py-0">
              {t(`runStatus.${lastLoadTest.status}`, { defaultValue: lastLoadTest.status })}
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-sm font-bold">{(lastLoadTest.results.totalRequests ?? 0).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{t('dashboard.requests')}</p>
            </div>
            <div>
              <p className="text-sm font-bold">{Math.round(lastLoadTest.results.avgResponseTime ?? 0)}ms</p>
              <p className="text-[10px] text-muted-foreground">{t('dashboard.avgResponse')}</p>
            </div>
            <div>
              <p className={`text-sm font-bold ${(lastLoadTest.results.errorRate ?? 0) > 5 ? 'text-red-500' : 'text-green-500'}`}>
                {(lastLoadTest.results.errorRate ?? 0).toFixed(1)}%
              </p>
              <p className="text-[10px] text-muted-foreground">{t('dashboard.errorRate')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Run */}
      <div className="border rounded-lg bg-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <div className="p-1 rounded-md bg-green-500/10">
            <Zap className="h-3 w-3 text-green-500" />
          </div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t('dashboard.quickRun')}
          </p>
        </div>

        {/* Sub-tabs */}
        <div className="flex items-center gap-0 px-3 border-b">
          <button
            onClick={() => setQuickRunTab('run')}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              quickRunTab === 'run'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Play className="h-3 w-3 inline-block mr-1" />
            {t('dashboard.runTab')}
          </button>
          <button
            onClick={() => setQuickRunTab('history')}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              quickRunTab === 'history'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <History className="h-3 w-3 inline-block mr-1" />
            {t('dashboard.historyTab')}
            {history.length > 0 && (
              <span className="ml-1 text-[10px] bg-muted px-1 rounded-full">{history.length}</span>
            )}
          </button>
        </div>

        {/* Run Tab */}
        {quickRunTab === 'run' && (
          <div className="p-3 space-y-2">
            <p className="text-xs text-muted-foreground">{t('dashboard.quickRunHint')}</p>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder={t('dashboard.pickTestCase')} />
              </SelectTrigger>
              <SelectContent>
                {testCases.filter(tc => tc.steps && tc.steps.length > 0).map((tc) => (
                  <SelectItem key={tc.id} value={tc.id} className="text-xs">
                    <span className="truncate">{tc.title}</span>
                  </SelectItem>
                ))}
                {testCases.filter(tc => tc.steps && tc.steps.length > 0).length === 0 && (
                  <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                    {t('dashboard.noExecutableCases')}
                  </div>
                )}
              </SelectContent>
            </Select>
            <Button size="sm" className="w-full h-7 text-xs" disabled={!selectedId || isRunning} onClick={handleQuickRun}>
              {isRunning ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />{t('dashboard.running')}</> : <><Play className="h-3 w-3 mr-1" />{t('dashboard.runNow')}</>}
            </Button>

            {lastResult && <QuickRunResultDetail result={lastResult} />}
          </div>
        )}

        {/* History Tab */}
        {quickRunTab === 'history' && (
          <div className="p-3 space-y-2">
            {history.length === 0 ? (
              <div className="text-center py-6">
                <History className="h-5 w-5 mx-auto text-muted-foreground/40 mb-1.5" />
                <p className="text-xs text-muted-foreground">{t('dashboard.noRunsYet')}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">{history.length === 1 ? t('dashboard.runCountOne', { count: history.length }) : t('dashboard.runCountOther', { count: history.length })}</span>
                  <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 text-muted-foreground hover:text-destructive" onClick={clearHistory}>
                    <Trash2 className="h-2.5 w-2.5 mr-1" />
                    {t('dashboard.clear')}
                  </Button>
                </div>
                <div className="space-y-1 max-h-[400px] overflow-y-auto">
                  {history.map((entry) => {
                    const isExpanded = expandedHistoryId === entry.id;
                    const r = entry.result;
                    const ts = new Date(entry.timestamp);
                    const timeStr = ts.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                    const dateStr = ts.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                    return (
                      <div key={entry.id} className="rounded-md border overflow-hidden">
                        {/* Row */}
                        <button
                          onClick={() => setExpandedHistoryId(isExpanded ? null : entry.id)}
                          className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-accent/50 transition-colors cursor-pointer"
                        >
                          {r.status === 'passed' ? <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                            : r.status === 'failed' ? <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                            : <AlertTriangle className="h-3 w-3 text-orange-500 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{entry.testCaseTitle}</p>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span>{dateStr} {timeStr}</span>
                              <span>{t('dashboard.stepsSummary', { passed: r.summary.passed, total: r.summary.total })}</span>
                              {r.duration > 0 && <span>{r.duration}ms</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => { e.stopPropagation(); removeHistoryEntry(entry.id); }}
                              className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                            <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                        </button>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="px-2.5 pb-2.5 border-t">
                            <QuickRunResultDetail result={r} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Empty State / Get Started */}
      {totalCases === 0 && (
        <div className="border-2 border-dashed rounded-lg p-4 text-center">
          <Wand2 className="h-6 w-6 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-xs font-medium">{t('dashboard.emptyTitle')}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 mb-2">{t('dashboard.emptyHint')}</p>
          <Button size="sm" className="h-7 text-xs" onClick={() => setWizardOpen(true)}>
            <Wand2 className="h-3 w-3 mr-1" />
            {t('dashboard.createTestCase')}
          </Button>
        </div>
      )}

      <TestCaseWizard open={wizardOpen} onOpenChange={setWizardOpen} onSaved={fetchData} />
    </div>
  );
}

// ── Enhanced Test Cases Tab (with wizard button) ──

function TestCasesSection() {
  const { t } = useTranslation('qa');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-3">
      {/* Wizard Banner */}
      <button
        onClick={() => setWizardOpen(true)}
        className="w-full p-3 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200 cursor-pointer group"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
            <Wand2 className="h-4 w-4 text-primary" />
          </div>
          <div className="text-left flex-1">
            <p className="text-xs font-semibold text-primary">{t('dashboard.createWithWizard')}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('dashboard.wizardBannerHint')}
            </p>
          </div>
        </div>
      </button>

      <TestCaseList key={refreshKey} />

      <TestCaseWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onSaved={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

// ── Enhanced Test Plans Tab ──

function TestPlansSection() {
  return (
    <div className="space-y-3">
      <TestPlanList />
    </div>
  );
}

// ── Enhanced Test Runs Tab ──

function TestRunsSection() {
  return (
    <div className="space-y-3">
      <TestRunView />
    </div>
  );
}

// ── Main QA Dashboard ──

// Combined QA workspace: Testing (overview / cases / load) and Planning (plans /
// runs / bugs / reqs / shared steps) on one screen, split by a top-level
// Testing|Planning tab. Import JUnit sits in that same top row.
// QAHeaderActions renders the Import JUnit control. It lives in the sidebar's
// panel HEADER (next to the "QA Testing" title) rather than inside the body, so
// it owns its own dialog state here.
export function QAHeaderActions() {
  const { t } = useTranslation('qa');
  const [junitOpen, setJunitOpen] = useState(false);
  return (
    <>
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setJunitOpen(true)}>
              <Upload className="h-3 w-3 mr-1" />
              {t('dashboard.importJunit')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('dashboard.importJunitTooltip')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <JUnitImportDialog open={junitOpen} onOpenChange={setJunitOpen} />
    </>
  );
}

export function QADashboard() {
  const { t } = useTranslation('qa');
  const [section, setSection] = useState<'testing' | 'planning'>('testing');
  const [testTab, setTestTab] = useState('overview');
  const [planTab, setPlanTab] = useState('plans');

  return (
    <div className="p-2">
      {/* Top-level section switch (Import JUnit lives in the panel header). */}
      <Tabs value={section} onValueChange={(v) => setSection(v as 'testing' | 'planning')} className="mb-2">
        <TabsList className="w-full h-auto gap-0.5 p-1">
          <TabsTrigger value="testing" className="text-sm h-7 px-2 flex-1 min-w-0">
            <ClipboardCheck className="h-3.5 w-3.5 mr-1 shrink-0 hidden sm:inline-block" />
            {t('dashboard.sectionTesting')}
          </TabsTrigger>
          <TabsTrigger value="planning" className="text-sm h-7 px-2 flex-1 min-w-0">
            <LayoutList className="h-3.5 w-3.5 mr-1 shrink-0 hidden sm:inline-block" />
            {t('dashboard.sectionPlanning')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {section === 'testing' ? (
        <Tabs value={testTab} onValueChange={setTestTab}>
          <TabsList className="w-full h-auto !justify-start gap-0.5 p-1 overflow-x-auto">
            <TabsTrigger value="overview" className="text-sm h-6 px-2 flex-1 min-w-fit">
              <BarChart3 className="h-3 w-3 mr-1 shrink-0 hidden sm:inline-block" />
              {t('dashboard.tabOverview')}
            </TabsTrigger>
            <TabsTrigger value="cases" className="text-sm h-6 px-2 flex-1 min-w-fit">
              <ClipboardList className="h-3 w-3 mr-1 shrink-0 hidden sm:inline-block" />
              {t('dashboard.tabCases')}
            </TabsTrigger>
            <TabsTrigger value="load" className="text-sm h-6 px-2 flex-1 min-w-fit">
              <Flame className="h-3 w-3 mr-1 shrink-0 hidden sm:inline-block" />
              {t('dashboard.tabLoadTest')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewSection />
          </TabsContent>
          <TabsContent value="cases">
            <TestCasesSection />
          </TabsContent>
          <TabsContent value="load">
            <LoadTestPanel />
          </TabsContent>
        </Tabs>
      ) : (
        <Tabs value={planTab} onValueChange={setPlanTab}>
          <TabsList className="w-full h-auto !justify-start gap-0.5 p-1 overflow-x-auto">
            <TabsTrigger value="plans" className="text-sm h-6 px-2 flex-1 min-w-fit">
              <LayoutList className="h-3 w-3 mr-1 shrink-0 hidden sm:inline-block" />
              {t('dashboard.tabPlans')}
            </TabsTrigger>
            <TabsTrigger value="runs" className="text-sm h-6 px-2 flex-1 min-w-fit">
              <Play className="h-3 w-3 mr-1 shrink-0 hidden sm:inline-block" />
              {t('dashboard.tabRuns')}
            </TabsTrigger>
            <TabsTrigger value="bugs" className="text-sm h-6 px-2 flex-1 min-w-fit">
              <Bug className="h-3 w-3 mr-1 shrink-0 hidden sm:inline-block" />
              {t('dashboard.tabBugs')}
            </TabsTrigger>
            <TabsTrigger value="reqs" className="text-sm h-6 px-2 flex-1 min-w-fit">
              <Target className="h-3 w-3 mr-1 shrink-0 hidden sm:inline-block" />
              {t('dashboard.tabReqs')}
            </TabsTrigger>
            <TabsTrigger value="shared-steps" className="text-sm h-6 px-2 flex-1 min-w-fit">
              <Layers className="h-3 w-3 mr-1 shrink-0 hidden sm:inline-block" />
              {t('dashboard.tabSteps')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="plans">
            <TestPlansSection />
          </TabsContent>
          <TabsContent value="runs">
            <TestRunsSection />
          </TabsContent>
          <TabsContent value="bugs">
            <DefectList />
          </TabsContent>
          <TabsContent value="reqs">
            <RequirementsList />
          </TabsContent>
          <TabsContent value="shared-steps">
            <SharedStepsList />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
