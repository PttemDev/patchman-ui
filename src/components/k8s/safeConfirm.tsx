import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// A single confirm request. When `typeToConfirm` is set the confirm button
// stays disabled until the user types that exact string — the type-to-confirm
// gate for destructive Kubernetes actions (Delete, Scale to 0, Drain, Force
// apply). Non-destructive actions (restart rollout, scale up, cordon) omit it
// for a one-click confirm.
export interface SafeConfirmRequest {
  title: string;
  description?: ReactNode;
  /** Confirm-button label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Red confirm button + warning banner. */
  destructive?: boolean;
  /** Exact string the user must type to enable confirm (type-to-confirm). */
  typeToConfirm?: string;
}

// useSafeConfirm exposes an imperative, promise-based confirm() plus the
// `dialog` element to render once in the tree. confirm(req) resolves true on
// confirm, false on cancel / escape / overlay-click. Modeled to be reused by
// the K8s explorer's quick-actions menu.
export function useSafeConfirm() {
  const { t } = useTranslation('k8s');
  const [req, setReq] = useState<SafeConfirmRequest | null>(null);
  const [typed, setTyped] = useState('');
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((r: SafeConfirmRequest) => {
    setTyped('');
    setReq(r);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  // finish is idempotent: the first call resolves the promise and nulls the
  // resolver, so the follow-up onOpenChange(false) that Radix fires after a
  // button activation is a no-op.
  const finish = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setReq(null);
    setTyped('');
  }, []);

  const needsType = !!req?.typeToConfirm;
  const canConfirm = !needsType || typed === req?.typeToConfirm;

  const dialog = (
    <AlertDialog open={!!req} onOpenChange={(o) => { if (!o) finish(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {req?.destructive && <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />}
            {req?.title}
          </AlertDialogTitle>
          {req?.description && (
            <AlertDialogDescription asChild>
              <div>{req.description}</div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>

        {needsType && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              <Trans
                t={t}
                i18nKey="confirm.typeToConfirm"
                values={{ value: req?.typeToConfirm ?? '' }}
                components={{ mono: <span className="font-mono font-medium text-foreground" /> }}
              />
            </p>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) finish(true); }}
              placeholder={req?.typeToConfirm}
              className="h-8 text-sm font-mono"
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(false)}>{t('common:cancel')}</AlertDialogCancel>
          <Button
            variant={req?.destructive ? 'destructive' : 'default'}
            disabled={!canConfirm}
            onClick={() => finish(true)}
            className={cn('mt-2 sm:mt-0')}
          >
            {req?.confirmLabel ?? t('common:confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, dialog };
}
