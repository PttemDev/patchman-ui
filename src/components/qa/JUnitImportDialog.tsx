import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import {
  Upload,
  UploadCloud,
  FileText,
  Loader2,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  MinusCircle,
  X,
} from 'lucide-react';
import { junitAPI, testPlansAPI } from '@/services/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { TestPlan } from '@/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { JUnitImportResult, JUnitSuiteDetail, JUnitTestCaseDetail } from '@/types';

interface JUnitImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testPlanId?: string;
}

// Sentinel that survives Radix Select's empty-string trap so "no plan"
// can be a real, addressable option in the dropdown.
const PLAN_NONE = '__none__';

export function JUnitImportDialog({ open, onOpenChange, testPlanId }: JUnitImportDialogProps) {
  const { t } = useTranslation('qa');
  const [file, setFile] = useState<File | null>(null);
  const [associatedPlanId, setAssociatedPlanId] = useState(testPlanId || PLAN_NONE);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'import' | 'previous'>('import');

  const [imports, setImports] = useState<JUnitImportResult[]>([]);
  const [importsLoading, setImportsLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<JUnitImportResult | null>(null);

  // Test plan dropdown — replaces the free-text Test Plan ID input so
  // users pick from real plans rather than typing UUIDs by hand.
  const [testPlans, setTestPlans] = useState<TestPlan[]>([]);
  const [testPlansLoading, setTestPlansLoading] = useState(false);

  // Dropzone state — drag/drop + click-to-browse with visual feedback.
  // dragDepth ref disambiguates nested-enter/leave events so a child
  // hover doesn't flicker the highlight off + on.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  // Per-row expansion. `expandedId` is the import currently expanded
  // (one at a time keeps the list compact); `detailCache` memoizes the
  // parsed suites array per import id so re-expanding doesn't refetch.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, JUnitSuiteDetail[]>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<Record<string, string>>({});
  // Per-testcase failure-message expansion within a suite. Keyed on
  // `${importId}::${suiteIdx}::${tcIdx}` to avoid collisions across
  // multiple expanded imports (though only one is open at a time today).
  const [openTestKeys, setOpenTestKeys] = useState<Record<string, boolean>>({});

  const toggleExpand = async (imp: JUnitImportResult) => {
    if (expandedId === imp.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(imp.id);
    if (detailCache[imp.id]) return; // already fetched
    setDetailLoadingId(imp.id);
    setDetailError((prev) => ({ ...prev, [imp.id]: '' }));
    try {
      const res = await junitAPI.get(imp.id);
      const row = res.data as JUnitImportResult;
      const suitesRaw = row?.suites;
      let parsed: JUnitSuiteDetail[] = [];
      if (typeof suitesRaw === 'string' && suitesRaw.length > 0) {
        try {
          parsed = JSON.parse(suitesRaw) as JUnitSuiteDetail[];
        } catch {
          parsed = [];
          setDetailError((prev) => ({ ...prev, [imp.id]: t('junit.invalidJsonPayload') }));
        }
      }
      setDetailCache((prev) => ({ ...prev, [imp.id]: parsed }));
    } catch {
      setDetailError((prev) => ({ ...prev, [imp.id]: t('junit.loadDetailsFailed') }));
    }
    setDetailLoadingId(null);
  };

  const toggleTestCase = (key: string) => {
    setOpenTestKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Resolve the dropdown sentinel back to a real id (or empty) before
  // it leaves the component — BE expects no `testPlanId` query at all
  // for "no plan" rather than an empty string.
  const resolvedPlanId = associatedPlanId === PLAN_NONE ? '' : associatedPlanId;

  const fetchImports = useCallback(async () => {
    setImportsLoading(true);
    try {
      const response = await junitAPI.list(resolvedPlanId || undefined);
      setImports(Array.isArray(response.data) ? response.data : []);
    } catch {
      setImports([]);
    }
    setImportsLoading(false);
  }, [resolvedPlanId]);

  const fetchTestPlans = useCallback(async () => {
    setTestPlansLoading(true);
    try {
      const res = await testPlansAPI.list();
      setTestPlans((res.data as TestPlan[]) ?? []);
    } catch {
      setTestPlans([]);
    }
    setTestPlansLoading(false);
  }, []);

  useEffect(() => {
    if (open) {
      fetchImports();
      fetchTestPlans();
      setFile(null);
      setError('');
      setSuccessMessage('');
      setActiveTab('import');
    }
  }, [open, fetchImports, fetchTestPlans]);

  useEffect(() => {
    if (testPlanId) setAssociatedPlanId(testPlanId);
  }, [testPlanId]);

  const acceptFile = (selectedFile: File | undefined | null) => {
    if (!selectedFile) return;
    if (!selectedFile.name.toLowerCase().endsWith('.xml')) {
      setError(t('junit.selectXml'));
      return;
    }
    setFile(selectedFile);
    setError('');
    setSuccessMessage('');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    acceptFile(e.target.files?.[0]);
    // Clear input so picking the same file twice still fires onChange.
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragOver(false);
    if (uploading) return;
    acceptFile(e.dataTransfer.files?.[0]);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (uploading) return;
    dragDepth.current += 1;
    setDragOver(true);
  };

  const handleDragLeave = () => {
    if (uploading) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };

  const openPicker = () => {
    if (uploading) return;
    fileInputRef.current?.click();
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');
    setSuccessMessage('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      await junitAPI.import(formData, resolvedPlanId || undefined);
      setSuccessMessage(t('junit.successMessage', { fileName: file.name }));
      setFile(null);
      await fetchImports();
      // Drop the user into the Previous tab so they can immediately
      // see the new row + expand it for detail.
      setActiveTab('previous');
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response: { data: { error?: string } } }).response?.data?.error || t('junit.importFailed')
          : t('junit.importFailed');
      setError(message);
    }
    setUploading(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await junitAPI.delete(deleteTarget.id);
      await fetchImports();
    } catch {
      // ignore
    }
    setDeleteTarget(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[550px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              {t('junit.title')}
            </DialogTitle>
            <DialogDescription>
              {t('junit.description')}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'import' | 'previous')} className="flex-1 min-h-0 flex flex-col">
            <TabsList className="w-full">
              <TabsTrigger value="import" className="flex-1">{t('junit.tabImport')}</TabsTrigger>
              <TabsTrigger value="previous" className="flex-1">
                {t('junit.tabPrevious')}
                {imports.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-[9px] px-1 py-0">{imports.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="import" className="mt-3 space-y-4">
              <div className="space-y-2">
                <Label>{t('junit.testPlanLabel')}</Label>
                <Select
                  value={associatedPlanId}
                  onValueChange={(v) => setAssociatedPlanId(v)}
                  disabled={testPlansLoading}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder={testPlansLoading ? t('common:loading') : t('junit.noPlanOption')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PLAN_NONE}>
                      <span className="text-muted-foreground">{t('junit.noPlanOption')}</span>
                    </SelectItem>
                    {testPlans.map((tp) => (
                      <SelectItem key={tp.id} value={tp.id}>{tp.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {t('junit.planHint')}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t('junit.fileLabel')}</Label>
                {/* Drag-and-drop zone — large click target, mirrors the
                    pattern used by ImportCollectionDialog. Filters by
                    .xml extension on both drop + browse paths. */}
                <div
                  role="button"
                  tabIndex={uploading ? -1 : 0}
                  onClick={openPicker}
                  onKeyDown={(e) => {
                    if (uploading) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openPicker();
                    }
                  }}
                  onDragEnter={handleDragEnter}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!uploading) e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  aria-disabled={uploading}
                  className={cn(
                    'relative flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed text-center py-8 px-6 transition-colors outline-none',
                    uploading
                      ? 'opacity-50 cursor-not-allowed border-border'
                      : 'cursor-pointer hover:border-primary/60 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring',
                    dragOver && !uploading ? 'border-primary bg-primary/5' : !uploading ? 'border-border' : '',
                  )}
                >
                  <UploadCloud
                    className={cn(
                      'h-7 w-7 transition-colors',
                      dragOver && !uploading ? 'text-primary' : 'text-muted-foreground',
                    )}
                  />
                  <p className="text-sm font-medium">
                    {dragOver && !uploading ? t('junit.dropToUpload') : t('junit.dragHint')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <Trans t={t} i18nKey="junit.xmlOnlyBrowse" components={{ b: <span className="underline underline-offset-2" /> }} />
                  </p>
                  {file && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-foreground/80">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate max-w-[320px]">{file.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {t('junit.fileSize', { size: (file.size / 1024).toFixed(1) })}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFile(null);
                        }}
                        className="p-0.5 rounded hover:bg-muted"
                        aria-label={t('junit.clearSelection')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xml"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}
              {successMessage && (
                <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {successMessage}
                </div>
              )}

              <Button
                size="sm"
                className="w-full h-9 text-xs"
                onClick={handleUpload}
                disabled={!file || uploading}
              >
                {uploading ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />{t('junit.importing')}</>
                ) : (
                  <><Upload className="h-3.5 w-3.5 mr-1" />{t('junit.import')}</>
                )}
              </Button>
            </TabsContent>

            <TabsContent value="previous" className="mt-3 space-y-2 flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {imports.length === 1
                    ? t('junit.importCountOne', { count: imports.length })
                    : t('junit.importCountOther', { count: imports.length })}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={fetchImports}
                  disabled={importsLoading}
                >
                  <RefreshCw className={`h-3 w-3 ${importsLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>

              {importsLoading && imports.length === 0 ? (
                <div className="flex items-center justify-center py-4">
                  <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : imports.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  {t('junit.noPreviousImports')}
                </p>
              ) : (
                <ScrollArea className="h-[280px]">
                  <div className="space-y-1.5 pr-2">
                    {imports.map((imp) => {
                      const isOpen = expandedId === imp.id;
                      const isLoadingDetail = detailLoadingId === imp.id;
                      const suites = detailCache[imp.id];
                      const err = detailError[imp.id];
                      return (
                      <div key={imp.id} className="border rounded-lg bg-card">
                        {/* Header — whole row clickable to expand. The
                            delete button stops propagation so it doesn't
                            also fire the toggle. */}
                        <button
                          type="button"
                          onClick={() => toggleExpand(imp)}
                          className="w-full text-left p-2.5 flex items-start gap-2 hover:bg-accent/30 transition-colors rounded-lg"
                        >
                          <div className="pt-0.5 shrink-0">
                            {isOpen ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium truncate block">
                              {imp.fileName}
                            </span>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <div className="flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                                <span className="text-[10px]">{imp.passed}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <XCircle className="h-3 w-3 text-red-500" />
                                <span className="text-[10px]">{imp.failed}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3 text-yellow-500" />
                                <span className="text-[10px]">{imp.skipped}</span>
                              </div>
                              {imp.errors > 0 && (
                                <div className="flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3 text-orange-500" />
                                  <span className="text-[10px]">{t('junit.errCount', { count: imp.errors })}</span>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="secondary" className="text-[9px] px-1 py-0">
                                {t('junit.testsCount', { count: imp.totalTests })}
                              </Badge>
                              <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                <Clock className="h-2.5 w-2.5" />
                                {imp.duration > 0 ? `${imp.duration.toFixed(2)}s` : t('junit.na')}
                              </div>
                              <span className="text-[10px] text-muted-foreground">
                                {new Date(imp.importedAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(imp);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                setDeleteTarget(imp);
                              }
                            }}
                            className="h-6 w-6 inline-flex items-center justify-center rounded-md text-destructive hover:bg-destructive/10 shrink-0"
                            aria-label={t('junit.deleteImport')}
                          >
                            <Trash2 className="h-3 w-3" />
                          </span>
                        </button>

                        {/* Expanded detail — suite breakdown + clickable
                            failing test cases that reveal the stack trace. */}
                        {isOpen && (
                          <div className="border-t px-2.5 py-2 bg-muted/20 space-y-2">
                            {isLoadingDetail && (
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-2">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                {t('junit.loadingSuiteDetail')}
                              </div>
                            )}
                            {!isLoadingDetail && err && (
                              <p className="text-[11px] text-destructive">{err}</p>
                            )}
                            {!isLoadingDetail && !err && suites && suites.length === 0 && (
                              <p className="text-[11px] text-muted-foreground italic">
                                {t('junit.noSuiteDetail')}
                              </p>
                            )}
                            {!isLoadingDetail && !err && suites && suites.map((suite, sIdx) => (
                              <SuiteSection
                                key={sIdx}
                                suite={suite}
                                openKeys={openTestKeys}
                                onToggleTest={(tcIdx) => toggleTestCase(`${imp.id}::${sIdx}::${tcIdx}`)}
                                keyPrefix={`${imp.id}::${sIdx}`}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('junit.deleteImportTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('junit.deleteImportConfirm', { fileName: deleteTarget?.fileName ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">
              {t('common:delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface SuiteSectionProps {
  suite: JUnitSuiteDetail;
  openKeys: Record<string, boolean>;
  onToggleTest: (tcIdx: number) => void;
  keyPrefix: string;
}

function SuiteSection({ suite, openKeys, onToggleTest, keyPrefix }: SuiteSectionProps) {
  const { t } = useTranslation('qa');
  return (
    <div className="border rounded-md bg-background">
      <div className="px-2.5 py-1.5 border-b bg-muted/40">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium truncate">{suite.name || t('junit.unnamedSuite')}</span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">{t('junit.testsCount', { count: suite.tests })}</span>
          {suite.time > 0 && (
            <>
              <span className="text-[10px] text-muted-foreground">·</span>
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" />
                {suite.time.toFixed(2)}s
              </span>
            </>
          )}
        </div>
      </div>
      <div className="divide-y">
        {suite.testCases?.map((tc, tcIdx) => (
          <TestCaseRow
            key={tcIdx}
            tc={tc}
            isOpen={!!openKeys[`${keyPrefix}::${tcIdx}`]}
            onToggle={() => onToggleTest(tcIdx)}
          />
        ))}
        {(!suite.testCases || suite.testCases.length === 0) && (
          <p className="text-[10px] italic text-muted-foreground px-2.5 py-1.5">
            {t('junit.noTestCasesInSuite')}
          </p>
        )}
      </div>
    </div>
  );
}

interface TestCaseRowProps {
  tc: JUnitTestCaseDetail;
  isOpen: boolean;
  onToggle: () => void;
}

// TestCaseRow shows one test case with a status icon, name, and timing.
// Failed / errored cases get a chevron — clicking expands the failure
// message + stack trace pulled from the JUnit XML's <failure>/<error>
// body. Passed and skipped cases stay collapsed (no extra detail to
// reveal); skipped shows its message inline.
function TestCaseRow({ tc, isOpen, onToggle }: TestCaseRowProps) {
  const hasDetail = tc.status === 'failed' || tc.status === 'error';
  const Icon =
    tc.status === 'passed'
      ? CheckCircle2
      : tc.status === 'failed'
        ? XCircle
        : tc.status === 'error'
          ? AlertTriangle
          : MinusCircle;
  const iconColor =
    tc.status === 'passed'
      ? 'text-green-500'
      : tc.status === 'failed'
        ? 'text-red-500'
        : tc.status === 'error'
          ? 'text-orange-500'
          : 'text-yellow-500';
  return (
    <div className="px-2.5 py-1.5">
      <button
        type="button"
        onClick={hasDetail ? onToggle : undefined}
        disabled={!hasDetail}
        className={`w-full text-left flex items-start gap-2 ${
          hasDetail ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
        }`}
      >
        {hasDetail ? (
          isOpen ? (
            <ChevronDown className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 mt-0.5 text-muted-foreground shrink-0" />
          )
        ) : (
          <span className="h-3 w-3 shrink-0" />
        )}
        <Icon className={`h-3 w-3 mt-0.5 shrink-0 ${iconColor}`} />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] truncate">{tc.name}</p>
          {tc.className && (
            <p className="text-[10px] text-muted-foreground truncate">{tc.className}</p>
          )}
          {tc.status === 'skipped' && tc.message && (
            <p className="text-[10px] text-yellow-600 dark:text-yellow-400 italic mt-0.5">
              {tc.message}
            </p>
          )}
        </div>
        {tc.time > 0 && (
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
            {tc.time.toFixed(2)}s
          </span>
        )}
      </button>
      {hasDetail && isOpen && (
        <div className="mt-1.5 ml-7 space-y-1">
          {tc.message && (
            <p className="text-[11px] font-medium text-destructive">{tc.message}</p>
          )}
          {tc.detail && (
            <pre className="text-[10px] font-mono whitespace-pre-wrap break-words bg-muted/60 border rounded p-2 max-h-[200px] overflow-auto">
              {tc.detail.trim()}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
