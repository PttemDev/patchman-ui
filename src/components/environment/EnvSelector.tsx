import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, CheckCircle2 } from 'lucide-react';
import { useEnvironmentStore } from '@/stores/environmentStore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { EnvManager } from './EnvManager';

export function EnvSelector() {
  const { t } = useTranslation('environment');
  const { environments, activeEnvironment, fetchEnvironments, activateEnvironment } =
    useEnvironmentStore();
  const [managerOpen, setManagerOpen] = useState(false);

  useEffect(() => {
    fetchEnvironments();
  }, [fetchEnvironments]);

  const hasActive = !!activeEnvironment;

  return (
    <div className="flex items-center gap-2">
      <Select
        value={activeEnvironment?.id || 'none'}
        onValueChange={(value) => {
          activateEnvironment(value === 'none' ? null : value);
        }}
      >
        <SelectTrigger
          className={`w-[180px] h-8 text-xs ${
            hasActive
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15'
              : ''
          }`}
        >
          <SelectValue placeholder={t('selector.noEnvironment')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t('selector.noEnvironment')}</SelectItem>
          {environments.map((env) => (
            <SelectItem key={env.id} value={env.id}>
              <span className="inline-flex items-center gap-1.5">
                {env.isActive && (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                )}
                {env.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setManagerOpen(true)}
      >
        <Settings className="h-3.5 w-3.5" />
      </Button>
      <EnvManager open={managerOpen} onOpenChange={setManagerOpen} />
    </div>
  );
}
