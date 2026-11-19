import { useEffect, useState, type ReactNode } from 'react';
import { useSecurityStore } from '@/lib/securityClient';
import { LockScreen } from './LockScreen';

// Holds the whole app tree until the first unlock (DESKTOP_SECURITY_RFC L4):
// while locked the embedded BE answers 423, so mounting the app would load
// every store empty and nothing would refetch after unlock. Later locks
// (idle, sleep) only cover the mounted app with the overlay.
export function BootGate({ children }: { children: ReactNode }) {
  const locked = useSecurityStore((s) => s.snap?.locked ?? false);
  const [opened, setOpened] = useState(!locked);
  useEffect(() => { if (!locked) setOpened(true); }, [locked]);
  return opened ? <>{children}</> : <LockScreen />;
}
