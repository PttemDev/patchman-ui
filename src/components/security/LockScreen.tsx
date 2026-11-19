import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Fingerprint, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startSecurityClient, unlockApp, useSecurityStore } from '@/lib/securityClient';
import { isDesktop } from '@/lib/platform';

// Full-window cover while the desktop app is locked (DESKTOP_SECURITY_RFC L4).
// The BE refuses every call while locked, so this is the UX, not the fence.
export function LockScreen() {
  const { t } = useTranslation('app');
  const locked = useSecurityStore((s) => s.snap?.locked ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { void startSecurityClient(); }, []);

  const unlock = async () => {
    setBusy(true);
    setError('');
    try {
      await unlockApp();
    } catch (e) {
      setError(String(e).includes('cancel') ? t('lock.cancelled') : t('lock.failed'));
    } finally {
      setBusy(false);
    }
  };

  // Ask right away when the lock appears (launch, idle, sleep) — one click less.
  useEffect(() => {
    if (locked) void unlock();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  if (!isDesktop() || !locked) return null;
  return (
    // Portal to <body> + pointer-events:auto: when the lock lands while a modal
    // dialog is open (e.g. "Lock now" in Settings), Radix sets
    // body { pointer-events: none } and an in-tree overlay can't be clicked.
    createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-background/95 backdrop-blur-md" style={{ pointerEvents: 'auto' }}>
      <div className="fixed top-0 inset-x-0 h-8" data-tauri-drag-region aria-hidden />
      <div className="flex flex-col items-center gap-4 text-center px-6">
        <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
          <Lock className="h-7 w-7 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">{t('lock.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">{t('lock.body')}</p>
        </div>
        <Button onClick={() => void unlock()} disabled={busy} className="gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
          {t('lock.unlock')}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>,
    document.body,
    )
  );
}
