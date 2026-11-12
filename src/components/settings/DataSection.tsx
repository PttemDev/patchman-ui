// Data panel inside the Settings dialog. Surfaces two pieces of state that
// previously hid in localStorage and silently confused users:
//
//   1. Where the FE is reading from right now — remote prod BE or the
//      embedded SQLite shipped with the desktop app.
//   2. The local↔remote merge dialog. After login it auto-fires once; if the
//      user dismissed it, the only way back used to be a logout/login cycle.
//
// Both are desktop-only — web doesn't ship an embedded BE so there's
// nothing to switch between.

import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Cloud, Database, GitMerge, AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import { useAuthStore, type DataSource } from '@/stores/authStore';
import { isDesktop } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { resetLocalData } from '@/lib/resetLocalData';

function ResetLocalDataCard() {
  const { t } = useTranslation('settings');
  const [armed, setArmed] = useState(false);
  const [running, setRunning] = useState(false);

  const onClick = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setRunning(true);
    await resetLocalData();
  };

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {t('data.resetSectionLabel')}
      </p>
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Trash2 className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground leading-relaxed flex-1">
            {t('data.resetDescription')}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={armed ? 'destructive' : 'outline'}
          onClick={onClick}
          disabled={running}
          className="gap-1.5"
        >
          {running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('data.resetting')}
            </>
          ) : armed ? (
            <>
              <Trash2 className="h-3.5 w-3.5" />
              {t('data.resetConfirm')}
            </>
          ) : (
            <>
              <Trash2 className="h-3.5 w-3.5" />
              {t('data.resetLocalSession')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export function DataSection() {
  const { t } = useTranslation('settings');
  const desktop = isDesktop();
  const { mode, dataSource, setDataSource, showFirstSyncPreview, lastSyncError, lastFirstSyncResult, isAuthenticated, user } =
    useAuthStore();
  const [planning, setPlanning] = useState(false);

  if (!desktop) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">{t('data.heading')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('data.description')}
          </p>
        </div>
        <div className="rounded-lg border p-4 text-sm text-muted-foreground">
          {t('data.webOnly')}
        </div>
        <ResetLocalDataCard />
      </div>
    );
  }

  if (mode === 'local') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">{t('data.heading')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('data.localModeDescription')}
          </p>
        </div>
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{t('data.localEmbedded')}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('data.localModeSignInHint')}
          </p>
          <Button asChild size="sm" variant="outline">
            <a href="/login">{t('data.signIn')}</a>
          </Button>
        </div>
        <ResetLocalDataCard />
      </div>
    );
  }

  const handleSwitch = (next: DataSource) => {
    if (next === dataSource) return;
    setDataSource(next);
    // Reload so every panel refetches against the new source. Without this
    // the in-memory collection tree, env list, etc. show stale data from the
    // previous source until the user navigates around — confusing exactly
    // when the badge made it less confusing.
    setTimeout(() => window.location.reload(), 50);
  };

  const handleMerge = async () => {
    setPlanning(true);
    try {
      await showFirstSyncPreview();
    } finally {
      setPlanning(false);
    }
  };

  const sourceCards: Array<{
    id: DataSource;
    label: string;
    sub: string;
    detail: string;
    icon: typeof Cloud;
  }> = [
    // Titles deliberately short — long labels truncated with an ellipsis
    // at narrow card widths and the qualifier (your account / embedded
    // SQLite) was repeating what the sub line already said. The sub line
    // now carries the qualifier so the title row never overflows.
    {
      id: 'remote',
      label: t('data.remoteLabel'),
      sub: t('data.remoteSub'),
      detail: t('data.remoteDetail'),
      icon: Cloud,
    },
    {
      id: 'local',
      label: t('data.localLabel'),
      sub: t('data.localSub'),
      detail: t('data.localDetail'),
      icon: Database,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t('data.heading')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('data.description')}
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          {t('data.activeDataSource')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {sourceCards.map((c) => {
            const Icon = c.icon;
            const active = dataSource === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => handleSwitch(c.id)}
                // `flex flex-col items-stretch` overrides the native button
                // baseline alignment that was making the inactive card's
                // content sit a few px lower than the active card in
                // `items-stretch` grid cells — now both columns start
                // strictly at the top edge of their card.
                className={`flex flex-col items-stretch text-left rounded-lg border p-3 transition-colors cursor-pointer ${
                  active
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-foreground/30 hover:bg-accent/30'
                }`}
              >
                {/* Title row: fixed min-height + reserved badge slot so the
                    active and inactive cards lay out identically. Without
                    the reserved slot the inactive card's icon/title appear
                    to ride up to the optical center of a slightly different
                    container, which read as a "misalignment" between the
                    two cards. `shrink-0` on the icon plus `truncate` on the
                    title keep long labels (e.g. "Local (embedded SQLite)")
                    from pushing the badge off-row on narrow widths. */}
                <div className="flex items-center gap-2 min-h-5">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}
                  />
                  <span className="text-sm font-medium truncate">{c.label}</span>
                  <span
                    className={`ml-auto text-[10px] uppercase tracking-wider font-semibold ${
                      active ? 'text-primary' : 'invisible'
                    }`}
                  >
                    {t('data.active')}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{c.sub}</p>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{c.detail}</p>
              </button>
            );
          })}
        </div>
        {dataSource === 'local' && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              <Trans
                t={t}
                i18nKey="data.localWarning"
                values={{ email: user?.email || t('data.unknownUser') }}
                components={{ mono: <span className="font-mono" /> }}
              />
            </span>
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          {t('data.mergeHeading')}
        </p>
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-start gap-3">
            <GitMerge className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground leading-relaxed flex-1">
              {t('data.mergeDescription')}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleMerge}
            disabled={planning || !isAuthenticated}
          >
            {planning ? t('data.computing') : t('data.openMergePreview')}
          </Button>
          {lastSyncError && (
            <p className="text-[11px] text-red-500">{lastSyncError}</p>
          )}
          {lastFirstSyncResult?.whiteboardsPushSupported === false && (
            <p className="text-[11px] text-amber-600 dark:text-amber-500">
              {t('data.whiteboardsNotSynced')}
            </p>
          )}
        </div>
      </div>

      <ResetLocalDataCard />
    </div>
  );
}
