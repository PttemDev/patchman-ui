// Admin-only panel for the crash-report → Slack integration.
//
// Surfaces three independent toggles (one per FE error source) and a
// "Send a test message" button. Reads the current state from the BE on
// mount and re-fetches after each save so a concurrent admin's change
// doesn't get silently overwritten. The "Send test" path is gated on
// Slack actually being configured server-side; otherwise it would just
// produce a confusing 503.

import { useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { AlertTriangle, Bell, Check, Loader2, Send, X } from 'lucide-react';
import {
  errorReportingAdminAPI,
  type ErrorReportingConfig,
  type ErrorReportingTestResponse,
} from '@/services/api';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import type { AxiosError } from 'axios';

type Toggle = 'boundaryEnabled' | 'rejectionEnabled' | 'windowEnabled';

const TOGGLE_DEFS: Array<{
  key: Toggle;
  labelKey: string;
  hintKey: string;
}> = [
  {
    key: 'boundaryEnabled',
    labelKey: 'crash.toggles.boundary.label',
    hintKey: 'crash.toggles.boundary.hint',
  },
  {
    key: 'rejectionEnabled',
    labelKey: 'crash.toggles.rejection.label',
    hintKey: 'crash.toggles.rejection.hint',
  },
  {
    key: 'windowEnabled',
    labelKey: 'crash.toggles.window.label',
    hintKey: 'crash.toggles.window.hint',
  },
];

export function CrashReportingCard() {
  const { t } = useTranslation('admin');
  const [config, setConfig] = useState<ErrorReportingConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<Toggle | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ErrorReportingTestResponse | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await errorReportingAdminAPI.getConfig();
      setConfig(res.data);
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      setError(ax.response?.data?.error || ax.message || t('crash.errors.loadConfigFailed'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setToggle = async (key: Toggle, value: boolean) => {
    if (!config) return;
    setSavingKey(key);
    try {
      const res = await errorReportingAdminAPI.patchConfig({ [key]: value });
      setConfig(res.data);
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      toast({
        title: t('crash.updateToggleFailed'),
        description: ax.response?.data?.error || ax.message,
        variant: 'destructive',
      });
    } finally {
      setSavingKey(null);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await errorReportingAdminAPI.test();
      setTestResult(res.data);
    } catch (err) {
      const ax = err as AxiosError<ErrorReportingTestResponse & { error?: string }>;
      setTestResult({
        ok: false,
        error: ax.response?.data?.error || ax.message || t('crash.errors.testRequestFailed'),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Bell className="h-4 w-4" />
          {t('crash.heading')}
        </h2>
        {config && !config.slackConfigured && (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3 w-3" />
            {t('crash.noWebhook')}
          </span>
        )}
      </div>

      <div className="rounded-md border bg-card p-4 space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {config && !config.slackConfigured && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
            <Trans
              t={t}
              i18nKey="crash.webhookNotice"
              components={{ mono: <span className="font-mono" /> }}
            />
          </div>
        )}

        <div className="space-y-3">
          {TOGGLE_DEFS.map((def) => {
            const value = config?.[def.key] ?? false;
            const saving = savingKey === def.key;
            return (
              <div key={def.key} className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{t(def.labelKey)}</div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {t(def.hintKey)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  <Switch
                    checked={value}
                    disabled={loading || saving || !config}
                    onCheckedChange={(next) => setToggle(def.key, next)}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t pt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground flex-1">
            {t('crash.testDescription')}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={sendTest}
            disabled={testing || !config?.slackConfigured}
            className="gap-1.5"
          >
            {testing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('crash.sending')}
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                {t('crash.sendTest')}
              </>
            )}
          </Button>
        </div>

        {testResult && (
          <div
            className={
              testResult.ok
                ? 'rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2'
                : 'rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive flex items-start gap-2'
            }
          >
            {testResult.ok ? (
              <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            ) : (
              <X className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            )}
            <span className="leading-relaxed">
              {testResult.ok
                ? t('crash.testSuccess')
                : t('crash.testFailed', { error: testResult.error || t('crash.unknownError') })}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
