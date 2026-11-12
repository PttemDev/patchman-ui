import { useEffect, useState } from 'react';
import { useRabbitConnectionStore, scopeForRabbit, canWriteRabbit } from '@/stores/rabbitConnectionStore';
import type { DBScope } from '@/services/api';
import type { RabbitConnection } from '@/types';

/** The tab's connection, the scope it runs on and whether it may change the broker. */
export function useRabbitConn(connId: string | undefined): {
  conn?: RabbitConnection; scope: DBScope; writable: boolean; loaded: boolean;
} {
  const { connections, loaded, fetchConnections } = useRabbitConnectionStore();
  useEffect(() => { if (!loaded) void fetchConnections(); }, [loaded, fetchConnections]);
  const conn = connections.find((c) => c.id === connId);
  return { conn, scope: scopeForRabbit(connections, connId ?? ''), writable: canWriteRabbit(conn), loaded };
}

/** A counter bumped every `seconds` (0 / "" = off) — drives auto-refresh. */
export function useTick(seconds: string | undefined): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const s = Number(seconds) || 0;
    if (s <= 0) return;
    const id = window.setInterval(() => setTick((n) => n + 1), Math.max(2, s) * 1000);
    return () => window.clearInterval(id);
  }, [seconds]);
  return tick;
}
