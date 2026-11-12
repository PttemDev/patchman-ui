import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, FolderTree, Send, Leaf, Cookie, Shapes, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import type { SyncDirection } from '@/data/sync/SyncEngine';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Counts = { collections: number; requests: number; environments: number; cookies: number; whiteboards: number };

function sum(c: Counts): number {
  return c.collections + c.requests + c.environments + c.cookies + c.whiteboards;
}

const ROWS: Array<{ key: keyof Counts; labelKey: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'collections', labelKey: 'firstSync.rowCollections', Icon: FolderTree },
  { key: 'requests', labelKey: 'firstSync.rowRequests', Icon: Send },
  { key: 'environments', labelKey: 'firstSync.rowEnvironments', Icon: Leaf },
  { key: 'cookies', labelKey: 'firstSync.rowCookies', Icon: Cookie },
  { key: 'whiteboards', labelKey: 'firstSync.rowWhiteboards', Icon: Shapes },
];

function SyncColumn({
  title,
  total,
  counts,
  tone,
  Icon,
  active,
}: {
  title: string;
  total: number;
  counts: Counts;
  tone: 'push' | 'pull';
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  const { t } = useTranslation('collections');
  const isEmpty = total === 0 || !active;
  const toneRing = !active
    ? 'ring-border'
    : tone === 'push'
      ? 'ring-blue-500/30'
      : 'ring-emerald-500/30';
  const toneIcon = !active
    ? 'text-muted-foreground/50'
    : tone === 'push'
      ? 'text-blue-500'
      : 'text-emerald-500';
  const badgeVariant = tone === 'push' ? ('info' as const) : ('success' as const);
  const inactiveClass = active ? '' : 'opacity-50';

  return (
    <div className={`rounded-lg border bg-muted/30 p-4 ring-1 transition-opacity ${toneRing} ${inactiveClass}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${toneIcon}`} />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <Badge variant={isEmpty ? 'outline' : badgeVariant}>{active ? total : 0}</Badge>
      </div>
      <div className="space-y-1.5">
        {ROWS.map(({ key, labelKey, Icon: RowIcon }) => {
          const n = active ? counts[key] : 0;
          const dim = n === 0;
          return (
            <div
              key={key}
              className={`flex items-center justify-between text-sm ${dim ? 'text-muted-foreground/60' : ''}`}
            >
              <span className="flex items-center gap-2">
                <RowIcon className="h-3.5 w-3.5" />
                {t(labelKey)}
              </span>
              <span className={dim ? '' : 'font-medium tabular-nums'}>{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DIRECTION_OPTIONS: Array<{
  value: SyncDirection;
  labelKey: string;
  hintKey: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: 'both', labelKey: 'firstSync.mergeBoth', hintKey: 'firstSync.mergeBothHint', Icon: ArrowLeftRight },
  { value: 'push', labelKey: 'firstSync.onlyPush', hintKey: 'firstSync.onlyPushHint', Icon: ArrowUpFromLine },
  { value: 'pull', labelKey: 'firstSync.onlyPull', hintKey: 'firstSync.onlyPullHint', Icon: ArrowDownToLine },
];

function DirectionPicker({
  value,
  onChange,
}: {
  value: SyncDirection;
  onChange: (v: SyncDirection) => void;
}) {
  const { t } = useTranslation('collections');
  return (
    <div className="grid grid-cols-3 gap-2">
      {DIRECTION_OPTIONS.map(({ value: v, labelKey, hintKey, Icon }) => {
        const selected = v === value;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`rounded-md border p-2.5 text-left transition-colors ${
              selected
                ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                : 'border-border hover:bg-muted/50'
            }`}
          >
            <div className="flex items-center gap-2 mb-0.5">
              <Icon className={`h-3.5 w-3.5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className={`text-xs font-semibold ${selected ? 'text-primary' : ''}`}>{t(labelKey)}</span>
            </div>
            <div className="text-xs text-muted-foreground leading-snug">{t(hintKey)}</div>
          </button>
        );
      })}
    </div>
  );
}

export function SyncPreviewDialog() {
  const { t } = useTranslation('collections');
  const { pendingFirstSync, confirmFirstSync, cancelFirstSync } = useAuthStore();
  const [applying, setApplying] = useState(false);
  const [direction, setDirection] = useState<SyncDirection>('both');

  if (!pendingFirstSync) return null;

  const { preview } = pendingFirstSync;
  const totalPush = sum(preview.push);
  const totalPull = sum(preview.pull);
  const pushActive = direction === 'both' || direction === 'push';
  const pullActive = direction === 'both' || direction === 'pull';
  const effectiveTotal = (pushActive ? totalPush : 0) + (pullActive ? totalPull : 0);
  const hasNotices =
    (pushActive && preview.renamed > 0) ||
    (pushActive && preview.skippedOrphanRequests > 0) ||
    direction === 'pull';

  const onConfirm = async () => {
    setApplying(true);
    try {
      await confirmFirstSync(direction);
    } finally {
      setApplying(false);
    }
  };

  const actionCap = direction === 'pull' ? 'Pull' : direction === 'push' ? 'Push' : 'Merge';
  const idleLabel = t(`firstSync.action${actionCap}`);
  const runningLabel = t(`firstSync.running${actionCap}`);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !applying) cancelFirstSync();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">{t('firstSync.title')}</DialogTitle>
          <DialogDescription>
            {t('firstSync.description')}
          </DialogDescription>
        </DialogHeader>

        <DirectionPicker value={direction} onChange={setDirection} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SyncColumn
            title={t('firstSync.pushColumn')}
            total={totalPush}
            counts={preview.push}
            tone="push"
            Icon={ArrowUpFromLine}
            active={pushActive}
          />
          <SyncColumn
            title={t('firstSync.pullColumn')}
            total={totalPull}
            counts={preview.pull}
            tone="pull"
            Icon={ArrowDownToLine}
            active={pullActive}
          />
        </div>

        {hasNotices && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm space-y-1">
            {pushActive && preview.renamed > 0 && (
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  <Trans
                    t={t}
                    i18nKey={preview.renamed === 1 ? 'firstSync.renamedNoticeOne' : 'firstSync.renamedNoticeOther'}
                    values={{ count: preview.renamed }}
                    components={{
                      b: <span className="font-medium" />,
                      code: <code className="rounded bg-background/60 px-1 py-0.5 text-xs" />,
                    }}
                  />
                </span>
              </div>
            )}
            {pushActive && preview.skippedOrphanRequests > 0 && (
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  <Trans
                    t={t}
                    i18nKey={preview.skippedOrphanRequests === 1 ? 'firstSync.orphanNoticeOne' : 'firstSync.orphanNoticeOther'}
                    values={{ count: preview.skippedOrphanRequests }}
                    components={{ b: <span className="font-medium" /> }}
                  />
                </span>
              </div>
            )}
            {direction === 'pull' && (
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  {t('firstSync.pullNotice')}
                </span>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={cancelFirstSync} disabled={applying}>
            {t('firstSync.skip')}
          </Button>
          <Button onClick={onConfirm} disabled={applying || effectiveTotal === 0}>
            {applying ? runningLabel : `${idleLabel}${effectiveTotal > 0 ? ` (${effectiveTotal})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
