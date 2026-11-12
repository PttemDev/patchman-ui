import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Loader2, Info, AlertTriangle } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { kafkaAPI } from '@/services/api';
import { useKafkaConnectionStore, scopeForKafka } from '@/stores/kafkaConnectionStore';
import { cn } from '@/lib/utils';
import type { KafkaConnection } from '@/types';

interface TopicCreateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: KafkaConnection;
  onCreated?: () => void;
}

const DAY_MS = 86_400_000;
const GB = 1024 * 1024 * 1024;

// TopicCreateWizard is a single guided dialog: every field carries inline
// "why" helper text so the topic gets created with sane, explained defaults
// instead of blind broker fallbacks.
export function TopicCreateWizard({ open, onOpenChange, connection, onCreated }: TopicCreateWizardProps) {
  const { t } = useTranslation('kafka');
  const connections = useKafkaConnectionStore((s) => s.connections);
  const { toast } = useToast();
  const scope = scopeForKafka(connections, connection.id);

  const [name, setName] = useState('');
  const [partitions, setPartitions] = useState(3);
  const [replicationFactor, setReplicationFactor] = useState(3);
  const [minInsyncReplicas, setMinInsyncReplicas] = useState(2);
  const [retentionDays, setRetentionDays] = useState(7);
  const [retentionGb, setRetentionGb] = useState<number | ''>(50);
  const [cleanupPolicy, setCleanupPolicy] = useState<'delete' | 'compact'>('delete');

  const [brokerCount, setBrokerCount] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setPartitions(3);
    setReplicationFactor(3);
    setMinInsyncReplicas(2);
    setRetentionDays(7);
    setRetentionGb(50);
    setCleanupPolicy('delete');
    setError('');
    setBrokerCount(null);
    let cancelled = false;
    kafkaAPI.brokers(connection.id, scope)
      .then((res) => {
        if (cancelled) return;
        const brokers = Array.isArray(res.data) ? res.data : [];
        setBrokerCount(brokers.length);
      })
      .catch(() => { if (!cancelled) setBrokerCount(null); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connection.id]);

  const suggestion = useMemo(() => {
    const raw = name.trim().toLowerCase();
    if (!raw) return '';
    const slug = raw.replace(/[^a-z0-9._-]+/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '');
    if (!slug || slug === raw) return '';
    return slug;
  }, [name]);

  const validation = useMemo<string | null>(() => {
    if (!name.trim()) return t('createTopic.vNameRequired');
    if (partitions < 1) return t('createTopic.vPartitionsMin');
    if (replicationFactor < 1) return t('createTopic.vRfMin');
    if (brokerCount != null && replicationFactor > brokerCount) {
      return t('createTopic.vRfExceedsBrokers', { rf: replicationFactor, brokers: brokerCount });
    }
    if (minInsyncReplicas > replicationFactor) {
      return t('createTopic.vMinIsrExceedsRf', { minIsr: minInsyncReplicas, rf: replicationFactor });
    }
    if (minInsyncReplicas < 1) return t('createTopic.vMinIsrMin');
    return null;
  }, [name, partitions, replicationFactor, minInsyncReplicas, brokerCount, t]);

  const handleCreate = useCallback(async () => {
    if (validation) {
      setError(validation);
      return;
    }
    setCreating(true);
    setError('');
    const gb = retentionGb === '' ? 0 : retentionGb;
    const config: Record<string, string> = {
      'retention.ms': retentionDays === -1 ? '-1' : String(retentionDays * DAY_MS),
      'retention.bytes': gb > 0 ? String(gb * GB) : '-1',
      'min.insync.replicas': String(minInsyncReplicas),
      'cleanup.policy': cleanupPolicy,
    };
    try {
      await kafkaAPI.createTopic(
        connection.id,
        { name: name.trim(), partitions, replicationFactor, config },
        scope,
      );
      toast({ title: t('createTopic.topicCreated'), description: name.trim() });
      onCreated?.();
      onOpenChange(false);
    } catch (err) {
      setError(extractErr(err, t('createTopic.createTopicFailed')));
    }
    setCreating(false);
  }, [validation, retentionGb, retentionDays, minInsyncReplicas, cleanupPolicy, connection.id, name, partitions, replicationFactor, scope, toast, onCreated, onOpenChange, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('createTopic.title')}</DialogTitle>
          <DialogDescription>
            <Trans
              t={t}
              i18nKey="createTopic.description"
              values={{ name: connection.name }}
              components={{ b: <span className="font-medium" /> }}
            />
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label={t('common:name')} help={t('createTopic.nameHelp')}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('createTopic.namePlaceholder')}
              className="font-mono text-xs"
              autoComplete="off"
            />
            {suggestion && (
              <button
                type="button"
                onClick={() => setName(suggestion)}
                className="mt-1 text-[10px] text-primary hover:underline"
              >
                <Trans
                  t={t}
                  i18nKey="createTopic.suggestion"
                  values={{ slug: suggestion }}
                  components={{ mono: <span className="font-mono" /> }}
                />
              </button>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('createTopic.partitions')} help={t('createTopic.partitionsHelp')}>
              <Input
                type="number"
                min={1}
                value={partitions}
                onChange={(e) => setPartitions(parseInt(e.target.value, 10) || 1)}
                className="h-8 text-xs"
              />
            </Field>
            <Field
              label={brokerCount != null
                ? t('createTopic.replicationFactorBrokers', { count: brokerCount })
                : t('createTopic.replicationFactor')}
              help={t('createTopic.replicationFactorHelp')}
            >
              <Input
                type="number"
                min={1}
                value={replicationFactor}
                onChange={(e) => setReplicationFactor(parseInt(e.target.value, 10) || 1)}
                className={cn(
                  'h-8 text-xs',
                  brokerCount != null && replicationFactor > brokerCount && 'border-destructive',
                )}
              />
            </Field>
          </div>

          <Field label={t('createTopic.minInsyncReplicas')} help={t('createTopic.minInsyncHelp')}>
            <Input
              type="number"
              min={1}
              value={minInsyncReplicas}
              onChange={(e) => setMinInsyncReplicas(parseInt(e.target.value, 10) || 1)}
              className="h-8 text-xs"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('createTopic.retentionDays')} help={t('createTopic.retentionDaysHelp')}>
              <Input
                type="number"
                value={retentionDays}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setRetentionDays(Number.isNaN(v) ? 0 : v);
                }}
                className="h-8 text-xs"
              />
            </Field>
            <Field label={t('createTopic.retentionGb')} help={t('createTopic.retentionGbHelp')}>
              <Input
                type="number"
                min={0}
                value={retentionGb}
                onChange={(e) => {
                  const v = e.target.value;
                  setRetentionGb(v === '' ? '' : (parseInt(v, 10) || 0));
                }}
                className="h-8 text-xs"
              />
            </Field>
          </div>

          <Field label={t('createTopic.cleanupPolicy')} help={t('createTopic.cleanupPolicyHelp')}>
            <div className="flex gap-2">
              <PolicyBtn active={cleanupPolicy === 'delete'} onClick={() => setCleanupPolicy('delete')} label={t('createTopic.policyDelete')} />
              <PolicyBtn active={cleanupPolicy === 'compact'} onClick={() => setCleanupPolicy('compact')} label={t('createTopic.policyCompact')} />
            </div>
          </Field>

          {(error || validation) && (
            <div className="flex items-start gap-2 p-2 rounded text-xs bg-destructive/10 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{error || validation}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={creating}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={creating || !!validation}>
            {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t('createTopic.createTopicButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {children}
      <p className="mt-1 flex items-start gap-1 text-[10px] text-muted-foreground leading-tight">
        <Info className="h-2.5 w-2.5 shrink-0 mt-0.5" />
        <span>{help}</span>
      </p>
    </div>
  );
}

function PolicyBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 px-2 py-1.5 rounded border text-xs font-mono transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-accent/50',
      )}
    >
      {label}
    </button>
  );
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}
