import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  Plus,
  Trash2,
  Pencil,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { sharedStepsAPI } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { SharedStep } from '@/types';

// ── Step Editor Row ──

interface StepRow {
  stepNo: number;
  action: string;
  expected: string;
}

function makeBlankStepRow(stepNo: number): StepRow {
  return { stepNo, action: '', expected: '' };
}

// ── Shared Step Editor Dialog ──

function SharedStepEditorDialog({
  open,
  onOpenChange,
  sharedStep,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sharedStep: SharedStep | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation('qa');
  const [title, setTitle] = useState('');
  const [steps, setSteps] = useState<StepRow[]>([makeBlankStepRow(1)]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (sharedStep) {
      setTitle(sharedStep.title);
      setSteps(
        sharedStep.steps.length > 0
          ? sharedStep.steps.map((s) => ({ stepNo: s.stepNo, action: s.action, expected: s.expected }))
          : [makeBlankStepRow(1)]
      );
    } else {
      setTitle('');
      setSteps([makeBlankStepRow(1)]);
    }
  }, [sharedStep, open]);

  const addStep = () => {
    setSteps([...steps, makeBlankStepRow(steps.length + 1)]);
  };

  const removeStep = (index: number) => {
    const newSteps = steps
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, stepNo: i + 1 }));
    setSteps(newSteps.length > 0 ? newSteps : [makeBlankStepRow(1)]);
  };

  const updateStep = (index: number, field: 'action' | 'expected', value: string) => {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], [field]: value };
    setSteps(newSteps);
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    setIsSaving(true);
    try {
      const data = {
        title: title.trim(),
        steps: steps.filter((s) => s.action.trim()),
      };
      if (sharedStep) {
        await sharedStepsAPI.update(sharedStep.id, data);
      } else {
        await sharedStepsAPI.create(data);
      }
      onSaved();
      onOpenChange(false);
    } catch {
      // handle silently
    }
    setIsSaving(false);
  };

  const reset = () => {
    setTitle('');
    setSteps([makeBlankStepRow(1)]);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-blue-500" />
            {sharedStep ? t('sharedSteps.editTitle') : t('sharedSteps.newTitle')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('sharedSteps.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('sharedSteps.titleLabel')}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('sharedSteps.titlePlaceholder')}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">{t('sharedSteps.stepsLabel')}</Label>
            {steps.map((step, index) => (
              <div key={index} className="flex items-start gap-2">
                <span className="text-xs font-medium text-muted-foreground mt-2 w-6 shrink-0">
                  #{step.stepNo}
                </span>
                <div className="flex-1 space-y-1">
                  <Input
                    placeholder={t('sharedSteps.actionPlaceholder')}
                    value={step.action}
                    onChange={(e) => updateStep(index, 'action', e.target.value)}
                    className="h-7 text-xs"
                  />
                  <Input
                    placeholder={t('sharedSteps.expectedPlaceholder')}
                    value={step.expected}
                    onChange={(e) => updateStep(index, 'expected', e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 mt-0.5 shrink-0"
                  onClick={() => removeStep(index)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={addStep}>
              <Plus className="h-3 w-3 mr-1" />
              {t('sharedSteps.addStep')}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => { reset(); onOpenChange(false); }} className="text-xs h-8">
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
            {sharedStep ? t('sharedSteps.update') : t('sharedSteps.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Shared Step Card ──

function SharedStepCard({
  sharedStep,
  onEdit,
  onDelete,
}: {
  sharedStep: SharedStep;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('qa');
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await sharedStepsAPI.delete(sharedStep.id);
      onDelete();
    } catch {
      // handle silently
    }
    setIsDeleting(false);
    setConfirmDelete(false);
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center p-2.5 gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${
              expanded ? 'rotate-90' : ''
            }`}
          />
          <span className="text-xs font-medium truncate flex-1">
            {sharedStep.title}
          </span>
        </button>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
          {sharedStep.steps.length === 1
            ? t('sharedSteps.stepCountOne', { count: sharedStep.steps.length })
            : t('sharedSteps.stepCountOther', { count: sharedStep.steps.length })}
        </Badge>
        {sharedStep.usageCount > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
            {t('sharedSteps.usedTimes', { count: sharedStep.usageCount })}
          </Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onEdit}
        >
          <Pencil className="h-2.5 w-2.5" />
        </Button>
        {confirmDelete ? (
          <div className="flex gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-1.5 text-red-500"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {t('sharedSteps.confirm')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-1.5"
              onClick={() => setConfirmDelete(false)}
            >
              {t('common:cancel')}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-red-500 hover:text-red-600"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-2.5 w-2.5" />
          </Button>
        )}
      </div>

      {expanded && (
        <div className="border-t px-3 py-2 bg-muted/30 animate-in fade-in-50 slide-in-from-top-1 duration-200">
          <div className="space-y-1">
            {sharedStep.steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 p-1.5 rounded bg-background">
                <span className="text-[10px] font-medium text-muted-foreground w-4 shrink-0 mt-0.5">
                  #{step.stepNo}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs">{step.action}</p>
                  {step.expected && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {t('sharedSteps.expected', { value: step.expected })}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main SharedStepsList Component ──

export function SharedStepsList() {
  const { t } = useTranslation('qa');
  const [sharedSteps, setSharedSteps] = useState<SharedStep[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<SharedStep | null>(null);

  const fetchSharedSteps = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await sharedStepsAPI.list();
      setSharedSteps(Array.isArray(response.data) ? response.data : []);
    } catch {
      // API not available
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchSharedSteps();
  }, [fetchSharedSteps]);

  const filtered = sharedSteps.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t('sharedSteps.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 text-xs pl-7"
          />
        </div>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            setEditingStep(null);
            setEditorOpen(true);
          }}
        >
          <Plus className="h-3 w-3 mr-1" />
          {t('sharedSteps.new')}
        </Button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-6 space-y-2">
          <Layers className="h-8 w-8 text-muted-foreground/30 mx-auto" />
          <p className="text-xs text-muted-foreground">
            {searchQuery ? t('sharedSteps.emptyMatching') : t('sharedSteps.empty')}
          </p>
          {!searchQuery && (
            <p className="text-sm text-muted-foreground/60">
              {t('sharedSteps.emptyHint')}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
          {filtered.map((ss) => (
            <SharedStepCard
              key={ss.id}
              sharedStep={ss}
              onEdit={() => {
                setEditingStep(ss);
                setEditorOpen(true);
              }}
              onDelete={fetchSharedSteps}
            />
          ))}
        </div>
      )}

      <SharedStepEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        sharedStep={editingStep}
        onSaved={fetchSharedSteps}
      />
    </div>
  );
}
