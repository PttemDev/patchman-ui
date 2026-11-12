import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { testPlansAPI } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestPlanEditor } from './TestPlanEditor';
import type { TestPlan } from '@/types';

const statusVariants: Record<string, 'secondary' | 'success' | 'warning' | 'info'> = {
  draft: 'secondary',
  active: 'success',
  completed: 'info',
  archived: 'warning',
};

export function TestPlanList() {
  const { t } = useTranslation('qa');
  const [plans, setPlans] = useState<TestPlan[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<TestPlan | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await testPlansAPI.list();
      setPlans(Array.isArray(response.data) ? response.data : []);
    } catch {
      // API not available
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await testPlansAPI.delete(id);
      await fetchPlans();
    } catch {
      // surfaced via interceptor
    }
    setDeletingId(null);
    setConfirmDeleteId(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{t('planList.heading')}</span>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            setEditingPlan(null);
            setEditorOpen(true);
          }}
        >
          <Plus className="h-3 w-3 mr-1" />
          {t('planList.new')}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : plans.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          {t('planList.empty')}
        </p>
      ) : (
        <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
          {plans.map((plan) => {
              const caseCount = Array.isArray(plan.testCaseIds) ? plan.testCaseIds.length : 0;
              const isConfirming = confirmDeleteId === plan.id;
              return (
                <div
                  key={plan.id}
                  className="group flex items-center gap-1 p-2 rounded-md hover:bg-accent transition-colors"
                >
                  <button
                    onClick={() => {
                      setEditingPlan(plan);
                      setEditorOpen(true);
                    }}
                    className="flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium truncate flex-1">
                        {plan.name}
                      </span>
                      <Badge
                        variant={statusVariants[plan.status] || 'secondary'}
                        className="text-sm px-1"
                      >
                        {t(`planStatus.${plan.status}`, { defaultValue: plan.status })}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 truncate">
                      {caseCount === 1
                        ? t('planList.caseCountOne', { count: caseCount })
                        : t('planList.caseCountOther', { count: caseCount })}
                    </p>
                  </button>

                  {isConfirming ? (
                    <div className="flex gap-0.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-1.5 text-red-500"
                        onClick={() => handleDelete(plan.id)}
                        disabled={deletingId === plan.id}
                      >
                        {deletingId === plan.id ? '...' : t('planList.confirm')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-1.5"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        {t('common:cancel')}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                        onClick={() => {
                          setEditingPlan(plan);
                          setEditorOpen(true);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-red-500 hover:text-red-600 opacity-0 group-hover:opacity-100"
                        onClick={() => setConfirmDeleteId(plan.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
        </div>
      )}

      <TestPlanEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        testPlan={editingPlan}
        onSaved={fetchPlans}
      />
    </div>
  );
}
