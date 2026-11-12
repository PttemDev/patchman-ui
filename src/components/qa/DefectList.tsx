import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  Bug,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ChevronDown,
  Pencil,
  Trash2,
} from 'lucide-react';
import { getRepo } from '@/data';
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
import type { Defect } from '@/types';

// ── Status Configuration ──

const STATUS_CONFIG: Record<string, { labelKey: string; icon: React.ElementType; color: string; badgeClass: string }> = {
  open: { labelKey: 'defectStatus.open', icon: AlertCircle, color: 'text-red-500', badgeClass: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  in_progress: { labelKey: 'defectStatus.in_progress', icon: Clock, color: 'text-yellow-500', badgeClass: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20' },
  fixed: { labelKey: 'defectStatus.fixed', icon: CheckCircle2, color: 'text-blue-500', badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
  verified: { labelKey: 'defectStatus.verified', icon: CheckCircle2, color: 'text-green-500', badgeClass: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' },
  closed: { labelKey: 'defectStatus.closed', icon: XCircle, color: 'text-gray-400', badgeClass: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  reopened: { labelKey: 'defectStatus.reopened', icon: RotateCcw, color: 'text-orange-500', badgeClass: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' },
};

const PRIORITY_CONFIG: Record<string, { labelKey: string; color: string }> = {
  P0: { labelKey: 'priorityShort.P0', color: 'bg-red-500 text-white' },
  P1: { labelKey: 'priorityShort.P1', color: 'bg-orange-500 text-white' },
  P2: { labelKey: 'priorityShort.P2', color: 'bg-yellow-500 text-black' },
  P3: { labelKey: 'priorityShort.P3', color: 'bg-blue-500 text-white' },
  P4: { labelKey: 'priorityShort.P4', color: 'bg-gray-400 text-white' },
};

const SEVERITY_CONFIG: Record<string, { labelKey: string; color: string }> = {
  critical: { labelKey: 'severity.critical', color: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  major: { labelKey: 'severity.major', color: 'bg-orange-500/15 text-orange-700 dark:text-orange-400' },
  minor: { labelKey: 'severity.minor', color: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400' },
  trivial: { labelKey: 'severity.trivial', color: 'bg-gray-500/15 text-gray-600 dark:text-gray-400' },
};

// ── Defect Editor (Create + Edit) ──

function DefectEditorDialog({
  open,
  onOpenChange,
  defect,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defect: Defect | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation('qa');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<Defect['status']>('open');
  const [priority, setPriority] = useState<Defect['priority']>('P2');
  const [severity, setSeverity] = useState<Defect['severity']>('major');
  const [stepsToReproduce, setStepsToReproduce] = useState('');
  const [tags, setTags] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (defect) {
      setTitle(defect.title);
      setDescription(defect.description);
      setStatus(defect.status);
      setPriority(defect.priority);
      setSeverity(defect.severity);
      setStepsToReproduce(defect.stepsToReproduce || '');
      setTags(Array.isArray(defect.tags) ? defect.tags.join(', ') : '');
    } else {
      setTitle('');
      setDescription('');
      setStatus('open');
      setPriority('P2');
      setSeverity('major');
      setStepsToReproduce('');
      setTags('');
    }
  }, [defect, open]);

  const handleSave = async () => {
    if (!title.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        status,
        priority,
        severity,
        stepsToReproduce: stepsToReproduce.trim(),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (defect) {
        await getRepo().defects.update(defect.id, payload);
      } else {
        await getRepo().defects.create(payload);
      }
      onSaved();
      onOpenChange(false);
    } catch {
      // surfaced via interceptor
    } finally {
      setIsSaving(false);
    }
  };

  const isEditing = !!defect;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Bug className="h-4 w-4 text-red-500" />
            {isEditing ? t('defects.editTitle') : t('defects.reportTitle')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isEditing
              ? t('defects.editDescription')
              : t('defects.createDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('defects.titleLabel')}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('defects.titlePlaceholder')}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('defects.descriptionLabel')}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('defects.descriptionPlaceholder')}
              rows={2}
              className="text-xs"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('common:status')}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Defect['status'])}>
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
            <div className="space-y-1.5">
              <Label className="text-xs">{t('defects.priorityLabel')}</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Defect['priority'])}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      {t(cfg.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('defects.severityLabel')}</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as Defect['severity'])}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SEVERITY_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      {t(cfg.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('defects.stepsLabel')}</Label>
            <Textarea
              value={stepsToReproduce}
              onChange={(e) => setStepsToReproduce(e.target.value)}
              placeholder={t('defects.stepsPlaceholder')}
              rows={3}
              className="text-xs font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('defects.tagsLabel')}</Label>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t('defects.tagsPlaceholder')}
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
            className={`text-xs h-8 ${isEditing ? '' : 'bg-red-600 hover:bg-red-700'}`}
          >
            {isSaving ? (
              <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
            ) : (
              <Bug className="h-3 w-3 mr-1" />
            )}
            {isEditing ? t('defects.saveChanges') : t('defects.reportBug')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Defect Card ──

function DefectCard({
  defect,
  onEdit,
  onChanged,
}: {
  defect: Defect;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation('qa');
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const statusCfg = STATUS_CONFIG[defect.status] || STATUS_CONFIG.open;
  const priorityCfg = PRIORITY_CONFIG[defect.priority] || PRIORITY_CONFIG.P2;
  const severityCfg = SEVERITY_CONFIG[defect.severity] || SEVERITY_CONFIG.major;
  const StatusIcon = statusCfg.icon;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await getRepo().defects.remove(defect.id);
      onChanged();
    } catch {
      // surfaced via interceptor
    }
    setIsDeleting(false);
    setConfirmDelete(false);
  };

  const handleStatusChange = async (next: string) => {
    if (next === defect.status) return;
    setStatusUpdating(true);
    try {
      await getRepo().defects.update(defect.id, { status: next as Defect['status'] });
      onChanged();
    } catch {
      // surfaced via interceptor
    }
    setStatusUpdating(false);
  };

  return (
    <div className="group rounded-lg border bg-card overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="p-2.5 hover:bg-accent/30 transition-colors cursor-pointer"
      >
        <div className="flex items-start gap-2">
          <StatusIcon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${statusCfg.color}`} />
          <span className="text-xs font-medium flex-1 leading-snug">{defect.title}</span>
          {confirmDelete ? (
            <div className="flex gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5 text-red-500"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? '...' : t('defects.confirm')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[10px] px-1.5"
                onClick={() => setConfirmDelete(false)}
              >
                {t('common:cancel')}
              </Button>
            </div>
          ) : (
            <div
              className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onEdit}>
                <Pencil className="h-2.5 w-2.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-red-500 hover:text-red-600"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-2.5 w-2.5" />
              </Button>
            </div>
          )}
          <ChevronDown
            className={`h-3 w-3 text-muted-foreground shrink-0 mt-0.5 transition-transform ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </div>

        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {/* Inline status select — change without opening the editor */}
          <div onClick={(e) => e.stopPropagation()}>
            <Select
              value={defect.status}
              onValueChange={handleStatusChange}
              disabled={statusUpdating}
            >
              <SelectTrigger
                className={`h-5 text-xs px-1.5 py-0 border ${statusCfg.badgeClass} gap-1 w-auto`}
              >
                <SelectValue>{t(statusCfg.labelKey)}</SelectValue>
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
          <Badge className={`text-xs px-1.5 py-0 ${priorityCfg.color}`}>
            {t(priorityCfg.labelKey)}
          </Badge>
          <Badge className={`text-xs px-1.5 py-0 ${severityCfg.color}`}>
            {t(severityCfg.labelKey)}
          </Badge>
          <span className="text-xs text-muted-foreground shrink-0 ml-auto">
            {new Date(defect.createdAt).toLocaleDateString()}
          </span>
        </div>

        {!expanded && defect.description && (
          <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">
            {defect.description}
          </p>
        )}

        {!expanded && defect.tags && defect.tags.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {defect.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[8px] px-1 py-0">
                {tag}
              </Badge>
            ))}
            {defect.tags.length > 3 && (
              <span className="text-[8px] text-muted-foreground">
                +{defect.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t px-3 py-2.5 bg-muted/20 space-y-2">
          {defect.description && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                {t('defects.descriptionLabel')}
              </p>
              <p className="text-xs whitespace-pre-wrap leading-relaxed">{defect.description}</p>
            </div>
          )}
          {defect.stepsToReproduce && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                {t('defects.stepsLabel')}
              </p>
              <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed bg-background/40 rounded p-2 border">
                {defect.stepsToReproduce}
              </pre>
            </div>
          )}
          {defect.environment && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">{t('defects.environment')}</span>
              <span className="font-mono">{defect.environment}</span>
            </div>
          )}
          {defect.tags && defect.tags.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {defect.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[9px] px-1 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          {!defect.description && !defect.stepsToReproduce && (
            <p className="text-xs text-muted-foreground italic">
              {t('defects.noDetails')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main DefectList Component ──

export function DefectList() {
  const { t } = useTranslation('qa');
  const [defects, setDefects] = useState<Defect[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingDefect, setEditingDefect] = useState<Defect | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const fetchDefects = useCallback(async () => {
    setIsLoading(true);
    try {
      const filters: { status?: string; priority?: string; severity?: string } = {};
      if (filterStatus !== 'all') filters.status = filterStatus;
      if (filterPriority !== 'all') filters.priority = filterPriority;
      if (filterSeverity !== 'all') filters.severity = filterSeverity;
      const items = await getRepo().defects.list(filters);
      setDefects(items);
    } catch {
      // API not available
    }
    setIsLoading(false);
  }, [filterStatus, filterPriority, filterSeverity]);

  useEffect(() => {
    fetchDefects();
  }, [fetchDefects]);

  const filteredDefects = defects.filter((d) =>
    d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (d.tags && d.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())))
  );

  const activeFilterCount = [filterStatus, filterPriority, filterSeverity].filter((f) => f !== 'all').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t('defects.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 text-xs pl-7"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs relative"
          onClick={() => setShowFilters(!showFilters)}
        >
          <ChevronDown className={`h-3 w-3 mr-1 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          {t('defects.filter')}
          {activeFilterCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground rounded-full w-3.5 h-3.5 text-[8px] flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs bg-red-600 hover:bg-red-700"
          onClick={() => {
            setEditingDefect(null);
            setEditorOpen(true);
          }}
        >
          <Bug className="h-3 w-3 mr-1" />
          {t('defects.report')}
        </Button>
      </div>

      {showFilters && (
        <div className="grid grid-cols-3 gap-2 p-2 rounded-md border bg-card animate-in fade-in-50 slide-in-from-top-2 duration-200">
          <div className="space-y-1">
            <Label className="text-sm text-muted-foreground">{t('common:status')}</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-6 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">{t('defects.all')}</SelectItem>
                {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {t(cfg.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-sm text-muted-foreground">{t('defects.priorityLabel')}</Label>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="h-6 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">{t('defects.all')}</SelectItem>
                {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {t(cfg.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-sm text-muted-foreground">{t('defects.severityLabel')}</Label>
            <Select value={filterSeverity} onValueChange={setFilterSeverity}>
              <SelectTrigger className="h-6 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">{t('defects.all')}</SelectItem>
                {Object.entries(SEVERITY_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {t(cfg.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredDefects.length === 0 ? (
        <div className="text-center py-6 space-y-2">
          <Bug className="h-8 w-8 text-muted-foreground/30 mx-auto" />
          <p className="text-xs text-muted-foreground">
            {searchQuery || activeFilterCount > 0 ? t('defects.emptyMatching') : t('defects.empty')}
          </p>
          {!searchQuery && activeFilterCount === 0 && (
            <p className="text-sm text-muted-foreground/60">
              {t('defects.emptyHint')}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
          {filteredDefects.map((defect) => (
            <DefectCard
              key={defect.id}
              defect={defect}
              onEdit={() => {
                setEditingDefect(defect);
                setEditorOpen(true);
              }}
              onChanged={fetchDefects}
            />
          ))}
        </div>
      )}

      <DefectEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        defect={editingDefect}
        onSaved={fetchDefects}
      />
    </div>
  );
}
