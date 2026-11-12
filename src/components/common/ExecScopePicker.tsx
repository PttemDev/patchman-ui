import { useTranslation } from 'react-i18next';
import { Zap, Cloud, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';
import { availableDBScopes } from '@/stores/dbConnectionStore';
import type { DBScope } from '@/services/api';

interface ExecScopePickerProps {
  /** Currently effective scope (per-tab override → connection default). */
  scope: DBScope;
  /** Scopes the connection actually exists on (dual-write result). */
  availableScopes?: Array<'local' | 'remote'>;
  onChange: (scope: DBScope) => void;
  /** Noun used in the tooltip, e.g. "query", "peek", "upload". */
  noun?: string;
}

// ExecScopePicker is the Local/Remote toggle that decides which backend a
// connection-bound operation runs on — the user's embedded desktop BE (for
// clusters/endpoints only reachable from this machine, e.g. localhost /
// LAN) or the hosted team BE (for prod behind the server's network).
// Mirrors the DB Query tool's toggle; renders nothing unless both scopes
// are reachable in this environment (i.e. desktop with dual-write).
export function ExecScopePicker({ scope, availableScopes, onChange, noun = 'operation' }: ExecScopePickerProps) {
  const { t } = useTranslation('app');
  if (availableDBScopes().length <= 1) return null;
  const avail = availableScopes && availableScopes.length ? availableScopes : [scope];
  const has = (s: DBScope) => avail.includes(s);
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className={cn(
                  'gap-1.5 h-8 border-2',
                  scope === 'local'
                    ? 'border-amber-500/60 text-amber-500 hover:text-amber-500'
                    : 'border-sky-500/60 text-sky-500 hover:text-sky-500',
                )}
              >
                {scope === 'local' ? <Zap className="h-3.5 w-3.5" /> : <Cloud className="h-3.5 w-3.5" />}
                <span className="text-xs font-semibold">{scope === 'local' ? t('common:local') : t('common:remote')}</span>
                <ChevronDown className="h-3 w-3 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[280px]">
              <DropdownMenuItem
                onClick={() => onChange('local')}
                disabled={!has('local')}
                className="flex-col items-start gap-0.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span className="font-semibold">{t('common:local')}</span>
                </div>
                <span className="text-[11px] text-muted-foreground pl-6">
                  {has('local')
                    ? t('scopePicker.localAvailable')
                    : t('scopePicker.localUnavailable')}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onChange('remote')}
                disabled={!has('remote')}
                className="flex-col items-start gap-0.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <Cloud className="h-3.5 w-3.5 text-sky-500" />
                  <span className="font-semibold">{t('common:remote')}</span>
                </div>
                <span className="text-[11px] text-muted-foreground pl-6">
                  {has('remote')
                    ? t('scopePicker.remoteAvailable')
                    : t('scopePicker.remoteUnavailable')}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p className="text-xs max-w-[240px]">
            {t('scopePicker.tooltip', { noun })}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
