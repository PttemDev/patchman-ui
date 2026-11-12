// Dialog shown for any uncaught FE error: render-time crashes (caught by
// the React ErrorBoundary), sync event-handler errors (window.onerror), and
// unhandled promise rejections (window.onunhandledrejection). It shows the
// error message + stack and gives the user a one-click copy so they can
// drop it into the #patchman-support Slack channel.
//
// Lives at the App root so it's visible regardless of which subtree
// triggered the error.

import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, Copy, Check, Hash, Trash2, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useErrorReportStore } from '@/stores/errorReportStore';
import { getAppVersion } from '@/lib/version';
import { isDesktop } from '@/lib/platform';
import { resetLocalData } from '@/lib/resetLocalData';

const SUPPORT_CHANNEL = '#patchman-support';

// English-only label used inside the copyable report block (a maintainer paste,
// kept in English alongside the untranslated Location:/When:/Source: fields).
function sourceLabel(source: string): string {
  switch (source) {
    case 'render':
      return 'Render error';
    case 'event-handler':
      return 'Action error';
    case 'unhandled-rejection':
      return 'Async error';
    default:
      return 'Error';
  }
}

// Localized label used in the on-screen description. Full literal keys (no
// concatenation) so the i18n ref-check can validate them.
function translatedSourceLabel(source: string, t: TFunction): string {
  switch (source) {
    case 'render':
      return t('errorReport.source.render');
    case 'event-handler':
      return t('errorReport.source.action');
    case 'unhandled-rejection':
      return t('errorReport.source.async');
    default:
      return t('errorReport.source.default');
  }
}

export function ErrorReportDialog() {
  const { t } = useTranslation('app');
  const current = useErrorReportStore((s) => s.current);
  const dismiss = useErrorReportStore((s) => s.dismiss);
  const [copied, setCopied] = useState(false);
  // Two-step reset: first click arms the button, second click commits.
  // Resets when a new error arrives so the user doesn't accidentally
  // commit through a stale armed state.
  const [resetArmed, setResetArmed] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    setCopied(false);
    setResetArmed(false);
    setResetting(false);
  }, [current?.id]);

  if (!current) return null;

  // Build a single shareable block. Version + platform + location bits live
  // up top so a maintainer reading the paste can see context without asking
  // the reporter for it.
  const reportText = [
    `PatchMan ${getAppVersion()} (${isDesktop() ? 'desktop' : 'web'})`,
    current.location ? `Location: ${current.location}` : null,
    `When: ${current.occurredAt}`,
    `Source: ${sourceLabel(current.source)}`,
    '',
    current.message,
    '',
    current.stack || '(no stack available)',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be denied (web build w/o secure context). Fallback:
      // select the textarea below so the user can copy manually.
      const ta = document.getElementById('error-report-textarea') as HTMLTextAreaElement | null;
      ta?.select();
    }
  };

  const handleReset = async () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetting(true);
    await resetLocalData();
    // resetLocalData reloads the page; we never reach this line in
    // practice. If something fails before reload, leave the spinner up
    // so the user can retry from a different escape hatch.
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {t('errorReport.title')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('errorReport.description', { source: translatedSourceLabel(current.source, t) })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              {t('errorReport.messageLabel')}
            </p>
            <p className="text-sm font-mono break-words whitespace-pre-wrap">
              {current.message}
            </p>
          </div>

          {current.stack && (
            <details className="rounded-md border bg-muted/30 p-3">
              <summary className="text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none">
                {t('errorReport.stackLabel')}
              </summary>
              <pre className="text-[10px] font-mono mt-2 whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto">
                {current.stack}
              </pre>
            </details>
          )}

          <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 text-xs">
            <Hash className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
            <span>
              <Trans
                t={t}
                i18nKey="errorReport.forwarded"
                values={{ channel: SUPPORT_CHANNEL }}
                components={{ mono: <span className="font-mono font-medium" /> }}
              />
            </span>
          </div>

          {/* Last-resort escape hatch. Persisted-state corruption (e.g. an
              older build wrote `headers: undefined` into IDB) can survive
              an in-place upgrade — the only way out is clearing the local
              cache. Two-click confirm so it's not triggered on accident. */}
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs space-y-2">
            <p className="text-muted-foreground">
              {t('errorReport.resetHint')}
            </p>
            <Button
              variant={resetArmed ? 'destructive' : 'outline'}
              size="sm"
              onClick={handleReset}
              disabled={resetting}
              className="gap-1.5"
            >
              {resetting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('errorReport.resetting')}
                </>
              ) : resetArmed ? (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('errorReport.resetConfirm')}
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('errorReport.resetLocal')}
                </>
              )}
            </Button>
          </div>

          {/* Hidden textarea that the clipboard fallback selects. Only visible
              if clipboard write fails (rare on desktop, can happen on web). */}
          <textarea
            id="error-report-textarea"
            className="sr-only"
            readOnly
            value={reportText}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={dismiss}>
            {t('errorReport.dismiss')}
          </Button>
          <Button onClick={handleCopy}>
            {copied ? (
              <>
                <Check className="h-4 w-4 mr-1.5" />
                {t('common:copied')}
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-1.5" />
                {t('errorReport.copyReport')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
