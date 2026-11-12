import { useTranslation } from 'react-i18next';
import type { Tab } from '@/types';
import { toolDef } from './registry';

interface DevToolsPanelProps {
  tab: Tab;
}

// DevToolsPanel is the main-pane body for a `type: 'tool'` tab. It resolves
// the tab's toolKind to a utility component via the registry. Most tools are
// fully self-contained (client-side); a few (e.g. DNS Toolkit) call the BE.
export function DevToolsPanel({ tab }: DevToolsPanelProps) {
  const { t } = useTranslation('devtools');
  const def = toolDef(tab.toolKind);
  if (!def) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t('panel.unknownTool')}
      </div>
    );
  }
  const { Component, labelKey, descriptionKey, icon: Icon } = def;
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t(labelKey)}</span>
        <span className="text-[11px] text-muted-foreground">· {t(descriptionKey)}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <Component />
      </div>
    </div>
  );
}
