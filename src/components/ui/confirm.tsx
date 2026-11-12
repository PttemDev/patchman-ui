import { create } from 'zustand';
import { useTranslation } from 'react-i18next';
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

// App-wide themed confirm. `window.confirm()` is unavailable in the Tauri shell
// (it routes to a dialog plugin command that isn't registered → "dialog.confirm
// not allowed"), and the app's design calls for themed dialogs anyway. This is
// an imperative, promise-based replacement backed by ONE <GlobalConfirm/>
// mounted at the app root — call `confirmDialog({...})` from anywhere and await
// the boolean.

export interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmState {
  req: ConfirmRequest | null;
  resolve: ((v: boolean) => void) | null;
  open: (r: ConfirmRequest) => Promise<boolean>;
  finish: (v: boolean) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  req: null,
  resolve: null,
  open: (r) =>
    new Promise<boolean>((resolve) => {
      // Resolve any in-flight confirm as cancelled before opening a new one.
      get().resolve?.(false);
      set({ req: r, resolve });
    }),
  finish: (v) => {
    get().resolve?.(v);
    set({ req: null, resolve: null });
  },
}));

/** Show a themed confirm dialog. Resolves true on confirm, false on cancel /
 *  escape / overlay-click. Safe to call from event handlers and effects. */
export function confirmDialog(r: ConfirmRequest): Promise<boolean> {
  return useConfirmStore.getState().open(r);
}

export function GlobalConfirm() {
  const { t } = useTranslation('common');
  const req = useConfirmStore((s) => s.req);
  const finish = useConfirmStore((s) => s.finish);
  return (
    <AlertDialog open={!!req} onOpenChange={(o) => { if (!o) finish(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {req?.destructive && <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />}
            {req?.title}
          </AlertDialogTitle>
          {req?.description && (
            <AlertDialogDescription>{req.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(false)}>
            {req?.cancelLabel ?? t('cancel')}
          </AlertDialogCancel>
          <Button
            variant={req?.destructive ? 'destructive' : 'default'}
            onClick={() => finish(true)}
            className="mt-2 sm:mt-0"
          >
            {req?.confirmLabel ?? t('confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
