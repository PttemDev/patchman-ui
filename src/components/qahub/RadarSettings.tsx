import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { qaAPI } from '@/services/api';
import type { QASettings } from '@/types';
import { SIGNAL_KINDS, SIGNAL_META } from './qaRadarUtil';

const OFF = '__off__';
const EMPTY: QASettings = { slaHours: 0, largeFiles: 0, sourcePatterns: '', testPatterns: '', disabledSignals: '', testStatuses: '', mergedDays: 0, digestHour: null };

// Radar thresholds of the QA space (CR_QA_P0_PLAN P0.c / O6): empty = the
// signal stays off. Saved per space; workspace editors can change them.
export function RadarSettings() {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const [s, setS] = useState<QASettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    qaAPI.settings()
      .then((r) => { if (alive) setS({ ...EMPTY, ...r.data }); })
      .catch(() => { /* defaults */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const disabled = new Set(s.disabledSignals.split(',').map((x) => x.trim()).filter(Boolean));
  const toggle = (kind: string, on: boolean) => {
    const next = new Set(disabled);
    if (on) next.delete(kind); else next.add(kind);
    setS({ ...s, disabledSignals: [...next].join(',') });
  };
  const num = (v: string) => Math.max(0, parseInt(v, 10) || 0);

  const save = async () => {
    setSaving(true);
    try {
      let timezone = 'UTC';
      try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* default */ }
      const r = await qaAPI.saveSettings({ ...s, clearDigest: s.digestHour == null, timezone });
      setS({ ...EMPTY, ...r.data });
      toast({ title: t('settings.radar.saved') });
    } catch (e) {
      toast({ title: (e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('settings.radar.saveFailed'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t('settings.links.loading')}</div>;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-muted-foreground" />
        <h3 className="whitespace-nowrap text-sm font-semibold">{t('settings.radar.title')}</h3>
        <span className="hidden min-w-0 truncate text-xs text-muted-foreground @2xl:inline">· {t('settings.radar.hint')}</span>
      </div>
      <div className="grid gap-4 rounded-lg border p-4 @3xl:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>{t('settings.radar.slaHours')}</Label>
          <Input type="number" min={0} value={s.slaHours || ''} placeholder={t('settings.radar.off')} onChange={(e) => setS({ ...s, slaHours: num(e.target.value) })} />
          <p className="text-xs text-muted-foreground">{t('settings.radar.slaHint')}</p>
        </div>
        <div className="grid gap-1.5">
          <Label>{t('settings.radar.largeFiles')}</Label>
          <Input type="number" min={0} value={s.largeFiles || ''} placeholder={t('settings.radar.off')} onChange={(e) => setS({ ...s, largeFiles: num(e.target.value) })} />
          <p className="text-xs text-muted-foreground">{t('settings.radar.largeHint')}</p>
        </div>
        <div className="grid gap-1.5">
          <Label>{t('settings.radar.testPatterns')}</Label>
          <Textarea rows={3} className="font-mono text-xs" value={s.testPatterns} placeholder={'**/*_test.go\n**/*.spec.ts\ntest/**'} onChange={(e) => setS({ ...s, testPatterns: e.target.value })} />
          <p className="text-xs text-muted-foreground">{t('settings.radar.testPatternsHint')}</p>
        </div>
        <div className="grid gap-1.5">
          <Label>{t('settings.radar.sourcePatterns')}</Label>
          <Textarea rows={3} className="font-mono text-xs" value={s.sourcePatterns} placeholder={'src/**\ninternal/**'} onChange={(e) => setS({ ...s, sourcePatterns: e.target.value })} />
          <p className="text-xs text-muted-foreground">{t('settings.radar.sourcePatternsHint')}</p>
        </div>
        <div className="grid gap-1.5">
          <Label>{t('settings.radar.testStatuses')}</Label>
          <Input value={s.testStatuses} placeholder="In Test, Ready for QA" onChange={(e) => setS({ ...s, testStatuses: e.target.value })} />
          <p className="text-xs text-muted-foreground">{t('settings.radar.testStatusesHint')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>{t('settings.radar.mergedDays')}</Label>
            <Input type="number" min={0} max={90} value={s.mergedDays || ''} placeholder="7" onChange={(e) => setS({ ...s, mergedDays: num(e.target.value) })} />
          </div>
          <div className="grid gap-1.5">
            <Label>{t('settings.radar.digestHour')}</Label>
            <Select value={s.digestHour == null ? OFF : String(s.digestHour)} onValueChange={(v) => setS({ ...s, digestHour: v === OFF ? null : Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={OFF}>{t('settings.radar.off')}</SelectItem>
                {Array.from({ length: 24 }, (_, h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-2 @3xl:col-span-2">
          <Label>{t('settings.radar.signals')}</Label>
          <div className="grid gap-2 @2xl:grid-cols-2 @5xl:grid-cols-4">
            {SIGNAL_KINDS.map((k) => {
              const Icon = SIGNAL_META[k].icon;
              return (
                <label key={k} className="flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs">
                  <Switch checked={!disabled.has(k)} onCheckedChange={(on) => toggle(k, on)} aria-label={t(`radar.signal.${k}.label`)} />
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="min-w-0 truncate" title={t(`radar.signal.${k}.hint`)}>{t(`radar.signal.${k}.label`)}</span>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.radar.signalsHint')}</p>
        </div>
        <div className="grid gap-1.5 @3xl:col-span-2">
          <Label>{t('settings.radar.reviewGuide')}</Label>
          <Textarea rows={5} maxLength={8000} className="text-xs" value={s.reviewGuide ?? ''} placeholder={t('settings.radar.reviewGuidePlaceholder')} onChange={(e) => setS({ ...s, reviewGuide: e.target.value })} />
          <p className="text-xs text-muted-foreground">{t('settings.radar.reviewGuideHint')}</p>
        </div>
        <div className="flex justify-end @3xl:col-span-2">
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{t('settings.links.save')}
          </Button>
        </div>
      </div>
    </section>
  );
}
