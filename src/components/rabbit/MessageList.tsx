import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Copy, Download, RotateCcw, Skull } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { RabbitMessage } from '@/types';
import { decodePayload, fmtBytes, messageProps, previewPayload, type DecodeMode } from './rabbitUtil';

// Messages from a peek, a stream read or a live tail, one collapsible row
// each: routing key, flags and a preview; expanded, the decoded payload and
// every property / header (x-death unfolded).

function deathCount(m: RabbitMessage): number {
  const h = messageProps(m).headers as Record<string, unknown> | undefined;
  const d = h?.['x-death'];
  if (!Array.isArray(d)) return 0;
  return d.reduce((a: number, x) => a + Number((x as Record<string, unknown>)?.count ?? 1), 0);
}

export function MessageList({ messages, fileName, emptyText }: { messages: RabbitMessage[]; fileName: string; emptyText?: string }) {
  const { t } = useTranslation('rabbit');
  const [decode, setDecode] = useState<DecodeMode>('auto');
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const download = () => {
    const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (messages.length === 0) return <div className="py-8 text-center text-xs text-muted-foreground">{emptyText ?? t('messages.none')}</div>;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{t('messages.count', { count: messages.length })}</span>
        <span className="ml-auto">{t('messages.decode')}</span>
        <Select value={decode} onValueChange={(v) => setDecode(v as DecodeMode)}>
          <SelectTrigger className="h-6 w-[96px] text-[11px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(['auto', 'json', 'text', 'hex', 'base64'] as const).map((m) => <SelectItem key={m} value={m}>{t(`messages.mode_${m}`)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setOpen(Object.fromEntries(messages.map((_, i) => [i, true])))}>{t('messages.expandAll')}</Button>
        <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px] gap-1" onClick={download}><Download className="h-3 w-3" /> JSON</Button>
      </div>
      <div className="rounded-md border divide-y bg-card">
        {messages.map((m, i) => (
          <MessageRow key={i} m={m} index={i} decode={decode} open={!!open[i]} onToggle={() => setOpen((o) => ({ ...o, [i]: !o[i] }))} />
        ))}
      </div>
    </div>
  );
}

function MessageRow({ m, index, decode, open, onToggle }: { m: RabbitMessage; index: number; decode: DecodeMode; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation('rabbit');
  const props = messageProps(m);
  const headers = (props.headers ?? {}) as Record<string, unknown>;
  const deaths = deathCount(m);
  const body = useMemo(() => (open ? decodePayload(m, decode) : null), [open, m, decode]);
  const otherProps = Object.entries(props).filter(([k]) => k !== 'headers');
  const when = m.received_at ? new Date(m.received_at) : typeof props.timestamp === 'number' ? new Date((props.timestamp as number) * 1000) : null;
  return (
    <div>
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-accent/30">
        {open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <span className="text-[10px] text-muted-foreground tabular-nums w-14 shrink-0">{m.offset != null ? `@${m.offset}` : `#${index + 1}`}</span>
        <span className="font-mono text-[11px] truncate max-w-[220px] shrink-0" title={m.routing_key}>{m.routing_key || <span className="text-muted-foreground">∅</span>}</span>
        {m.redelivered && <span title={t('messages.redelivered')}><RotateCcw className="h-3 w-3 shrink-0 text-amber-500" /></span>}
        {deaths > 0 && <span className="flex items-center gap-0.5 text-[10px] text-destructive shrink-0" title={t('messages.deadLettered')}><Skull className="h-3 w-3" />{deaths}</span>}
        <span className="text-[11px] text-muted-foreground truncate min-w-0 flex-1 font-mono">{previewPayload(m)}</span>
        {when && <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{when.toLocaleTimeString()}</span>}
        <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums w-14 text-right">{fmtBytes(m.payload_bytes)}</span>
      </button>
      {open && body && (
        <div className="px-3 pb-3 pt-1 grid xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
              <span className="uppercase tracking-wide">{t('messages.payload')}</span>
              {m.payload_bytes > (m.payload?.length ?? 0) && m.payload_encoding === 'string' && <span className="text-amber-600">{t('messages.truncated')}</span>}
              <button type="button" className="ml-auto flex items-center gap-1 hover:text-foreground" onClick={() => void navigator.clipboard.writeText(body.text)}><Copy className="h-3 w-3" /> {t('messages.copy')}</button>
            </div>
            <pre className={cn('rounded bg-muted/50 p-2 text-[11px] font-mono whitespace-pre-wrap break-all max-h-96 overflow-auto', body.kind === 'binary' && 'whitespace-pre')}>{body.text}</pre>
          </div>
          <div className="min-w-0 space-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{t('messages.properties')}</div>
              <table className="w-full text-[11px] table-fixed">
                <tbody>
                  <PropRow k="exchange" v={m.exchange || '(default)'} />
                  <PropRow k="routing_key" v={m.routing_key} />
                  <PropRow k="redelivered" v={String(m.redelivered)} />
                  {otherProps.map(([k, v]) => <PropRow key={k} k={k} v={k === 'timestamp' && typeof v === 'number' ? new Date(v * 1000).toISOString() : v} />)}
                </tbody>
              </table>
            </div>
            {Object.keys(headers).length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{t('messages.headers')}</div>
                <table className="w-full text-[11px] table-fixed">
                  <tbody>{Object.entries(headers).map(([k, v]) => <PropRow key={k} k={k} v={v} />)}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PropRow({ k, v }: { k: string; v: unknown }) {
  const text = typeof v === 'object' && v !== null ? JSON.stringify(v, null, 1) : String(v ?? '');
  return (
    <tr className="align-top">
      <td className="w-32 pr-2 py-0.5 text-muted-foreground font-mono truncate" title={k}>{k}</td>
      <td className="py-0.5 font-mono break-words whitespace-pre-wrap">{text}</td>
    </tr>
  );
}
