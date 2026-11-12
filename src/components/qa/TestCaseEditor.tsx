import { useState, useEffect, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Plus, Trash2, History, RotateCcw, Eye, ChevronDown, ChevronUp,
  Send, ShieldCheck, Variable, Clock, Play, Check, Info,
  CheckCircle2, XCircle, AlertTriangle,
} from 'lucide-react';
import { testCasesAPI, testCaseVersionsAPI } from '@/services/api';
import { parseCurlAsRecord } from '@/lib/parseCurl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { confirmDialog } from '@/components/ui/confirm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CommentSection } from '@/components/comments/CommentSection';
import { VariableInput, VariableTextarea, RuntimeVarsProvider } from '@/components/environment/VariableInput';
import { useAuthStore } from '@/stores/authStore';
import { activeRunEnv, runErrorResult, runtimeVarsBefore } from './stepVars';
import type { TestCase, TestStep, TestCaseVersion, TestExecutionResult } from '@/types';

// ── Shared constants ──

type AssertionType = 'status' | 'body_contains' | 'json_path' | 'response_time' | 'header';
type AssertionOperator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'exists' | 'not_empty' | 'greater_than' | 'less_than' | 'matches';

interface AssertionItem {
  type: AssertionType;
  operator: AssertionOperator;
  value?: string;
  path?: string;
  key?: string;
}

interface ExtractionItem {
  variable: string;
  source: 'json_path' | 'header' | 'body' | 'status';
  path?: string;
  key?: string;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-600 dark:text-green-400',
  POST: 'text-blue-600 dark:text-blue-400',
  PUT: 'text-yellow-600 dark:text-yellow-400',
  PATCH: 'text-orange-600 dark:text-orange-400',
  DELETE: 'text-red-600 dark:text-red-400',
};

const ASSERTION_TYPES: AssertionType[] = ['status', 'body_contains', 'json_path', 'response_time', 'header'];

const OPERATORS_BY_TYPE: Record<AssertionType, AssertionOperator[]> = {
  status: ['equals', 'not_equals'],
  body_contains: ['contains', 'not_contains', 'matches'],
  json_path: ['equals', 'not_equals', 'exists', 'not_empty', 'contains', 'greater_than', 'less_than'],
  response_time: ['less_than', 'greater_than'],
  header: ['equals', 'contains', 'exists'],
};

const STEP_ICONS: Record<string, React.ElementType> = {
  request: Send,
  assertion: ShieldCheck,
  extract: Variable,
  wait: Clock,
};

// The step body editor: the ui <Textarea> look, on a VariableTextarea (bare).
const STEP_BODY_CLASS =
  'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const STEP_COLORS: Record<string, string> = {
  request: 'text-blue-500 bg-blue-500/10',
  assertion: 'text-green-500 bg-green-500/10',
  extract: 'text-purple-500 bg-purple-500/10',
  wait: 'text-orange-500 bg-orange-500/10',
};

function describeAssertion(t: TFunction, a: AssertionItem): string {
  const V = a.value || '...';
  const P = a.path || '...';
  const K = a.key || '...';
  switch (a.type) {
    case 'status':
      return a.operator === 'equals'
        ? t('assertDesc.statusEq', { value: V })
        : t('assertDesc.statusNe', { value: V });
    case 'body_contains':
      if (a.operator === 'contains') return t('assertDesc.bodyContains', { value: V });
      if (a.operator === 'not_contains') return t('assertDesc.bodyNotContains', { value: V });
      return t('assertDesc.bodyMatches', { value: V });
    case 'json_path':
      if (a.operator === 'exists') return t('assertDesc.jsonExists', { path: P });
      if (a.operator === 'not_empty') return t('assertDesc.jsonNotEmpty', { path: P });
      return t('assertDesc.jsonOp', { path: P, operator: a.operator, value: V });
    case 'response_time':
      return a.operator === 'less_than'
        ? t('assertDesc.responseTimeLt', { value: V })
        : t('assertDesc.responseTimeGt', { value: V });
    case 'header':
      if (a.operator === 'exists') return t('assertDesc.headerExists', { key: K });
      return t('assertDesc.headerOp', { key: K, operator: a.operator, value: V });
  }
}

// ── Version History Section ──

function VersionHistorySection({
  testCaseId,
  onRestore,
}: {
  testCaseId: string;
  onRestore: () => void;
}) {
  const { t } = useTranslation('qa');
  const [versions, setVersions] = useState<TestCaseVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<TestCaseVersion | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const fetchVersions = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await testCaseVersionsAPI.list(testCaseId);
      setVersions(Array.isArray(response.data) ? response.data : []);
    } catch {
      // handle silently
    }
    setIsLoading(false);
  }, [testCaseId]);

  useEffect(() => {
    if (expanded && versions.length === 0) {
      fetchVersions();
    }
  }, [expanded, fetchVersions, versions.length]);

  const handleViewVersion = async (version: TestCaseVersion) => {
    try {
      const response = await testCaseVersionsAPI.get(testCaseId, version.id);
      setViewingVersion(response.data);
    } catch {
      setViewingVersion(version);
    }
  };

  const handleRestore = async (versionId: string) => {
    setIsRestoring(true);
    try {
      await testCaseVersionsAPI.restore(testCaseId, versionId);
      onRestore();
    } catch {
      // handle silently
    }
    setIsRestoring(false);
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-2 hover:bg-accent/50 transition-colors cursor-pointer"
      >
        <History className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{t('caseEditor.versionHistory')}</span>
        {versions.length > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1">
            {versions.length}
          </Badge>
        )}
        <span className="ml-auto">
          {expanded ? (
            <ChevronUp className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t px-2 py-2 bg-muted/30 animate-in fade-in-50 duration-200">
          {isLoading ? (
            <div className="flex items-center justify-center py-3">
              <div className="h-3 w-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : versions.length === 0 ? (
            <p className="text-[10px] text-muted-foreground text-center py-2">
              {t('caseEditor.noVersionHistory')}
            </p>
          ) : (
            <ScrollArea className={versions.length > 4 ? 'max-h-[180px]' : ''}>
              <div className="space-y-1">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center gap-2 p-1.5 rounded bg-background text-xs"
                  >
                    <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                      v{v.version}
                    </Badge>
                    <span className="flex-1 truncate text-muted-foreground">
                      {v.changeNote || v.title}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {new Date(v.createdAt).toLocaleDateString()}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0"
                      onClick={() => handleViewVersion(v)}
                    >
                      <Eye className="h-2.5 w-2.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0"
                      onClick={() => handleRestore(v.id)}
                      disabled={isRestoring}
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {viewingVersion && (
            <div className="mt-2 p-2 rounded border bg-background space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                  {t('caseEditor.versionDetails', { version: viewingVersion.version })}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => setViewingVersion(null)}
                >
                  <span className="text-xs">✕</span>
                </Button>
              </div>
              <div className="space-y-1 text-[10px]">
                <p><span className="font-medium">{t('caseEditor.vTitle')}</span> {viewingVersion.title}</p>
                <p><span className="font-medium">{t('caseEditor.vDescription')}</span> {viewingVersion.description || '-'}</p>
                <p><span className="font-medium">{t('caseEditor.vPriority')}</span> {viewingVersion.priority}</p>
                <p><span className="font-medium">{t('caseEditor.vTags')}</span> {viewingVersion.tags || '-'}</p>
                <p><span className="font-medium">{t('caseEditor.vChangedBy')}</span> {viewingVersion.changedBy || '-'}</p>
                <p><span className="font-medium">{t('caseEditor.vNote')}</span> {viewingVersion.changeNote || '-'}</p>
                {viewingVersion.steps && (
                  <div>
                    <span className="font-medium">{t('caseEditor.vSteps')}</span>
                    <pre className="mt-0.5 text-[9px] bg-muted p-1 rounded overflow-auto max-h-[80px] whitespace-pre-wrap">
                      {viewingVersion.steps}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Editor ──

interface TestCaseEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testCase: TestCase | null;
  onSaved: () => void;
  /** Folder a NEW case is filed in (null/undefined = root). Ignored on edit. */
  folderId?: string | null;
}

export function TestCaseEditor({
  open,
  onOpenChange,
  testCase,
  onSaved,
  folderId,
}: TestCaseEditorProps) {
  const { t } = useTranslation('qa');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('P2');
  const [status, setStatus] = useState('draft');
  const [type, setType] = useState('functional');
  const [tags, setTags] = useState('');
  const [steps, setSteps] = useState<TestStep[]>([]);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [headerExpanded, setHeaderExpanded] = useState<Set<number>>(new Set());
  const [bodyExpanded, setBodyExpanded] = useState<Set<number>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [execResult, setExecResult] = useState<TestExecutionResult | null>(null);
  const isLocal = useAuthStore((s) => s.mode === 'local');

  useEffect(() => {
    if (testCase) {
      setTitle(testCase.title);
      setDescription(testCase.description);
      setPriority(testCase.priority);
      setStatus(testCase.status || 'draft');
      setType(testCase.type);
      setTags(Array.isArray(testCase.tags) ? testCase.tags.join(', ') : '');
      const parsed = Array.isArray(testCase.steps) ? testCase.steps : [];
      setSteps(parsed.length > 0 ? parsed : []);
      setExpandedSteps(new Set(parsed.map((_, i) => i)));
    } else {
      setTitle('');
      setDescription('');
      setPriority('P2');
      setStatus('draft');
      setType('functional');
      setTags('');
      setSteps([]);
      setExpandedSteps(new Set());
    }
    setHeaderExpanded(new Set());
    setBodyExpanded(new Set());
    setExecResult(null);
  }, [testCase, open]);

  // ── Step management ──

  const addStep = (stepType: TestStep['type']) => {
    const newStep: TestStep = {
      stepNo: steps.length + 1,
      type: stepType,
      action: '',
      expected: '',
    };
    if (stepType === 'request') {
      newStep.request = { method: 'GET', url: '' };
    } else if (stepType === 'assertion') {
      newStep.assertions = [{ type: 'status', operator: 'equals', value: '200' }];
    } else if (stepType === 'extract') {
      newStep.extractions = [{ variable: '', source: 'json_path', path: '' }];
    } else if (stepType === 'wait') {
      newStep.waitMs = 1000;
    }
    setSteps((prev) => [...prev, newStep]);
    setExpandedSteps((prev) => new Set([...prev, steps.length]));
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepNo: i + 1 })));
    setExpandedSteps((prev) => {
      const next = new Set<number>();
      prev.forEach((v) => {
        if (v < index) next.add(v);
        else if (v > index) next.add(v - 1);
      });
      return next;
    });
  };

  const toggleExpand = (index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const updateStepRequest = (index: number, field: string, value: string) => {
    setSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], request: { ...next[index].request!, [field]: value } };
      return next;
    });
  };

  const updateStepRequestHeader = (index: number, headers: Record<string, string>) => {
    setSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], request: { ...next[index].request!, headers } };
      return next;
    });
  };

  const updateAssertion = (stepIndex: number, assertionIndex: number, updates: Partial<AssertionItem>) => {
    setSteps((prev) => {
      const next = [...prev];
      const step = { ...next[stepIndex] };
      const assertions = [...(step.assertions || [])];
      assertions[assertionIndex] = { ...assertions[assertionIndex], ...updates } as AssertionItem;
      step.assertions = assertions;
      next[stepIndex] = step;
      return next;
    });
  };

  const addAssertion = (stepIndex: number) => {
    setSteps((prev) => {
      const next = [...prev];
      const step = { ...next[stepIndex] };
      step.assertions = [...(step.assertions || []), { type: 'status' as AssertionType, operator: 'equals' as AssertionOperator, value: '200' }];
      next[stepIndex] = step;
      return next;
    });
  };

  const removeAssertion = (stepIndex: number, assertionIndex: number) => {
    setSteps((prev) => {
      const next = [...prev];
      const step = { ...next[stepIndex] };
      step.assertions = (step.assertions || []).filter((_, i) => i !== assertionIndex);
      if (step.assertions.length === 0) {
        step.assertions = [{ type: 'status', operator: 'equals', value: '200' }];
      }
      next[stepIndex] = step;
      return next;
    });
  };

  const updateExtraction = (stepIndex: number, extractionIndex: number, updates: Partial<ExtractionItem>) => {
    setSteps((prev) => {
      const next = [...prev];
      const step = { ...next[stepIndex] };
      const extractions = [...(step.extractions || [])];
      extractions[extractionIndex] = { ...extractions[extractionIndex], ...updates } as ExtractionItem;
      step.extractions = extractions;
      next[stepIndex] = step;
      return next;
    });
  };

  const updateStepWait = (index: number, waitMs: number) => {
    setSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], waitMs };
      return next;
    });
  };

  // ── cURL paste handler ──

  const handleUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
    const pastedText = e.clipboardData.getData('text');
    const parsed = parseCurlAsRecord(pastedText);
    if (parsed) {
      e.preventDefault();
      setSteps((prev) => {
        const next = [...prev];
        next[index] = {
          ...next[index],
          action: t('step.curlAction', { method: parsed.method }),
          request: {
            method: parsed.method,
            url: parsed.url,
            headers: Object.keys(parsed.headers).length > 0 ? parsed.headers : next[index].request?.headers,
            body: parsed.body || next[index].request?.body,
          },
        };
        return next;
      });
      if (Object.keys(parsed.headers).length > 0) {
        setHeaderExpanded((prev) => new Set(prev).add(index));
      }
      if (parsed.body) {
        setBodyExpanded((prev) => new Set(prev).add(index));
      }
    }
  };

  // ── Save ──

  const handleSave = async () => {
    if (!title.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const data = {
        title: title.trim(),
        description: description.trim(),
        priority,
        type,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        steps,
        status,
      };

      if (testCase) {
        await testCasesAPI.update(testCase.id, data);
      } else {
        await testCasesAPI.create(folderId ? { ...data, folderId } : data);
      }

      onSaved();
      onOpenChange(false);
    } catch {
      // error handled silently
    } finally {
      setIsSaving(false);
    }
  };

  // ── Execute ──

  const handleExecute = async () => {
    if (!testCase || isRunning) return;

    // Save first if there are unsaved changes, then execute
    if (title.trim()) {
      setIsSaving(true);
      try {
        await testCasesAPI.update(testCase.id, {
          title: title.trim(),
          description: description.trim(),
          priority,
          type,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          steps,
          status: testCase.status || 'draft',
        });
        onSaved();
      } catch {
        setIsSaving(false);
        return;
      }
      setIsSaving(false);
    }

    setIsRunning(true);
    setExecResult(null);
    try {
      const res = await testCasesAPI.execute(testCase.id, activeRunEnv());
      setExecResult(res.data);
    } catch (err) {
      setExecResult(runErrorResult(err));
    }
    setIsRunning(false);
  };

  const handleVersionRestore = () => {
    onSaved();
    onOpenChange(false);
  };

  // ── Step renderers ──

  const renderRequestEditor = (step: TestStep, index: number) => {
    const headers = step.request?.headers || {};
    const headerEntries = Object.entries(headers);
    const isHeaderExpanded = headerExpanded.has(index);
    const isBodyExpanded = bodyExpanded.has(index);

    return (
      <div className="space-y-2">
        <p className="text-[10px] text-muted-foreground italic">{t('step.curlHint')}</p>
        <div className="flex gap-1.5">
          <Select
            value={step.request?.method || 'GET'}
            onValueChange={(v) => updateStepRequest(index, 'method', v)}
          >
            <SelectTrigger className="h-8 text-xs w-[72px] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((m) => (
                <SelectItem key={m} value={m} className="text-sm">
                  <span className={`font-mono font-bold ${METHOD_COLORS[m] || ''}`}>{m}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <VariableInput
            value={step.request?.url || ''}
            onChange={(e) => updateStepRequest(index, 'url', e.target.value)}
            onPaste={(e) => handleUrlPaste(e, index)}
            placeholder={t('step.urlPlaceholder', { baseUrl: '{{base_url}}' })}
            wrapperClassName="flex-1 min-w-0"
            className="h-8 text-xs font-mono"
          />
        </div>

        {/* Headers */}
        <button
          onClick={() => setHeaderExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index); else next.add(index);
            return next;
          })}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {isHeaderExpanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
          {t('step.headers')} {headerEntries.length > 0 && `(${headerEntries.length})`}
        </button>
        {isHeaderExpanded && (
          <div className="space-y-1 pl-2 border-l-2 border-muted">
            {headerEntries.map(([key, value], i) => (
              <div key={i} className="flex gap-1 items-center">
                <VariableInput
                  value={key}
                  onChange={(e) => {
                    const newHeaders = { ...headers };
                    delete newHeaders[key];
                    newHeaders[e.target.value] = value;
                    updateStepRequestHeader(index, newHeaders);
                  }}
                  placeholder={t('step.keyPlaceholder')}
                  wrapperClassName="flex-1 min-w-0"
                  className="h-7 text-[10px] font-mono"
                />
                <VariableInput
                  value={value}
                  onChange={(e) => updateStepRequestHeader(index, { ...headers, [key]: e.target.value })}
                  placeholder={t('step.valuePlaceholder')}
                  wrapperClassName="flex-1 min-w-0"
                  className="h-7 text-[10px] font-mono"
                />
                <button onClick={() => {
                  const newHeaders = { ...headers };
                  delete newHeaders[key];
                  updateStepRequestHeader(index, newHeaders);
                }} className="p-0.5 shrink-0">
                  <Trash2 className="h-2.5 w-2.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="h-5 text-[10px] px-2"
              onClick={() => updateStepRequestHeader(index, { ...headers, '': '' })}>
              <Plus className="h-2.5 w-2.5 mr-0.5" /> {t('step.addHeader')}
            </Button>
          </div>
        )}

        {/* Body */}
        <button
          onClick={() => setBodyExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index); else next.add(index);
            return next;
          })}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {isBodyExpanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
          {t('step.body')} {step.request?.body ? t('step.bodySet') : t('step.bodyOptional')}
        </button>
        {isBodyExpanded && (
          <VariableTextarea
            value={step.request?.body || ''}
            onChange={(e) => updateStepRequest(index, 'body', e.target.value)}
            placeholder='{"key": "value"}'
            rows={3}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className={STEP_BODY_CLASS}
          />
        )}
      </div>
    );
  };

  const renderAssertionEditor = (step: TestStep, index: number) => {
    const assertions = step.assertions || [];

    return (
      <div className="space-y-2">
        {assertions.map((assertion, aIdx) => {
          const availableOps = OPERATORS_BY_TYPE[assertion.type] || [];
          const needsValue = !['exists', 'not_empty'].includes(assertion.operator);
          const needsPath = assertion.type === 'json_path';
          const needsKey = assertion.type === 'header';

          return (
            <div key={aIdx} className="space-y-1.5 p-2 rounded-md bg-green-500/5 border border-green-500/10">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground shrink-0 w-14">{t('step.checkThat')}</span>
                <Select
                  value={assertion.type}
                  onValueChange={(v) => {
                    const newType = v as AssertionType;
                    const ops = OPERATORS_BY_TYPE[newType];
                    updateAssertion(index, aIdx, {
                      type: newType,
                      operator: ops[0] || 'equals',
                      value: newType === 'status' ? '200' : newType === 'response_time' ? '500' : '',
                      path: newType === 'json_path' ? '$.data' : undefined,
                      key: newType === 'header' ? '' : undefined,
                    });
                  }}
                >
                  <SelectTrigger className="h-7 text-[10px] flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSERTION_TYPES.map((k) => (
                      <SelectItem key={k} value={k} className="text-sm">{t(`assertType.${k}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {assertions.length > 1 && (
                  <button onClick={() => removeAssertion(index, aIdx)} className="p-0.5 shrink-0">
                    <Trash2 className="h-2.5 w-2.5 text-muted-foreground hover:text-destructive" />
                  </button>
                )}
              </div>

              {needsPath && (
                <VariableInput value={assertion.path || ''} onChange={(e) => updateAssertion(index, aIdx, { path: e.target.value })}
                  placeholder={t('step.jsonPathPlaceholder')} className="h-7 text-[10px] font-mono" />
              )}
              {needsKey && (
                <VariableInput value={assertion.key || ''} onChange={(e) => updateAssertion(index, aIdx, { key: e.target.value })}
                  placeholder={t('step.contentTypePlaceholder')} className="h-7 text-[10px] font-mono" />
              )}

              <div className="flex gap-1.5">
                <Select value={assertion.operator} onValueChange={(v) => updateAssertion(index, aIdx, { operator: v as AssertionOperator })}>
                  <SelectTrigger className="h-7 text-[10px] w-[100px] shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableOps.map((op) => (
                      <SelectItem key={op} value={op} className="text-sm">{t(`assertOp.${op}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {needsValue && (
                  <VariableInput value={assertion.value || ''} onChange={(e) => updateAssertion(index, aIdx, { value: e.target.value })}
                    placeholder={assertion.type === 'status' ? '200' : assertion.type === 'response_time' ? '500' : t('step.expectedValuePlaceholder')}
                    wrapperClassName="flex-1 min-w-0"
                    className="h-7 text-[10px] font-mono" />
                )}
              </div>

              <p className="text-[10px] text-green-700 dark:text-green-400 flex items-center gap-1">
                <Check className="h-2.5 w-2.5 shrink-0" />
                {describeAssertion(t, assertion)}
              </p>
            </div>
          );
        })}

        <Button variant="ghost" size="sm"
          className="h-7 text-[10px] text-green-600 dark:text-green-400 hover:bg-green-500/10 w-full"
          onClick={() => addAssertion(index)}>
          <Plus className="h-2.5 w-2.5 mr-1" /> {t('step.addCheck')}
        </Button>
      </div>
    );
  };

  const renderExtractionEditor = (step: TestStep, index: number) => {
    const extraction = step.extractions?.[0] || { variable: '', source: 'json_path' as const, path: '' };

    return (
      <div className="space-y-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{t('step.variableName')}</Label>
          <Input value={extraction.variable} onChange={(e) => updateExtraction(index, 0, { variable: e.target.value })}
            placeholder={t('step.variableNamePlaceholder')} className="h-7 text-[10px] font-mono" />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{t('step.source')}</Label>
          <Select value={extraction.source} onValueChange={(v) => updateExtraction(index, 0, { source: v as ExtractionItem['source'] })}>
            <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="json_path" className="text-sm">{t('extractSource.json_path')}</SelectItem>
              <SelectItem value="header" className="text-sm">{t('extractSource.header')}</SelectItem>
              <SelectItem value="body" className="text-sm">{t('extractSource.body')}</SelectItem>
              <SelectItem value="status" className="text-sm">{t('extractSource.status')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {extraction.source === 'json_path' && (
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">{t('step.jsonPath')}</Label>
            <VariableInput value={extraction.path || ''} onChange={(e) => updateExtraction(index, 0, { path: e.target.value })}
              placeholder={t('step.jsonPathValuePlaceholder')} className="h-7 text-[10px] font-mono" />
          </div>
        )}
        {extraction.source === 'header' && (
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">{t('step.headerKey')}</Label>
            <VariableInput value={extraction.key || ''} onChange={(e) => updateExtraction(index, 0, { key: e.target.value })}
              placeholder={t('step.authorizationPlaceholder')} className="h-7 text-[10px] font-mono" />
          </div>
        )}
        {extraction.variable && (
          <div className="flex items-start gap-1.5 p-1.5 rounded bg-purple-500/5 border border-purple-500/10">
            <Info className="h-2.5 w-2.5 text-purple-500 shrink-0 mt-0.5" />
            <p className="text-[9px] text-purple-700 dark:text-purple-400 leading-relaxed">
              <Trans
                t={t}
                i18nKey="step.extractHint"
                values={{ token: `{{${extraction.variable}}}` }}
                components={{ c: <code className="px-0.5 bg-purple-500/10 rounded" /> }}
              />
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderWaitEditor = (step: TestStep, index: number) => (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Input type="number" value={step.waitMs || 1000} onChange={(e) => updateStepWait(index, parseInt(e.target.value) || 0)}
          className="h-7 text-[10px] w-20 font-mono" min={0} step={100} />
        <span className="text-[10px] text-muted-foreground">{t('step.waitMs', { seconds: ((step.waitMs || 1000) / 1000).toFixed(1) })}</span>
      </div>
    </div>
  );

  // ── Execution result display ──

  const renderExecResult = () => {
    if (!execResult) return null;

    const statusIcon = execResult.status === 'passed'
      ? <CheckCircle2 className="h-4 w-4 text-green-500" />
      : execResult.status === 'failed'
        ? <XCircle className="h-4 w-4 text-red-500" />
        : <AlertTriangle className="h-4 w-4 text-orange-500" />;

    const statusBg = execResult.status === 'passed'
      ? 'border-green-500/30 bg-green-500/5'
      : execResult.status === 'failed'
        ? 'border-red-500/30 bg-red-500/5'
        : 'border-orange-500/30 bg-orange-500/5';

    return (
      <div className={`rounded-lg border-2 ${statusBg} overflow-hidden`}>
        {/* Header */}
        <div className="flex items-center gap-3 p-3 border-b border-inherit">
          {statusIcon}
          <div className="flex-1">
            <div className="text-sm font-semibold">
              {execResult.status === 'passed' ? t('caseEditor.testPassed') : execResult.status === 'failed' ? t('caseEditor.testFailed') : t('caseEditor.testError')}
            </div>
            <div className="text-xs text-muted-foreground">
              {t('caseEditor.stepsSummary', { passed: execResult.summary.passed, total: execResult.summary.total })}
              {execResult.summary.failed > 0 && t('caseEditor.failedPart', { count: execResult.summary.failed })}
              {execResult.summary.skipped > 0 && t('caseEditor.skippedPart', { count: execResult.summary.skipped })}
              {execResult.duration > 0 && t('caseEditor.durationPart', { duration: execResult.duration })}
            </div>
          </div>
          <button onClick={() => setExecResult(null)}
            className="text-xs text-muted-foreground hover:text-foreground p-1">✕</button>
        </div>

        {/* Step results */}
        {execResult.steps.length > 0 && (
          <div className="divide-y divide-border/50">
            {execResult.steps.map((s, i) => {
              const stepPassed = s.status === 'passed';
              const stepFailed = s.status === 'failed';

              return (
                <div key={i} className="p-2.5 space-y-1.5">
                  {/* Step header row */}
                  <div className="flex items-center gap-2">
                    {stepPassed ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      : stepFailed ? <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                        : <div className="h-3.5 w-3.5 rounded-full bg-muted-foreground/20 shrink-0" />}
                    <span className="text-xs font-semibold">{t('caseList.step', { n: s.stepNo })}</span>
                    <Badge variant="outline" className="text-[10px] px-1 py-0">{t(`stepType.${s.type}`, { defaultValue: s.type })}</Badge>
                    {s.request && (
                      <span className="text-[10px] font-mono text-muted-foreground truncate">
                        {s.request.method} {s.request.url}
                      </span>
                    )}
                    {s.duration > 0 && (
                      <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{s.duration}ms</span>
                    )}
                  </div>

                  {/* Response info */}
                  {s.response && (
                    <div className="ml-5.5 flex items-center gap-2">
                      <Badge
                        variant={s.response.statusCode >= 200 && s.response.statusCode < 300 ? 'success'
                          : s.response.statusCode >= 400 ? 'destructive' : 'warning'}
                        className="text-[10px] px-1.5 py-0"
                      >
                        {s.response.statusCode}
                      </Badge>
                      {s.response.body && (
                        <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[300px]">
                          {s.response.body.substring(0, 80)}{s.response.body.length > 80 ? '...' : ''}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Assertion results */}
                  {s.assertions && s.assertions.length > 0 && (
                    <div className="ml-5.5 space-y-0.5">
                      {s.assertions.map((a, aIdx) => (
                        <div key={aIdx} className={`flex items-start gap-1.5 text-[10px] p-1 rounded ${
                          a.passed ? 'bg-green-500/10' : 'bg-red-500/10'
                        }`}>
                          {a.passed
                            ? <Check className="h-2.5 w-2.5 text-green-500 shrink-0 mt-0.5" />
                            : <XCircle className="h-2.5 w-2.5 text-red-500 shrink-0 mt-0.5" />}
                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{a.type}</span>
                            {!a.passed && (
                              <div className="text-red-600 dark:text-red-400">
                                <Trans
                                  t={t}
                                  i18nKey="caseEditor.expectedGot"
                                  values={{ expected: a.expected, actual: a.actual }}
                                  components={{ m: <span className="font-mono" /> }}
                                />
                              </div>
                            )}
                            {a.passed && a.actual && (
                              <span className="text-muted-foreground ml-1 font-mono">{a.actual}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Extractions */}
                  {s.extractions && s.extractions.length > 0 && (
                    <div className="ml-5.5 space-y-0.5">
                      {s.extractions.map((ex, exIdx) => (
                        <div key={exIdx} className="flex items-center gap-1.5 text-[10px] p-1 rounded bg-purple-500/10">
                          <Variable className="h-2.5 w-2.5 text-purple-500 shrink-0" />
                          <code className="text-purple-600 dark:text-purple-400">{`{{${ex.variable}}}`}</code>
                          <span className="text-muted-foreground">=</span>
                          <span className="font-mono text-muted-foreground truncate">{ex.value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Error */}
                  {s.error && (
                    <div className="ml-5.5 text-[10px] text-red-600 dark:text-red-400 bg-red-500/10 p-1.5 rounded font-mono">
                      {s.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl !grid-rows-[auto_1fr_auto] max-h-[85vh] overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{testCase ? t('caseEditor.editTitle') : t('caseEditor.newTitle')}</DialogTitle>
          <DialogDescription>
            {t('caseEditor.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="overflow-auto pr-2 -mr-2">
          <div className="grid gap-3 py-2">
            {/* Meta fields */}
            <div className="grid gap-2">
              <Label className="text-xs">{t('caseEditor.titleLabel')}</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder={t('caseEditor.titlePlaceholder')} className="h-8 text-sm" />
            </div>

            <div className="grid gap-2">
              <Label className="text-xs">{t('caseEditor.descriptionLabel')}</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder={t('caseEditor.descriptionPlaceholder')} rows={2} className="text-sm" />
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">{t('caseEditor.priorityLabel')}</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="P0">{t('priorityLong.P0')}</SelectItem>
                    <SelectItem value="P1">{t('priorityLong.P1')}</SelectItem>
                    <SelectItem value="P2">{t('priorityLong.P2')}</SelectItem>
                    <SelectItem value="P3">{t('priorityLong.P3')}</SelectItem>
                    <SelectItem value="P4">{t('priorityLong.P4')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">{t('common:type')}</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="functional">{t('caseType.functional')}</SelectItem>
                    <SelectItem value="integration">{t('caseType.integration')}</SelectItem>
                    <SelectItem value="performance">{t('caseType.performance')}</SelectItem>
                    <SelectItem value="security">{t('caseType.security')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">{t('common:status')}</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">{t('caseStatus.draft')}</SelectItem>
                    <SelectItem value="active">{t('caseStatus.active')}</SelectItem>
                    <SelectItem value="deprecated">{t('caseStatus.deprecated')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">{t('caseEditor.tagsLabel')}</Label>
                <Input value={tags} onChange={(e) => setTags(e.target.value)}
                  placeholder={t('caseEditor.tagsPlaceholder')} className="h-7 text-[10px]" />
              </div>
            </div>

            {/* Execution result */}
            {renderExecResult()}

            {/* Steps */}
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-2">
                {t('caseEditor.stepsLabel')}
                <Badge variant="secondary" className="text-[10px] px-1 py-0">{steps.length}</Badge>
              </Label>

              {steps.length === 0 && (
                <div className="text-center py-4 border border-dashed rounded-lg">
                  <p className="text-xs text-muted-foreground mb-2">{t('caseEditor.noSteps')}</p>
                </div>
              )}

              {steps.map((step, index) => {
                const Icon = STEP_ICONS[step.type] || Send;
                const color = STEP_COLORS[step.type] || '';
                const label = t(`stepKind.${step.type}`, { defaultValue: step.type });
                const isExpanded = expandedSteps.has(index);

                // Step summary for collapsed view
                let summary = '';
                if (step.type === 'request' && step.request?.url) {
                  summary = `${step.request.method} ${step.request.url.substring(0, 50)}`;
                } else if (step.type === 'assertion' && step.assertions?.length) {
                  summary = step.assertions.length === 1
                    ? t('step.checkCountOne', { count: step.assertions.length })
                    : t('step.checkCountOther', { count: step.assertions.length });
                } else if (step.type === 'extract' && step.extractions?.[0]?.variable) {
                  summary = `{{${step.extractions[0].variable}}}`;
                } else if (step.type === 'wait') {
                  summary = `${step.waitMs || 1000}ms`;
                }

                return (
                  <div key={index} className="border rounded-lg overflow-hidden">
                    <div
                      className="flex items-center gap-2 p-2 hover:bg-accent/30 transition-colors cursor-pointer"
                      onClick={() => toggleExpand(index)}
                    >
                      <span className={`flex items-center justify-center h-5 w-5 rounded ${color}`}>
                        <Icon className="h-3 w-3" />
                      </span>
                      <span className="text-[10px] font-bold text-muted-foreground">#{step.stepNo}</span>
                      <span className="text-xs font-medium">{label}</span>
                      {summary && (
                        <span className="text-[10px] text-muted-foreground truncate flex-1 font-mono">
                          {summary}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeStep(index); }}
                        className="p-0.5 shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                      {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" />
                        : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
                    </div>

                    {isExpanded && (
                      <RuntimeVarsProvider names={runtimeVarsBefore(steps, index)}>
                        <div className="border-t p-2.5 bg-muted/20">
                          {step.type === 'request' && renderRequestEditor(step, index)}
                          {step.type === 'assertion' && renderAssertionEditor(step, index)}
                          {step.type === 'extract' && renderExtractionEditor(step, index)}
                          {step.type === 'wait' && renderWaitEditor(step, index)}
                        </div>
                      </RuntimeVarsProvider>
                    )}
                  </div>
                );
              })}

              {/* Add step buttons */}
              <div className="grid grid-cols-4 gap-1.5">
                {([
                  { type: 'request' as const, icon: Send, labelKey: 'addStepBtn.request', color: 'text-blue-500 hover:bg-blue-500/10' },
                  { type: 'assertion' as const, icon: ShieldCheck, labelKey: 'addStepBtn.assertion', color: 'text-green-500 hover:bg-green-500/10' },
                  { type: 'extract' as const, icon: Variable, labelKey: 'addStepBtn.extract', color: 'text-purple-500 hover:bg-purple-500/10' },
                  { type: 'wait' as const, icon: Clock, labelKey: 'addStepBtn.wait', color: 'text-orange-500 hover:bg-orange-500/10' },
                ]).map((item) => (
                  <Button
                    key={item.type}
                    variant="outline"
                    size="sm"
                    className={`h-7 text-[10px] ${item.color}`}
                    onClick={() => addStep(item.type)}
                  >
                    <item.icon className="h-3 w-3 mr-1" />
                    {t(item.labelKey)}
                  </Button>
                ))}
              </div>
            </div>

            {/* Version History */}
            {testCase && (
              <VersionHistorySection testCaseId={testCase.id} onRestore={handleVersionRestore} />
            )}

            {/* Comments */}
            {testCase && !isLocal && (
              <div className="border rounded-lg p-2.5">
                <CommentSection targetType="test_case" targetId={testCase.id} />
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="flex items-center sm:justify-between pt-2 border-t">
          {testCase ? (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={async () => {
                if (!(await confirmDialog({ title: t('caseEditor.deleteConfirm'), destructive: true }))) return;
                try {
                  await testCasesAPI.delete(testCase.id);
                  onSaved();
                  onOpenChange(false);
                } catch {
                  // error handled silently
                }
              }}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              {t('common:delete')}
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onOpenChange(false)}>
              {t('common:cancel')}
            </Button>
            {testCase && steps.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-green-500/30 text-green-600 dark:text-green-400 hover:bg-green-500/10"
                onClick={handleExecute}
                disabled={isRunning}
              >
                <Play className="h-3 w-3 mr-1" />
                {isRunning ? t('caseEditor.running') : t('caseEditor.run')}
              </Button>
            )}
            <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={isSaving || !title.trim()}>
              {isSaving ? t('caseEditor.saving') : testCase ? t('caseEditor.update') : t('caseEditor.create')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
