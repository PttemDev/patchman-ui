import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle, Loader2, HelpCircle } from 'lucide-react';
import { useProxyConfigStore } from '@/stores/proxyConfigStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ProxyProtocolInfoDialog } from './ProxyProtocolInfoDialog';

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';

export function ProxySection() {
  const { t } = useTranslation('settings');
  const saved = useProxyConfigStore();
  const [endpoint, setEndpoint] = useState(saved.endpoint);
  const [authHeaderName, setAuthHeaderName] = useState(saved.authHeaderName);
  const [authHeaderValue, setAuthHeaderValue] = useState(saved.authHeaderValue);
  const [enabled, setEnabled] = useState(saved.enabled);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    setEndpoint(saved.endpoint);
    setAuthHeaderName(saved.authHeaderName);
    setAuthHeaderValue(saved.authHeaderValue);
    setEnabled(saved.enabled);
    setTestStatus('idle');
    setTestMessage('');
  }, [saved.endpoint, saved.authHeaderName, saved.authHeaderValue, saved.enabled]);

  const dirty =
    endpoint !== saved.endpoint ||
    authHeaderName !== saved.authHeaderName ||
    authHeaderValue !== saved.authHeaderValue ||
    enabled !== saved.enabled;

  const handleTest = async () => {
    if (!endpoint.trim()) {
      setTestStatus('fail');
      setTestMessage(t('proxy.enterEndpoint'));
      return;
    }
    setTestStatus('testing');
    setTestMessage('');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authHeaderName.trim()) headers[authHeaderName.trim()] = authHeaderValue;
      const res = await fetch(endpoint.trim(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          method: 'GET',
          url: 'https://httpbin.org/get',
          headers: {},
          params: {},
          body: { type: 'none', content: '' },
        }),
      });
      if (res.ok) {
        setTestStatus('ok');
        setTestMessage(t('proxy.connectedOk', { status: res.status }));
      } else {
        setTestStatus('fail');
        setTestMessage(t('proxy.returnedError', { status: res.status, statusText: res.statusText }));
      }
    } catch (err) {
      setTestStatus('fail');
      const msg = err instanceof Error ? err.message : t('proxy.connectionFailed');
      setTestMessage(msg);
    }
  };

  const handleSave = () => {
    saved.setConfig({
      endpoint: endpoint.trim(),
      authHeaderName: authHeaderName.trim(),
      authHeaderValue,
      enabled,
    });
  };

  const handleReset = () => {
    setEndpoint(saved.endpoint);
    setAuthHeaderName(saved.authHeaderName);
    setAuthHeaderValue(saved.authHeaderValue);
    setEnabled(saved.enabled);
    setTestStatus('idle');
    setTestMessage('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">{t('proxy.heading')}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t('proxy.description')}
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="ml-1 inline-flex items-center gap-1 text-primary hover:underline"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            {t('proxy.howItWorks')}
          </button>
        </p>
      </div>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div className="space-y-0.5">
          <Label className="text-sm">{t('proxy.enableLabel')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('proxy.enableDescription')}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="endpoint">{t('proxy.endpointLabel')}</Label>
        <Input
          id="endpoint"
          type="url"
          placeholder="https://proxy.example.com/proxy"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="auth-name">{t('proxy.authNameLabel')}</Label>
          <Input
            id="auth-name"
            placeholder="X-Proxy-Token"
            value={authHeaderName}
            onChange={(e) => setAuthHeaderName(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="auth-value">{t('proxy.authValueLabel')}</Label>
          <Input
            id="auth-value"
            type="password"
            placeholder={t('proxy.authValuePlaceholder')}
            value={authHeaderValue}
            onChange={(e) => setAuthHeaderValue(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testStatus === 'testing' || !endpoint.trim()}
        >
          {testStatus === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
          {t('proxy.testConnection')}
        </Button>
        {testStatus === 'ok' && (
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {testMessage}
          </span>
        )}
        {testStatus === 'fail' && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <XCircle className="h-3.5 w-3.5" />
            {testMessage}
          </span>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t">
        <Button variant="ghost" size="sm" onClick={handleReset} disabled={!dirty}>
          {t('proxy.reset')}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!dirty}>
          {t('common:save')}
        </Button>
      </div>

      <ProxyProtocolInfoDialog open={infoOpen} onOpenChange={setInfoOpen} />
    </div>
  );
}
