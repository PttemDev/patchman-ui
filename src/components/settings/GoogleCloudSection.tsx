// Settings → Google Cloud: the user's own BigQuery scan limits
// (GOOGLE_CLOUD_RFC.md ADR-3). Stored on every backend the user reaches
// (dual-write), because the backend enforces them — for the app and for AI
// agents alike. A connection's own limit overrides these; a server admin
// ceiling caps both.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { bigQuerySettingsAPI } from '@/services/api';
import { availableDBScopes, dualWrite } from '@/stores/dbConnectionStore';
import { extractErr } from '@/components/git/util';
import { GcpCredentialsPanel } from '@/components/gcp/GcpCredentialsPanel';

const GIB = 1024 ** 3;
const gb = (bytes: number) => (bytes > 0 ? String(+(bytes / GIB).toFixed(2)) : '');

interface Loaded { maxBytes: number; askBytes: number; defaultMaxBytes: number; defaultAskBytes: number; ceilingBytes: number }

export function GoogleCloudSection() {
  const { t } = useTranslation('settings');
  const { toast } = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [maxGB, setMaxGB] = useState('');
  const [askGB, setAskGB] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const scope = availableDBScopes()[0];
    bigQuerySettingsAPI.get(scope)
      .then((r) => {
        const d = r.data as Loaded;
        setData(d);
        setMaxGB(gb(d.maxBytes || d.defaultMaxBytes));
        setAskGB(gb(d.askBytes || d.defaultAskBytes));
      })
      .catch((e) => setError(extractErr(e, t('gcp.loadFailed'))));
  }, [t]);

  const save = async () => {
    const max = Math.round(parseFloat(maxGB || '0') * GIB);
    const ask = Math.round(parseFloat(askGB || '0') * GIB);
    if (!(max > 0) || !(ask > 0)) { setError(t('gcp.errPositive')); return; }
    if (ask > max) { setError(t('gcp.errAskAboveMax')); return; }
    if (data?.ceilingBytes && max > data.ceilingBytes) { setError(t('gcp.errCeiling', { gb: gb(data.ceilingBytes) })); return; }
    setError('');
    setSaving(true);
    const results = await dualWrite((s) => bigQuerySettingsAPI.put({ maxBytes: max, askBytes: ask }, s), availableDBScopes());
    setSaving(false);
    const failed = results.filter((r) => !r.ok);
    if (failed.length === results.length) { setError(extractErr(failed[0]?.error, t('gcp.saveFailed'))); return; }
    toast({ title: t('gcp.saved') });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('gcp.heading')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('gcp.description')}</p>
      </div>
      <GcpCredentialsPanel />
      <div className="max-w-xl space-y-3 rounded-lg border p-4">
        <div className="text-sm font-medium">{t('gcp.bigquery')}</div>
        {!data && !error ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('gcp.maxScan')}</Label>
                <div className="mt-1 flex items-center gap-1">
                  <Input type="number" min={0} step="0.1" value={maxGB} onChange={(e) => setMaxGB(e.target.value)} />
                  <span className="text-xs text-muted-foreground">GB</span>
                </div>
              </div>
              <div>
                <Label className="text-xs">{t('gcp.askAbove')}</Label>
                <div className="mt-1 flex items-center gap-1">
                  <Input type="number" min={0} step="0.1" value={askGB} onChange={(e) => setAskGB(e.target.value)} />
                  <span className="text-xs text-muted-foreground">GB</span>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('gcp.note')}
              {data?.ceilingBytes ? ` ${t('gcp.ceilingNote', { gb: gb(data.ceilingBytes) })}` : ''}
            </p>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{t('gcp.save')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
