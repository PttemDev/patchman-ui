import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Trash2, Laptop, Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useHistoryStore,
  localHistoryAvailable,
  remoteHistoryAvailable,
  type HistoryScope,
} from '@/stores/historyStore';
import { useRequestStore } from '@/stores/requestStore';
import { useAuthStore } from '@/stores/authStore';
import { isDesktop } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { HistoryItem } from '@/types';

const methodColors: Record<string, string> = {
  GET: 'text-green-500',
  POST: 'text-yellow-500',
  PUT: 'text-blue-500',
  PATCH: 'text-purple-500',
  DELETE: 'text-red-500',
  HEAD: 'text-teal-500',
  OPTIONS: 'text-gray-500',
};

function statusVariant(code: number) {
  if (code >= 200 && code < 300) return 'success' as const;
  if (code >= 300 && code < 400) return 'info' as const;
  if (code >= 400 && code < 500) return 'warning' as const;
  return 'destructive' as const;
}

function groupByDate(items: HistoryItem[]) {
  const groups: Record<string, HistoryItem[]> = {};
  items.forEach((item) => {
    const date = new Date(item.createdAt).toLocaleDateString();
    if (!groups[date]) groups[date] = [];
    groups[date].push(item);
  });
  return groups;
}

// Honest message when a source can't apply to the current session, so an
// empty tab reads as "N/A here" rather than "you have no history".
// Returns a translation key resolved by the caller.
function unavailableMessageKey(scope: HistoryScope): string {
  if (scope === 'remote') return 'unavailable.remote';
  // Local: distinguish "wrong platform" from "desktop, sidecar not ready".
  return isDesktop() ? 'unavailable.localBackend' : 'unavailable.localDesktopOnly';
}

interface ScopeBodyProps {
  scope: HistoryScope;
  onSelect: (item: HistoryItem) => void;
}

function ScopeBody({ scope, onSelect }: ScopeBodyProps) {
  const { t } = useTranslation('history');
  const state = useHistoryStore((s) => s[scope]);
  const available = scope === 'local' ? localHistoryAvailable() : remoteHistoryAvailable();

  if (!available) {
    return (
      <div className="text-center py-8 px-4">
        <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">{t(unavailableMessageKey(scope))}</p>
      </div>
    );
  }

  if (state.isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="text-center py-8 px-4">
        <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">{state.error}</p>
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <div className="text-center py-8 px-4">
        <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">{t('emptyTitle')}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {t('emptyHint')}
        </p>
      </div>
    );
  }

  const grouped = groupByDate(state.items);

  return (
    <div className="space-y-3">
      {Object.entries(grouped).map(([date, groupItems]) => (
        <div key={date}>
          <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1 px-1">
            {date}
          </p>
          <div className="space-y-0.5">
            {groupItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(item)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-accent transition-colors duration-200 cursor-pointer"
              >
                <span
                  className={cn(
                    'text-[10px] font-bold uppercase w-9 text-left shrink-0',
                    methodColors[item.method] || 'text-gray-500'
                  )}
                >
                  {item.method}
                </span>
                <span className="truncate flex-1 text-left">
                  {(() => {
                    try { return new URL(item.url).pathname; } catch { return item.url; }
                  })()}
                </span>
                <Badge variant={statusVariant(item.statusCode)} className="text-[10px] px-1.5 py-0">
                  {item.statusCode}
                </Badge>
                <span className="text-muted-foreground text-[10px] shrink-0">
                  {t('durationMs', { n: item.duration })}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function HistoryList() {
  const { t } = useTranslation('history');
  const { local, remote, fetchScope, clearHistory } = useHistoryStore();
  const { addTab } = useRequestStore();
  const mode = useAuthStore((s) => s.mode);

  // Default the visible tab: the desktop app defaults to Local (this device's
  // own history), everything else to Remote — and offline (local mode) is
  // always Local. Follows a mid-session mode change so the panel doesn't strand
  // on an empty tab.
  const defaultScope = (): HistoryScope => (isDesktop() || mode === 'local' ? 'local' : 'remote');
  const [activeScope, setActiveScope] = useState<HistoryScope>(defaultScope);
  useEffect(() => {
    setActiveScope(defaultScope());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    fetchScope('local');
    fetchScope('remote');
  }, [fetchScope]);

  const handleClick = (item: HistoryItem) => {
    addTab({
      name: `${item.method} ${new URL(item.url).pathname}`,
      method: item.method,
      url: item.url,
    });
  };

  const activeState = activeScope === 'local' ? local : remote;
  const activeAvailable = activeScope === 'local' ? localHistoryAvailable() : remoteHistoryAvailable();

  const tabs: { scope: HistoryScope; label: string; icon: typeof Laptop; count: number }[] = [
    { scope: 'local', label: t('common:local'), icon: Laptop, count: local.items.length },
    { scope: 'remote', label: t('common:remote'), icon: Cloud, count: remote.items.length },
  ];

  return (
    <div className="p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('title')}
          <span className="normal-case font-normal ml-1">{t('maxDays')}</span>
        </span>
        {activeAvailable && activeState.items.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => clearHistory(activeScope)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Local / Remote source selector */}
      <div className="flex items-center gap-1 mb-2 p-0.5 rounded-md bg-muted/50">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeScope === tab.scope;
          return (
            <button
              key={tab.scope}
              onClick={() => setActiveScope(tab.scope)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors duration-200 cursor-pointer',
                active
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{tab.label}</span>
              <span className="text-[10px] text-muted-foreground">{tab.count}</span>
            </button>
          );
        })}
      </div>

      <ScopeBody scope={activeScope} onSelect={handleClick} />
    </div>
  );
}
