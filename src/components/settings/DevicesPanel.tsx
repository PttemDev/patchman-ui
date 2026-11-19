import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Laptop, Loader2, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { confirmDialog } from '@/components/ui/confirm';
import { authAPI, type UserSession } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

// Devices signed in to the team backend (DESKTOP_SECURITY_RFC L8): lets the
// user end a lost laptop's session from anywhere.
export function DevicesPanel() {
  const { t } = useTranslation('settings');
  const { toast } = useToast();
  const { isAuthenticated, mode } = useAuthStore();
  const [rows, setRows] = useState<UserSession[] | null>(null);
  const [error, setError] = useState('');
  const synced = isAuthenticated && mode === 'synced';

  const load = useCallback(async () => {
    try {
      const res = await authAPI.sessions();
      setRows(Array.isArray(res.data) ? res.data : []);
      setError('');
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(status === 404 ? t('security.devicesUnsupported') : t('security.devicesFailed'));
    }
  }, [t]);
  useEffect(() => { if (synced) void load(); }, [synced, load]);

  if (!synced) return null;

  const revoke = async (s: UserSession) => {
    if (!(await confirmDialog({ title: t('security.revokeConfirm'), description: describe(s), destructive: true }))) return;
    try { await authAPI.revokeSession(s.id); await load(); } catch { toast({ title: t('security.devicesFailed'), variant: 'destructive' }); }
  };
  const revokeOthers = async () => {
    if (!(await confirmDialog({ title: t('security.revokeOthersConfirm'), destructive: true }))) return;
    try { await authAPI.revokeOtherSessions(); await load(); } catch { toast({ title: t('security.devicesFailed'), variant: 'destructive' }); }
  };

  return (
    <section className="rounded-lg border px-4 pb-3">
      <div className="flex items-center justify-between pt-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><Laptop className="h-3.5 w-3.5" />{t('security.devices')}</div>
        {rows && rows.length > 1 && (
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => void revokeOthers()}>
            <LogOut className="h-3.5 w-3.5" />{t('security.revokeOthers')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{t('security.devicesHint')}</p>
      {error ? (
        <p className="text-xs text-muted-foreground mt-2">{error}</p>
      ) : !rows ? (
        <div className="py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
      ) : (
        <ul className="mt-2 divide-y">
          {rows.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{describe(s)}{s.current && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{t('security.thisDevice')}</span>}</div>
                <div className="text-muted-foreground">{s.ipAddress || '—'} · {t('security.lastSeen', { when: new Date(s.lastSeenAt).toLocaleString() })}</div>
              </div>
              {!s.current && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void revoke(s)}>{t('security.revoke')}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function describe(s: UserSession): string {
  const ua = s.userAgent || '';
  const app = s.clientVersion ? `PatchMan ${s.clientVersion}` : '';
  const os = /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Tauri|PatchMan/.test(ua) ? 'Desktop' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [app || browser, os].filter(Boolean).join(' · ') || ua.slice(0, 60) || '—';
}
