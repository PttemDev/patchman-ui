// Deprecation page for old /join/env/:token links.
//
// Pre-1.16 environments used a legacy share-code flow — the recipient
// POSTed to /api/environments/join with the token. That endpoint and
// every related env-share-collaborator surface were removed in 1.16;
// env sharing now runs exclusively through visibility=public + the
// Editors / Viewers + team / user / everyone grants surface. Existing
// collaborator rows were converted to public-grants at boot
// (see migrateEnvironmentSharesToPublicGrants in database.go).
//
// We keep the route alive purely to give old links a friendly
// landing page instead of a 404: tell the user the flow has changed
// and bounce them back to the app. Owners now grant access via the
// Share Environment dialog.

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function JoinEnvironmentByTokenPage() {
  const { t } = useTranslation('environment');
  const navigate = useNavigate();

  // Soft auto-redirect after a few seconds so users who just see a
  // flash of text don't get stranded.
  useEffect(() => {
    const timer = setTimeout(() => navigate('/', { replace: true }), 8000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-3">
        <AlertCircle className="h-10 w-10 text-amber-500 mx-auto" />
        <p className="text-base font-medium">{t('joinDeprecated.linkDead')}</p>
        <p className="text-sm text-muted-foreground">
          {t('joinDeprecated.info')}
        </p>
        <Button onClick={() => navigate('/', { replace: true })}>
          {t('joinDeprecated.backToApp')}
        </Button>
      </div>
    </div>
  );
}
