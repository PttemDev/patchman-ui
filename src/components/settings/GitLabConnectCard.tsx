// Connect/Disconnect card for GitLab. Used in two places: the Settings →
// Integrations panel (full-width) and the Import → GitLab tab (when not yet
// connected, to flow the user through OAuth without leaving the dialog).
//
// All state lives in useGitIntegrationStore; this is a thin presentation
// shell so the two surfaces stay in sync.

import { useTranslation } from 'react-i18next';
import { GitBranch, ExternalLink, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/confirm';
import { useGitIntegrationStore } from '@/stores/gitIntegrationStore';
import { gitlabHostname } from '@/lib/tenant';

interface Props {
  // Hide the heading row when embedded inside another labelled surface
  // (e.g. the Import dialog GitLab tab) where the parent already explains
  // what the card is for.
  variant?: 'card' | 'embedded';
}

export function GitLabConnectCard({ variant = 'card' }: Props) {
  const { t } = useTranslation('settings');
  const status = useGitIntegrationStore((s) => s.status);
  const loading = useGitIntegrationStore((s) => s.loading);
  const error = useGitIntegrationStore((s) => s.error);
  const connectState = useGitIntegrationStore((s) => s.connectState);
  const connect = useGitIntegrationStore((s) => s.connect);
  const disconnect = useGitIntegrationStore((s) => s.disconnect);
  const refresh = useGitIntegrationStore((s) => s.refresh);

  const handleDisconnect = async () => {
    if (!(await confirmDialog({ title: t('gitlab.disconnectConfirm'), destructive: true }))) {
      return;
    }
    await disconnect();
  };

  return (
    <div className={variant === 'card' ? 'rounded-lg border p-4 space-y-4' : 'space-y-4'}>
      {variant === 'card' && (
        <div className="flex items-start gap-3">
          <GitBranch className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold">GitLab</div>
            <div className="text-xs text-muted-foreground">
              {t('gitlab.description')}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('gitlab.checkingStatus')}
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : status ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {status.gitlabAvatar ? (
              <img src={status.gitlabAvatar} alt="" className="h-9 w-9 rounded-full" />
            ) : (
              <div className="h-9 w-9 rounded-full bg-muted" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                {t('gitlab.connectedAs', { username: status.gitlabUsername })}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {status.gitlabName} · {t('gitlab.scopes', { scopes: status.scopes || '—' })}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleDisconnect}>
              {t('common:disconnect')}
            </Button>
            <Button variant="ghost" size="sm" onClick={refresh}>
              {t('common:refresh')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Button onClick={connect} disabled={connectState !== 'idle'} size="sm">
            {connectState === 'idle' ? (
              <>
                <ExternalLink className="h-4 w-4 mr-2" />
                {t('gitlab.connect')}
              </>
            ) : connectState === 'pending' ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('gitlab.waitingForBrowser')}
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('gitlab.finalising')}
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t('gitlab.approvePrompt', { host: gitlabHostname() })}
          </p>
        </div>
      )}
    </div>
  );
}
