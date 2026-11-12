import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { rabbitAPI, type DBScope } from '@/services/api';
import { cn } from '@/lib/utils';
import type { RabbitConnection, RabbitExchange, RabbitPage, RabbitQueue } from '@/types';
import { extractErr } from './rabbitUtil';

/** JSON object text → object; null when it isn't one. */
function parseArgs(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* fall through */ }
  return null;
}

// ── create queue ───────────────────────────────────────────────────

export function CreateQueueDialog({ open, onOpenChange, conn, scope, vhosts, defaultVhost, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; conn: RabbitConnection; scope: DBScope; vhosts: string[];
  defaultVhost: string; onCreated: (vhost: string, name: string) => void;
}) {
  const { t } = useTranslation('rabbit');
  const [vhost, setVhost] = useState(defaultVhost || '/');
  const [name, setName] = useState('');
  const [type, setType] = useState('quorum');
  const [durable, setDurable] = useState(true);
  const [autoDelete, setAutoDelete] = useState(false);
  const [dlx, setDlx] = useState('');
  const [dlrk, setDlrk] = useState('');
  const [ttl, setTtl] = useState('');
  const [maxLen, setMaxLen] = useState('');
  const [deliveryLimit, setDeliveryLimit] = useState('');
  const [maxBytes, setMaxBytes] = useState('');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setVhost(defaultVhost || '/'); setName(''); setType('quorum'); setDurable(true); setAutoDelete(false);
    setDlx(''); setDlrk(''); setTtl(''); setMaxLen(''); setDeliveryLimit(''); setMaxBytes(''); setExtra(''); setError('');
  }, [open, defaultVhost]);

  const submit = async () => {
    const more = parseArgs(extra);
    if (more === null) return setError(t('dialogs.argsInvalid'));
    const args: Record<string, unknown> = { 'x-queue-type': type, ...more };
    if (dlx.trim()) args['x-dead-letter-exchange'] = dlx.trim();
    if (dlrk.trim()) args['x-dead-letter-routing-key'] = dlrk.trim();
    if (ttl.trim() && type !== 'stream') args['x-message-ttl'] = Number(ttl);
    if (maxLen.trim()) args['x-max-length'] = Number(maxLen);
    if (deliveryLimit.trim() && type === 'quorum') args['x-delivery-limit'] = Number(deliveryLimit);
    if (maxBytes.trim()) args['x-max-length-bytes'] = Number(maxBytes);
    setBusy(true);
    try {
      await rabbitAPI.createQueue(conn.id, { vhost, name: name.trim(), durable: type === 'classic' ? durable : true, autoDelete: type === 'classic' && autoDelete, arguments: args }, scope);
      onCreated(vhost, name.trim());
      onOpenChange(false);
    } catch (e) {
      setError(extractErr(e, t('dialogs.failed')));
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('dialogs.newQueue')}</DialogTitle>
          <DialogDescription>{t('dialogs.newQueueDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[140px_1fr] gap-3">
            <div>
              <Label className="text-xs">{t('vhost.name')}</Label>
              <Select value={vhost} onValueChange={setVhost}>
                <SelectTrigger className="h-9 text-xs font-mono"><SelectValue /></SelectTrigger>
                <SelectContent>{vhosts.map((v) => <SelectItem key={v} value={v}><span className="font-mono">{v}</span></SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('dialogs.name')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="font-mono text-xs" autoFocus />
            </div>
          </div>
          <div>
            <Label className="text-xs">{t('dialogs.queueType')}</Label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {(['quorum', 'classic', 'stream'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setType(k)} className={cn('rounded-md border p-2 text-left', type === k ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'hover:bg-accent/50')}>
                  <div className="text-xs font-semibold capitalize">{k}</div>
                  <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{t(`dialogs.type_${k}`)}</div>
                </button>
              ))}
            </div>
          </div>
          {type === 'classic' && (
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-xs"><Switch checked={durable} onCheckedChange={setDurable} /> {t('dialogs.durable')}</label>
              <label className="flex items-center gap-2 text-xs"><Switch checked={autoDelete} onCheckedChange={setAutoDelete} /> {t('dialogs.autoDelete')}</label>
            </div>
          )}
          {type !== 'stream' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('dialogs.dlx')}</Label>
                <Input value={dlx} onChange={(e) => setDlx(e.target.value)} className="font-mono text-xs" placeholder="dlx" />
              </div>
              <div>
                <Label className="text-xs">{t('dialogs.dlrk')}</Label>
                <Input value={dlrk} onChange={(e) => setDlrk(e.target.value)} className="font-mono text-xs" />
              </div>
              <div>
                <Label className="text-xs">{t('dialogs.ttl')}</Label>
                <Input value={ttl} onChange={(e) => setTtl(e.target.value.replace(/\D/g, ''))} className="font-mono text-xs" placeholder="60000" />
              </div>
              <div>
                <Label className="text-xs">{t('dialogs.maxLength')}</Label>
                <Input value={maxLen} onChange={(e) => setMaxLen(e.target.value.replace(/\D/g, ''))} className="font-mono text-xs" />
              </div>
              {type === 'quorum' && (
                <div>
                  <Label className="text-xs">{t('dialogs.deliveryLimit')}</Label>
                  <Input value={deliveryLimit} onChange={(e) => setDeliveryLimit(e.target.value.replace(/\D/g, ''))} className="font-mono text-xs" placeholder="20" />
                </div>
              )}
            </div>
          )}
          {type === 'stream' && (
            <div>
              <Label className="text-xs">{t('dialogs.maxBytes')}</Label>
              <Input value={maxBytes} onChange={(e) => setMaxBytes(e.target.value.replace(/\D/g, ''))} className="font-mono text-xs" placeholder="10000000000" />
            </div>
          )}
          <div>
            <Label className="text-xs">{t('dialogs.extraArgs')}</Label>
            <Textarea value={extra} onChange={(e) => setExtra(e.target.value)} className="font-mono text-xs min-h-[56px]" placeholder={'{ "x-single-active-consumer": true }'} />
          </div>
          {error && <p className="text-xs text-destructive break-words">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common:cancel')}</Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}{t('dialogs.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── create exchange ────────────────────────────────────────────────

export function CreateExchangeDialog({ open, onOpenChange, conn, scope, vhosts, defaultVhost, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; conn: RabbitConnection; scope: DBScope; vhosts: string[];
  defaultVhost: string; onCreated: (vhost: string, name: string) => void;
}) {
  const { t } = useTranslation('rabbit');
  const [vhost, setVhost] = useState(defaultVhost || '/');
  const [name, setName] = useState('');
  const [type, setType] = useState('topic');
  const [durable, setDurable] = useState(true);
  const [autoDelete, setAutoDelete] = useState(false);
  const [internal, setInternal] = useState(false);
  const [alternate, setAlternate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setVhost(defaultVhost || '/'); setName(''); setType('topic'); setDurable(true); setAutoDelete(false); setInternal(false); setAlternate(''); setError('');
  }, [open, defaultVhost]);

  const submit = async () => {
    setBusy(true);
    try {
      const args: Record<string, unknown> = {};
      if (alternate.trim()) args['alternate-exchange'] = alternate.trim();
      await rabbitAPI.createExchange(conn.id, { vhost, name: name.trim(), type, durable, autoDelete, internal, arguments: args }, scope);
      onCreated(vhost, name.trim());
      onOpenChange(false);
    } catch (e) {
      setError(extractErr(e, t('dialogs.failed')));
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('dialogs.newExchange')}</DialogTitle>
          <DialogDescription>{t('dialogs.newExchangeDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[140px_1fr] gap-3">
            <div>
              <Label className="text-xs">{t('vhost.name')}</Label>
              <Select value={vhost} onValueChange={setVhost}>
                <SelectTrigger className="h-9 text-xs font-mono"><SelectValue /></SelectTrigger>
                <SelectContent>{vhosts.map((v) => <SelectItem key={v} value={v}><span className="font-mono">{v}</span></SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('dialogs.name')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="font-mono text-xs" autoFocus />
            </div>
          </div>
          <div>
            <Label className="text-xs">{t('dialogs.exchangeType')}</Label>
            <div className="grid grid-cols-4 gap-2 mt-1">
              {(['topic', 'direct', 'fanout', 'headers'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setType(k)} className={cn('rounded-md border px-2 py-1.5 text-xs font-semibold', type === k ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'hover:bg-accent/50')}>{k}</button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">{t(`dialogs.ex_${type}`)}</p>
          </div>
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-xs"><Switch checked={durable} onCheckedChange={setDurable} /> {t('dialogs.durable')}</label>
            <label className="flex items-center gap-2 text-xs"><Switch checked={autoDelete} onCheckedChange={setAutoDelete} /> {t('dialogs.autoDelete')}</label>
            <label className="flex items-center gap-2 text-xs"><Switch checked={internal} onCheckedChange={setInternal} /> {t('dialogs.internal')}</label>
          </div>
          <div>
            <Label className="text-xs">{t('dialogs.alternate')}</Label>
            <Input value={alternate} onChange={(e) => setAlternate(e.target.value)} className="font-mono text-xs" />
          </div>
          {error && <p className="text-xs text-destructive break-words">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common:cancel')}</Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}{t('dialogs.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── bind ───────────────────────────────────────────────────────────

/** Bind an exchange to a queue/exchange. Fixed side passed in; the other picked. */
export function BindDialog({ open, onOpenChange, conn, scope, vhost, source, destination, destinationType, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; conn: RabbitConnection; scope: DBScope; vhost: string;
  source?: string; destination?: string; destinationType?: 'queue' | 'exchange'; onDone: () => void;
}) {
  const { t } = useTranslation('rabbit');
  const [src, setSrc] = useState(source ?? '');
  const [dst, setDst] = useState(destination ?? '');
  const [dstType, setDstType] = useState<'queue' | 'exchange'>(destinationType ?? 'queue');
  const [key, setKey] = useState('');
  const [args, setArgs] = useState('');
  const [exchanges, setExchanges] = useState<RabbitExchange[]>([]);
  const [queues, setQueues] = useState<RabbitQueue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSrc(source ?? ''); setDst(destination ?? ''); setDstType(destinationType ?? 'queue'); setKey(''); setArgs(''); setError('');
    void rabbitAPI.exchanges(conn.id, { vhost, pageSize: 500, sort: 'name' }, scope).then((r) => setExchanges((r.data as RabbitPage<RabbitExchange>).items ?? [])).catch(() => {});
    void rabbitAPI.queues(conn.id, { vhost, pageSize: 500, sort: 'name' }, scope).then((r) => setQueues((r.data as RabbitPage<RabbitQueue>).items ?? [])).catch(() => {});
  }, [open, source, destination, destinationType, conn.id, vhost, scope]);

  const srcType = exchanges.find((e) => e.name === src)?.type;
  const submit = async () => {
    const a = parseArgs(args);
    if (a === null) return setError(t('dialogs.argsInvalid'));
    setBusy(true);
    try {
      await rabbitAPI.bind(conn.id, { vhost, source: src, destination: dst, destinationType: dstType, routingKey: key, arguments: a }, scope);
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(extractErr(e, t('dialogs.failed')));
    }
    setBusy(false);
  };
  const userExchanges = exchanges.filter((e) => e.name && !e.name.startsWith('amq.'));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('dialogs.newBinding')}</DialogTitle>
          <DialogDescription>{t('dialogs.newBindingDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t('bindings.source')}</Label>
            {source !== undefined ? (
              <Input value={source} disabled className="font-mono text-xs" />
            ) : (
              <Select value={src} onValueChange={setSrc}>
                <SelectTrigger className="h-9 text-xs font-mono"><SelectValue placeholder={t('dialogs.pickExchange')} /></SelectTrigger>
                <SelectContent>{userExchanges.concat(exchanges.filter((e) => e.name.startsWith('amq.'))).map((e) => <SelectItem key={e.name} value={e.name}><span className="font-mono">{e.name}</span> <span className="text-muted-foreground">({e.type})</span></SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <div>
              <Label className="text-xs">{t('bindings.destinationType')}</Label>
              <Select value={dstType} onValueChange={(v) => { setDstType(v as 'queue' | 'exchange'); if (destination === undefined) setDst(''); }} disabled={destination !== undefined}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="queue">{t('bindings.queue')}</SelectItem>
                  <SelectItem value="exchange">{t('bindings.exchange')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('bindings.destination')}</Label>
              {destination !== undefined ? (
                <Input value={destination} disabled className="font-mono text-xs" />
              ) : (
                <Select value={dst} onValueChange={setDst}>
                  <SelectTrigger className="h-9 text-xs font-mono"><SelectValue placeholder={t('dialogs.pick')} /></SelectTrigger>
                  <SelectContent>
                    {(dstType === 'queue' ? queues.map((q) => q.name) : userExchanges.map((e) => e.name)).map((n) => <SelectItem key={n} value={n}><span className="font-mono">{n}</span></SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          {srcType !== 'fanout' && srcType !== 'headers' && (
            <div>
              <Label className="text-xs">{t('bindings.routingKey')}</Label>
              <Input value={key} onChange={(e) => setKey(e.target.value)} className="font-mono text-xs" placeholder={srcType === 'topic' ? 'order.*.created' : ''} />
              {srcType === 'topic' && <p className="text-[10px] text-muted-foreground mt-1">{t('dialogs.topicHelp')}</p>}
            </div>
          )}
          <div>
            <Label className="text-xs">{t('bindings.arguments')}</Label>
            <Textarea value={args} onChange={(e) => setArgs(e.target.value)} className="font-mono text-xs min-h-[56px]" placeholder={srcType === 'headers' ? '{ "x-match": "all", "region": "eu" }' : '{}'} />
          </div>
          {error && <p className="text-xs text-destructive break-words">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common:cancel')}</Button>
          <Button onClick={submit} disabled={busy || !src || !dst}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}{t('dialogs.bind')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── move messages ──────────────────────────────────────────────────

export function MoveDialog({ open, onOpenChange, conn, scope, vhost, source, available, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; conn: RabbitConnection; scope: DBScope; vhost: string;
  source: string; available: number; onDone: (moved: number, stopped?: string) => void;
}) {
  const { t } = useTranslation('rabbit');
  const [target, setTarget] = useState<'origin' | 'queue' | 'exchange'>('origin');
  const [queue, setQueue] = useState('');
  const [exchange, setExchange] = useState('');
  const [key, setKey] = useState('');
  const [count, setCount] = useState('');
  const [queues, setQueues] = useState<RabbitQueue[]>([]);
  const [exchanges, setExchanges] = useState<RabbitExchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTarget('origin'); setQueue(''); setExchange(''); setKey(''); setCount(String(Math.min(available || 100, 10000))); setError('');
    void rabbitAPI.queues(conn.id, { vhost, pageSize: 500, sort: 'name' }, scope).then((r) => setQueues((r.data as RabbitPage<RabbitQueue>).items ?? [])).catch(() => {});
    void rabbitAPI.exchanges(conn.id, { vhost, pageSize: 500, sort: 'name' }, scope).then((r) => setExchanges((r.data as RabbitPage<RabbitExchange>).items ?? [])).catch(() => {});
  }, [open, available, conn.id, vhost, scope]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await rabbitAPI.move(conn.id, {
        vhost, source, target, targetQueue: queue, targetExchange: exchange, targetRoutingKey: key, count: Number(count) || 1,
      }, scope);
      const d = res.data as { moved: number; stopped?: string };
      onDone(d.moved, d.stopped);
      onOpenChange(false);
    } catch (e) {
      setError(extractErr(e, t('dialogs.failed')));
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('move.title', { name: source })}</DialogTitle>
          <DialogDescription>{t('move.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            {(['origin', 'queue', 'exchange'] as const).map((k) => (
              <label key={k} className={cn('flex items-start gap-2 rounded-md border p-2 cursor-pointer', target === k ? 'border-primary bg-primary/5' : 'hover:bg-accent/40')}>
                <input type="radio" className="mt-0.5" checked={target === k} onChange={() => setTarget(k)} />
                <span>
                  <span className="block text-xs font-medium">{t(`move.${k}`)}</span>
                  <span className="block text-[10px] text-muted-foreground">{t(`move.${k}Desc`)}</span>
                </span>
              </label>
            ))}
          </div>
          {target === 'queue' && (
            <Select value={queue} onValueChange={setQueue}>
              <SelectTrigger className="h-9 text-xs font-mono"><SelectValue placeholder={t('dialogs.pick')} /></SelectTrigger>
              <SelectContent>{queues.filter((q) => q.name !== source && q.type !== 'stream').map((q) => <SelectItem key={q.name} value={q.name}><span className="font-mono">{q.name}</span></SelectItem>)}</SelectContent>
            </Select>
          )}
          {target === 'exchange' && (
            <div className="grid grid-cols-2 gap-3">
              <Select value={exchange} onValueChange={setExchange}>
                <SelectTrigger className="h-9 text-xs font-mono"><SelectValue placeholder={t('dialogs.pickExchange')} /></SelectTrigger>
                <SelectContent>{exchanges.filter((e) => e.name).map((e) => <SelectItem key={e.name} value={e.name}><span className="font-mono">{e.name}</span></SelectItem>)}</SelectContent>
              </Select>
              <Input value={key} onChange={(e) => setKey(e.target.value)} className="font-mono text-xs" placeholder={t('move.keepKey')} />
            </div>
          )}
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <div>
              <Label className="text-xs">{t('move.count')}</Label>
              <Input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} className="font-mono text-xs" />
            </div>
            <span className="text-[11px] text-muted-foreground pb-2">{t('move.available', { count: available })}</span>
          </div>
          <div className="flex gap-1.5 rounded bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /> {t('move.note')}
          </div>
          {error && <p className="text-xs text-destructive break-words">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common:cancel')}</Button>
          <Button onClick={submit} disabled={busy || (target === 'queue' && !queue) || (target === 'exchange' && !exchange)}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}{t('move.run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── typed confirmation (purge / delete / close) ────────────────────

export function ConfirmDialog({ open, onOpenChange, title, description, confirmText, typeToConfirm, danger, children, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; confirmText: string;
  typeToConfirm?: string; danger?: boolean; children?: React.ReactNode; onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation('rabbit');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setTyped(''); setError(''); } }, [open]);
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(extractErr(e, t('dialogs.failed')));
    }
    setBusy(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        {typeToConfirm && (
          <div>
            <Label className="text-xs">{t('dialogs.typeToConfirm', { name: typeToConfirm })}</Label>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} className="font-mono text-xs" autoFocus />
          </div>
        )}
        {error && <p className="text-xs text-destructive break-words">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common:cancel')}</Button>
          <Button variant={danger ? 'destructive' : 'default'} onClick={run} disabled={busy || (!!typeToConfirm && typed !== typeToConfirm)}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}{confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
