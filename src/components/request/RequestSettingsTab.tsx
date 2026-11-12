import { useState } from 'react';
import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRequestSettingsStore, DEFAULT_REQUEST_TIMEOUT } from '@/stores/requestSettingsStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

// Global, device-local request settings (not per-tab, not synced). Currently
// just the request timeout — see requestSettingsStore.
export function RequestSettingsTab() {
  const { t } = useTranslation('request');
  const timeoutSeconds = useRequestSettingsStore((s) => s.timeoutSeconds);
  const setTimeoutSeconds = useRequestSettingsStore((s) => s.setTimeoutSeconds);
  const reset = useRequestSettingsStore((s) => s.reset);

  // A local text draft so the field can be fully cleared while typing (a plain
  // number input snaps the last digit back). Only digits are accepted — no
  // decimals, commas, or sign — and an empty field falls back to the default.
  const [draft, setDraft] = useState(() => String(timeoutSeconds));

  const onChange = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '');
    setDraft(digits);
    // Effective value: empty (or 0) → the default; otherwise the integer typed.
    setTimeoutSeconds(digits === '' ? DEFAULT_REQUEST_TIMEOUT : parseInt(digits, 10));
  };

  const doReset = () => {
    reset();
    setDraft(String(DEFAULT_REQUEST_TIMEOUT));
  };

  return (
    <div className="p-4 overflow-auto flex-1">
      <div className="max-w-lg space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <Label className="text-xs font-medium">{t('reqSettings.requestTimeout')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="text"
            inputMode="numeric"
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            placeholder={String(DEFAULT_REQUEST_TIMEOUT)}
            aria-label={t('reqSettings.requestTimeoutAria')}
            className="h-8 w-28 text-xs font-mono"
          />
          <span className="text-xs text-muted-foreground">{t('reqSettings.seconds')}</span>
          {draft !== '' && draft !== String(DEFAULT_REQUEST_TIMEOUT) && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={doReset}>
              {t('reqSettings.resetTo', { seconds: DEFAULT_REQUEST_TIMEOUT })}
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug pt-1">
          {t('reqSettings.timeoutHelp', { seconds: DEFAULT_REQUEST_TIMEOUT })}
        </p>
      </div>
    </div>
  );
}
