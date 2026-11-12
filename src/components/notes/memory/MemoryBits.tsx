import { useTranslation } from 'react-i18next';
import { Bot, Globe2, Lock, User, Users2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MemoryScope } from '@/types';

/** Whose memory this is: personal / team: X / shared by Y / everyone. */
export function ScopeBadge({ scope, className }: { scope?: MemoryScope; className?: string }) {
  const { t } = useTranslation('notes');
  const kind = scope?.kind ?? 'personal';
  const Icon = kind === 'team' ? Users2 : kind === 'everyone' ? Globe2 : kind === 'shared' ? User : Lock;
  const label =
    kind === 'team' ? t('memory.scope.team', { teams: (scope?.teams ?? []).join(', ') })
      : kind === 'shared' ? (scope?.owner ? t('memory.scope.shared', { owner: scope.owner }) : t('memory.scope.sharedMine'))
        : kind === 'everyone' ? t('memory.scope.everyone')
          : t('memory.scope.personal');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] leading-4 whitespace-nowrap',
        kind === 'team' ? 'border-violet-500/40 text-violet-600 dark:text-violet-300 bg-violet-500/10'
          : kind === 'personal' ? 'text-muted-foreground'
            : 'border-sky-500/40 text-sky-600 dark:text-sky-300 bg-sky-500/10',
        className,
      )}
      title={label}
    >
      <Icon className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate max-w-[160px]">{label}</span>
    </span>
  );
}

/** Who wrote a card: a person, or the agent by its own name. */
export function SourceBadge({ source, agent }: { source?: string; agent?: string }) {
  const { t } = useTranslation('notes');
  if (source !== 'agent' && source !== 'human') return null;
  const isAgent = source === 'agent';
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] leading-4',
      isAgent ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    )}
    >
      {isAgent ? <Bot className="h-2.5 w-2.5" /> : <User className="h-2.5 w-2.5" />}
      {isAgent && agent ? agent : t(`memory.source.${source}`)}
    </span>
  );
}
