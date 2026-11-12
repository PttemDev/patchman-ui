import { Zap, Cloud } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, type ExecutionTarget } from '@/stores/authStore';
import { isDesktop } from '@/lib/platform';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { useState } from 'react';

/**
 * Picker shown next to the Send button. Only visible on desktop-synced: web
 * users have nowhere to pin execution to (no embedded BE), and local-mode
 * users already execute locally by definition. Selecting "Local" pins
 * proxy/send, test-case execute, and test-plan execute to the embedded BE
 * while collections / envs / test definitions keep loading from remote.
 */
export function ExecutionTargetPicker() {
  const { t } = useTranslation('request');
  const mode = useAuthStore((s) => s.mode);
  const executionTarget = useAuthStore((s) => s.executionTarget);
  const setExecutionTarget = useAuthStore((s) => s.setExecutionTarget);
  const [open, setOpen] = useState(false);

  if (!isDesktop() || mode !== 'synced') return null;

  const isLocal = executionTarget === 'local';

  function choose(t: ExecutionTarget) {
    setExecutionTarget(t);
    setOpen(false);
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex items-center gap-1 px-2 h-10 rounded-md border text-xs font-medium cursor-pointer shrink-0 transition-colors',
                  isLocal
                    ? 'border-amber-500/40 text-amber-500 hover:bg-amber-500/10'
                    : 'border-sky-500/40 text-sky-500 hover:bg-sky-500/10',
                )}
                aria-label={t('execTarget.title')}
              >
                {isLocal ? <Zap className="h-3.5 w-3.5" /> : <Cloud className="h-3.5 w-3.5" />}
                <span>{isLocal ? t('execTarget.local') : t('execTarget.remote')}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-1" align="end">
              <button
                type="button"
                onClick={() => choose('local')}
                className={cn(
                  'w-full flex items-start gap-2 px-2 py-2 text-left rounded hover:bg-accent cursor-pointer',
                  isLocal && 'bg-accent',
                )}
              >
                <Zap className="h-4 w-4 mt-0.5 text-amber-500 shrink-0" />
                <div className="flex flex-col">
                  <span className="text-xs font-medium">{t('execTarget.local')}</span>
                  <span className="text-[11px] text-muted-foreground leading-snug">
                    {t('execTarget.localDesc')}
                  </span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => choose('remote')}
                className={cn(
                  'w-full flex items-start gap-2 px-2 py-2 text-left rounded hover:bg-accent cursor-pointer',
                  !isLocal && 'bg-accent',
                )}
              >
                <Cloud className="h-4 w-4 mt-0.5 text-sky-500 shrink-0" />
                <div className="flex flex-col">
                  <span className="text-xs font-medium">{t('execTarget.remote')}</span>
                  <span className="text-[11px] text-muted-foreground leading-snug">
                    {t('execTarget.remoteDesc')}
                  </span>
                </div>
              </button>
            </PopoverContent>
          </Popover>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('execTarget.title')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
