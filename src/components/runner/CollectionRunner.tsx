import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Timer,
  Hash,
  Zap,
  RotateCcw,
  Upload,
  AlertTriangle,
  Eye,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { runnerAPI } from '@/services/api';
import { useCollectionStore } from '@/stores/collectionStore';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { useAuthStore } from '@/stores/authStore';
import type { RunnerResult } from '@/types';

interface CollectionRunnerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const methodColors: Record<string, string> = {
  GET: 'bg-green-500/15 text-green-700 dark:text-green-400',
  POST: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  PUT: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  PATCH: 'bg-purple-500/15 text-purple-700 dark:text-purple-400',
  DELETE: 'bg-red-500/15 text-red-700 dark:text-red-400',
  HEAD: 'bg-gray-500/15 text-gray-700 dark:text-gray-400',
  OPTIONS: 'bg-gray-500/15 text-gray-700 dark:text-gray-400',
};

function statusCodeVariant(code: number) {
  if (code >= 200 && code < 300) return 'success' as const;
  if (code >= 400 && code < 500) return 'warning' as const;
  if (code >= 500) return 'destructive' as const;
  return 'secondary' as const;
}

export function CollectionRunner(props: CollectionRunnerProps) {
  const { t } = useTranslation('runner');
  const isLocal = useAuthStore((s) => s.mode === 'local');
  if (isLocal) {
    return (
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>
              {t('localOnly')}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }
  return <AuthenticatedCollectionRunner {...props} />;
}

function AuthenticatedCollectionRunner({ open, onOpenChange }: CollectionRunnerProps) {
  const { t } = useTranslation('runner');
  const { collections, fetchCollections } = useCollectionStore();
  const { environments, fetchEnvironments } = useEnvironmentStore();

  const [collectionId, setCollectionId] = useState('');
  const [environmentId, setEnvironmentId] = useState('');
  const [iterations, setIterations] = useState(1);
  const [delay, setDelay] = useState(0);
  const [dataDrivenJson, setDataDrivenJson] = useState('');
  const [activeTab, setActiveTab] = useState('options');

  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<RunnerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());
  const [dataJsonError, setDataJsonError] = useState<string | null>(null);
  const [dataPreview, setDataPreview] = useState<{ count: number; firstRow: Record<string, string> } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      fetchCollections();
      fetchEnvironments();
    }
  }, [open, fetchCollections, fetchEnvironments]);

  // Validate data-driven JSON in real-time
  useEffect(() => {
    const trimmed = dataDrivenJson.trim();
    if (!trimmed) {
      setDataJsonError(null);
      setDataPreview(null);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        setDataJsonError(t('validation.notArray'));
        setDataPreview(null);
        return;
      }
      if (parsed.length === 0) {
        setDataJsonError(t('validation.empty'));
        setDataPreview(null);
        return;
      }
      for (let i = 0; i < parsed.length; i++) {
        if (typeof parsed[i] !== 'object' || parsed[i] === null || Array.isArray(parsed[i])) {
          setDataJsonError(t('validation.itemNotObject', { index: i }));
          setDataPreview(null);
          return;
        }
      }
      setDataJsonError(null);
      setDataPreview({ count: parsed.length, firstRow: parsed[0] });
    } catch (e) {
      setDataJsonError(e instanceof Error ? e.message : t('validation.invalidJson'));
      setDataPreview(null);
    }
  }, [dataDrivenJson, t]);

  const handleLoadFromFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') {
        setDataDrivenJson(text);
      }
    };
    reader.onerror = () => {
      setDataJsonError(t('validation.readFailed'));
    };
    reader.readAsText(file);
    // Reset file input so the same file can be selected again
    e.target.value = '';
  }, [t]);

  const handleRun = useCallback(async () => {
    if (!collectionId) return;

    setIsRunning(true);
    setResult(null);
    setError(null);
    setExpandedErrors(new Set());

    try {
      // Check if data-driven mode
      const trimmedJson = dataDrivenJson.trim();
      let response;

      if (trimmedJson) {
        let parsedData: Record<string, string>[];
        try {
          parsedData = JSON.parse(trimmedJson);
          if (!Array.isArray(parsedData)) {
            throw new Error(t('validation.notArray'));
          }
          for (let i = 0; i < parsedData.length; i++) {
            if (typeof parsedData[i] !== 'object' || parsedData[i] === null || Array.isArray(parsedData[i])) {
              throw new Error(t('validation.itemNotObject', { index: i }));
            }
          }
        } catch (parseErr) {
          setError(
            parseErr instanceof Error
              ? t('run.invalidData', { message: parseErr.message })
              : t('run.invalidDataGeneric')
          );
          setIsRunning(false);
          return;
        }

        response = await runnerAPI.dataDriven({
          collectionId,
          environmentId: environmentId || undefined,
          data: parsedData,
          delay: delay > 0 ? delay : undefined,
        });
      } else {
        response = await runnerAPI.run({
          collectionId,
          environmentId: environmentId || undefined,
          iterations: iterations > 1 ? iterations : undefined,
          delay: delay > 0 ? delay : undefined,
        });
      }

      setResult(response.data as RunnerResult);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'response' in err
            ? ((err as { response?: { data?: { error?: string } } }).response?.data?.error ??
              t('run.failed'))
            : t('run.failed');
      setError(message);
    } finally {
      setIsRunning(false);
    }
  }, [collectionId, environmentId, iterations, delay, dataDrivenJson, t]);

  // Retry only failed requests
  const handleRetryFailed = useCallback(async () => {
    if (!result || !collectionId) return;
    const failedItems = result.results.filter((r) => !r.passed);
    if (failedItems.length === 0) return;

    setIsRunning(true);
    setError(null);

    try {
      // Re-run the full collection - the backend handles all requests
      // We keep the previous result and merge
      const response = await runnerAPI.run({
        collectionId,
        environmentId: environmentId || undefined,
        iterations: 1,
        delay: delay > 0 ? delay : undefined,
      });

      const retryResult = response.data as RunnerResult;
      // Merge: keep passed items from original, update failed items with retry results
      const failedRequestIds = new Set(failedItems.map((f) => f.requestId));
      const mergedResults = result.results.map((item) => {
        if (failedRequestIds.has(item.requestId)) {
          const retried = retryResult.results.find((r) => r.requestId === item.requestId);
          return retried || item;
        }
        return item;
      });

      const passed = mergedResults.filter((r) => r.passed).length;
      const failed = mergedResults.filter((r) => !r.passed).length;

      setResult({
        results: mergedResults,
        summary: {
          total: mergedResults.length,
          passed,
          failed,
          duration: result.summary.duration + retryResult.summary.duration,
        },
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : t('run.retryFailed');
      setError(message);
    } finally {
      setIsRunning(false);
    }
  }, [result, collectionId, environmentId, delay, t]);

  const toggleErrorExpand = (index: number) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
    setExpandedErrors(new Set());
  };

  // Flatten nested collections for the dropdown
  const flatCollections = collections.filter((c) => c.type === 'collection');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            {t('title')}
          </DialogTitle>
          <DialogDescription>
            {t('description')}
          </DialogDescription>
        </DialogHeader>

        {!result && !error ? (
          <div className="space-y-4">
            {/* Collection & Environment selectors */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="collection-select">{t('fields.collection')}</Label>
                <Select value={collectionId} onValueChange={setCollectionId}>
                  <SelectTrigger id="collection-select">
                    <SelectValue placeholder={t('fields.selectCollection')} />
                  </SelectTrigger>
                  <SelectContent>
                    {flatCollections.map((col) => (
                      <SelectItem key={col.id} value={col.id}>
                        {col.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="environment-select">{t('fields.environment')}</Label>
                <Select value={environmentId} onValueChange={setEnvironmentId}>
                  <SelectTrigger id="environment-select">
                    <SelectValue placeholder={t('fields.noEnvironment')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('fields.noEnvironment')}</SelectItem>
                    {environments.map((env) => (
                      <SelectItem key={env.id} value={env.id}>
                        {env.name}
                        {env.isActive && (
                          <span className="ml-1 text-xs text-muted-foreground">{t('fields.active')}</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Options Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full">
                <TabsTrigger value="options" className="flex-1">
                  {t('tabs.options')}
                </TabsTrigger>
                <TabsTrigger value="data" className="flex-1">
                  {t('tabs.dataDriven')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="options">
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="iterations" className="flex items-center gap-1.5">
                      <Hash className="h-3.5 w-3.5" />
                      {t('options.iterations')}
                    </Label>
                    <Input
                      id="iterations"
                      type="number"
                      min={1}
                      max={100}
                      value={iterations}
                      onChange={(e) => setIterations(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="delay" className="flex items-center gap-1.5">
                      <Timer className="h-3.5 w-3.5" />
                      {t('options.delay')}
                    </Label>
                    <Input
                      id="delay"
                      type="number"
                      min={0}
                      max={30000}
                      step={100}
                      value={delay}
                      onChange={(e) => setDelay(Math.max(0, parseInt(e.target.value) || 0))}
                    />
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="data">
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="data-json">
                      {t('data.variableSets')}
                    </Label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleLoadFromFile}
                    >
                      <Upload className="h-3 w-3 mr-1" />
                      {t('data.loadFromFile')}
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={handleFileSelected}
                    />
                  </div>
                  <Textarea
                    id="data-json"
                    placeholder={`[\n  { "baseUrl": "https://api.example.com", "token": "abc123" },\n  { "baseUrl": "https://staging.example.com", "token": "def456" }\n]`}
                    value={dataDrivenJson}
                    onChange={(e) => setDataDrivenJson(e.target.value)}
                    className={cn(
                      "min-h-[120px] font-mono text-xs",
                      dataJsonError && dataDrivenJson.trim() && "border-destructive focus-visible:ring-destructive"
                    )}
                  />

                  {/* Validation error */}
                  {dataJsonError && dataDrivenJson.trim() && (
                    <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/30">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                      <p className="text-xs text-destructive">{dataJsonError}</p>
                    </div>
                  )}

                  {/* Preview section */}
                  {dataPreview && (
                    <div className="rounded-md border bg-muted/30 p-2 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Eye className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">
                          {t(dataPreview.count === 1 ? 'data.iterationCountOne' : 'data.iterationCountOther', { count: dataPreview.count })}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        <span className="font-medium">{t('data.firstRow')}</span>
                        <pre className="mt-0.5 font-mono bg-background rounded p-1.5 overflow-x-auto text-foreground">
                          {JSON.stringify(dataPreview.firstRow, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {t('data.hint')}
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            {/* Indeterminate progress during execution */}
            {isRunning && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('progress.running')}
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary rounded-full animate-pulse w-full origin-left" style={{ animation: 'indeterminate 1.5s infinite ease-in-out' }} />
                  <style>{`@keyframes indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
                </div>
              </div>
            )}

            {/* Run button */}
            <div className="flex justify-end">
              <Button
                onClick={handleRun}
                disabled={!collectionId || isRunning || (!!dataDrivenJson.trim() && !!dataJsonError)}
                className="min-w-[120px]"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('run.running')}
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    {t('run.runCollection')}
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          /* Results view */
          <div className="flex-1 min-h-0 flex flex-col gap-4">
            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4">
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-destructive shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-destructive">{t('results.runFailed')}</p>
                    <p className="text-xs text-destructive/80 mt-1">{error}</p>
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    {t('results.tryAgain')}
                  </Button>
                </div>
              </div>
            )}

            {result && (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold">{result.summary.total}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('results.total')}</p>
                  </div>
                  <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3 text-center">
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {result.summary.passed}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('results.passed')}</p>
                  </div>
                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-center">
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                      {result.summary.failed}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('results.failed')}</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-2xl font-bold">{result.summary.duration}ms</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('results.duration')}</p>
                  </div>
                </div>

                {/* Completion progress bar */}
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-500 transition-all duration-500"
                    style={{
                      width: `${result.summary.total > 0 ? (result.summary.passed / result.summary.total) * 100 : 0}%`,
                    }}
                  />
                </div>

                {/* Results table */}
                <ScrollArea className="flex-1 min-h-0 max-h-[340px]">
                  <div className="space-y-1">
                    {result.results.map((item, index) => (
                      <div key={index}>
                        <div
                          className={cn(
                            'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                            item.error
                              ? 'hover:bg-red-500/5 cursor-pointer'
                              : 'hover:bg-accent'
                          )}
                          onClick={() => item.error && toggleErrorExpand(index)}
                        >
                          {/* Expand arrow for failed items */}
                          <div className="w-4 shrink-0">
                            {item.error && (
                              expandedErrors.has(index) ? (
                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                              )
                            )}
                          </div>

                          {/* Pass/Fail icon */}
                          {item.passed ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                          )}

                          {/* Iteration badge */}
                          {item.iteration !== undefined && item.iteration > 0 && (
                            <Badge variant="outline" className="text-[10px] px-1 shrink-0">
                              #{item.iteration}
                            </Badge>
                          )}

                          {/* Method badge */}
                          <span
                            className={cn(
                              'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0',
                              methodColors[item.method.toUpperCase()] || 'bg-gray-500/15 text-gray-700'
                            )}
                          >
                            {item.method}
                          </span>

                          {/* Request name */}
                          <span className="font-medium truncate min-w-0 flex-1">
                            {item.name || t('results.untitledRequest')}
                          </span>

                          {/* URL truncated */}
                          <span className="text-xs text-muted-foreground truncate max-w-[160px] hidden sm:block">
                            {item.url}
                          </span>

                          {/* Status code */}
                          <Badge variant={statusCodeVariant(item.statusCode)} className="shrink-0">
                            {item.statusCode}
                          </Badge>

                          {/* Duration */}
                          <span className="text-xs text-muted-foreground shrink-0 w-14 text-right">
                            {item.duration}ms
                          </span>
                        </div>

                        {/* Expanded error details */}
                        {item.error && expandedErrors.has(index) && (
                          <div className="ml-8 mr-3 mb-1 p-2 rounded bg-red-500/5 border border-red-500/20 space-y-1.5">
                            <p className="text-xs font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap">
                              {item.error}
                            </p>
                            {/* Show response body snippet if available */}
                            {(() => {
                              const body = (item as Record<string, unknown>).responseBody;
                              if (!body) return null;
                              const text = String(body);
                              return (
                                <div className="border-t border-red-500/10 pt-1.5">
                                  <p className="text-[10px] text-muted-foreground font-medium mb-0.5">{t('results.responseBody')}</p>
                                  <pre className="text-[10px] font-mono text-red-600/80 dark:text-red-400/80 whitespace-pre-wrap max-h-[80px] overflow-hidden">
                                    {text.substring(0, 500)}{text.length > 500 ? '...' : ''}
                                  </pre>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2 border-t">
                  {result.summary.failed > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRetryFailed}
                      disabled={isRunning}
                    >
                      {isRunning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      {t('results.retryFailedCount', { count: result.summary.failed })}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    <Zap className="h-3.5 w-3.5" />
                    {t('results.runAgain')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
