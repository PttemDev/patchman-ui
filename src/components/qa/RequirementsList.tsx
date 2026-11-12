import { useEffect, useState, useCallback, createContext, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  Plus,
  FileText,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Link2,
  Pencil,
  Trash2,
  X,
  Check,
} from 'lucide-react';
import { getRepo } from '@/data';
import { testCasesAPI, requirementsAPI } from '@/services/api';
import type { TraceabilityEntry } from '@/data/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import type { Requirement, TestCase } from '@/types';

const TYPE_CONFIG: Record<string, { labelKey: string; color: string }> = {
  functional: { labelKey: 'reqType.functional', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  non_functional: { labelKey: 'reqType.non_functional', color: 'bg-purple-500/15 text-purple-700 dark:text-purple-400' },
  user_story: { labelKey: 'reqType.user_story', color: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  epic: { labelKey: 'reqType.epic', color: 'bg-orange-500/15 text-orange-700 dark:text-orange-400' },
};

const PRIORITY_CONFIG: Record<string, { labelKey: string; color: string; dot: string }> = {
  critical: { labelKey: 'reqPriority.critical', color: 'text-red-600 dark:text-red-400', dot: 'bg-red-500' },
  high: { labelKey: 'reqPriority.high', color: 'text-orange-600 dark:text-orange-400', dot: 'bg-orange-500' },
  medium: { labelKey: 'reqPriority.medium', color: 'text-yellow-600 dark:text-yellow-400', dot: 'bg-yellow-500' },
  low: { labelKey: 'reqPriority.low', color: 'text-gray-500', dot: 'bg-gray-400' },
};

const STATUS_CONFIG: Record<string, { labelKey: string; icon: React.ElementType; color: string }> = {
  draft: { labelKey: 'reqStatus.draft', icon: Clock, color: 'text-gray-400' },
  approved: { labelKey: 'reqStatus.approved', icon: CheckCircle2, color: 'text-blue-500' },
  implemented: { labelKey: 'reqStatus.implemented', icon: CheckCircle2, color: 'text-green-500' },
  deprecated: { labelKey: 'reqStatus.deprecated', icon: XCircle, color: 'text-red-400' },
};

type TraceabilityLink = TraceabilityEntry['testCases'][number];

const TraceabilityContext = createContext<Map<string, TraceabilityLink[]>>(new Map());

function getLinkedTestCases(
  traceabilityMap: Map<string, TraceabilityLink[]>,
  reqId: string,
): TraceabilityLink[] {
  return traceabilityMap.get(reqId) || [];
}

// ── Requirement Editor (Create + Edit) ──

function RequirementEditorDialog({
  open,
  onOpenChange,
  requirement,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requirement: Requirement | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation('qa');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<Requirement['type']>('functional');
  const [priority, setPriority] = useState<Requirement['priority']>('medium');
  const [status, setStatus] = useState<Requirement['status']>('draft');
  const [externalRef, setExternalRef] = useState('');
  const [tags, setTags] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (requirement) {
      setTitle(requirement.title);
      setDescription(requirement.description);
      setType(requirement.type);
      setPriority(requirement.priority);
      setStatus(requirement.status);
      setExternalRef(requirement.externalRef || '');
      setTags(Array.isArray(requirement.tags) ? requirement.tags.join(', ') : '');
    } else {
      setTitle('');
      setDescription('');
      setType('functional');
      setPriority('medium');
      setStatus('draft');
      setExternalRef('');
      setTags('');
    }
  }, [requirement, open]);

  const handleSave = async () => {
    if (!title.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        type,
        priority,
        status,
        externalRef: externalRef.trim() || undefined,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (requirement) {
        await getRepo().requirements.update(requirement.id, payload);
      } else {
        await getRepo().requirements.create(payload);
      }
      onSaved();
      onOpenChange(false);
    } catch {
      // surfaced via interceptor
    } finally {
      setIsSaving(false);
    }
  };

  const isEditing = !!requirement;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-blue-500" />
            {isEditing ? t('requirements.editTitle') : t('requirements.newTitle')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isEditing
              ? t('requirements.editDescription')
              : t('requirements.createDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('requirements.titleLabel')}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('requirements.titlePlaceholder')}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('requirements.descriptionLabel')}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('requirements.descriptionPlaceholder')}
              rows={3}
              className="text-xs"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('common:type')}</Label>
              <Select value={type} onValueChange={(v) => setType(v as Requirement['type'])}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      {t(cfg.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('requirements.priorityLabel')}</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Requirement['priority'])}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                        {t(cfg.labelKey)}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('common:status')}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Requirement['status'])}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      {t(cfg.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('requirements.externalRefLabel')}</Label>
            <Input
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              placeholder={t('requirements.externalRefPlaceholder')}
              className="h-8 text-xs"
            />
            <p className="text-sm text-muted-foreground">
              {t('requirements.externalRefHint')}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('requirements.tagsLabel')}</Label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t('requirements.tagsPlaceholder')}
              className="h-8 text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs h-8">
            {t('common:cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!title.trim() || isSaving}
            className="text-xs h-8"
          >
            {isSaving ? (
              <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
            ) : (
              <Plus className="h-3 w-3 mr-1" />
            )}
            {isEditing ? t('requirements.saveChanges') : t('requirements.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Link Test Cases Dialog ──

function LinkTestCasesDialog({
  open,
  onOpenChange,
  requirementId,
  linkedIds,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requirementId: string | null;
  linkedIds: Set<string>;
  onChanged: () => void;
}) {
  const { t } = useTranslation('qa');
  const [allCases, setAllCases] = useState<TestCase[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setCasesLoading(true);
    testCasesAPI
      .list()
      .then((res) => setAllCases(Array.isArray(res.data) ? res.data : []))
      .catch(() => setAllCases([]))
      .finally(() => setCasesLoading(false));
  }, [open]);

  const filteredCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allCases;
    return allCases.filter((tc) => tc.title.toLowerCase().includes(q));
  }, [allCases, search]);

  const toggle = async (tcId: string) => {
    if (!requirementId || busyId) return;
    setBusyId(tcId);
    try {
      if (linkedIds.has(tcId)) {
        await requirementsAPI.unlinkTestCase(requirementId, tcId);
      } else {
        await requirementsAPI.linkTestCase(requirementId, tcId);
      }
      onChanged();
    } catch {
      // surfaced via interceptor
    }
    setBusyId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4 text-blue-500" />
            {t('requirements.linkTitle')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('requirements.linkDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('requirements.searchCases')}
            className="h-7 text-xs pl-7"
          />
        </div>

        <ScrollArea className="h-[300px] border rounded-md">
          {casesLoading ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredCases.length === 0 ? (
            <p className="text-[11px] text-muted-foreground text-center py-6">
              {allCases.length === 0
                ? t('requirements.noCasesFound')
                : t('requirements.noCasesMatch')}
            </p>
          ) : (
            <div className="p-1">
              {filteredCases.map((tc) => {
                const linked = linkedIds.has(tc.id);
                const busy = busyId === tc.id;
                return (
                  <button
                    key={tc.id}
                    type="button"
                    onClick={() => toggle(tc.id)}
                    disabled={busy}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                      linked ? 'bg-primary/10' : 'hover:bg-accent'
                    } ${busy ? 'opacity-50' : ''}`}
                  >
                    <span
                      className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${
                        linked
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'border-muted-foreground/40'
                      }`}
                    >
                      {linked && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                      {t(`priorityShort.${tc.priority}`, { defaultValue: tc.priority })}
                    </Badge>
                    <span className="text-xs truncate flex-1">{tc.title}</span>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs h-8">
            {t('requirements.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Requirement Card ──

function RequirementCard({
  requirement,
  onEdit,
  onDelete,
  onLink,
}: {
  requirement: Requirement;
  onEdit: () => void;
  onDelete: () => void;
  onLink: () => void;
}) {
  const { t } = useTranslation('qa');
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const traceabilityMap = useContext(TraceabilityContext);
  const typeCfg = TYPE_CONFIG[requirement.type] || TYPE_CONFIG.functional;
  const priorityCfg = PRIORITY_CONFIG[requirement.priority] || PRIORITY_CONFIG.medium;
  const statusCfg = STATUS_CONFIG[requirement.status] || STATUS_CONFIG.draft;
  const StatusIcon = statusCfg.icon;

  const linkedCases = getLinkedTestCases(traceabilityMap, requirement.id);
  const passedCount = linkedCases.filter((c) => c.status === 'passed').length;
  const totalCount = linkedCases.length;
  const coveragePercent = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await getRepo().requirements.remove(requirement.id);
      onDelete();
    } catch {
      // surfaced via interceptor
    }
    setIsDeleting(false);
    setConfirmDelete(false);
  };

  return (
    <div className="group rounded-lg border bg-card overflow-hidden">
      <div className="relative">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-left p-2.5 hover:bg-accent/50 transition-colors cursor-pointer"
        >
          <div className="flex items-start gap-2">
            <ChevronRight
              className={`h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5 transition-transform duration-200 ${
                expanded ? 'rotate-90' : ''
              }`}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium flex-1 leading-snug truncate">
                  {requirement.title}
                </span>
                <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${statusCfg.color}`} />
              </div>

              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <Badge className={`text-xs px-1.5 py-0 ${typeCfg.color}`}>
                  {t(typeCfg.labelKey)}
                </Badge>
                <div className="flex items-center gap-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${priorityCfg.dot}`} />
                  <span className={`text-xs font-medium ${priorityCfg.color}`}>
                    {t(priorityCfg.labelKey)}
                  </span>
                </div>
                {requirement.externalRef && (
                  <Badge variant="outline" className="text-[8px] px-1 py-0">
                    {requirement.externalRef}
                  </Badge>
                )}
                {totalCount > 0 && (
                  <div className="flex items-center gap-1 ml-auto">
                    <Link2 className="h-2.5 w-2.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {totalCount === 1
                        ? t('requirements.caseCountOne', { count: totalCount })
                        : t('requirements.caseCountOther', { count: totalCount })}
                    </span>
                  </div>
                )}
              </div>

              {totalCount > 0 && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs text-muted-foreground">{t('requirements.coverage')}</span>
                    <span className="text-xs font-medium">{coveragePercent}%</span>
                  </div>
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        coveragePercent === 100
                          ? 'bg-green-500'
                          : coveragePercent >= 50
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                      }`}
                      style={{ width: `${coveragePercent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </button>

        <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {confirmDelete ? (
            <div className="flex gap-0.5 bg-card rounded-md border px-1 py-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5 text-red-500"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete();
                }}
                disabled={isDeleting}
              >
                {isDeleting ? '...' : t('requirements.confirm')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(false);
                }}
              >
                <X className="h-2.5 w-2.5" />
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 bg-card"
                onClick={(e) => {
                  e.stopPropagation();
                  onLink();
                }}
                title={t('requirements.linkTestCasesTitle')}
              >
                <Link2 className="h-2.5 w-2.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 bg-card"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
              >
                <Pencil className="h-2.5 w-2.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 bg-card text-red-500 hover:text-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(true);
                }}
              >
                <Trash2 className="h-2.5 w-2.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t px-3 py-2 bg-muted/30 animate-in fade-in-50 slide-in-from-top-1 duration-200">
          {requirement.description && (
            <p className="text-sm text-muted-foreground mb-2 leading-relaxed">
              {requirement.description}
            </p>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                {t('requirements.linkedTestCases')}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onLink();
                }}
              >
                <Link2 className="h-2.5 w-2.5 mr-1" />
                {t('requirements.manage')}
              </Button>
            </div>

            {linkedCases.length === 0 ? (
              <div className="text-center py-3">
                <Link2 className="h-5 w-5 text-muted-foreground/30 mx-auto mb-1" />
                <p className="text-sm text-muted-foreground">
                  {t('requirements.noLinkedCases')}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {linkedCases.map((tc) => (
                  <div
                    key={tc.testCaseId}
                    className="flex items-center gap-2 p-1.5 rounded bg-background"
                  >
                    {tc.status === 'passed' ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                    ) : tc.status === 'failed' ? (
                      <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                    ) : (
                      <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-sm flex-1 truncate">{tc.title}</span>
                    <Badge
                      variant={
                        tc.status === 'passed'
                          ? 'success'
                          : tc.status === 'failed'
                            ? 'destructive'
                            : 'secondary'
                      }
                      className="text-[8px] px-1 py-0"
                    >
                      {t(`runStatus.${tc.status}`, { defaultValue: tc.status })}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          {requirement.tags && requirement.tags.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {requirement.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[8px] px-1 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main RequirementsList Component ──

export function RequirementsList() {
  const { t } = useTranslation('qa');
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRequirement, setEditingRequirement] = useState<Requirement | null>(null);
  const [linkOpenFor, setLinkOpenFor] = useState<string | null>(null);
  const [traceabilityMap, setTraceabilityMap] = useState<Map<string, TraceabilityLink[]>>(new Map());

  const fetchTraceability = useCallback(async () => {
    try {
      const matrix = await getRepo().requirements.traceability();
      const map = new Map<string, TraceabilityLink[]>();
      for (const entry of matrix) {
        map.set(entry.requirementId, entry.testCases || []);
      }
      setTraceabilityMap(map);
    } catch {
      // Graceful fallback
    }
  }, []);

  const fetchRequirements = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await getRepo().requirements.list();
      setRequirements(items);
    } catch {
      // API not available
    }
    setIsLoading(false);
  }, []);

  const refreshAll = useCallback(() => {
    fetchRequirements();
    fetchTraceability();
  }, [fetchRequirements, fetchTraceability]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const filtered = requirements.filter((r) =>
    r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.externalRef && r.externalRef.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (r.tags && r.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())))
  );

  const linkedIdsForCurrent = useMemo(() => {
    if (!linkOpenFor) return new Set<string>();
    const links = traceabilityMap.get(linkOpenFor) || [];
    return new Set(links.map((l) => l.testCaseId));
  }, [linkOpenFor, traceabilityMap]);

  return (
    <TraceabilityContext.Provider value={traceabilityMap}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t('requirements.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 text-xs pl-7"
            />
          </div>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setEditingRequirement(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="h-3 w-3 mr-1" />
            {t('requirements.new')}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-6 space-y-2">
            <FileText className="h-8 w-8 text-muted-foreground/30 mx-auto" />
            <p className="text-xs text-muted-foreground">
              {searchQuery ? t('requirements.emptyMatching') : t('requirements.empty')}
            </p>
            {!searchQuery && (
              <p className="text-sm text-muted-foreground/60">
                {t('requirements.emptyHint')}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
            {filtered.map((req) => (
              <RequirementCard
                key={req.id}
                requirement={req}
                onEdit={() => {
                  setEditingRequirement(req);
                  setEditorOpen(true);
                }}
                onDelete={refreshAll}
                onLink={() => setLinkOpenFor(req.id)}
              />
            ))}
          </div>
        )}

        <RequirementEditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          requirement={editingRequirement}
          onSaved={refreshAll}
        />

        <LinkTestCasesDialog
          open={!!linkOpenFor}
          onOpenChange={(v) => { if (!v) setLinkOpenFor(null); }}
          requirementId={linkOpenFor}
          linkedIds={linkedIdsForCurrent}
          onChanged={fetchTraceability}
        />
      </div>
    </TraceabilityContext.Provider>
  );
}
