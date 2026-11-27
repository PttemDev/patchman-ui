import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { qaAPI } from '@/services/api';
import { useQAInboxStore } from '@/stores/qaInboxStore';
import type { QASetupProposal } from '@/types';
import { useAge } from './qaRadarUtil';

// Setup changes an AI agent asked for over MCP (when its client couldn't ask
// you directly). Apply sends the change as you; Reject drops it.
export function PendingSetupCard({ onApplied }: { onApplied?: () => void }) {
  const { t } = useTranslation('qa');
  const { toast } = useToast();
  const age = useAge();
  const [rows, setRows] = useState<QASetupProposal[]>([]);
  const [busy, setBusy] = useState('');
  const refreshInbox = useQAInboxStore((s) => s.fetch);
  const load = useCallback(async () => { try { setRows((await qaAPI.proposals()).data); } catch { setRows([]); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (rows.length === 0) return null;

  const apply = async (p: QASetupProposal) => {
    setBusy(p.id);
    try {
      const req = (await qaAPI.proposalRequest(p.id)).data;
      await qaAPI.applyProposalRequest(req);
      await qaAPI.resolveProposal(p.id, 'applied');
      toast({ title: t('pending.applied') });
      onApplied?.();
    } catch (e) {
      toast({ title: (e as { response?: { data?: { error?: string } } })?.response?.data?.error || t('pending.applyFailed'), variant: 'destructive' });
    } finally {
      setBusy('');
      void load();
      void refreshInbox();
    }
  };
  const reject = async (p: QASetupProposal) => {
    setBusy(p.id);
    try { await qaAPI.resolveProposal(p.id, 'rejected'); } catch { /* ignore */ } finally { setBusy(''); void load(); void refreshInbox(); }
  };

  return (
    <section className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">{t('pending.title', { count: rows.length })}</h3></div>
      <p className="text-xs text-muted-foreground">{t('pending.body')}</p>
      <div className="divide-y rounded-lg border bg-background">
        {rows.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm">{p.summary}</div>
              <div className="text-[11px] text-muted-foreground">{p.agent || t('pending.anAgent')} · {p.tool} · {age(p.createdAt)}</div>
            </div>
            <Button size="sm" className="h-7 gap-1 text-xs" disabled={busy === p.id} onClick={() => void apply(p)}>
              {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}{t('pending.apply')}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={busy === p.id} onClick={() => void reject(p)}><X className="h-3 w-3" />{t('pending.reject')}</Button>
          </div>
        ))}
      </div>
    </section>
  );
}
