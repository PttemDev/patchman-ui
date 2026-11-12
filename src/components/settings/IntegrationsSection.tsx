// Integrations panel — currently only GitLab account linking. The user
// clicks Connect, completes OAuth on the configured GitLab instance, and sees
// their linked identity here. The token never lives on this device — it sits
// encrypted in the BE and is used by the collection sync feature.

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { useGitIntegrationStore } from '@/stores/gitIntegrationStore';
import { GitLabConnectCard } from './GitLabConnectCard';

export function IntegrationsSection() {
  const { t } = useTranslation('settings');
  const isAuthed = useAuthStore((s) => s.isAuthenticated);
  const mode = useAuthStore((s) => s.mode);
  const refresh = useGitIntegrationStore((s) => s.refresh);

  useEffect(() => {
    if (isAuthed) refresh();
  }, [isAuthed, refresh]);

  if (mode === 'local') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">{t('integrations.heading')}</h2>
          <p className="text-sm text-muted-foreground">{t('integrations.description')}</p>
        </div>
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          {t('integrations.signInPrompt')}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t('integrations.heading')}</h2>
        <p className="text-sm text-muted-foreground">{t('integrations.description')}</p>
      </div>
      <GitLabConnectCard />
    </div>
  );
}
