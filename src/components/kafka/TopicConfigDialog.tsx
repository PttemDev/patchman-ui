import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Loader2, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { kafkaAPI } from '@/services/api';
import { useKafkaConnectionStore, scopeForKafka } from '@/stores/kafkaConnectionStore';
import { cn } from '@/lib/utils';
import type { KafkaConfigEntry, KafkaConnection } from '@/types';

interface TopicConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: KafkaConnection;
  topic: string;
}

// The keys worth surfacing first — the day-to-day retention / durability
// knobs. Everything else falls under "All configs".
const IMPORTANT_KEYS = [
  'retention.ms',
  'retention.bytes',
  'min.insync.replicas',
  'cleanup.policy',
  'max.message.bytes',
];

// Maps a config key to its i18n help key (resolved with t() at render).
const HELP_KEYS: Record<string, string> = {
  'retention.ms': 'topicConfig.help.retentionMs',
  'retention.bytes': 'topicConfig.help.retentionBytes',
  'min.insync.replicas': 'topicConfig.help.minInsyncReplicas',
  'cleanup.policy': 'topicConfig.help.cleanupPolicy',
  'max.message.bytes': 'topicConfig.help.maxMessageBytes',
};

type TFn = (key: string, opts?: Record<string, unknown>) => string;

// Kafka names its duration configs `*.ms` and its size configs `*.bytes`,
// so the suffix is enough to know how to humanize the raw number.
const isMsKey = (k: string) => k.endsWith('.ms');
const isBytesKey = (k: string) => k.endsWith('.bytes');

// humanizeMs / humanizeBytes turn a raw config value into a friendly hint
// shown next to the input (86400000 → "1d", 1073741824 → "1 GB"). They
// return null when the value isn't a plain integer (so non-numeric configs
// get no hint). -1 and Kafka's Long.MAX sentinel read as "forever"/"unbounded".
function humanizeMs(v: string, t: TFn): string | null {
  const s = v.trim();
  if (!/^-?\d+$/.test(s)) return null;
  if (s === '-1') return t('topicConfig.forever');
  if (s.replace('-', '').length >= 19) return t('topicConfig.foreverApprox'); // Long.MAX etc.
  const ms = Number(s);
  if (!Number.isFinite(ms)) return t('topicConfig.foreverApprox');
  if (ms === 0) return '0';
  const units: [number, string][] = [
    [86400000, 'd'], [3600000, 'h'], [60000, 'm'], [1000, 's'], [1, 'ms'],
  ];
  let rem = ms;
  const parts: string[] = [];
  for (const [u, label] of units) {
    if (rem >= u) {
      parts.push(`${Math.floor(rem / u)}${label}`);
      rem %= u;
    }
    if (parts.length >= 2) break; // keep it to the two biggest units
  }
  return parts.join(' ') || `${ms}ms`;
}

function humanizeBytes(v: string, t: TFn): string | null {
  const s = v.trim();
  if (!/^-?\d+$/.test(s)) return null;
  if (s === '-1') return t('topicConfig.unbounded');
  if (s.replace('-', '').length >= 19) return t('topicConfig.unboundedApprox');
  const b = Number(s);
  if (!Number.isFinite(b)) return t('topicConfig.unboundedApprox');
  if (b === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let n = b;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  const disp = i === 0 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1);
  return `${disp} ${units[i]}`;
}

// hintFor returns the humanized hint for a config value, or null.
function hintFor(key: string, value: string, t: TFn): string | null {
  if (isMsKey(key)) return humanizeMs(value, t);
  if (isBytesKey(key)) return humanizeBytes(value, t);
  return null;
}

// TopicConfigDialog fetches the topic's effective config, lets the user
// edit the writable entries, and PATCHes only the changed keys.
export function TopicConfigDialog({ open, onOpenChange, connection, topic }: TopicConfigDialogProps) {
  const { t } = useTranslation('kafka');
  const connections = useKafkaConnectionStore((s) => s.connections);
  const { toast } = useToast();
  const scope = scopeForKafka(connections, connection.id);

  const [entries, setEntries] = useState<KafkaConfigEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Only keys the user actually touched, mapped to their new string value.
  const [edits, setEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setEdits({});
    kafkaAPI.topicConfig(connection.id, topic, scope)
      .then((res) => {
        if (cancelled) return;
        setEntries((res.data as KafkaConfigEntry[]) ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(extractErr(err, t('topicConfig.loadConfigFailed')));
        setEntries([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connection.id, topic]);

  const valueOf = useCallback(
    (e: KafkaConfigEntry) => (e.key in edits ? edits[e.key] : e.value),
    [edits],
  );

  const setValue = useCallback((key: string, value: string) => {
    setEdits((m) => ({ ...m, [key]: value }));
  }, []);

  const { important, rest } = useMemo(() => {
    const imp: KafkaConfigEntry[] = [];
    const other: KafkaConfigEntry[] = [];
    for (const e of entries) {
      (IMPORTANT_KEYS.includes(e.key) ? imp : other).push(e);
    }
    imp.sort((a, b) => IMPORTANT_KEYS.indexOf(a.key) - IMPORTANT_KEYS.indexOf(b.key));
    other.sort((a, b) => a.key.localeCompare(b.key));
    return { important: imp, rest: other };
  }, [entries]);

  const changedKeys = useMemo(
    () => entries.filter((e) => e.editable && e.key in edits && edits[e.key] !== e.value).map((e) => e.key),
    [entries, edits],
  );

  const handleSave = async () => {
    if (changedKeys.length === 0) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const config: Record<string, string> = {};
      for (const key of changedKeys) config[key] = edits[key];
      await kafkaAPI.alterTopicConfig(connection.id, topic, config, scope);
      toast({
        title: t('topicConfig.configUpdated'),
        description: t(
          changedKeys.length === 1 ? 'topicConfig.configUpdatedDescOne' : 'topicConfig.configUpdatedDescOther',
          { count: changedKeys.length, topic },
        ),
      });
      onOpenChange(false);
    } catch (err) {
      setError(extractErr(err, t('topicConfig.updateConfigFailed')));
    }
    setSaving(false);
  };

  const renderEntry = (e: KafkaConfigEntry) => {
    const helpKey = HELP_KEYS[e.key];
    const help = helpKey ? t(helpKey) : undefined;
    const cur = e.editable ? valueOf(e) : e.value;
    const hint = hintFor(e.key, cur, t);
    return (
      <div key={e.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-start gap-3 py-1.5 border-b last:border-b-0">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs truncate">{e.key}</span>
            {!e.editable && <Lock className="h-2.5 w-2.5 text-muted-foreground shrink-0" />}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">
            {help ?? t('topicConfig.sourceLabel', { source: e.source })}
          </div>
        </div>
        <div className="min-w-0">
          {e.editable ? (
            <Input
              value={valueOf(e)}
              onChange={(ev) => setValue(e.key, ev.target.value)}
              className={cn(
                'h-7 text-xs font-mono',
                e.key in edits && edits[e.key] !== e.value && 'border-amber-500/60',
              )}
            />
          ) : (
            <div className="text-xs font-mono text-muted-foreground break-all px-1 py-1 rounded bg-muted/40">
              {e.value || <span className="italic">{t('topicConfig.emptyValue')}</span>}
            </div>
          )}
          {hint && (
            <div className="mt-0.5 text-right text-[10px] font-mono text-muted-foreground/70">≈ {hint}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* flex! forces display:flex over the base DialogContent's `grid`
          (grid wins on source order otherwise), so flex-1 min-h-0 on the
          scroll body actually bounds it and the long config list scrolls. */}
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] flex! flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trans
              t={t}
              i18nKey="topicConfig.title"
              values={{ topic }}
              components={{ mono: <span className="font-mono text-sm text-muted-foreground" /> }}
            />
          </DialogTitle>
          <DialogDescription>
            {t('topicConfig.description')}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-xs text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('topicConfig.loadingConfig')}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto pr-3 -mr-3">
            {important.length > 0 && (
              <div className="mb-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  {t('topicConfig.common')}
                </div>
                {important.map(renderEntry)}
              </div>
            )}
            {rest.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  {t('topicConfig.allConfigs')}
                </div>
                {rest.map(renderEntry)}
              </div>
            )}
            {entries.length === 0 && !error && (
              <p className="text-xs text-muted-foreground italic py-6 text-center">{t('topicConfig.noConfigEntries')}</p>
            )}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter className="gap-2">
          <span className="mr-auto text-[11px] text-muted-foreground self-center">
            {changedKeys.length > 0
              ? t(changedKeys.length === 1 ? 'topicConfig.pendingChangesOne' : 'topicConfig.pendingChangesOther', { count: changedKeys.length })
              : t('topicConfig.noChanges')}
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving || changedKeys.length === 0}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t('common:save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}
