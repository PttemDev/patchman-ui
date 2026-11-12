import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Send, Trash2, CheckCircle2, AlertTriangle, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { rabbitAPI, type DBScope } from '@/services/api';
import { cn } from '@/lib/utils';
import type { RabbitConnection } from '@/types';
import { extractErr } from './rabbitUtil';

// Publish to an exchange (or to a queue through the default exchange):
// payload, content type, persistence, headers and the other AMQP properties,
// optionally N copies. The answer says whether RabbitMQ routed it anywhere.
export function PublishForm({ conn, scope, vhost, exchange, routingKey: initialKey, lockKey, writable, onPublished }: {
  conn: RabbitConnection; scope: DBScope; vhost: string; exchange: string; routingKey?: string; lockKey?: boolean;
  writable: boolean; onPublished?: () => void;
}) {
  const { t } = useTranslation('rabbit');
  const [key, setKey] = useState(initialKey ?? '');
  const [payload, setPayload] = useState('{\n  \n}');
  const [contentType, setContentType] = useState('application/json');
  const [persistent, setPersistent] = useState(true);
  const [headers, setHeaders] = useState<Array<{ k: string; v: string }>>([]);
  const [more, setMore] = useState(false);
  const [props, setProps] = useState<Record<string, string>>({});
  const [copies, setCopies] = useState('1');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const formatJSON = () => {
    try { setPayload(JSON.stringify(JSON.parse(payload), null, 2)); } catch { /* leave as is */ }
  };

  const publish = async () => {
    setBusy(true);
    setResult(null);
    const properties: Record<string, unknown> = { delivery_mode: persistent ? 2 : 1 };
    if (contentType && contentType !== 'none') properties.content_type = contentType;
    const h: Record<string, unknown> = {};
    for (const { k, v } of headers) {
      if (!k.trim()) continue;
      h[k.trim()] = /^-?\d+$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v;
    }
    if (Object.keys(h).length) properties.headers = h;
    for (const [k, v] of Object.entries(props)) {
      if (!v.trim()) continue;
      properties[k] = k === 'priority' ? Number(v) : k === 'timestamp' ? Number(v) : v.trim();
    }
    const n = Math.max(1, Math.min(1000, Number(copies) || 1));
    let routed = 0;
    let unrouted = 0;
    try {
      for (let i = 0; i < n; i++) {
        const res = await rabbitAPI.publish(conn.id, { vhost, exchange, routingKey: key, payload, payloadEncoding: 'string', properties }, scope);
        if ((res.data as { routed: boolean }).routed) routed++;
        else unrouted++;
      }
      setResult(unrouted === 0
        ? { ok: true, text: n === 1 ? t('publish.routed') : t('publish.routedN', { count: n }) }
        : { ok: false, text: routed === 0 ? t('publish.unrouted') : t('publish.partly', { routed, unrouted }) });
      onPublished?.();
    } catch (e) {
      setResult({ ok: false, text: extractErr(e, t('publish.failed')) });
    }
    setBusy(false);
  };

  if (!writable) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" /> {t('readOnly')}
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="grid grid-cols-[1fr_1fr] gap-3">
        <div>
          <Label className="text-xs">{t('publish.exchange')}</Label>
          <Input value={exchange || t('exchange.default')} disabled className="font-mono text-xs" />
        </div>
        <div>
          <Label className="text-xs">{t('bindings.routingKey')}</Label>
          <Input value={key} onChange={(e) => setKey(e.target.value)} disabled={lockKey} className="font-mono text-xs" />
        </div>
      </div>
      {lockKey && <p className="text-[10px] text-muted-foreground -mt-2">{t('publish.directNote')}</p>}
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">{t('messages.payload')}</Label>
          <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={formatJSON}>{t('publish.formatJson')}</button>
        </div>
        <Textarea value={payload} onChange={(e) => setPayload(e.target.value)} className="font-mono text-xs min-h-[160px]" spellCheck={false} />
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <Label className="text-xs">{t('publish.contentType')}</Label>
          <Select value={contentType} onValueChange={setContentType}>
            <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['application/json', 'text/plain', 'application/xml', 'application/octet-stream', 'none'].map((c) => <SelectItem key={c} value={c}>{c === 'none' ? t('publish.noContentType') : c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-xs pb-1.5"><Switch checked={persistent} onCheckedChange={setPersistent} /> {t('publish.persistent')}</label>
        <div>
          <Label className="text-xs">{t('publish.copies')}</Label>
          <Input value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, ''))} className="h-8 w-20 text-xs font-mono" />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">{t('messages.headers')}</Label>
          <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1" onClick={() => setHeaders((h) => [...h, { k: '', v: '' }])}><Plus className="h-3 w-3" /> {t('publish.addHeader')}</Button>
        </div>
        {headers.map((h, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 mt-1">
            <Input value={h.k} onChange={(e) => setHeaders((hs) => hs.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} placeholder="key" className="h-7 text-xs font-mono" />
            <Input value={h.v} onChange={(e) => setHeaders((hs) => hs.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} placeholder="value" className="h-7 text-xs font-mono" />
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setHeaders((hs) => hs.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setMore((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">{more ? '▼ ' : '▸ '}{t('publish.moreProps')}</button>
      {more && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {['message_id', 'correlation_id', 'reply_to', 'expiration', 'priority', 'type', 'app_id'].map((k) => (
            <div key={k}>
              <Label className="text-[11px] font-mono">{k}</Label>
              <Input value={props[k] ?? ''} onChange={(e) => setProps((p) => ({ ...p, [k]: e.target.value }))} className="h-7 text-xs font-mono" placeholder={k === 'expiration' ? 'ms, e.g. 60000' : ''} />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button onClick={publish} disabled={busy} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t('publish.send')}
        </Button>
        {result && (
          <span className={cn('flex items-center gap-1.5 text-xs', result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
            {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />} {result.text}
          </span>
        )}
      </div>
    </div>
  );
}
