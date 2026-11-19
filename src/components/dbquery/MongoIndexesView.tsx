import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowDown, ArrowUp, Check, Copy, Eye, EyeOff, KeyRound, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { dbQueryAPI, type DBScope } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { confirmDialog } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { useDBConnectionStore } from '@/stores/dbConnectionStore';
import type { DBConnection, DBSchemaTable, MongoIndex, MongoIndexKey } from '@/types';

export interface MongoTarget { db?: string; coll: string }

function errMsg(e: unknown, fallback: string): string {
  const r = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return r || (e instanceof Error ? e.message : fallback);
}

function fmtBytes(n: number): string {
  if (n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

const targetKey = (t: { db?: string; coll: string }) => `${t.db ?? ''}\u0000${t.coll}`;

// Compass-style Indexes view for one collection: keys, properties, size and
// usage; create / hide / drop when the connection is read-write and the
// caller can manage it.
export function MongoIndexesView({ conn, scope, target, tables, onTargetChange }: {
  conn: DBConnection;
  scope: DBScope;
  target?: MongoTarget;
  tables: DBSchemaTable[];
  onTargetChange: (t: MongoTarget) => void;
}) {
  const { t } = useTranslation('dbquery');
  const [list, setList] = useState<MongoIndex[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const canWrite = !!conn.allowWrite && (!conn.shared || conn.grantRole === 'write');
  // The collection picker and the field suggestions come from the schema.
  const loadSchema = useDBConnectionStore((s) => s.loadSchema);
  useEffect(() => { if (tables.length === 0) loadSchema(conn.id).catch(() => { /* picker stays as is */ }); }, [conn.id, tables.length, loadSchema]);

  const load = useCallback(async () => {
    if (!target?.coll) return;
    setLoading(true);
    setErr('');
    try {
      const res = await dbQueryAPI.mongoIndexes(conn.id, { db: target.db || undefined, coll: target.coll }, scope);
      setList((res.data as MongoIndex[]) ?? []);
    } catch (e) {
      setErr(errMsg(e, t('mongoIndexes.loadFailed')));
      setList(null);
    } finally {
      setLoading(false);
    }
  }, [conn.id, target?.db, target?.coll, scope, t]);
  useEffect(() => { void load(); }, [load]);

  const fields = useMemo(() => {
    const tb = tables.find((x) => x.name === target?.coll && (x.schema ?? '') === (target?.db ?? x.schema ?? ''));
    return (tb?.columns ?? []).map((c) => c.name);
  }, [tables, target]);

  const drop = async (ix: MongoIndex) => {
    const ok = await confirmDialog({
      title: t('mongoIndexes.dropTitle', { name: ix.name }),
      description: t('mongoIndexes.dropBody'),
      destructive: true,
      confirmLabel: t('mongoIndexes.drop'),
    });
    if (!ok || !target) return;
    try {
      await dbQueryAPI.mongoDropIndex(conn.id, { db: target.db, coll: target.coll, name: ix.name }, scope);
      await load();
    } catch (e) {
      setErr(errMsg(e, t('mongoIndexes.actionFailed')));
    }
  };
  const toggleHidden = async (ix: MongoIndex) => {
    if (!target) return;
    try {
      await dbQueryAPI.mongoHideIndex(conn.id, { db: target.db, coll: target.coll, name: ix.name, hidden: !ix.hidden }, scope);
      await load();
    } catch (e) {
      setErr(errMsg(e, t('mongoIndexes.actionFailed')));
    }
  };

  const options = useMemo(() => {
    const o = tables.map((x) => ({ key: targetKey({ db: x.schema, coll: x.name }), db: x.schema, coll: x.name }));
    // A target the schema does not list (not introspected yet, or the query
    // named a db the schema files elsewhere) still shows in the picker.
    if (target && !o.some((x) => x.coll === target.coll && (x.db ?? '') === (target.db ?? x.db ?? ''))) {
      o.unshift({ key: targetKey(target), db: target.db, coll: target.coll });
    }
    return o;
  }, [tables, target]);
  const selectedKey = useMemo(() => {
    if (!target) return '';
    const hit = options.find((x) => x.coll === target.coll && (x.db ?? '') === (target.db ?? x.db ?? ''));
    return hit ? hit.key : targetKey(target);
  }, [options, target]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-2 border-b px-4 py-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <Select
          value={selectedKey}
          onValueChange={(v) => { const o = options.find((x) => x.key === v); if (o) onTargetChange({ db: o.db, coll: o.coll }); }}
        >
          <SelectTrigger className="h-8 w-[320px] text-xs">
            <SelectValue placeholder={t('mongoIndexes.pickCollection')} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.key} value={o.key} className="text-xs">
                {o.db ? <span className="text-muted-foreground">{o.db}.</span> : null}{o.coll}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => void load()} disabled={!target || loading} aria-label={t('mongoIndexes.refresh')} title={t('mongoIndexes.refresh')}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </Button>
        <div className="flex-1" />
        {list && <span className="text-[11px] text-muted-foreground">{t('mongoIndexes.count', { count: list.length })}</span>}
        <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={!target || !canWrite} title={canWrite ? undefined : t('mongoIndexes.readOnlyHint')} onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> {t('mongoIndexes.create')}
        </Button>
      </div>

      {err && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{err}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto p-4">
        {!target ? (
          <p className="py-12 text-center text-xs text-muted-foreground">{t('mongoIndexes.pickCollectionHint')}</p>
        ) : !list ? (
          loading ? <div className="flex justify-center py-12"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div> : null
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">{t('mongoIndexes.colName')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('mongoIndexes.colKeys')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('mongoIndexes.colProps')}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t('mongoIndexes.colSize')}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t('mongoIndexes.colUsage')}</th>
                <th className="py-1.5 w-16" />
              </tr>
            </thead>
            <tbody>
              {list.map((ix) => {
                const unused = ix.ops === 0 && ix.name !== '_id_';
                return (
                  <tr key={ix.name} className={cn('border-b align-top hover:bg-accent/30', (unused || ix.hidden) && 'text-muted-foreground')}>
                    <td className="py-2 pr-3">
                      <div className="font-mono font-medium">{ix.name}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{t(`mongoIndexes.type.${ix.type}`)}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {ix.keys.map((k) => <KeyChip key={k.field} k={k} />)}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {ix.unique && <Prop label={t('mongoIndexes.unique')} tone="violet" />}
                        {ix.sparse && <Prop label={t('mongoIndexes.sparse')} />}
                        {ix.expireAfterSeconds !== undefined && <Prop label={t('mongoIndexes.ttl', { sec: ix.expireAfterSeconds })} tone="amber" />}
                        {ix.partialFilterExpression !== undefined && (
                          <Prop label={t('mongoIndexes.partial')} title={JSON.stringify(ix.partialFilterExpression)} tone="sky" />
                        )}
                        {ix.collation !== undefined && <Prop label={t('mongoIndexes.collation')} title={JSON.stringify(ix.collation)} />}
                        {ix.hidden && <Prop label={t('mongoIndexes.hidden')} tone="muted" />}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtBytes(ix.size)}</td>
                    <td className="py-2 pr-3 text-right">
                      {ix.ops < 0 ? '—' : (
                        <>
                          <div className="font-mono tabular-nums">{t('mongoIndexes.ops', { count: ix.ops })}</div>
                          {unused && <div className="text-[10px] text-amber-600 dark:text-amber-400">{t('mongoIndexes.unused')}</div>}
                          {ix.since && <div className="text-[10px] text-muted-foreground">{t('mongoIndexes.since', { date: new Date(ix.since).toLocaleDateString() })}</div>}
                        </>
                      )}
                    </td>
                    <td className="py-2">
                      {ix.name !== '_id_' && canWrite && (
                        <div className="flex justify-end gap-0.5">
                          <button type="button" className="rounded p-1 hover:bg-accent" onClick={() => void toggleHidden(ix)}
                            title={ix.hidden ? t('mongoIndexes.unhide') : t('mongoIndexes.hide')} aria-label={ix.hidden ? t('mongoIndexes.unhide') : t('mongoIndexes.hide')}>
                            {ix.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          </button>
                          <button type="button" className="rounded p-1 text-destructive hover:bg-destructive/10" onClick={() => void drop(ix)}
                            title={t('mongoIndexes.drop')} aria-label={t('mongoIndexes.drop')}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {target && (
        <CreateIndexDialog
          target={target}
          open={createOpen}
          onOpenChange={setCreateOpen}
          fields={fields}
          onCreate={async (spec) => {
            await dbQueryAPI.mongoCreateIndex(conn.id, { db: target.db, coll: target.coll, ...spec }, scope);
            await load();
          }}
        />
      )}
    </div>
  );
}

function KeyChip({ k }: { k: MongoIndexKey }) {
  const dir = k.value === 1 ? <ArrowUp className="h-2.5 w-2.5" /> : k.value === -1 ? <ArrowDown className="h-2.5 w-2.5" /> : <span className="text-[9px] uppercase">{String(k.value)}</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]">
      {k.field}
      <span className="text-sky-600 dark:text-sky-400">{dir}</span>
    </span>
  );
}

const TONES: Record<string, string> = {
  violet: 'border-violet-500/40 text-violet-600 dark:text-violet-400',
  amber: 'border-amber-500/40 text-amber-600 dark:text-amber-400',
  sky: 'border-sky-500/40 text-sky-600 dark:text-sky-400',
  muted: 'border-muted-foreground/30 text-muted-foreground',
};
function Prop({ label, title, tone }: { label: string; title?: string; tone?: string }) {
  return <span title={title} className={cn('rounded-full border px-1.5 py-px text-[10px]', tone ? TONES[tone] : 'text-foreground/80')}>{label}</span>;
}

// ── Create index ─────────────────────────────────────────────────────────────

interface KeyRow { field: string; value: string }
const KEY_TYPES = ['1', '-1', 'text', '2dsphere', 'hashed'];

function CreateIndexDialog({ open, onOpenChange, fields, onCreate, target }: {
  target: MongoTarget;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fields: string[];
  onCreate: (spec: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useTranslation('dbquery');
  const [keys, setKeys] = useState<KeyRow[]>([{ field: '', value: '1' }]);
  const [name, setName] = useState('');
  const [unique, setUnique] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [ttlOn, setTtlOn] = useState(false);
  const [ttl, setTtl] = useState('3600');
  const [partial, setPartial] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setKeys([{ field: '', value: '1' }]); setName(''); setUnique(false); setSparse(false); setHidden(false);
      setTtlOn(false); setTtl('3600'); setPartial(''); setErr(''); setBusy(false);
    }
  }, [open]);

  const keyVal = (v: string) => (v === '1' || v === '-1' ? Number(v) : v);
  const valid = keys.every((k) => k.field.trim()) && (!ttlOn || /^\d+$/.test(ttl));
  const preview = useMemo(() => {
    const k = `{ ${keys.filter((x) => x.field.trim()).map((x) => `${/^[A-Za-z_$][\w$]*$/.test(x.field.trim()) ? x.field.trim() : `'${x.field.trim()}'`}: ${x.value === '1' || x.value === '-1' ? x.value : `"${x.value}"`}`).join(', ')} }`;
    const o: string[] = [];
    if (name.trim()) o.push(`name: "${name.trim()}"`);
    if (unique) o.push('unique: true');
    if (sparse) o.push('sparse: true');
    if (hidden) o.push('hidden: true');
    if (ttlOn && keys.length === 1) o.push(`expireAfterSeconds: ${ttl || 0}`);
    if (partial.trim()) o.push(`partialFilterExpression: ${partial.trim()}`);
    const coll = target.db
      ? `db.getSiblingDB('${target.db}').getCollection('${target.coll}')`
      : `db.getCollection('${target.coll}')`;
    return `${coll}.createIndex(${k}${o.length ? `, { ${o.join(', ')} }` : ''})`;
  }, [keys, name, unique, sparse, hidden, ttlOn, ttl, partial, target]);

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await onCreate({
        keys: keys.map((k) => ({ field: k.field.trim(), value: keyVal(k.value) })),
        name: name.trim(),
        unique, sparse, hidden,
        expireAfterSeconds: ttlOn && keys.length === 1 ? Number(ttl) : undefined,
        partialFilter: partial.trim(),
      });
      onOpenChange(false);
    } catch (e) {
      setErr(errMsg(e, t('mongoIndexes.actionFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('mongoIndexes.createTitle')}</DialogTitle>
          <DialogDescription className="text-xs">{t('mongoIndexes.createHint')}</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('mongoIndexes.fields')}</Label>
            <datalist id="pm-mongo-index-fields">{fields.map((f) => <option key={f} value={f} />)}</datalist>
            {keys.map((k, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input list="pm-mongo-index-fields" value={k.field} placeholder={t('mongoIndexes.fieldPlaceholder')}
                  onChange={(e) => setKeys((ks) => ks.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))}
                  className="h-8 flex-1 font-mono text-xs" autoFocus={i === 0} />
                <Select value={k.value} onValueChange={(v) => setKeys((ks) => ks.map((x, j) => (j === i ? { ...x, value: v } : x)))}>
                  <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KEY_TYPES.map((v) => <SelectItem key={v} value={v} className="text-xs">{t(`mongoIndexes.keyType.${v}`)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={keys.length === 1}
                  onClick={() => setKeys((ks) => ks.filter((_, j) => j !== i))} aria-label={t('mongoIndexes.removeField')}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setKeys((ks) => [...ks, { field: '', value: '1' }])}>
              <Plus className="h-3 w-3" /> {t('mongoIndexes.addField')}
            </Button>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('mongoIndexes.name')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('mongoIndexes.namePlaceholder')} className="h-8 font-mono text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex items-center gap-2"><Switch checked={unique} onCheckedChange={setUnique} />{t('mongoIndexes.unique')}</label>
            <label className="flex items-center gap-2"><Switch checked={sparse} onCheckedChange={setSparse} />{t('mongoIndexes.sparse')}</label>
            <label className="flex items-center gap-2"><Switch checked={hidden} onCheckedChange={setHidden} />{t('mongoIndexes.hidden')}</label>
            <label className={cn('flex items-center gap-2', keys.length > 1 && 'opacity-50')} title={keys.length > 1 ? t('mongoIndexes.ttlSingleField') : undefined}>
              <Switch checked={ttlOn && keys.length === 1} disabled={keys.length > 1} onCheckedChange={setTtlOn} />{t('mongoIndexes.ttlLabel')}
              {ttlOn && keys.length === 1 && <Input value={ttl} onChange={(e) => setTtl(e.target.value)} className="h-7 w-20 font-mono text-xs" />}
            </label>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('mongoIndexes.partialLabel')}</Label>
            <Textarea value={partial} onChange={(e) => setPartial(e.target.value)} placeholder='{ status: "active" }' className="min-h-[52px] font-mono text-xs" spellCheck={false} />
          </div>
          <div className="relative min-w-0 rounded bg-muted/50">
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all py-1.5 pl-2 pr-9 font-mono text-[11px] text-muted-foreground">{preview}</pre>
            <button
              type="button"
              onClick={() => { void navigator.clipboard.writeText(preview).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
              className="absolute right-1 top-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title={copied ? t('mongoIndexes.copied') : t('mongoIndexes.copy')}
              aria-label={t('mongoIndexes.copy')}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          {err && <p className="break-words text-xs text-destructive">{err}</p>}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>{t('common:cancel')}</Button>
          <Button size="sm" disabled={!valid || busy} onClick={submit}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {t('mongoIndexes.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
