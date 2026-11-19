import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, ShieldCheck } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { isDesktop } from '@/lib/platform';
import { DevicesPanel } from './DevicesPanel';
import {
  lockApp, startSecurityClient, updateSecuritySettings, useSecurityStore, type SecuritySettings,
} from '@/lib/securityClient';

const IDLE_PRESETS = [5, 10, 15, 30, 60, 120, 240];
const SUDO_PRESETS = [1, 5, 15, 30, 60];

// Desktop security settings (DESKTOP_SECURITY_RFC L4–L7). The launch token,
// origin lock and deep-link confirmation are always on and not listed here.
// Settings are stored by the desktop shell, and any change that protects less
// asks for Touch ID / the macOS password first.
export function SecuritySection() {
  const { t } = useTranslation('settings');
  const { toast } = useToast();
  const snap = useSecurityStore((s) => s.snap);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void startSecurityClient(); }, []);

  if (!isDesktop()) {
    return (
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{t('security.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('security.desktopOnly')}</p>
        <DevicesPanel />
      </div>
    );
  }
  if (!snap) return <p className="text-sm text-muted-foreground">…</p>;
  const s = snap.settings;

  const save = async (next: Partial<SecuritySettings>) => {
    setBusy(true);
    try {
      await updateSecuritySettings({ ...s, ...next });
    } catch (e) {
      toast({ title: t('security.saveFailed'), description: String(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const minutesSelect = (value: number, presets: number[], onChange: (n: number) => void, disabled: boolean) => {
    const opts = presets.includes(value) ? presets : [...presets, value].sort((a, b) => a - b);
    return (
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))} disabled={disabled || busy}>
        <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {opts.map((m) => <SelectItem key={m} value={String(m)} className="text-xs">{t('security.minutes', { count: m })}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  };

  const row = (label: string, hint: string, control: React.ReactNode) => (
    <div className="flex items-start justify-between gap-6 py-3 border-b last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );

  return (
    <div className="space-y-5 max-w-2xl">
      {/* pr-10 keeps "Lock now" clear of the dialog's close button. */}
      <div className="flex items-center justify-between pr-10">
        <h2 className="text-lg font-semibold">{t('security.title')}</h2>
        {s.lockEnabled && snap.authAvailable && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void lockApp()}>
            <Lock className="h-3.5 w-3.5" />{t('security.lockNow')}
          </Button>
        )}
      </div>

      {!snap.authAvailable && (
        <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
          {t('security.noAuth')}
        </p>
      )}

      <section className="rounded-lg border px-4">
        <div className="flex items-center gap-2 pt-3 text-xs uppercase tracking-wider text-muted-foreground"><Lock className="h-3.5 w-3.5" />{t('security.lockHeading')}</div>
        {row(t('security.lockEnabled'), t('security.lockEnabledHint'),
          <Switch checked={s.lockEnabled} disabled={busy || !snap.authAvailable} onCheckedChange={(v) => void save({ lockEnabled: v })} />)}
        {row(t('security.idle'), t('security.idleHint'), (
          <div className="flex items-center gap-2">
            {minutesSelect(s.idleMinutes, IDLE_PRESETS, (n) => void save({ idleMinutes: n }), !s.lockEnabled)}
            <CustomMinutes max={480} disabled={!s.lockEnabled || busy} onApply={(n) => void save({ idleMinutes: n })} />
          </div>
        ))}
        {row(t('security.onSleep'), t('security.onSleepHint'),
          <Switch checked={s.lockOnSleep} disabled={busy || !s.lockEnabled} onCheckedChange={(v) => void save({ lockOnSleep: v })} />)}
        {row(t('security.onScreenLock'), t('security.onScreenLockHint'),
          <Switch checked={s.lockOnScreenLock} disabled={busy || !s.lockEnabled} onCheckedChange={(v) => void save({ lockOnScreenLock: v })} />)}
        {row(t('security.blockMcp'), t('security.blockMcpHint'),
          <Switch checked={s.blockMcpWhileLocked} disabled={busy || !s.lockEnabled} onCheckedChange={(v) => void save({ blockMcpWhileLocked: v })} />)}
      </section>

      <section className="rounded-lg border px-4">
        <div className="flex items-center gap-2 pt-3 text-xs uppercase tracking-wider text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />{t('security.sudoHeading')}</div>
        {row(t('security.sudoEnabled'), t('security.sudoEnabledHint'),
          <Switch checked={s.sudoEnabled} disabled={busy || !snap.authAvailable} onCheckedChange={(v) => void save({ sudoEnabled: v })} />)}
        {row(t('security.sudoWindow'), t('security.sudoWindowHint'),
          minutesSelect(s.sudoMinutes, SUDO_PRESETS, (n) => void save({ sudoMinutes: n }), !s.sudoEnabled))}
      </section>

      <DevicesPanel />

      <p className="text-xs text-muted-foreground">{t('security.alwaysOn')}</p>
    </div>
  );
}

function CustomMinutes({ max, disabled, onApply }: { max: number; disabled: boolean; onApply: (n: number) => void }) {
  const { t } = useTranslation('settings');
  const [v, setV] = useState('');
  const n = Number(v);
  const valid = Number.isInteger(n) && n >= 1 && n <= max;
  return (
    <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (valid) { onApply(n); setV(''); } }}>
      <Input value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} placeholder={t('security.custom')} disabled={disabled} className="h-8 w-20 text-xs" inputMode="numeric" />
      <Button type="submit" size="sm" variant="ghost" className="h-8 text-xs" disabled={disabled || !valid}>{t('security.apply')}</Button>
    </form>
  );
}
