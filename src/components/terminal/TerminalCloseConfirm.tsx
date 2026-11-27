import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { sessionLabel, useTerminalSessions } from './terminalSessions';
import { endSession, useTerminalCloseConfirm } from './terminalView';

// "Close a session that is still running something?" — one instance for the
// sidebar panel and the terminal tabs (mounted in AppLayout).
export function TerminalCloseConfirm() {
  const { t } = useTranslation(['terminal', 'common']);
  const pendingId = useTerminalCloseConfirm((s) => s.pendingId);
  const cancel = useTerminalCloseConfirm((s) => s.cancel);
  const session = useTerminalSessions((s) => s.sessions.find((x) => x.id === pendingId));
  return (
    <AlertDialog open={!!session} onOpenChange={(o) => { if (!o) cancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('terminal:closeBusyTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('terminal:closeBusyBody', { title: session ? sessionLabel(session) : '' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => { if (session) endSession(session.id); }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {t('common:close')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
