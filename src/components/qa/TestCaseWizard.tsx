import { useState, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Globe,
  Lock,
  Database,
  Timer,
  AlertTriangle,
  Puzzle,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Check,
  Lightbulb,
  Send,
  ShieldCheck,
  Variable,
  Clock,
  ChevronDown,
  ChevronUp,
  Zap,
  Play,
  Info,
  GripVertical,
} from 'lucide-react';
import { testCasesAPI } from '@/services/api';
import { VariableInput, VariableTextarea, RuntimeVarsProvider } from '@/components/environment/VariableInput';
import { activeRunEnv, runtimeVarsBefore } from './stepVars';
import { parseCurlAsRecord } from '@/lib/parseCurl';
import type { TestStep } from '@/types';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Wrapper that gives a wizard step row dnd-kit sortable behavior.
// Separate component so we can call useSortable (hooks can't run inside a .map callback).
function SortableStepItem({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: (listeners: React.HTMLAttributes<HTMLElement>, isDragging: boolean) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className={className} {...attributes}>
      {children({ ...(listeners as React.HTMLAttributes<HTMLElement>) }, isDragging)}
    </div>
  );
}

// ── Assertion & Extraction type helpers ──

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

// ── Template definitions ──

interface TemplateDefinition {
  id: string;
  icon: React.ElementType;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  defaultPriority: string;
  defaultType: string;
  defaultTags: string[];
  steps: TestStep[];
}

const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'api-endpoint',
    icon: Globe,
    difficulty: 'Beginner',
    defaultPriority: 'P2',
    defaultType: 'functional',
    defaultTags: ['api', 'endpoint'],
    steps: [
      {
        stepNo: 1, type: 'request', action: 'Send GET request', expected: 'Response received',
        request: { method: 'GET', url: '{{base_url}}/api/endpoint' },
      },
      {
        stepNo: 2, type: 'assertion', action: 'Check status code', expected: 'Status code is 200',
        assertions: [{ type: 'status', operator: 'equals', value: '200' }],
      },
      {
        stepNo: 3, type: 'assertion', action: 'Check response time', expected: 'Response time under 1000ms',
        assertions: [{ type: 'response_time', operator: 'less_than', value: '1000' }],
      },
      {
        stepNo: 4, type: 'assertion', action: 'Check response body', expected: 'Body contains expected data',
        assertions: [{ type: 'body_contains', operator: 'contains', value: 'data' }],
      },
    ],
  },
  {
    id: 'auth-flow',
    icon: Lock,
    difficulty: 'Intermediate',
    defaultPriority: 'P0',
    defaultType: 'security',
    defaultTags: ['auth', 'security', 'login'],
    steps: [
      {
        stepNo: 1, type: 'request', action: 'Login with valid credentials', expected: 'Token received',
        request: { method: 'POST', url: '{{base_url}}/auth/login', body: '{"email": "test@example.com", "password": "password123"}' },
      },
      {
        stepNo: 2, type: 'assertion', action: 'Verify login success', expected: 'Status 200',
        assertions: [{ type: 'status', operator: 'equals', value: '200' }],
      },
      {
        stepNo: 3, type: 'extract', action: 'Save access token', expected: 'Token saved',
        extractions: [{ variable: 'access_token', source: 'json_path', path: '$.token' }],
      },
      {
        stepNo: 4, type: 'request', action: 'Access protected endpoint', expected: 'Data received',
        request: { method: 'GET', url: '{{base_url}}/auth/me', headers: { 'Authorization': 'Bearer {{access_token}}' } },
      },
      {
        stepNo: 5, type: 'assertion', action: 'Verify protected access', expected: 'Status 200',
        assertions: [{ type: 'status', operator: 'equals', value: '200' }],
      },
      {
        stepNo: 6, type: 'request', action: 'Access without token', expected: '401 returned',
        request: { method: 'GET', url: '{{base_url}}/auth/me' },
      },
      {
        stepNo: 7, type: 'assertion', action: 'Verify unauthorized', expected: 'Status 401',
        assertions: [{ type: 'status', operator: 'equals', value: '401' }],
      },
    ],
  },
  {
    id: 'crud',
    icon: Database,
    difficulty: 'Intermediate',
    defaultPriority: 'P1',
    defaultType: 'functional',
    defaultTags: ['crud', 'api'],
    steps: [
      {
        stepNo: 1, type: 'request', action: 'Create resource', expected: 'Resource created',
        request: { method: 'POST', url: '{{base_url}}/api/resource', body: '{"name": "Test Item"}' },
      },
      {
        stepNo: 2, type: 'assertion', action: 'Verify creation', expected: 'Status 201',
        assertions: [{ type: 'status', operator: 'equals', value: '201' }],
      },
      {
        stepNo: 3, type: 'extract', action: 'Save resource ID', expected: 'ID saved',
        extractions: [{ variable: 'item_id', source: 'json_path', path: '$.data.id' }],
      },
      {
        stepNo: 4, type: 'request', action: 'Read resource', expected: 'Resource retrieved',
        request: { method: 'GET', url: '{{base_url}}/api/resource/{{item_id}}' },
      },
      {
        stepNo: 5, type: 'assertion', action: 'Verify read', expected: 'Status 200 and data matches',
        assertions: [
          { type: 'status', operator: 'equals', value: '200' },
          { type: 'json_path', operator: 'equals', path: '$.data.name', value: 'Test Item' },
        ],
      },
      {
        stepNo: 6, type: 'request', action: 'Update resource', expected: 'Resource updated',
        request: { method: 'PUT', url: '{{base_url}}/api/resource/{{item_id}}', body: '{"name": "Updated"}' },
      },
      {
        stepNo: 7, type: 'assertion', action: 'Verify update', expected: 'Status 200',
        assertions: [{ type: 'status', operator: 'equals', value: '200' }],
      },
      {
        stepNo: 8, type: 'request', action: 'Delete resource', expected: 'Resource deleted',
        request: { method: 'DELETE', url: '{{base_url}}/api/resource/{{item_id}}' },
      },
      {
        stepNo: 9, type: 'assertion', action: 'Verify deletion', expected: 'Status 200 or 204',
        assertions: [{ type: 'status', operator: 'equals', value: '200' }],
      },
    ],
  },
  {
    id: 'performance',
    icon: Timer,
    difficulty: 'Beginner',
    defaultPriority: 'P2',
    defaultType: 'performance',
    defaultTags: ['performance', 'sla'],
    steps: [
      {
        stepNo: 1, type: 'request', action: 'Send request to endpoint', expected: 'Response received',
        request: { method: 'GET', url: '{{base_url}}/api/endpoint' },
      },
      {
        stepNo: 2, type: 'assertion', action: 'Check response time SLA', expected: 'Under 500ms',
        assertions: [
          { type: 'response_time', operator: 'less_than', value: '500' },
          { type: 'status', operator: 'equals', value: '200' },
        ],
      },
      {
        stepNo: 3, type: 'assertion', action: 'Check caching headers', expected: 'Cache headers present',
        assertions: [{ type: 'header', operator: 'exists', key: 'Cache-Control' }],
      },
    ],
  },
  {
    id: 'error-scenarios',
    icon: AlertTriangle,
    difficulty: 'Intermediate',
    defaultPriority: 'P1',
    defaultType: 'functional',
    defaultTags: ['error', 'negative-testing'],
    steps: [
      {
        stepNo: 1, type: 'request', action: 'Send request with invalid body', expected: '400 returned',
        request: { method: 'POST', url: '{{base_url}}/api/resource', body: 'invalid json' },
      },
      {
        stepNo: 2, type: 'assertion', action: 'Verify bad request', expected: 'Status 400',
        assertions: [{ type: 'status', operator: 'equals', value: '400' }],
      },
      {
        stepNo: 3, type: 'request', action: 'Request non-existent resource', expected: '404 returned',
        request: { method: 'GET', url: '{{base_url}}/api/resource/nonexistent-id' },
      },
      {
        stepNo: 4, type: 'assertion', action: 'Verify not found', expected: 'Status 404',
        assertions: [{ type: 'status', operator: 'equals', value: '404' }],
      },
      {
        stepNo: 5, type: 'assertion', action: 'Verify error format', expected: 'Error message present',
        assertions: [{ type: 'json_path', operator: 'not_empty', path: '$.error' }],
      },
    ],
  },
  {
    id: 'custom',
    icon: Puzzle,
    difficulty: 'Advanced',
    defaultPriority: 'P2',
    defaultType: 'functional',
    defaultTags: [],
    steps: [],
  },
];

// ── Priority & Type constants ──

const PRIORITIES = [
  { value: 'P0', color: 'bg-red-500' },
  { value: 'P1', color: 'bg-orange-500' },
  { value: 'P2', color: 'bg-yellow-500' },
  { value: 'P3', color: 'bg-blue-500' },
  { value: 'P4', color: 'bg-gray-400' },
];

const TYPES = ['functional', 'integration', 'performance', 'security'];

const DIFFICULTY_COLORS: Record<string, string> = {
  Beginner: 'bg-green-500/15 text-green-700 dark:text-green-400',
  Intermediate: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  Advanced: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

const ASSERTION_TYPES: AssertionType[] = ['status', 'body_contains', 'json_path', 'response_time', 'header'];

const OPERATORS_BY_TYPE: Record<AssertionType, AssertionOperator[]> = {
  status: ['equals', 'not_equals'],
  body_contains: ['contains', 'not_contains', 'matches'],
  json_path: ['equals', 'not_equals', 'exists', 'not_empty', 'contains', 'greater_than', 'less_than'],
  response_time: ['less_than', 'greater_than'],
  header: ['equals', 'contains', 'exists'],
};

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-500/15 text-green-700 dark:text-green-400',
  POST: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  PUT: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  PATCH: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  DELETE: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

// ── Human-readable assertion description ──

function describeAssertion(t: TFunction, a: AssertionItem): string {
  const V = a.value || '...';
  const Vraw = a.value || '';
  const P = a.path || '...';
  const K = a.key || '...';
  switch (a.type) {
    case 'status':
      if (a.operator === 'equals') return t('wizard.assertDesc.statusEq', { value: V });
      if (a.operator === 'not_equals') return t('wizard.assertDesc.statusNe', { value: V });
      return t('wizard.assertDesc.statusFallback', { operator: a.operator, value: Vraw });
    case 'body_contains':
      if (a.operator === 'contains') return t('wizard.assertDesc.bodyContains', { value: V });
      if (a.operator === 'not_contains') return t('wizard.assertDesc.bodyNotContains', { value: V });
      if (a.operator === 'matches') return t('wizard.assertDesc.bodyMatches', { value: V });
      return t('wizard.assertDesc.bodyFallback', { operator: a.operator, value: Vraw });
    case 'json_path':
      if (a.operator === 'exists') return t('wizard.assertDesc.jsonExists', { path: P });
      if (a.operator === 'not_empty') return t('wizard.assertDesc.jsonNotEmpty', { path: P });
      if (a.operator === 'equals') return t('wizard.assertDesc.jsonEquals', { path: P, value: V });
      if (a.operator === 'greater_than') return t('wizard.assertDesc.jsonGt', { path: P, value: V });
      if (a.operator === 'less_than') return t('wizard.assertDesc.jsonLt', { path: P, value: V });
      return t('wizard.assertDesc.jsonFallback', { path: P, operator: a.operator, value: Vraw });
    case 'response_time':
      if (a.operator === 'less_than') return t('wizard.assertDesc.rtLt', { value: V });
      if (a.operator === 'greater_than') return t('wizard.assertDesc.rtGt', { value: V });
      return t('wizard.assertDesc.rtFallback', { operator: a.operator, value: Vraw });
    case 'header':
      if (a.operator === 'exists') return t('wizard.assertDesc.headerExists', { key: K });
      if (a.operator === 'equals') return t('wizard.assertDesc.headerEquals', { key: K, value: V });
      if (a.operator === 'contains') return t('wizard.assertDesc.headerContains', { key: K, value: V });
      return t('wizard.assertDesc.headerFallback', { key: a.key || '', operator: a.operator, value: Vraw });
    default:
      return '';
  }
}

// ── Step type icons & colors ──

function getStepMeta(type: TestStep['type']) {
  switch (type) {
    case 'request':
      return { icon: Send, color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20', labelKey: 'stepKind.request' };
    case 'assertion':
      return { icon: ShieldCheck, color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20', labelKey: 'stepKind.assertion' };
    case 'extract':
      return { icon: Variable, color: 'text-purple-500', bg: 'bg-purple-500/10', border: 'border-purple-500/20', labelKey: 'stepKind.extract' };
    case 'wait':
      return { icon: Clock, color: 'text-gray-500', bg: 'bg-gray-500/10', border: 'border-gray-500/20', labelKey: 'stepKind.wait' };
  }
}

// ── Wizard Props ──

// The step body editor: the ui <Textarea> look, on a VariableTextarea (bare).
const WIZARD_BODY_CLASS =
  'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface TestCaseWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function TestCaseWizard({ open, onOpenChange, onSaved }: TestCaseWizardProps) {
  const { t } = useTranslation('qa');
  const [wizardStep, setWizardStep] = useState(0); // 0=template, 1=steps, 2=details
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDefinition | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('P2');
  const [type, setType] = useState('functional');
  const [tags, setTags] = useState('');
  const [steps, setSteps] = useState<TestStep[]>([]);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [headerExpanded, setHeaderExpanded] = useState<Set<number>>(new Set());
  const [bodyExpanded, setBodyExpanded] = useState<Set<number>>(new Set());
  const [activeStepIdx, setActiveStepIdx] = useState<number | null>(null);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const WIZARD_LABELS = [t('wizard.wizStep0'), t('wizard.wizStep1'), t('wizard.wizStep2')];

  const resetWizard = useCallback(() => {
    setWizardStep(0);
    setSelectedTemplate(null);
    setTitle('');
    setDescription('');
    setPriority('P2');
    setType('functional');
    setTags('');
    setSteps([]);
    setExpandedSteps(new Set());
    setHeaderExpanded(new Set());
    setBodyExpanded(new Set());
    setIsSaving(false);
  }, []);

  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen) resetWizard();
    onOpenChange(isOpen);
  }, [onOpenChange, resetWizard]);

  const selectTemplate = useCallback((template: TemplateDefinition) => {
    setSelectedTemplate(template);
    setTitle(t(`wizard.tpl.${template.id}.title`));
    setDescription(t(`wizard.tpl.${template.id}.formDesc`));
    setPriority(template.defaultPriority);
    setType(template.defaultType);
    setTags(template.defaultTags.join(', '));
    setSteps(template.steps.map((s) => ({ ...s })));
    // expand all steps by default
    setExpandedSteps(new Set(template.steps.map((_, i) => i)));
    setWizardStep(1);
  }, [t]);

  // Step management
  const toggleExpand = (index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const addStep = (type: TestStep['type']) => {
    const newStep: TestStep = {
      stepNo: steps.length + 1,
      type,
      action: '',
      expected: '',
    };
    if (type === 'request') {
      newStep.request = { method: 'GET', url: '' };
    } else if (type === 'assertion') {
      newStep.assertions = [{ type: 'status', operator: 'equals', value: '200' }];
    } else if (type === 'extract') {
      newStep.extractions = [{ variable: '', source: 'json_path', path: '' }];
    } else if (type === 'wait') {
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

  const moveStep = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const reindexSet = (s: Set<number>, order: number[]) => {
      const next = new Set<number>();
      s.forEach((oldIdx) => {
        const newIdx = order.indexOf(oldIdx);
        if (newIdx >= 0) next.add(newIdx);
      });
      return next;
    };
    setSteps((prev) => {
      if (from >= prev.length || to > prev.length) return prev;
      const order = prev.map((_, i) => i);
      const [movedOrder] = order.splice(from, 1);
      order.splice(to, 0, movedOrder);
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setExpandedSteps((s) => reindexSet(s, order));
      setHeaderExpanded((s) => reindexSet(s, order));
      setBodyExpanded((s) => reindexSet(s, order));
      return next.map((s, i) => ({ ...s, stepNo: i + 1 }));
    });
  };

  const handleStepDragStart = (event: DragStartEvent) => {
    const idx = Number(String(event.active.id).replace(/^step:/, ''));
    setActiveStepIdx(Number.isNaN(idx) ? null : idx);
  };

  const handleStepDragEnd = (event: DragEndEvent) => {
    setActiveStepIdx(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = Number(String(active.id).replace(/^step:/, ''));
    const to = Number(String(over.id).replace(/^step:/, ''));
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    moveStep(from, to);
  };

  const updateStepRequest = (index: number, field: string, value: string) => {
    setSteps((prev) => {
      const next = [...prev];
      const step = { ...next[index] };
      step.request = { ...step.request!, [field]: value };
      next[index] = step;
      return next;
    });
  };

  const updateStepRequestHeader = (index: number, headers: Record<string, string>) => {
    setSteps((prev) => {
      const next = [...prev];
      const step = { ...next[index] };
      step.request = { ...step.request!, headers };
      next[index] = step;
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

  const handleSave = useCallback(async (andRun = false) => {
    if (!title.trim()) return;
    setIsSaving(true);
    try {
      const result = await testCasesAPI.create({
        title: title.trim(),
        description: description.trim(),
        priority,
        type,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        steps,
        status: 'draft',
      });
      if (andRun && result.data?.id) {
        try {
          await testCasesAPI.execute(result.data.id, activeRunEnv());
        } catch {
          // execution may not be available yet
        }
      }
      onSaved();
      handleOpenChange(false);
    } catch {
      // handle error silently
    } finally {
      setIsSaving(false);
    }
  }, [title, description, priority, type, tags, steps, onSaved, handleOpenChange]);

  const canGoNext = () => {
    if (wizardStep === 0) return !!selectedTemplate;
    if (wizardStep === 1) return steps.length > 0;
    return title.trim().length > 0;
  };

  // ── Step 1: Template Selection ──

  const renderTemplateStep = () => (
    <ScrollArea className="h-[420px] pr-1">
      <div className="space-y-2">
        {TEMPLATES.map((template) => {
          const Icon = template.icon;
          const isSelected = selectedTemplate?.id === template.id;
          return (
            <button
              key={template.id}
              onClick={() => selectTemplate(template)}
              className={`w-full text-left p-3 rounded-lg border-2 transition-all duration-200 cursor-pointer ${
                isSelected
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-transparent bg-card hover:border-muted-foreground/20 hover:bg-accent/50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-md shrink-0 ${isSelected ? 'bg-primary/10' : 'bg-muted'}`}>
                  <Icon className={`h-5 w-5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{t(`wizard.tpl.${template.id}.name`)}</span>
                    <Badge className={`text-[10px] px-1.5 py-0 leading-tight ${DIFFICULTY_COLORS[template.difficulty]}`}>
                      {t(`wizard.difficulty.${template.difficulty}`)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {t(`wizard.tpl.${template.id}.cardDesc`)}
                  </p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-xs text-muted-foreground">{t(`wizard.tpl.${template.id}.est`)}</span>
                    {template.steps.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {template.steps.length === 1
                          ? t('wizard.stepsCountOne', { count: template.steps.length })
                          : t('wizard.stepsCountOther', { count: template.steps.length })}
                      </span>
                    )}
                  </div>
                </div>
                {isSelected && <Check className="h-5 w-5 text-primary shrink-0" />}
              </div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );

  // ── Step 2: Configure Steps ──

  const renderStepsBuilder = () => (
    <div className="space-y-2">
      {/* Tip bar */}
      <div className="flex items-start gap-2 p-2 rounded-md bg-blue-500/5 border border-blue-500/10">
        <Lightbulb className="h-3 w-3 text-blue-500 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed">
          <Trans
            t={t}
            i18nKey="wizard.tip"
            values={{ token: '{{variable}}' }}
            components={{ c: <code className="px-0.5 bg-blue-500/10 rounded text-xs" /> }}
          />
        </p>
      </div>

      <ScrollArea className="h-[310px] pr-1">
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragStart={handleStepDragStart}
          onDragEnd={handleStepDragEnd}
          onDragCancel={() => setActiveStepIdx(null)}
        >
          <SortableContext
            items={steps.map((_, i) => `step:${i}`)}
            strategy={verticalListSortingStrategy}
          >
        <div className="space-y-2">
          {steps.map((step, index) => {
            const meta = getStepMeta(step.type);
            const Icon = meta.icon;
            const isExpanded = expandedSteps.has(index);

            return (
              <SortableStepItem
                key={index}
                id={`step:${index}`}
                className={`rounded-lg border ${meta.border} overflow-hidden`}
              >
                {(dragHandleProps) => (
                <>
                {/* Step header */}
                <div
                  className={`flex items-center gap-2 p-2 cursor-pointer ${meta.bg}`}
                  onClick={() => toggleExpand(index)}
                >
                  <span
                    className="inline-flex items-center justify-center p-0.5 -ml-0.5 text-muted-foreground/60 cursor-grab active:cursor-grabbing touch-none"
                    onClick={(e) => e.stopPropagation()}
                    {...dragHandleProps}
                  >
                    <GripVertical className="h-3.5 w-3.5" aria-label={t('wizard.dragToReorder')} />
                  </span>
                  <Badge variant="outline" className="text-xs px-1 py-0 font-mono shrink-0">
                    {step.stepNo}
                  </Badge>
                  <Icon className={`h-3 w-3 ${meta.color} shrink-0`} />
                  <span className="text-sm font-medium flex-1 truncate">
                    {t(meta.labelKey)}
                    {step.type === 'request' && step.request?.method && (
                      <span className="ml-1 opacity-60">{step.request.method} {step.request.url ? step.request.url.substring(0, 20) + (step.request.url.length > 20 ? '...' : '') : ''}</span>
                    )}
                    {step.type === 'assertion' && step.assertions?.length && (
                      <span className="ml-1 opacity-60">{step.assertions.length === 1 ? t('step.checkCountOne', { count: step.assertions.length }) : t('step.checkCountOther', { count: step.assertions.length })}</span>
                    )}
                    {step.type === 'extract' && step.extractions?.[0]?.variable && (
                      <span className="ml-1 opacity-60">{`{{${step.extractions[0].variable}}}`}</span>
                    )}
                    {step.type === 'wait' && step.waitMs && (
                      <span className="ml-1 opacity-60">{step.waitMs}ms</span>
                    )}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeStep(index); }}
                    className="p-0.5 rounded hover:bg-destructive/10 transition-colors shrink-0"
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </button>
                  {isExpanded ? (
                    <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                </div>

                {/* Step body */}
                {isExpanded && (
                  <RuntimeVarsProvider names={runtimeVarsBefore(steps, index)}>
                    <div className="p-2.5 space-y-2 bg-card">
                      {step.type === 'request' && renderRequestEditor(step, index)}
                      {step.type === 'assertion' && renderAssertionEditor(step, index)}
                      {step.type === 'extract' && renderExtractionEditor(step, index)}
                      {step.type === 'wait' && renderWaitEditor(step, index)}
                    </div>
                  </RuntimeVarsProvider>
                )}
                </>
                )}
              </SortableStepItem>
            );
          })}

          {steps.length === 0 && (
            <div className="text-center py-6">
              <p className="text-xs text-muted-foreground">{t('wizard.noSteps')}</p>
            </div>
          )}
        </div>
          </SortableContext>
          <DragOverlay>
            {activeStepIdx !== null && steps[activeStepIdx] ? (
              <div className={`rounded-lg border shadow-lg px-2 py-2 text-sm bg-card ${getStepMeta(steps[activeStepIdx].type).border}`}>
                <span className="font-mono text-xs opacity-60 mr-2">#{steps[activeStepIdx].stepNo}</span>
                {t(getStepMeta(steps[activeStepIdx].type).labelKey)}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </ScrollArea>

      {/* Add step buttons */}
      <div className="grid grid-cols-2 gap-2 pt-2">
        <Button
          variant="outline"
          className="h-10 text-sm border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
          onClick={() => addStep('request')}
        >
          <Send className="h-4 w-4 mr-1.5" />
          {t('wizard.addRequest')}
        </Button>
        <Button
          variant="outline"
          className="h-10 text-sm border-green-500/30 text-green-600 dark:text-green-400 hover:bg-green-500/10"
          onClick={() => addStep('assertion')}
        >
          <ShieldCheck className="h-4 w-4 mr-1.5" />
          {t('wizard.addCheck')}
        </Button>
        <Button
          variant="outline"
          className="h-10 text-sm border-purple-500/30 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10"
          onClick={() => addStep('extract')}
        >
          <Variable className="h-4 w-4 mr-1.5" />
          {t('wizard.addExtract')}
        </Button>
        <Button
          variant="outline"
          className="h-10 text-sm border-gray-500/30 text-gray-600 dark:text-gray-400 hover:bg-gray-500/10"
          onClick={() => addStep('wait')}
        >
          <Clock className="h-4 w-4 mr-1.5" />
          {t('wizard.addWait')}
        </Button>
      </div>
    </div>
  );

  // ── Request step editor ──

  // cURL parser for wizard URL fields
  const handleUrlPaste = (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
    const pastedText = e.clipboardData.getData('text');
    const parsed = parseCurlAsRecord(pastedText);
    if (parsed) {
      e.preventDefault();
      const newSteps = [...steps];
      newSteps[index] = {
        ...newSteps[index],
        action: t('step.curlAction', { method: parsed.method }),
        request: {
          method: parsed.method,
          url: parsed.url,
          headers: Object.keys(parsed.headers).length > 0 ? parsed.headers : newSteps[index].request?.headers,
          body: parsed.body || newSteps[index].request?.body,
        },
      };
      setSteps(newSteps);
      // Auto-expand headers/body if they were parsed
      if (Object.keys(parsed.headers).length > 0) {
        setHeaderExpanded((prev) => new Set(prev).add(index));
      }
      if (parsed.body) {
        setBodyExpanded((prev) => new Set(prev).add(index));
      }
    }
  };

  const renderRequestEditor = (step: TestStep, index: number) => {
    const headers = step.request?.headers || {};
    const headerEntries = Object.entries(headers);
    const isHeaderExpanded = headerExpanded.has(index);
    const isBodyExpanded = bodyExpanded.has(index);

    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground italic">{t('wizard.requestHint')}</p>
        {/* Method + URL */}
        <div className="flex gap-1.5">
          <Select
            value={step.request?.method || 'GET'}
            onValueChange={(v) => updateStepRequest(index, 'method', v)}
          >
            <SelectTrigger className="h-9 text-sm w-[72px] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((m) => (
                <SelectItem key={m} value={m} className="text-sm">
                  <span className={`font-mono font-bold ${METHOD_COLORS[m]?.split(' ')[1] || ''}`}>{m}</span>
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
            className="h-9 text-sm font-mono"
          />
        </div>

        {/* Headers (collapsible) */}
        <button
          onClick={() => setHeaderExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
          })}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
                  className="h-8 text-xs font-mono"
                />
                <VariableInput
                  value={value}
                  onChange={(e) => {
                    const newHeaders = { ...headers, [key]: e.target.value };
                    updateStepRequestHeader(index, newHeaders);
                  }}
                  placeholder={t('step.valuePlaceholder')}
                  wrapperClassName="flex-1 min-w-0"
                  className="h-8 text-xs font-mono"
                />
                <button
                  onClick={() => {
                    const newHeaders = { ...headers };
                    delete newHeaders[key];
                    updateStepRequestHeader(index, newHeaders);
                  }}
                  className="p-0.5 shrink-0"
                >
                  <Trash2 className="h-2.5 w-2.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-5 text-xs px-2"
              onClick={() => updateStepRequestHeader(index, { ...headers, '': '' })}
            >
              <Plus className="h-2.5 w-2.5 mr-0.5" /> {t('step.addHeader')}
            </Button>
          </div>
        )}

        {/* Body (collapsible) */}
        <button
          onClick={() => setBodyExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
          })}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
            className={WIZARD_BODY_CLASS}
          />
        )}
      </div>
    );
  };

  // ── Assertion step editor ──

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
              {/* Assertion type selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground shrink-0 w-14">{t('step.checkThat')}</span>
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
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSERTION_TYPES.map((k) => (
                      <SelectItem key={k} value={k} className="text-sm">{t(`assertType.${k}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {assertions.length > 1 && (
                  <button
                    onClick={() => removeAssertion(index, aIdx)}
                    className="p-0.5 shrink-0"
                  >
                    <Trash2 className="h-2.5 w-2.5 text-muted-foreground hover:text-destructive" />
                  </button>
                )}
              </div>

              {/* Path/Key field */}
              {needsPath && (
                <VariableInput
                  value={assertion.path || ''}
                  onChange={(e) => updateAssertion(index, aIdx, { path: e.target.value })}
                  placeholder={t('step.jsonPathPlaceholder')}
                  className="h-8 text-xs font-mono"
                />
              )}
              {needsKey && (
                <VariableInput
                  value={assertion.key || ''}
                  onChange={(e) => updateAssertion(index, aIdx, { key: e.target.value })}
                  placeholder={t('step.contentTypePlaceholder')}
                  className="h-8 text-xs font-mono"
                />
              )}

              {/* Operator + Value */}
              <div className="flex gap-1.5">
                <Select
                  value={assertion.operator}
                  onValueChange={(v) => updateAssertion(index, aIdx, { operator: v as AssertionOperator })}
                >
                  <SelectTrigger className="h-8 text-xs w-[100px] shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableOps.map((op) => (
                      <SelectItem key={op} value={op} className="text-sm">{t(`assertOp.${op}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {needsValue && (
                  <VariableInput
                    value={assertion.value || ''}
                    onChange={(e) => updateAssertion(index, aIdx, { value: e.target.value })}
                    placeholder={assertion.type === 'status' ? '200' : assertion.type === 'response_time' ? '500' : t('step.expectedValuePlaceholder')}
                    wrapperClassName="flex-1 min-w-0"
                    className="h-8 text-xs font-mono"
                  />
                )}
              </div>

              {/* Human-readable preview */}
              <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
                <Check className="h-2.5 w-2.5 shrink-0" />
                {describeAssertion(t, assertion)}
              </p>
            </div>
          );
        })}

        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-green-600 dark:text-green-400 hover:bg-green-500/10 w-full"
          onClick={() => addAssertion(index)}
        >
          <Plus className="h-2.5 w-2.5 mr-1" />
          {t('step.addCheck')}
        </Button>
      </div>
    );
  };

  // ── Extraction step editor ──

  const renderExtractionEditor = (step: TestStep, index: number) => {
    const extraction = step.extractions?.[0] || { variable: '', source: 'json_path' as const, path: '' };

    return (
      <div className="space-y-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('step.variableName')}</Label>
          <Input
            value={extraction.variable}
            onChange={(e) => updateExtraction(index, 0, { variable: e.target.value })}
            placeholder={t('step.variableNamePlaceholder')}
            className="h-8 text-xs font-mono"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('step.source')}</Label>
          <Select
            value={extraction.source}
            onValueChange={(v) => updateExtraction(index, 0, { source: v as ExtractionItem['source'] })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json_path" className="text-sm">{t('extractSource.json_path')}</SelectItem>
              <SelectItem value="header" className="text-sm">{t('extractSource.header')}</SelectItem>
              <SelectItem value="body" className="text-sm">{t('extractSource.body')}</SelectItem>
              <SelectItem value="status" className="text-sm">{t('extractSource.status')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {extraction.source === 'json_path' && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('step.jsonPath')}</Label>
            <VariableInput
              value={extraction.path || ''}
              onChange={(e) => updateExtraction(index, 0, { path: e.target.value })}
              placeholder={t('step.jsonPathValuePlaceholder')}
              className="h-8 text-xs font-mono"
            />
          </div>
        )}

        {extraction.source === 'header' && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t('step.headerKey')}</Label>
            <VariableInput
              value={extraction.key || ''}
              onChange={(e) => updateExtraction(index, 0, { key: e.target.value })}
              placeholder={t('step.authorizationPlaceholder')}
              className="h-8 text-xs font-mono"
            />
          </div>
        )}

        {extraction.variable && (
          <div className="flex items-start gap-1.5 p-1.5 rounded bg-purple-500/5 border border-purple-500/10">
            <Info className="h-2.5 w-2.5 text-purple-500 shrink-0 mt-0.5" />
            <p className="text-[8px] text-purple-700 dark:text-purple-400 leading-relaxed">
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

  // ── Wait step editor ──

  const renderWaitEditor = (step: TestStep, index: number) => (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground italic">{t('wizard.waitHint')}</p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          value={step.waitMs || 1000}
          onChange={(e) => updateStepWait(index, parseInt(e.target.value) || 0)}
          className="h-8 text-xs w-20 font-mono"
          min={0}
          step={100}
        />
        <span className="text-xs text-muted-foreground">{t('wizard.milliseconds')}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('wizard.waitSeconds', { seconds: ((step.waitMs || 1000) / 1000).toFixed(1) })}
      </p>
    </div>
  );

  // ── Step 3: Details & Save ──

  const renderDetailsStep = () => (
    <ScrollArea className="h-[420px] pr-1">
      <div className="space-y-3 pb-1">
        {/* Title */}
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t('wizard.titleLabel')}</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('wizard.titlePlaceholder')}
            className="h-9 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            {t('wizard.titleHint')}
          </p>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t('wizard.descriptionLabel')}</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('wizard.descriptionPlaceholder')}
            rows={2}
            className="text-sm"
          />
        </div>

        {/* Priority */}
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t('wizard.priorityLabel')}</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p.value} value={p.value} className="text-sm">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${p.color}`} />
                    <span>{t(`priorityLong.${p.value}`)}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t(`wizard.priorityDesc.${priority}`)}
          </p>
        </div>

        {/* Type */}
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t('common:type')}</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((tv) => (
                <SelectItem key={tv} value={tv} className="text-sm">
                  {t(`caseType.${tv}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tags */}
        <div className="space-y-1">
          <Label className="text-sm font-medium">{t('wizard.tagsLabel')}</Label>
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={t('wizard.tagsPlaceholder')}
            className="h-9 text-sm"
          />
          {tags && (
            <div className="flex flex-wrap gap-1 mt-1">
              {tags.split(',').map((t) => t.trim()).filter(Boolean).map((tag) => (
                <Badge key={tag} variant="outline" className="text-[8px] px-1">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Steps review */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">{t('wizard.stepsSummary', { count: steps.length })}</Label>
          <div className="space-y-1">
            {steps.map((step, i) => {
              const meta = getStepMeta(step.type);
              const Icon = meta.icon;
              return (
                <div key={i} className={`flex items-center gap-1.5 p-1.5 rounded ${meta.bg} text-xs`}>
                  <Badge variant="outline" className="text-[8px] px-0.5 py-0 font-mono">{step.stepNo}</Badge>
                  <Icon className={`h-2.5 w-2.5 ${meta.color} shrink-0`} />
                  <span className="truncate flex-1">
                    {step.type === 'request' && `${step.request?.method || 'GET'} ${step.request?.url || t('wizard.noUrl')}`}
                    {step.type === 'assertion' && (step.assertions?.length === 1
                      ? t('step.checkCountOne', { count: step.assertions.length })
                      : t('step.checkCountOther', { count: step.assertions?.length || 0 }))}
                    {step.type === 'extract' && t('wizard.saveVar', { var: step.extractions?.[0]?.variable || '...' })}
                    {step.type === 'wait' && t('wizard.waitSummary', { ms: step.waitMs || 0 })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </ScrollArea>
  );

  // ── Main render ──

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[800px] w-[90vw] p-0 gap-0 max-h-[85vh]">
        <DialogHeader className="p-5 pb-3">
          <DialogTitle className="text-base flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            {t('wizard.title')}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {WIZARD_LABELS[wizardStep]}
          </DialogDescription>

          {/* Progress bar */}
          <div className="flex gap-1 mt-2">
            {WIZARD_LABELS.map((label, i) => (
              <TooltipProvider key={i} delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex-1 flex flex-col items-center gap-0.5">
                      <div
                        className={`h-1 w-full rounded-full transition-all duration-300 ${
                          i <= wizardStep ? 'bg-primary' : 'bg-muted'
                        }`}
                      />
                      <span className={`text-[8px] ${i <= wizardStep ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                        {i + 1}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">{label}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="px-4 py-2">
          {wizardStep === 0 && renderTemplateStep()}
          {wizardStep === 1 && renderStepsBuilder()}
          {wizardStep === 2 && renderDetailsStep()}
        </div>

        {/* Footer */}
        <DialogFooter className="p-4 pt-2 border-t gap-1.5">
          {wizardStep > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-sm"
              onClick={() => setWizardStep((s) => s - 1)}
            >
              <ChevronLeft className="h-3 w-3 mr-0.5" />
              {t('wizard.back')}
            </Button>
          )}
          <div className="flex-1" />
          {wizardStep < 2 ? (
            <Button
              size="sm"
              className="h-9 text-sm"
              disabled={!canGoNext()}
              onClick={() => setWizardStep((s) => s + 1)}
            >
              {t('wizard.next')}
              <ChevronRight className="h-3 w-3 ml-0.5" />
            </Button>
          ) : (
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-sm"
                disabled={isSaving || !title.trim()}
                onClick={() => handleSave(false)}
              >
                {isSaving ? (
                  <div className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
                ) : null}
                {t('wizard.save')}
              </Button>
              <Button
                size="sm"
                className="h-9 text-sm"
                disabled={isSaving || !title.trim()}
                onClick={() => handleSave(true)}
              >
                {isSaving ? (
                  <div className="h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-1" />
                ) : (
                  <Play className="h-3 w-3 mr-0.5" />
                )}
                {t('wizard.saveAndRun')}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
