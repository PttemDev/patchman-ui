// Settings → Jira: the user's Jira connections (Cloud or Data Center), read
// by the QA Hub and the jira_* MCP tools (CR_QA_P0_PLAN.md P0.b / O1).

import { useTranslation } from 'react-i18next';
import { JiraConnectionsPanel } from '@/components/jira/JiraConnectionsPanel';

export function JiraSection() {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('jira.heading')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('jira.description')}</p>
      </div>
      <JiraConnectionsPanel />
    </div>
  );
}
