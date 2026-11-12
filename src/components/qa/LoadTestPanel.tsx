import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getRemoteBaseUrl } from '@/stores/remoteStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  BarChart3,
  TrendingUp,
  Zap,
  Clock,
  Flame,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Play,
  Square,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Eye,
  Activity,
  Timer,
  Users,
  Hash,
  Upload,
  Download,
  Database,
  FileText,
  X,
} from 'lucide-react';
import { loadTestAPI } from '@/services/api';

// ── Types ──

type LoadProfile = 'constant' | 'ramp_up' | 'spike' | 'soak' | 'stress';
type TestStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface LoadTestConfig {
  profile: LoadProfile;
  target: {
    method: HttpMethod;
    url: string;
    headers: { key: string; value: string }[];
    body: string;
  };
  parameters: {
    virtualUsers: number;
    duration: number;
    thinkTime?: number; // ms between requests per VU (0 = no delay)
    startVUs?: number;
    maxVUs?: number;
    rampDuration?: number;
    holdDuration?: number;
    normalVUs?: number;
    spikeVUs?: number;
    spikeDuration?: number;
    maxErrorRate?: number;
  };
  thresholds: {
    maxResponseTime: number;
    maxErrorRate: number;
    p95ResponseTime: number;
  };
  // Optional data feed: each request fires with a different row of data,
  // substituted into the URL/headers/body via {{column}} tokens. Mirrors
  // JMeter "CSV Data Set Config" / k6 SharedArray. The JSON shape here must
  // match the BE loadTestDataFeed struct exactly (columns/rows/strategy).
  dataFeed?: {
    columns: string[];
    rows: Record<string, string>[];
    strategy: FeedStrategy;
  };
}

type FeedStrategy = 'circular' | 'sequential' | 'random' | 'shuffle' | 'once';

const MAX_FEED_ROWS = 10000;

const FEED_STRATEGIES: { id: FeedStrategy }[] = [
  { id: 'circular' },
  { id: 'sequential' },
  { id: 'random' },
  { id: 'shuffle' },
  { id: 'once' },
];

interface LoadTestSummary {
  id: string;
  name: string;
  description?: string;
  status: TestStatus;
  config: LoadTestConfig;
  createdAt: string;
  results?: LoadTestResults;
}

interface LoadTestResults {
  totalRequests: number;
  requestsPerSecond: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p95ResponseTime: number;
  errorRate: number;
  errorCount: number;
  duration: number;
  statusCodes: Record<string, number>;
  errors: { message: string; count: number }[];
  timeline: TimelinePoint[];
  thresholdResults: { name: string; threshold: number; actual: number; passed: boolean }[];
}

interface TimelinePoint {
  second: number;
  avgResponseTime: number;
  activeUsers: number;
  requestCount: number;
  errorCount: number;
}

// ── Profile Definitions ──

interface ProfileDefinition {
  id: LoadProfile;
  icon: React.ElementType;
  shape: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
}

const PROFILES: ProfileDefinition[] = [
  { id: 'constant', icon: BarChart3, shape: '▁▁▁████████▁▁▁', difficulty: 'Beginner' },
  { id: 'ramp_up', icon: TrendingUp, shape: '▁▂▃▄▅▆▇████▁▁', difficulty: 'Intermediate' },
  { id: 'spike', icon: Zap, shape: '▁▁██▁▁█████▁▁▁', difficulty: 'Intermediate' },
  { id: 'soak', icon: Clock, shape: '▁████████████▁', difficulty: 'Advanced' },
  { id: 'stress', icon: Flame, shape: '▁▂▃▄▅▆▇█↑↑↑✗', difficulty: 'Advanced' },
];

const DIFFICULTY_COLORS: Record<string, string> = {
  Beginner: 'bg-green-500/15 text-green-700 dark:text-green-400',
  Intermediate: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  Advanced: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-500',
  POST: 'text-blue-500',
  PUT: 'text-yellow-500',
  DELETE: 'text-red-500',
  PATCH: 'text-purple-500',
};

// ── Helper functions ──

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusBadge(t: TFunction, status: TestStatus) {
  const map: Record<TestStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
    pending: { variant: 'secondary', className: 'bg-gray-500/15 text-gray-600 dark:text-gray-400' },
    running: { variant: 'default', className: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 animate-pulse' },
    completed: { variant: 'default', className: 'bg-green-500/15 text-green-700 dark:text-green-400' },
    failed: { variant: 'destructive', className: 'bg-red-500/15 text-red-700 dark:text-red-400' },
    cancelled: { variant: 'secondary', className: 'bg-gray-500/15 text-gray-600 dark:text-gray-400' },
  };
  const cfg = map[status] || map.pending;
  return <Badge variant={cfg.variant} className={`text-xs px-1.5 py-0 ${cfg.className}`}>{t(`runStatus.${status}`, { defaultValue: status })}</Badge>;
}

function defaultConfig(): LoadTestConfig {
  return {
    profile: 'constant',
    target: {
      method: 'GET',
      url: '',
      headers: [{ key: '', value: '' }],
      body: '',
    },
    parameters: {
      virtualUsers: 10,
      duration: 30,
      thinkTime: 0,
      startVUs: 1,
      maxVUs: 100,
      rampDuration: 30,
      holdDuration: 60,
      normalVUs: 10,
      spikeVUs: 100,
      spikeDuration: 10,
      maxErrorRate: 50,
    },
    thresholds: {
      maxResponseTime: 5000,
      maxErrorRate: 10,
      p95ResponseTime: 2000,
    },
  };
}

// ── Data feed helpers ──

// Minimal RFC-4180-ish CSV parser: handles quoted fields, "" escapes, and
// embedded commas / newlines inside quotes. First row = header (columns).
function parseCSV(text: string): { columns: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      pushField();
      i++;
      continue;
    }
    if (ch === '\r') {
      // swallow, handle on \n (or standalone \r)
      if (text[i + 1] === '\n') {
        pushRecord();
        i += 2;
      } else {
        pushRecord();
        i++;
      }
      continue;
    }
    if (ch === '\n') {
      pushRecord();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // flush trailing field/record if any content remains
  if (field.length > 0 || record.length > 0) {
    pushRecord();
  }
  // Drop fully-empty trailing records
  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0] === ''));
  if (nonEmpty.length === 0) return { columns: [], rows: [] };
  const columns = nonEmpty[0].map((c) => c.trim());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < nonEmpty.length; r++) {
    const cells = nonEmpty[r];
    const obj: Record<string, string> = {};
    columns.forEach((col, ci) => {
      obj[col] = cells[ci] ?? '';
    });
    rows.push(obj);
  }
  return { columns, rows };
}

// Parse an uploaded feed file (.json array-of-objects | .csv) into columns+rows.
function parseFeedFile(t: TFunction, name: string, text: string): { columns: string[]; rows: Record<string, string>[] } {
  const isJson = name.toLowerCase().endsWith('.json') || text.trim().startsWith('[');
  if (isJson) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error(t('loadtest.jsonMustBeArray'));
    const columns: string[] = [];
    const rows: Record<string, string>[] = [];
    for (let idx = 0; idx < parsed.length; idx++) {
      const item = parsed[idx];
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error(t('loadtest.itemMustBeObject', { idx }));
      }
      const row: Record<string, string> = {};
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        if (!columns.includes(k)) columns.push(k);
        row[k] = v == null ? '' : String(v);
      }
      rows.push(row);
    }
    return { columns, rows };
  }
  return parseCSV(text);
}

// Scan a target (URL + header keys/values + body) for {{token}} occurrences,
// deduped, preserving first-seen order. Falls back to a generic set.
function scanTargetTokens(target: LoadTestConfig['target']): string[] {
  const re = /\{\{(\w+)\}\}/g;
  const seen = new Set<string>();
  const push = (s: string) => {
    if (!s) return;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) seen.add(m[1]);
  };
  push(target.url);
  for (const h of target.headers) {
    push(h.key);
    push(h.value);
  }
  push(target.body);
  const tokens = Array.from(seen);
  return tokens.length > 0 ? tokens : ['id', 'name', 'email'];
}

function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Build a starter template (2 example rows) from the given columns.
function buildTemplate(columns: string[], format: 'csv' | 'json'): string {
  if (format === 'json') {
    const rows = [1, 2].map((n) => {
      const obj: Record<string, string> = {};
      columns.forEach((c) => {
        obj[c] = `${c}_${n}`;
      });
      return obj;
    });
    return JSON.stringify(rows, null, 2);
  }
  const header = columns.map(csvEscape).join(',');
  const rows = [1, 2].map((n) => columns.map((c) => csvEscape(`${c}_${n}`)).join(','));
  return [header, ...rows].join('\n');
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Sub-Components ──

// Step Indicator
function StepIndicator({ current, total, labels }: { current: number; total: number; labels: string[] }) {
  return (
    <div className="flex items-center gap-1 mb-4">
      {labels.map((label, i) => (
        <div key={i} className="flex items-center gap-1 flex-1 min-w-0">
          <div
            className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
              i < current
                ? 'bg-primary text-primary-foreground'
                : i === current
                  ? 'bg-primary text-primary-foreground ring-2 ring-primary/30'
                  : 'bg-muted text-muted-foreground'
            }`}
          >
            {i < current ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
          </div>
          <span className={`text-xs truncate ${i === current ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
            {label}
          </span>
          {i < total - 1 && <div className={`flex-1 h-px min-w-2 ${i < current ? 'bg-primary' : 'bg-muted'}`} />}
        </div>
      ))}
    </div>
  );
}

// Profile Card
function ProfileCard({
  profile,
  selected,
  onClick,
}: {
  profile: ProfileDefinition;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation('qa');
  const Icon = profile.icon;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border-2 transition-all duration-200 cursor-pointer group ${
        selected
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border hover:border-primary/40 hover:bg-accent/30'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`p-1.5 rounded-md shrink-0 ${selected ? 'bg-primary/15' : 'bg-muted group-hover:bg-primary/10'}`}>
          <Icon className={`h-4 w-4 ${selected ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{t(`loadtest.profileName.${profile.id}`)}</span>
            <Badge variant="secondary" className={`text-[10px] px-1 py-0 ${DIFFICULTY_COLORS[profile.difficulty]}`}>
              {t(`wizard.difficulty.${profile.difficulty}`)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t(`loadtest.profileDesc.${profile.id}`)}</p>
          <div className="mt-1.5 font-mono text-sm tracking-wider text-muted-foreground">
            {profile.shape}
          </div>
          <p className="text-[10px] text-muted-foreground/70 mt-1 italic">{t('loadtest.bestFor', { value: t(`loadtest.profileBestFor.${profile.id}`) })}</p>
        </div>
      </div>
    </button>
  );
}

// Slider Parameter
function ParamSlider({
  label,
  value,
  min,
  max,
  step = 1,
  hint,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">{label}</Label>
        <span className="text-xs font-mono font-bold text-primary">
          {format ? format(value) : value}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 h-1.5 appearance-none bg-muted rounded-full cursor-pointer accent-primary
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm
            [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background"
        />
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (n >= min && n <= max) onChange(n);
          }}
          className="w-16 h-6 text-xs text-center px-1"
        />
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Key-Value Editor
function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  items: { key: string; value: string }[];
  onChange: (items: { key: string; value: string }[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const { t } = useTranslation('qa');
  const kPlaceholder = keyPlaceholder ?? t('loadtest.keyDefault');
  const vPlaceholder = valuePlaceholder ?? t('loadtest.valueDefault');
  const update = (index: number, field: 'key' | 'value', val: string) => {
    const next = [...items];
    next[index] = { ...next[index], [field]: val };
    onChange(next);
  };
  const add = () => onChange([...items, { key: '', value: '' }]);
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            className="h-6 text-xs flex-1"
            placeholder={kPlaceholder}
            value={item.key}
            onChange={(e) => update(i, 'key', e.target.value)}
          />
          <Input
            className="h-6 text-xs flex-1"
            placeholder={vPlaceholder}
            value={item.value}
            onChange={(e) => update(i, 'value', e.target.value)}
          />
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => remove(i)}>
            <Trash2 className="h-3 w-3 text-muted-foreground" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="h-6 text-xs w-full" onClick={add}>
        <Plus className="h-3 w-3 mr-1" /> {t('loadtest.add')}
      </Button>
    </div>
  );
}

// Collapsible Section
function Collapsible({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <span className="text-xs font-medium">{title}</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && <div className="p-3 space-y-3">{children}</div>}
    </div>
  );
}

// ── Data Feed Section ──

function DataFeedSection({
  target,
  dataFeed,
  onChange,
}: {
  target: LoadTestConfig['target'];
  dataFeed: LoadTestConfig['dataFeed'];
  onChange: (feed: LoadTestConfig['dataFeed']) => void;
}) {
  const { t } = useTranslation('qa');
  const [open, setOpen] = useState(!!dataFeed);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== 'string') {
        setError(t('loadtest.readFileFailed'));
        return;
      }
      try {
        let { columns, rows } = parseFeedFile(t, file.name, text);
        if (columns.length === 0 || rows.length === 0) {
          setError(t('loadtest.noDataRows'));
          return;
        }
        let warn: string | null = null;
        if (rows.length > MAX_FEED_ROWS) {
          rows = rows.slice(0, MAX_FEED_ROWS);
          warn = t('loadtest.truncated', { max: MAX_FEED_ROWS.toLocaleString() });
        }
        setError(null);
        setWarning(warn);
        onChange({ columns, rows, strategy: dataFeed?.strategy || 'circular' });
      } catch (err) {
        setError(err instanceof Error ? err.message : t('loadtest.parseFileFailed'));
      }
    };
    reader.onerror = () => setError(t('loadtest.readFileFailed'));
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleClear = () => {
    setError(null);
    setWarning(null);
    onChange(undefined);
  };

  const handleTemplate = (format: 'csv' | 'json') => {
    const columns = scanTargetTokens(target);
    const content = buildTemplate(columns, format);
    if (format === 'csv') {
      downloadBlob('data-feed-template.csv', content, 'text/csv');
    } else {
      downloadBlob('data-feed-template.json', content, 'application/json');
    }
  };

  const strategyHint = t(`loadtest.strategyHint.${dataFeed?.strategy || 'circular'}`);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <span className="text-xs font-medium flex items-center gap-1.5">
          <Database className="h-3 w-3" />
          {t('loadtest.dataFeedLabel')}
          {dataFeed && (
            <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-primary/15 text-primary">
              {t('loadtest.rowsBadge', { value: dataFeed.rows.length.toLocaleString() })}
            </Badge>
          )}
        </span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="p-3 space-y-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <Trans
              t={t}
              i18nKey="loadtest.feedIntro"
              values={{ token: '{{column}}' }}
              components={{ c: <code className="px-1 py-0.5 rounded bg-muted font-mono text-[10px]" /> }}
            />
          </p>

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              className="hidden"
              onChange={handleFileSelected}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3 w-3 mr-1" />
              {dataFeed ? t('loadtest.replaceFile') : t('loadtest.uploadFile')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs">
                  <Download className="h-3 w-3 mr-1" />
                  {t('loadtest.template')}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem className="text-xs" onClick={() => handleTemplate('csv')}>
                  <FileText className="h-3 w-3 mr-2" /> {t('loadtest.csvTemplate')}
                </DropdownMenuItem>
                <DropdownMenuItem className="text-xs" onClick={() => handleTemplate('json')}>
                  <FileText className="h-3 w-3 mr-2" /> {t('loadtest.jsonTemplate')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {dataFeed && (
              <Button variant="ghost" size="sm" className="h-7 text-xs ml-auto text-muted-foreground" onClick={handleClear}>
                <X className="h-3 w-3 mr-1" />
                {t('loadtest.clear')}
              </Button>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-1.5 p-2 rounded bg-red-500/5 border border-red-500/20">
              <AlertTriangle className="h-3 w-3 text-red-500 shrink-0 mt-0.5" />
              <span className="text-[11px] text-red-700 dark:text-red-400">{error}</span>
            </div>
          )}
          {warning && (
            <div className="flex items-start gap-1.5 p-2 rounded bg-yellow-500/5 border border-yellow-500/20">
              <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0 mt-0.5" />
              <span className="text-[11px] text-yellow-700 dark:text-yellow-400">{warning}</span>
            </div>
          )}

          {dataFeed && (
            <>
              {/* Column chips */}
              <div className="flex flex-wrap gap-1">
                {dataFeed.columns.map((c) => (
                  <Badge key={c} variant="secondary" className="text-[10px] px-1.5 py-0 font-mono">
                    {`{{${c}}}`}
                  </Badge>
                ))}
              </div>

              {/* Preview: first 3 rows */}
              <div className="border rounded-md overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      {dataFeed.columns.map((c) => (
                        <th key={c} className="px-2 py-1 text-left font-medium font-mono truncate max-w-[120px]">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataFeed.rows.slice(0, 3).map((row, ri) => (
                      <tr key={ri} className="border-b last:border-b-0">
                        {dataFeed.columns.map((c) => (
                          <td key={c} className="px-2 py-1 font-mono text-muted-foreground truncate max-w-[120px]">
                            {row[c]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {dataFeed.rows.length === 1
                  ? t('loadtest.rowsLoadedOne', { count: dataFeed.rows.length, value: dataFeed.rows.length.toLocaleString() })
                  : t('loadtest.rowsLoadedOther', { count: dataFeed.rows.length, value: dataFeed.rows.length.toLocaleString() })}
                {dataFeed.rows.length > 3 && t('loadtest.showingFirst')}
              </p>

              {/* Strategy */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">{t('loadtest.strategy')}</Label>
                <Select
                  value={dataFeed.strategy}
                  onValueChange={(v) => onChange({ ...dataFeed, strategy: v as FeedStrategy })}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FEED_STRATEGIES.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {t(`loadtest.strategyLabel.${s.id}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {strategyHint && <p className="text-[10px] text-muted-foreground">{strategyHint}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Response Time Bar Chart ──

function ResponseTimeChart({ timeline }: { timeline: TimelinePoint[] }) {
  const { t } = useTranslation('qa');
  if (!timeline || timeline.length === 0) return null;
  const maxRT = Math.max(...timeline.map((t) => t.avgResponseTime), 1);
  const barCount = Math.min(timeline.length, 60);
  const data = timeline.slice(-barCount);

  return (
    <div className="border rounded-lg p-3 bg-card">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Timer className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('loadtest.chartResponseTime')}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-sm bg-green-500 inline-block" /> {t('loadtest.legendFast')}</span>
          <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-sm bg-yellow-500 inline-block" /> {t('loadtest.legendMid')}</span>
          <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" /> {t('loadtest.legendSlow')}</span>
        </div>
      </div>
      <div className="flex items-end gap-px h-20">
        {data.map((point, i) => {
          const heightPct = Math.max((point.avgResponseTime / maxRT) * 100, 2);
          const color =
            point.avgResponseTime < 500
              ? 'bg-green-500'
              : point.avgResponseTime < 1000
                ? 'bg-yellow-500'
                : 'bg-red-500';
          return (
            <TooltipProvider key={i} delayDuration={50}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={`flex-1 rounded-t-sm transition-all duration-150 cursor-default ${color}`}
                    style={{ height: `${heightPct}%`, opacity: 0.6 + (i / data.length) * 0.4 }}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>{t('loadtest.tooltipSecondMs', { second: point.second, ms: Math.round(point.avgResponseTime) })}</p>
                  <p>{t('loadtest.tooltipReqsErrors', { reqs: point.requestCount, errors: point.errorCount })}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-muted-foreground">{data[0]?.second || 0}s</span>
        <span className="text-[10px] text-muted-foreground">{data[data.length - 1]?.second || 0}s</span>
      </div>
    </div>
  );
}

// ── Active Users Chart ──

function ActiveUsersChart({ timeline }: { timeline: TimelinePoint[] }) {
  const { t } = useTranslation('qa');
  if (!timeline || timeline.length === 0) return null;
  const maxVU = Math.max(...timeline.map((t) => t.activeUsers), 1);
  const barCount = Math.min(timeline.length, 60);
  const data = timeline.slice(-barCount);

  return (
    <div className="border rounded-lg p-3 bg-card">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Users className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('loadtest.chartActiveUsers')}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{t('loadtest.peakVus', { count: maxVU })}</span>
      </div>
      <div className="flex items-end gap-px h-14">
        {data.map((point, i) => {
          const heightPct = Math.max((point.activeUsers / maxVU) * 100, 2);
          return (
            <TooltipProvider key={i} delayDuration={50}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="flex-1 rounded-t-sm bg-blue-500 transition-all duration-150 cursor-default"
                    style={{ height: `${heightPct}%`, opacity: 0.5 + (i / data.length) * 0.5 }}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p>{t('loadtest.tooltipSecondVus', { second: point.second, count: point.activeUsers })}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-muted-foreground">{data[0]?.second || 0}s</span>
        <span className="text-[10px] text-muted-foreground">{data[data.length - 1]?.second || 0}s</span>
      </div>
    </div>
  );
}

// ── Status Codes Distribution ──

function StatusCodesChart({ statusCodes }: { statusCodes: Record<string, number> }) {
  const { t } = useTranslation('qa');
  const entries = Object.entries(statusCodes).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;
  const maxCount = Math.max(...entries.map(([, c]) => c), 1);

  return (
    <div className="border rounded-lg p-3 bg-card">
      <div className="flex items-center gap-1.5 mb-2">
        <Hash className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('loadtest.chartStatusCodes')}</span>
      </div>
      <div className="space-y-1.5">
        {entries.map(([code, count]) => {
          const pct = (count / maxCount) * 100;
          const color = code.startsWith('2')
            ? 'bg-green-500'
            : code.startsWith('4')
              ? 'bg-yellow-500'
              : code.startsWith('5')
                ? 'bg-red-500'
                : 'bg-gray-400';
          return (
            <div key={code} className="flex items-center gap-2">
              <span className="text-xs font-mono w-8 shrink-0">{code}</span>
              <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs font-mono w-12 text-right text-muted-foreground">{count.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Summary Stat Card ──

function StatCard({
  label,
  value,
  sub,
  color = 'text-foreground',
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  icon: React.ElementType;
}) {
  return (
    <div className="border rounded-lg p-2.5 bg-card">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</span>
      </div>
      <p className={`text-lg font-bold leading-none ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Load Shape Preview ──

function LoadShapePreview({ config }: { config: LoadTestConfig }) {
  const { t } = useTranslation('qa');
  const { profile, parameters } = config;
  const points: number[] = [];
  const totalSteps = 20;

  switch (profile) {
    case 'constant': {
      for (let i = 0; i < totalSteps; i++) {
        points.push(i === 0 || i === totalSteps - 1 ? 0 : parameters.virtualUsers);
      }
      break;
    }
    case 'ramp_up': {
      const rampSteps = Math.round(totalSteps * 0.4);
      const holdSteps = totalSteps - rampSteps - 2;
      const startVU = parameters.startVUs || 1;
      const peakVU = parameters.maxVUs || 100;
      points.push(0);
      for (let i = 0; i < rampSteps; i++) {
        points.push(Math.round(startVU + ((peakVU - startVU) * i) / rampSteps));
      }
      for (let i = 0; i < holdSteps; i++) {
        points.push(peakVU);
      }
      points.push(0);
      break;
    }
    case 'spike': {
      const normalVU = parameters.normalVUs || 10;
      const spikeVU = parameters.spikeVUs || 100;
      for (let i = 0; i < totalSteps; i++) {
        if (i === 0 || i === totalSteps - 1) points.push(0);
        else if (i >= 6 && i <= 9) points.push(spikeVU);
        else if (i >= 13 && i <= 16) points.push(spikeVU);
        else points.push(normalVU);
      }
      break;
    }
    case 'soak': {
      for (let i = 0; i < totalSteps; i++) {
        points.push(i === 0 || i === totalSteps - 1 ? 0 : parameters.virtualUsers);
      }
      break;
    }
    case 'stress': {
      points.push(0);
      for (let i = 1; i < totalSteps - 1; i++) {
        const vu = Math.round((parameters.maxVUs || 500) * (i / (totalSteps - 2)));
        points.push(vu);
      }
      points.push(0);
      break;
    }
  }

  const maxVal = Math.max(...points, 1);

  return (
    <div className="border rounded-lg p-3 bg-muted/20">
      <div className="flex items-center gap-1.5 mb-2">
        <Activity className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{t('loadtest.plannedLoadShape')}</span>
      </div>
      <div className="flex items-end gap-px h-12">
        {points.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm bg-primary/60 transition-all"
            style={{ height: `${Math.max((v / maxVal) * 100, 1)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-muted-foreground">0s</span>
        <span className="text-[10px] text-muted-foreground">
          {formatDuration(
            profile === 'ramp_up'
              ? (parameters.rampDuration || 30) + (parameters.holdDuration || 60)
              : parameters.duration
          )}
        </span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// ── WIZARD ──
// ══════════════════════════════════════════

function LoadTestWizard({
  open,
  onOpenChange,
  onCreated,
  initialConfig,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Pass the new test id back so the parent can drop the user straight into
  // the live results view; falling through to the list (the previous
  // behavior) made users open the just-started test by hand to see anything.
  onCreated: (newId?: string) => void;
  initialConfig?: LoadTestConfig;
}) {
  const { t } = useTranslation('qa');
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<LoadTestConfig>(initialConfig || defaultConfig());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const totalSteps = 4;
  const stepLabels = [t('loadtest.stepProfile'), t('loadtest.stepTarget'), t('loadtest.stepParameters'), t('loadtest.stepReview')];

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(0);
      setConfig(initialConfig || defaultConfig());
      const profile = PROFILES.find((p) => p.id === (initialConfig?.profile || 'constant'));
      const today = new Date().toISOString().slice(0, 10);
      const pname = profile ? t(`loadtest.profileName.${profile.id}`) : t('loadtest.loadFallback');
      setName(t('loadtest.autoName', { name: pname, date: today }));
      setDescription('');
      setIsSubmitting(false);
    }
  }, [open, initialConfig, t]);

  // Auto-update name when profile changes
  useEffect(() => {
    const profile = PROFILES.find((p) => p.id === config.profile);
    const today = new Date().toISOString().slice(0, 10);
    const pname = profile ? t(`loadtest.profileName.${profile.id}`) : t('loadtest.loadFallback');
    setName(t('loadtest.autoName', { name: pname, date: today }));
  }, [config.profile, t]);

  const updateConfig = (patch: Partial<LoadTestConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const updateTarget = (patch: Partial<LoadTestConfig['target']>) =>
    setConfig((c) => ({ ...c, target: { ...c.target, ...patch } }));
  const updateParams = (patch: Partial<LoadTestConfig['parameters']>) =>
    setConfig((c) => ({ ...c, parameters: { ...c.parameters, ...patch } }));
  const updateThresholds = (patch: Partial<LoadTestConfig['thresholds']>) =>
    setConfig((c) => ({ ...c, thresholds: { ...c.thresholds, ...patch } }));

  const canNext = () => {
    if (step === 1) return config.target.url.trim().length > 0;
    return true;
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      // Transform frontend config to backend expected shape
      const headersMap: Record<string, string> = {};
      for (const h of config.target.headers) {
        if (h.key.trim()) headersMap[h.key] = h.value;
      }
      const backendConfig = {
        profile: config.profile,
        target: {
          method: config.target.method,
          url: config.target.url,
          headers: Object.keys(headersMap).length > 0 ? headersMap : undefined,
          body: config.target.body || undefined,
        },
        parameters: {
          virtualUsers: config.parameters.virtualUsers,
          duration: config.parameters.duration,
          thinkTime: config.parameters.thinkTime || 0,
          rampUpTime: config.parameters.rampDuration || 0,
          rampUpUsers: config.parameters.maxVUs || 0,
          spikeUsers: config.parameters.spikeVUs || 0,
          spikeDuration: config.parameters.spikeDuration || 0,
          thresholds: config.thresholds,
        },
        // Optional data feed — omitted entirely when unset. Shape matches the
        // BE loadTestDataFeed struct (columns/rows/strategy).
        dataFeed: config.dataFeed,
      };
      const res = await loadTestAPI.create({ name, description: description || undefined, config: backendConfig });
      const newId = (res.data as { id?: string })?.id;
      onCreated(newId);
      onOpenChange(false);
    } catch {
      // Error handled by interceptor
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="text-sm font-semibold">{t('loadtest.newTitle')}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t('loadtest.newDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 pt-2">
          <StepIndicator current={step} total={totalSteps} labels={stepLabels} />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-2">
          <div>
            {/* Step 0: Profile */}
            {step === 0 && (
              <div className="space-y-2">
                {PROFILES.map((profile) => (
                  <ProfileCard
                    key={profile.id}
                    profile={profile}
                    selected={config.profile === profile.id}
                    onClick={() => updateConfig({ profile: profile.id })}
                  />
                ))}
              </div>
            )}

            {/* Step 1: Target */}
            {step === 1 && (
              <div className="space-y-3">
                <div className="p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20">
                  <p className="text-xs text-blue-700 dark:text-blue-400">
                    {t('loadtest.targetHint')}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Select
                    value={config.target.method}
                    onValueChange={(v) => updateTarget({ method: v as HttpMethod })}
                  >
                    <SelectTrigger className="w-24 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const).map((m) => (
                        <SelectItem key={m} value={m} className="text-xs">
                          <span className={METHOD_COLORS[m]}>{m}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="flex-1 h-7 text-xs font-mono"
                    placeholder={t('loadtest.urlPlaceholder', { baseUrl: '{{base_url}}' })}
                    value={config.target.url}
                    onChange={(e) => updateTarget({ url: e.target.value })}
                  />
                </div>

                <Collapsible title={t('loadtest.headers')}>
                  <KeyValueEditor
                    items={config.target.headers}
                    onChange={(headers) => updateTarget({ headers })}
                    keyPlaceholder={t('loadtest.headerName')}
                    valuePlaceholder={t('loadtest.headerValue')}
                  />
                </Collapsible>

                {config.target.method !== 'GET' && (
                  <Collapsible title={t('loadtest.body')}>
                    <Textarea
                      className="text-xs font-mono min-h-[80px]"
                      placeholder='{"key": "value"}'
                      value={config.target.body}
                      onChange={(e) => updateTarget({ body: e.target.value })}
                    />
                  </Collapsible>
                )}

                <DataFeedSection
                  target={config.target}
                  dataFeed={config.dataFeed}
                  onChange={(dataFeed) => updateConfig({ dataFeed })}
                />
              </div>
            )}

            {/* Step 2: Parameters */}
            {step === 2 && (
              <div className="space-y-4">
                {/* Profile-specific parameters */}
                {config.profile === 'constant' && (
                  <>
                    <ParamSlider
                      label={t('loadtest.param.virtualUsers')}
                      value={config.parameters.virtualUsers}
                      min={1}
                      max={500}
                      hint={t('loadtest.hint.virtualUsersConstant')}
                      onChange={(v) => updateParams({ virtualUsers: v })}
                    />
                    <ParamSlider
                      label={t('loadtest.param.duration')}
                      value={config.parameters.duration}
                      min={5}
                      max={300}
                      format={formatDuration}
                      hint={t('loadtest.hint.durationConstant')}
                      onChange={(v) => updateParams({ duration: v })}
                    />
                  </>
                )}

                {config.profile === 'ramp_up' && (
                  <>
                    <ParamSlider
                      label={t('loadtest.param.startingVUs')}
                      value={config.parameters.startVUs || 1}
                      min={1}
                      max={50}
                      hint={t('loadtest.hint.startingVUs')}
                      onChange={(v) => updateParams({ startVUs: v })}
                    />
                    <ParamSlider
                      label={t('loadtest.param.peakVUs')}
                      value={config.parameters.maxVUs || 100}
                      min={10}
                      max={500}
                      hint={t('loadtest.hint.peakVUs')}
                      onChange={(v) => updateParams({ maxVUs: v })}
                    />
                    <ParamSlider
                      label={t('loadtest.param.rampDuration')}
                      value={config.parameters.rampDuration || 30}
                      min={5}
                      max={120}
                      format={formatDuration}
                      hint={t('loadtest.hint.rampDuration')}
                      onChange={(v) => updateParams({ rampDuration: v })}
                    />
                    <ParamSlider
                      label={t('loadtest.param.holdDuration')}
                      value={config.parameters.holdDuration || 60}
                      min={5}
                      max={300}
                      format={formatDuration}
                      hint={t('loadtest.hint.holdDuration')}
                      onChange={(v) => updateParams({ holdDuration: v })}
                    />
                  </>
                )}

                {config.profile === 'spike' && (
                  <>
                    <ParamSlider
                      label={t('loadtest.param.normalVUs')}
                      value={config.parameters.normalVUs || 10}
                      min={1}
                      max={100}
                      hint={t('loadtest.hint.normalVUs')}
                      onChange={(v) => updateParams({ normalVUs: v })}
                    />
                    <ParamSlider
                      label={t('loadtest.param.spikeVUs')}
                      value={config.parameters.spikeVUs || 100}
                      min={10}
                      max={500}
                      hint={t('loadtest.hint.spikeVUs')}
                      onChange={(v) => updateParams({ spikeVUs: v })}
                    />
                    <ParamSlider
                      label={t('loadtest.param.spikeDuration')}
                      value={config.parameters.spikeDuration || 10}
                      min={5}
                      max={120}
                      format={formatDuration}
                      hint={t('loadtest.hint.spikeDuration')}
                      onChange={(v) => updateParams({ spikeDuration: v })}
                    />
                    <ParamSlider
                      label={t('loadtest.param.totalDuration')}
                      value={config.parameters.duration}
                      min={30}
                      max={300}
                      format={formatDuration}
                      hint={t('loadtest.hint.totalDuration')}
                      onChange={(v) => updateParams({ duration: v })}
                    />
                  </>
                )}

                {config.profile === 'soak' && (
                  <>
                    <ParamSlider
                      label={t('loadtest.param.virtualUsers')}
                      value={config.parameters.virtualUsers}
                      min={1}
                      max={200}
                      hint={t('loadtest.hint.virtualUsersSoak')}
                      onChange={(v) => updateParams({ virtualUsers: v })}
                    />
                    <ParamSlider
                      label={t('loadtest.param.duration')}
                      value={config.parameters.duration}
                      min={60}
                      max={300}
                      step={10}
                      format={formatDuration}
                      hint={t('loadtest.hint.durationSoak')}
                      onChange={(v) => updateParams({ duration: v })}
                    />
                  </>
                )}

                {config.profile === 'stress' && (
                  <>
                    <ParamSlider
                      label={t('loadtest.param.maxVUs')}
                      value={config.parameters.maxVUs || 500}
                      min={50}
                      max={500}
                      hint={t('loadtest.hint.maxVUs')}
                      onChange={(v) => updateParams({ maxVUs: v })}
                    />
                    <ParamSlider
                      label={t('loadtest.param.maxErrorRateStop')}
                      value={config.parameters.maxErrorRate || 50}
                      min={10}
                      max={90}
                      hint={t('loadtest.hint.maxErrorRateStop')}
                      format={(v) => `${v}%`}
                      onChange={(v) => updateParams({ maxErrorRate: v })}
                    />
                    <ParamSlider
                      label={t('loadtest.param.duration')}
                      value={config.parameters.duration}
                      min={30}
                      max={300}
                      format={formatDuration}
                      hint={t('loadtest.hint.durationStress')}
                      onChange={(v) => updateParams({ duration: v })}
                    />
                  </>
                )}

                {/* Think Time — common to all profiles */}
                <ParamSlider
                  label={t('loadtest.param.thinkTime')}
                  value={config.parameters.thinkTime || 0}
                  min={0}
                  max={5000}
                  step={100}
                  format={(v) => v === 0 ? t('loadtest.noneMaxThroughput') : `${v}ms`}
                  hint={t('loadtest.hint.thinkTime')}
                  onChange={(v) => updateParams({ thinkTime: v })}
                />

                {/* Thresholds */}
                <Collapsible title={t('loadtest.thresholdsTitle')} defaultOpen={false}>
                  <ParamSlider
                    label={t('loadtest.param.maxResponseTime')}
                    value={config.thresholds.maxResponseTime}
                    min={500}
                    max={30000}
                    step={100}
                    format={(v) => `${v}ms`}
                    hint={t('loadtest.hint.maxResponseTime')}
                    onChange={(v) => updateThresholds({ maxResponseTime: v })}
                  />
                  <ParamSlider
                    label={t('loadtest.param.maxErrorRate')}
                    value={config.thresholds.maxErrorRate}
                    min={1}
                    max={50}
                    format={(v) => `${v}%`}
                    hint={t('loadtest.hint.maxErrorRate')}
                    onChange={(v) => updateThresholds({ maxErrorRate: v })}
                  />
                  <ParamSlider
                    label={t('loadtest.param.p95ResponseTime')}
                    value={config.thresholds.p95ResponseTime}
                    min={100}
                    max={10000}
                    step={100}
                    format={(v) => `${v}ms`}
                    hint={t('loadtest.hint.p95ResponseTime')}
                    onChange={(v) => updateThresholds({ p95ResponseTime: v })}
                  />
                </Collapsible>
              </div>
            )}

            {/* Step 3: Review */}
            {step === 3 && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-xs font-medium">{t('loadtest.testName')}</Label>
                  <Input
                    className="h-7 text-xs"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('loadtest.testNamePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-medium">{t('loadtest.descriptionOptional')}</Label>
                  <Textarea
                    className="text-xs min-h-[50px]"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('loadtest.descriptionPlaceholder')}
                  />
                </div>

                {/* Summary */}
                <div className="border rounded-lg p-3 bg-card space-y-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('loadtest.review.summary')}</span>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="text-xs">
                      <span className="text-muted-foreground">{t('loadtest.review.profile')}</span>{' '}
                      <span className="font-medium">{t(`loadtest.profileName.${config.profile}`)}</span>
                    </div>
                    <div className="text-xs">
                      <span className="text-muted-foreground">{t('loadtest.review.method')}</span>{' '}
                      <span className={`font-medium ${METHOD_COLORS[config.target.method]}`}>{config.target.method}</span>
                    </div>
                    <div className="text-xs col-span-2">
                      <span className="text-muted-foreground">{t('loadtest.review.url')}</span>{' '}
                      <span className="font-mono font-medium break-all">{config.target.url || t('loadtest.review.notSet')}</span>
                    </div>
                    {config.dataFeed && (
                      <div className="text-xs col-span-2">
                        <span className="text-muted-foreground">{t('loadtest.review.dataFeed')}</span>{' '}
                        <span className="font-medium">
                          {t('loadtest.review.feedSummary', { rows: config.dataFeed.rows.length.toLocaleString(), strategy: t(`loadtest.strategyLabel.${config.dataFeed.strategy}`) })}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="border-t pt-2 mt-2">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('loadtest.review.parameters')}</span>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      {config.profile === 'constant' && (
                        <>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.vus')} <span className="font-medium text-foreground">{config.parameters.virtualUsers}</span></span>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.duration')} <span className="font-medium text-foreground">{formatDuration(config.parameters.duration)}</span></span>
                        </>
                      )}
                      {config.profile === 'ramp_up' && (
                        <>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.start')} <span className="font-medium text-foreground">{config.parameters.startVUs} {t('loadtest.vusUnit')}</span></span>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.peak')} <span className="font-medium text-foreground">{config.parameters.maxVUs} {t('loadtest.vusUnit')}</span></span>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.ramp')} <span className="font-medium text-foreground">{formatDuration(config.parameters.rampDuration || 30)}</span></span>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.hold')} <span className="font-medium text-foreground">{formatDuration(config.parameters.holdDuration || 60)}</span></span>
                        </>
                      )}
                      {config.profile === 'spike' && (
                        <>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.normal')} <span className="font-medium text-foreground">{config.parameters.normalVUs} {t('loadtest.vusUnit')}</span></span>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.spike')} <span className="font-medium text-foreground">{config.parameters.spikeVUs} {t('loadtest.vusUnit')}</span></span>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.spikeDur')} <span className="font-medium text-foreground">{formatDuration(config.parameters.spikeDuration || 10)}</span></span>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.total')} <span className="font-medium text-foreground">{formatDuration(config.parameters.duration)}</span></span>
                        </>
                      )}
                      {config.profile === 'soak' && (
                        <>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.vus')} <span className="font-medium text-foreground">{config.parameters.virtualUsers}</span></span>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.duration')} <span className="font-medium text-foreground">{formatDuration(config.parameters.duration)}</span></span>
                        </>
                      )}
                      {config.profile === 'stress' && (
                        <>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.maxVus')} <span className="font-medium text-foreground">{config.parameters.maxVUs}</span></span>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.stopAt')} <span className="font-medium text-foreground">{t('loadtest.review.stopAtValue', { count: config.parameters.maxErrorRate })}</span></span>
                          <span className="text-xs text-muted-foreground">{t('loadtest.review.maxDur')} <span className="font-medium text-foreground">{formatDuration(config.parameters.duration)}</span></span>
                        </>
                      )}
                      {(config.parameters.thinkTime || 0) > 0 && (
                        <span className="text-xs text-muted-foreground col-span-2">{t('loadtest.review.thinkTime')} <span className="font-medium text-foreground">{config.parameters.thinkTime}ms</span></span>
                      )}
                    </div>
                  </div>

                  <div className="border-t pt-2 mt-2">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('loadtest.review.thresholds')}</span>
                    <div className="grid grid-cols-1 gap-0.5 mt-1">
                      <span className="text-xs text-muted-foreground">{t('loadtest.review.maxResponseTime')} <span className="font-medium text-foreground">{config.thresholds.maxResponseTime}ms</span></span>
                      <span className="text-xs text-muted-foreground">{t('loadtest.review.maxErrorRate')} <span className="font-medium text-foreground">{config.thresholds.maxErrorRate}%</span></span>
                      <span className="text-xs text-muted-foreground">{t('loadtest.review.p95ResponseTime')} <span className="font-medium text-foreground">{config.thresholds.p95ResponseTime}ms</span></span>
                    </div>
                  </div>
                </div>

                <LoadShapePreview config={config} />
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-4 py-3 border-t flex-row gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={step === 0}
            onClick={() => setStep((s) => s - 1)}
          >
            <ChevronLeft className="h-3 w-3 mr-1" />
            {t('loadtest.back')}
          </Button>
          <div className="flex-1" />
          {step < totalSteps - 1 ? (
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!canNext()}
              onClick={() => setStep((s) => s + 1)}
            >
              {t('loadtest.next')}
              <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
              disabled={isSubmitting || !name.trim()}
              onClick={handleSubmit}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  {t('loadtest.starting')}
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 mr-1" />
                  {t('loadtest.startTest')}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════
// ── RESULTS VIEW ──
// ══════════════════════════════════════════

function LoadTestResultsView({
  test,
  onBack,
  onRunAgain,
  onQuickRun,
  onRefresh,
}: {
  test: LoadTestSummary;
  onBack: () => void;
  onRunAgain: (config: LoadTestConfig) => void;
  onQuickRun: (config: LoadTestConfig, name: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const { t } = useTranslation('qa');
  const isRunning = test.status === 'running';
  const [isCancelling, setIsCancelling] = useState(false);
  const [isQuickRunning, setIsQuickRunning] = useState(false);
  const [liveTest, setLiveTest] = useState<LoadTestSummary>(test);
  const esRef = useRef<EventSource | ReturnType<typeof setInterval> | null>(null);

  // Prefer SSE-populated liveTest.results; fall back to prop results when the
  // stream hasn't delivered its first frame yet or the test is no longer running.
  const results = liveTest.results ?? test.results;

  // Reset liveTest only when the user switches to a different test. Syncing on
  // every `test` ref change would wipe SSE-delivered results whenever the
  // parent refetches with a still-empty results field.
  useEffect(() => {
    setLiveTest(test);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test.id]);

  // Use SSE for live results while running
  useEffect(() => {
    if (test.status !== 'running') {
      const ref = esRef.current;
      if (ref) {
        if (ref instanceof EventSource) {
          ref.close();
        } else {
          clearInterval(ref as unknown as ReturnType<typeof setInterval>);
        }
        esRef.current = null;
      }
      return;
    }

    const baseUrl = getRemoteBaseUrl();
    const token = localStorage.getItem('patchman_token');
    const sseUrl = `${baseUrl}/load-tests/${test.id}/live${token ? `?token=${token}` : ''}`;

    try {
      const es = new EventSource(sseUrl);
      esRef.current = es;

      // Backend sends named events: "connected", "result", "done"
      es.addEventListener('result', (event) => {
        try {
          const raw = JSON.parse(event.data);
          const normalized = normalizeTestSummary({ ...test, results: raw, status: 'running' });
          setLiveTest(normalized);
        } catch {
          // Ignore parse errors from SSE
        }
      });

      es.addEventListener('done', (event) => {
        try {
          const info = JSON.parse(event.data);
          setLiveTest((prev) => ({ ...prev, status: info.status || 'completed' }));
        } catch {
          // ignore
        }
        es.close();
        esRef.current = null;
        onRefresh();
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        // Fallback: poll every 2s while test is running
        const fallbackInterval = setInterval(() => { onRefresh(); }, 2000);
        // Store interval ID so cleanup can clear it
        (esRef as React.MutableRefObject<unknown>).current = fallbackInterval;
      };
    } catch {
      // EventSource not supported or URL error, fallback to polling
      const fallbackInterval = setInterval(() => { onRefresh(); }, 2000);
      (esRef as React.MutableRefObject<unknown>).current = fallbackInterval;
    }

    return () => {
      const ref = esRef.current;
      if (ref) {
        if (ref instanceof EventSource) {
          ref.close();
        } else {
          // It's a fallback polling interval
          clearInterval(ref as unknown as ReturnType<typeof setInterval>);
        }
        esRef.current = null;
      }
    };
  }, [test.id, test.status, onRefresh]);

  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      await loadTestAPI.cancel(test.id);
      onRefresh();
    } catch {
      // Error handled
    }
    setIsCancelling(false);
  };

  const handleDelete = async () => {
    try {
      await loadTestAPI.delete(test.id);
      onBack();
    } catch {
      // Error handled
    }
  };

  const errorRateColor = (rate: number) =>
    rate < 5 ? 'text-green-500' : rate < 10 ? 'text-yellow-500' : 'text-red-500';

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={onBack}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate">{test.name}</h3>
            {statusBadge(t, test.status)}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {formatDate(test.createdAt)}
            {results && ` | ${formatDuration(Math.round(results.duration / 1000))}`}
          </p>
        </div>
      </div>

      {/* Running Indicator */}
      {isRunning && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg border border-yellow-500/20 bg-yellow-500/5">
          <div className="relative">
            <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />
            <div className="absolute inset-0 h-4 w-4 rounded-full bg-yellow-500/20 animate-ping" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400">{t('loadtest.running')}</p>
            <p className="text-[10px] text-yellow-600/70 dark:text-yellow-400/60">{t('loadtest.runningSub')}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs border-yellow-500/30 text-yellow-600 hover:bg-yellow-500/10"
            disabled={isCancelling}
            onClick={handleCancel}
          >
            {isCancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3 mr-1" />}
            {t('loadtest.cancel')}
          </Button>
        </div>
      )}

      {/* Summary Cards */}
      {results && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              icon={Activity}
              label={t('loadtest.statTotalRequests')}
              value={results.totalRequests.toLocaleString()}
              sub={t('loadtest.statReqPerSec', { value: results.requestsPerSecond.toFixed(1) })}
            />
            <StatCard
              icon={Timer}
              label={t('loadtest.statAvgResponse')}
              value={`${Math.round(results.avgResponseTime)}ms`}
              sub={t('loadtest.statMinMax', { min: Math.round(results.minResponseTime), max: Math.round(results.maxResponseTime) })}
            />
            <StatCard
              icon={AlertTriangle}
              label={t('loadtest.statErrorRate')}
              value={`${results.errorRate.toFixed(1)}%`}
              color={errorRateColor(results.errorRate)}
              sub={t('loadtest.statErrorsCount', { count: results.errorCount })}
            />
            <StatCard
              icon={BarChart3}
              label={t('loadtest.statP95Response')}
              value={`${Math.round(results.p95ResponseTime)}ms`}
            />
          </div>

          {/* Charts */}
          <ResponseTimeChart timeline={results.timeline} />
          <ActiveUsersChart timeline={results.timeline} />
          <StatusCodesChart statusCodes={results.statusCodes} />

          {/* Errors List */}
          {results.errors && results.errors.length > 0 && (
            <div className="border rounded-lg p-3 bg-card">
              <div className="flex items-center gap-1.5 mb-2">
                <XCircle className="h-3 w-3 text-red-500" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('loadtest.errorsHeader')}</span>
              </div>
              <div className="space-y-1.5">
                {results.errors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 p-1.5 rounded bg-red-500/5 border border-red-500/10">
                    <Badge variant="destructive" className="text-[10px] px-1 py-0 shrink-0">
                      {t('loadtest.errorCount', { count: err.count })}
                    </Badge>
                    <span className="text-xs text-red-700 dark:text-red-400 break-all">{err.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Threshold Results */}
          {results.thresholdResults && results.thresholdResults.length > 0 && (
            <div className="border rounded-lg p-3 bg-card">
              <div className="flex items-center gap-1.5 mb-2">
                <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('loadtest.thresholdsHeader')}</span>
              </div>
              <div className="space-y-1.5">
                {results.thresholdResults.map((tr, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {tr.passed ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    )}
                    <span className="text-xs flex-1">{tr.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {typeof tr.actual === 'number' ? (tr.actual % 1 === 0 ? tr.actual : tr.actual.toFixed(1)) : tr.actual}
                      {' / '}
                      {tr.threshold}
                    </span>
                    <Badge
                      variant={tr.passed ? 'secondary' : 'destructive'}
                      className={`text-[10px] px-1 py-0 ${tr.passed ? 'bg-green-500/15 text-green-700 dark:text-green-400' : ''}`}
                    >
                      {tr.passed ? t('loadtest.pass') : t('loadtest.fail')}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* No results yet */}
      {!results && !isRunning && (
        <div className="text-center py-6">
          <Activity className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-xs text-muted-foreground">{t('loadtest.noResults')}</p>
        </div>
      )}

      {/* Action Buttons */}
      {!isRunning && (
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="h-7 text-xs flex-1"
            disabled={isQuickRunning}
            onClick={async () => {
              setIsQuickRunning(true);
              await onQuickRun(test.config, test.name);
              setIsQuickRunning(false);
            }}
          >
            <Play className="h-3 w-3 mr-1" />
            {isQuickRunning ? t('loadtest.starting') : t('loadtest.quickRun')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs flex-1"
            onClick={() => onRunAgain(test.config)}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            {t('loadtest.runAgain')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10"
            onClick={handleDelete}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            {t('loadtest.delete')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// ── Normalizer: backend → frontend shape ──
// ══════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeTestSummary(raw: any): LoadTestSummary {
  // Normalize config: backend stores thresholds inside parameters
  let config = raw.config;
  if (config && typeof config === 'object') {
    const params = config.parameters || {};
    config = {
      profile: config.profile || 'constant',
      target: {
        method: config.target?.method || 'GET',
        url: config.target?.url || '',
        headers: Array.isArray(config.target?.headers)
          ? config.target.headers
          : Object.entries(config.target?.headers || {}).map(([k, v]) => ({ key: k, value: v as string })),
        body: config.target?.body || '',
      },
      parameters: {
        virtualUsers: params.virtualUsers || 10,
        duration: params.duration || 30,
        thinkTime: params.thinkTime || 0,
        startVUs: params.startVUs,
        maxVUs: params.rampUpUsers || params.maxVUs,
        rampDuration: params.rampUpTime || params.rampDuration,
        holdDuration: params.holdDuration,
        normalVUs: params.normalVUs,
        spikeVUs: params.spikeUsers || params.spikeVUs,
        spikeDuration: params.spikeDuration,
        maxErrorRate: params.maxErrorRate,
      },
      thresholds: params.thresholds || config.thresholds || {
        maxResponseTime: 5000,
        maxErrorRate: 10,
        p95ResponseTime: 2000,
      },
    };
  }

  // Normalize results: map backend field names to frontend field names
  let results: LoadTestResults | undefined;
  if (raw.results && typeof raw.results === 'object' && raw.results.totalRequests != null) {
    const r = raw.results;
    // Normalize timeline entries
    const timeline: TimelinePoint[] = (r.timeline || []).map((t: any) => ({
      second: t.second,
      avgResponseTime: t.avgResponseTime ?? t.avgTime ?? 0,
      activeUsers: t.activeUsers ?? 0,
      requestCount: t.requestCount ?? t.requests ?? 0,
      errorCount: t.errorCount ?? t.errors ?? 0,
    }));
    // Normalize thresholdResults: backend is map, frontend is array
    let thresholdResults: { name: string; threshold: number; actual: number; passed: boolean }[] = [];
    if (r.thresholdResults) {
      if (Array.isArray(r.thresholdResults)) {
        thresholdResults = r.thresholdResults;
      } else {
        thresholdResults = Object.entries(r.thresholdResults).map(([name, tr]: [string, any]) => ({
          name,
          threshold: tr.threshold,
          actual: tr.actual,
          passed: tr.passed,
        }));
      }
    }
    results = {
      totalRequests: r.totalRequests ?? 0,
      requestsPerSecond: r.requestsPerSecond ?? 0,
      avgResponseTime: r.avgResponseTime ?? 0,
      minResponseTime: r.minResponseTime ?? 0,
      maxResponseTime: r.maxResponseTime ?? 0,
      p95ResponseTime: r.p95ResponseTime ?? 0,
      errorRate: r.errorRate ?? 0,
      errorCount: r.failedRequests ?? r.errorCount ?? 0,
      duration: r.totalDuration ?? r.duration ?? 0,
      statusCodes: r.statusCodes || {},
      errors: r.errors || [],
      timeline,
      thresholdResults,
    };
  }

  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    status: raw.status,
    config,
    createdAt: raw.createdAt,
    results,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ══════════════════════════════════════════
// ── MAIN PANEL ──
// ══════════════════════════════════════════

export function LoadTestPanel() {
  const { t } = useTranslation('qa');
  const [tests, setTests] = useState<LoadTestSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardInitialConfig, setWizardInitialConfig] = useState<LoadTestConfig | undefined>();
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [selectedTest, setSelectedTest] = useState<LoadTestSummary | null>(null);

  const fetchTests = useCallback(async () => {
    try {
      const res = await loadTestAPI.list();
      const raw = Array.isArray(res.data) ? res.data : [];
      setTests(raw.map(normalizeTestSummary));
    } catch {
      setTests([]);
    }
    setIsLoading(false);
  }, []);

  const fetchTestDetail = useCallback(async (id: string) => {
    try {
      const res = await loadTestAPI.get(id);
      setSelectedTest(normalizeTestSummary(res.data));
    } catch {
      // Error handled
    }
  }, []);

  useEffect(() => {
    fetchTests();
  }, [fetchTests]);

  useEffect(() => {
    if (selectedTestId) {
      fetchTestDetail(selectedTestId);
    }
  }, [selectedTestId, fetchTestDetail]);

  const handleCreated = (newId?: string) => {
    fetchTests();
    setWizardInitialConfig(undefined);
    // Drop the user into the live results view immediately. Without this they
    // see the list and have to click the just-created test to watch results
    // stream in via SSE.
    if (newId) {
      setSelectedTestId(newId);
      fetchTestDetail(newId);
    }
  };

  const handleRunAgain = (config: LoadTestConfig) => {
    setWizardInitialConfig(config);
    setSelectedTestId(null);
    setSelectedTest(null);
    setWizardOpen(true);
  };

  const handleQuickRun = useCallback(async (config: LoadTestConfig, baseName: string) => {
    // Build backend config from frontend config (same as wizard submit)
    const headersMap: Record<string, string> = {};
    for (const h of config.target.headers) {
      if (h.key.trim()) headersMap[h.key] = h.value;
    }
    const backendConfig = {
      profile: config.profile,
      target: {
        method: config.target.method,
        url: config.target.url,
        headers: Object.keys(headersMap).length > 0 ? headersMap : undefined,
        body: config.target.body || undefined,
      },
      parameters: {
        virtualUsers: config.parameters.virtualUsers,
        duration: config.parameters.duration,
        thinkTime: config.parameters.thinkTime || 0,
        rampUpTime: config.parameters.rampDuration || 0,
        rampUpUsers: config.parameters.maxVUs || 0,
        spikeUsers: config.parameters.spikeVUs || 0,
        spikeDuration: config.parameters.spikeDuration || 0,
        thresholds: config.thresholds,
      },
      // Optional data feed — carried through quick-run (re-run) so the row
      // dataset + strategy survive. Shape matches the BE loadTestDataFeed.
      dataFeed: config.dataFeed,
    };
    const today = new Date().toISOString().slice(0, 10);
    const name = `${baseName.replace(/ - \d{4}-\d{2}-\d{2}$/, '')} - ${today}`;
    try {
      const res = await loadTestAPI.create({ name, config: backendConfig });
      // Navigate to the newly created test
      const newId = (res.data as { id?: string })?.id;
      if (newId) {
        setSelectedTestId(newId);
        fetchTestDetail(newId);
      } else {
        fetchTests();
        setSelectedTestId(null);
        setSelectedTest(null);
      }
    } catch {
      // Error handled by interceptor
    }
  }, [fetchTestDetail, fetchTests]);

  const handleRefreshDetail = useCallback(() => {
    if (selectedTestId) {
      fetchTestDetail(selectedTestId);
    }
  }, [selectedTestId, fetchTestDetail]);

  // ── Detail View ──
  if (selectedTest) {
    return (
      <div className="space-y-3">
        <LoadTestResultsView
          test={selectedTest}
          onBack={() => {
            setSelectedTestId(null);
            setSelectedTest(null);
            fetchTests();
          }}
          onRunAgain={handleRunAgain}
          onQuickRun={handleQuickRun}
          onRefresh={handleRefreshDetail}
        />
      </div>
    );
  }

  // ── List View ──
  return (
    <div className="space-y-3">
      {/* New Load Test Button */}
      <button
        onClick={() => {
          setWizardInitialConfig(undefined);
          setWizardOpen(true);
        }}
        className="w-full p-3 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200 cursor-pointer group"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
            <Plus className="h-4 w-4 text-primary" />
          </div>
          <div className="text-left flex-1">
            <p className="text-xs font-semibold text-primary">{t('loadtest.newLoadTest')}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t('loadtest.newLoadTestHint')}
            </p>
          </div>
        </div>
      </button>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 text-primary animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && tests.length === 0 && (
        <div className="text-center py-8">
          <Activity className="h-10 w-10 mx-auto text-muted-foreground/20 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">{t('loadtest.empty')}</p>
          <p className="text-xs text-muted-foreground/70 mt-1">{t('loadtest.emptyHint')}</p>
        </div>
      )}

      {/* Test List */}
      {!isLoading && tests.length > 0 && (
        <div className="space-y-2">
          {tests.map((test) => {
            const profile = PROFILES.find((p) => p.id === test.config?.profile);
            const Icon = profile?.icon || Activity;
            return (
              <div
                key={test.id}
                className="border rounded-lg p-2.5 bg-card hover:bg-accent/30 transition-colors cursor-pointer group"
                onClick={() => setSelectedTestId(test.id)}
              >
                <div className="flex items-start gap-2.5">
                  <div className="p-1.5 rounded-md bg-muted group-hover:bg-primary/10 transition-colors shrink-0">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold truncate">{test.name}</span>
                      {statusBadge(t, test.status)}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDate(test.createdAt)}
                    </p>
                    {test.results && (
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[10px] text-muted-foreground">
                          <span className="font-medium text-foreground">{test.results.totalRequests.toLocaleString()}</span> {t('loadtest.reqsLabel')}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          <span className="font-medium text-foreground">{Math.round(test.results.avgResponseTime)}ms</span> {t('loadtest.avgLabel')}
                        </span>
                        <span className={`text-[10px] ${test.results.errorRate < 5 ? 'text-green-600 dark:text-green-400' : test.results.errorRate < 10 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`}>
                          <span className="font-medium">{test.results.errorRate.toFixed(1)}%</span> {t('loadtest.errLabel')}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTestId(test.id);
                            }}
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left"><p>{t('loadtest.viewDetails')}</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-600"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await loadTestAPI.delete(test.id);
                                fetchTests();
                              } catch {
                                // Error handled
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left"><p>{t('loadtest.deleteTest')}</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Wizard */}
      <LoadTestWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={handleCreated}
        initialConfig={wizardInitialConfig}
      />
    </div>
  );
}
