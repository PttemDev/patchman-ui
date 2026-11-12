import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRequestStore } from '@/stores/requestStore';
import { cn } from '@/lib/utils';
import { TOOLS, type ToolDef } from './registry';

// DevToolsSidebar lists the client-side developer utilities. Clicking a tool
// focuses the last-opened tab OF THAT SAME KIND if one exists (so you don't
// pile up duplicates, and different tools never overwrite each other); if none
// is open yet it creates one. The small "+" button always opens a fresh tab.
export function DevToolsSidebar() {
  const { t } = useTranslation('devtools');
  const addTab = useRequestStore((s) => s.addTab);
  const setActiveTab = useRequestStore((s) => s.setActiveTab);

  const openInLast = (tool: ToolDef) => {
    const { tabs } = useRequestStore.getState();
    // Reuse the last existing tab of this exact tool kind.
    const existing = [...tabs].reverse().find((tab) => tab.type === 'tool' && tab.toolKind === tool.kind);
    if (existing) {
      setActiveTab(existing.id);
    } else {
      addTab({ type: 'tool', toolKind: tool.kind, name: t(tool.labelKey), method: 'GET', url: '' }, true);
    }
  };

  const openInNew = (tool: ToolDef) => {
    addTab({ type: 'tool', toolKind: tool.kind, name: t(tool.labelKey), method: 'GET', url: '' }, true);
  };

  return (
    <div className="p-2 space-y-1">
      <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {t('sidebar.utilities')}
      </p>
      {TOOLS.map((tool) => {
        const Icon = tool.icon;
        return (
          <div
            key={tool.kind}
            className={cn(
              'group flex items-center rounded-md hover:bg-accent transition-colors',
            )}
          >
            <button
              type="button"
              onClick={() => openInLast(tool)}
              className="flex-1 min-w-0 flex items-start gap-2.5 px-2 py-2 text-left"
            >
              <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-sm">{t(tool.labelKey)}</span>
                <span className="block text-[11px] text-muted-foreground truncate">{t(tool.descriptionKey)}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => openInNew(tool)}
              title={t('sidebar.openInNewTab')}
              className="mr-1.5 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity shrink-0"
            >
              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
