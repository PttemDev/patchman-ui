import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Search } from 'lucide-react';
import { testPlansAPI, testCasesAPI } from '@/services/api';
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
import type { TestPlan, TestCase } from '@/types';

interface TestPlanEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testPlan: TestPlan | null;
  onSaved: () => void;
}

export function TestPlanEditor({
  open,
  onOpenChange,
  testPlan,
  onSaved,
}: TestPlanEditorProps) {
  const { t } = useTranslation('qa');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('draft');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allCases, setAllCases] = useState<TestCase[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (testPlan) {
      setName(testPlan.name);
      setDescription(testPlan.description);
      setStatus(testPlan.status);
      setSelectedIds(new Set(Array.isArray(testPlan.testCaseIds) ? testPlan.testCaseIds : []));
    } else {
      setName('');
      setDescription('');
      setStatus('draft');
      setSelectedIds(new Set());
    }
    setSearch('');
  }, [testPlan, open]);

  useEffect(() => {
    if (!open) return;
    setCasesLoading(true);
    testCasesAPI
      .list()
      .then((res) => {
        setAllCases(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => setAllCases([]))
      .finally(() => setCasesLoading(false));
  }, [open]);

  const filteredCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allCases;
    return allCases.filter((tc) =>
      tc.title.toLowerCase().includes(q) ||
      (tc.description || '').toLowerCase().includes(q),
    );
  }, [allCases, search]);

  const toggleCase = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const data = {
        name: name.trim(),
        description: description.trim(),
        status,
        testCaseIds: Array.from(selectedIds),
      };
      if (testPlan) {
        await testPlansAPI.update(testPlan.id, data);
      } else {
        await testPlansAPI.create(data);
      }
      onSaved();
      onOpenChange(false);
    } catch {
      // surfaced via global interceptor
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{testPlan ? t('planEditor.editTitle') : t('planEditor.newTitle')}</DialogTitle>
          <DialogDescription>
            {t('planEditor.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label className="text-xs">{t('common:name')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('planEditor.namePlaceholder')}
              className="h-8 text-sm"
            />
          </div>
          <div className="grid gap-2">
            <Label className="text-xs">{t('planEditor.descriptionLabel')}</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('planEditor.descriptionPlaceholder')}
              rows={2}
              className="text-sm"
            />
          </div>
          <div className="grid gap-2">
            <Label className="text-xs">{t('common:status')}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">{t('planStatus.draft')}</SelectItem>
                <SelectItem value="active">{t('planStatus.active')}</SelectItem>
                <SelectItem value="completed">{t('planStatus.completed')}</SelectItem>
                <SelectItem value="archived">{t('planStatus.archived')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">{t('planEditor.testCases')}</Label>
              <span className="text-[10px] text-muted-foreground">
                {t('planEditor.selectedCount', { count: selectedIds.size })}
              </span>
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('planEditor.searchCases')}
                className="h-7 text-xs pl-7"
              />
            </div>
            <ScrollArea className="h-[200px] border rounded-md">
              {casesLoading ? (
                <div className="flex items-center justify-center py-6">
                  <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filteredCases.length === 0 ? (
                <p className="text-[11px] text-muted-foreground text-center py-6">
                  {allCases.length === 0
                    ? t('planEditor.noCasesFound')
                    : t('planEditor.noCasesMatch')}
                </p>
              ) : (
                <div className="p-1">
                  {filteredCases.map((tc) => {
                    const checked = selectedIds.has(tc.id);
                    return (
                      <button
                        key={tc.id}
                        type="button"
                        onClick={() => toggleCase(tc.id)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                          checked ? 'bg-primary/10' : 'hover:bg-accent'
                        }`}
                      >
                        <span
                          className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${
                            checked ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'
                          }`}
                        >
                          {checked && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                          {tc.priority}
                        </Badge>
                        <span className="text-xs truncate flex-1">{tc.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || isSaving}>
            {isSaving ? t('planEditor.saving') : testPlan ? t('planEditor.update') : t('planEditor.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
