import { useCallback, useMemo, useState } from 'react';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { Plus, Trash2, Wand2, Copy, Download, Database } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useThemeStore } from '@/stores/themeStore';
import { useToast } from '@/components/ui/use-toast';
import {
  FIELD_TYPES, generateRows, formatRows,
  type MockField, type FieldType, type OutputFormat,
} from './mockData';

const uid = () => crypto.randomUUID();

const DEFAULT_FIELDS: MockField[] = [
  { id: uid(), name: 'id', type: 'rowNumber' },
  { id: uid(), name: 'first_name', type: 'firstName' },
  { id: uid(), name: 'last_name', type: 'lastName' },
  { id: uid(), name: 'email', type: 'email' },
  { id: uid(), name: 'created_at', type: 'datetime' },
];

// Group the type catalog for the <Select>.
const GROUPED = FIELD_TYPES.reduce<Record<string, typeof FIELD_TYPES>>((acc, t) => {
  (acc[t.group] ??= []).push(t);
  return acc;
}, {});

export function MockDataTool() {
  const { t } = useTranslation('devtools');
  const { theme } = useThemeStore();
  const { toast } = useToast();
  const [fields, setFields] = useState<MockField[]>(DEFAULT_FIELDS);
  const [count, setCount] = useState(10);
  const [format, setFormat] = useState<OutputFormat>('json');
  const [table, setTable] = useState('mock_data');
  const [output, setOutput] = useState('');

  const optsOf = useCallback((type: FieldType) => FIELD_TYPES.find((ft) => ft.type === type)?.opts ?? [], []);

  const update = useCallback((id: string, patch: Partial<MockField>) => {
    setFields((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);
  const remove = useCallback((id: string) => setFields((fs) => fs.filter((f) => f.id !== id)), []);
  const add = useCallback(() => setFields((fs) => [...fs, { id: uid(), name: `field_${fs.length + 1}`, type: 'word' }]), []);

  const generate = useCallback(() => {
    const rows = generateRows(fields, count);
    setOutput(formatRows(rows, fields, format, table));
  }, [fields, count, format, table]);

  const lang = format === 'sql' ? 'sql' : format === 'csv' ? 'plaintext' : 'json';

  const copy = useCallback(() => {
    if (!output) return;
    navigator.clipboard.writeText(output);
    toast({ title: t('common:copied'), description: t('mockData.copiedDesc', { count, format: format.toUpperCase() }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output, count, format, toast]);

  const download = useCallback(() => {
    if (!output) return;
    const ext = format === 'ndjson' ? 'ndjson' : format;
    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `mock.${ext}`; a.click();
    URL.revokeObjectURL(url);
  }, [output, format]);

  const rowsEstimate = useMemo(() => count * fields.length, [count, fields.length]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 border-b px-4 pt-4 pb-2 flex items-center gap-2 flex-wrap">
        <Database className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t('mockData.title')}</span>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">{t('mockData.rows')}</Label>
          <Input
            type="number"
            min={1}
            max={100000}
            value={count}
            onChange={(e) => setCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="h-8 w-24 text-xs"
          />
        </div>
        <Select value={format} onValueChange={(v) => setFormat(v as OutputFormat)}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="json">JSON</SelectItem>
            <SelectItem value="ndjson">NDJSON</SelectItem>
            <SelectItem value="csv">CSV</SelectItem>
            <SelectItem value="sql">{t('mockData.sqlInsert')}</SelectItem>
          </SelectContent>
        </Select>
        {format === 'sql' && (
          <Input
            value={table}
            onChange={(e) => setTable(e.target.value)}
            placeholder={t('mockData.tablePlaceholder')}
            className="h-8 w-32 text-xs font-mono"
          />
        )}
        <div className="flex-1" />
        <Button size="sm" className="h-8 gap-1.5" onClick={generate}>
          <Wand2 className="h-3.5 w-3.5" /> <span className="text-xs">{t('actions.generate')}</span>
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5" disabled={!output} onClick={copy}>
          <Copy className="h-3.5 w-3.5" /> <span className="text-xs">{t('common:copy')}</span>
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5" disabled={!output} onClick={download}>
          <Download className="h-3.5 w-3.5" /> <span className="text-xs">{t('actions.download')}</span>
        </Button>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Schema editor */}
        <div className="w-[46%] min-w-[380px] border-r flex flex-col min-h-0">
          <div className="shrink-0 px-3 py-2 border-b flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t(fields.length === 1 ? 'mockData.schemaFieldsOne' : 'mockData.schemaFieldsOther', { count: fields.length })}
            </span>
            <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={add}>
              <Plus className="h-3.5 w-3.5" /> {t('mockData.field')}
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1.5">
            {fields.map((f) => {
              const opts = optsOf(f.type);
              return (
                <div key={f.id} className="rounded border bg-muted/20 p-2 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={f.name}
                      onChange={(e) => update(f.id, { name: e.target.value })}
                      placeholder={t('mockData.fieldNamePlaceholder')}
                      className="h-7 text-xs font-mono flex-1"
                    />
                    <Select value={f.type} onValueChange={(v) => update(f.id, { type: v as FieldType })}>
                      <SelectTrigger className="h-7 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(GROUPED).map(([group, types]) => (
                          <SelectGroup key={group}>
                            <SelectLabel className="text-[10px]">{t(`mockData.group.${group}`)}</SelectLabel>
                            {types.map((ft) => (
                              <SelectItem key={ft.type} value={ft.type} className="text-xs">{t(`mockData.fieldType.${ft.type}`)}</SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove(f.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {(opts.length > 0 || true) && (
                    <div className="flex items-center gap-1.5 flex-wrap pl-0.5">
                      {opts.includes('min') && (
                        <NumOpt label={t('mockData.opt.min')} value={f.min} onChange={(n) => update(f.id, { min: n })} />
                      )}
                      {opts.includes('max') && (
                        <NumOpt label={t('mockData.opt.max')} value={f.max} onChange={(n) => update(f.id, { max: n })} />
                      )}
                      {opts.includes('decimals') && (
                        <NumOpt label={t('mockData.opt.dec')} value={f.decimals} onChange={(n) => update(f.id, { decimals: n })} />
                      )}
                      {opts.includes('from') && (
                        <TxtOpt label={t('mockData.opt.from')} value={f.from} placeholder="2020-01-01" onChange={(s) => update(f.id, { from: s })} />
                      )}
                      {opts.includes('to') && (
                        <TxtOpt label={t('mockData.opt.to')} value={f.to} placeholder="2026-01-01" onChange={(s) => update(f.id, { to: s })} />
                      )}
                      {opts.includes('list') && (
                        <TxtOpt label={t('mockData.opt.list')} value={f.list} placeholder={t('mockData.listPlaceholder')} wide onChange={(s) => update(f.id, { list: s })} />
                      )}
                      {opts.includes('value') && (
                        <TxtOpt label={t('mockData.opt.value')} value={f.value} placeholder={t('mockData.constantPlaceholder')} wide onChange={(s) => update(f.id, { value: s })} />
                      )}
                      <NumOpt label={t('mockData.opt.blank')} value={f.blank} onChange={(n) => update(f.id, { blank: n })} />
                    </div>
                  )}
                </div>
              );
            })}
            {fields.length === 0 && (
              <p className="text-center text-xs text-muted-foreground py-6">{t('mockData.noFields')}</p>
            )}
          </div>
        </div>

        {/* Output */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          <div className="shrink-0 px-3 py-2 border-b flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('mockData.output')} {output ? t(count === 1 ? 'mockData.outputRowsOne' : 'mockData.outputRowsOther', { count }) : ''}
            </span>
            <span className="text-[10px] text-muted-foreground/70">{format.toUpperCase()} {t('mockData.values', { count: rowsEstimate.toLocaleString() })}</span>
          </div>
          <div className="flex-1 min-h-0">
            {output ? (
              <CodeEditor
                height="100%"
                language={lang}
                theme={theme === 'dark' ? 'vs-dark' : 'light'}
                value={output}
                options={{
                  readOnly: true, minimap: { enabled: false }, fontSize: 12,
                  scrollBeyondLastLine: false, wordWrap: 'on', automaticLayout: true,
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                <Trans i18nKey="mockData.emptyState" ns="devtools">
                  Define your schema, then press <span className="mx-1 font-medium text-foreground">Generate</span>.
                </Trans>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NumOpt({ label, value, onChange }: { label: string; value?: number; onChange: (n: number | undefined) => void }) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
      {label}
      <Input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className="h-6 w-16 text-[11px] px-1.5"
      />
    </label>
  );
}

function TxtOpt({ label, value, placeholder, wide, onChange }: { label: string; value?: string; placeholder?: string; wide?: boolean; onChange: (s: string) => void }) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
      {label}
      <Input
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`h-6 text-[11px] px-1.5 ${wide ? 'w-40' : 'w-24'}`}
      />
    </label>
  );
}
