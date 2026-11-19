import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { JSONSchema } from '@/lib/plugins/pluginApi';
import { kind } from './schema';

// SchemaForm renders a flat form from a plugin's JSON Schema (connection
// config, op input). Every label and hint comes from the plugin, so it is
// rendered as text only — never as HTML (RFC D10).

interface Props {
  schema: JSONSchema | undefined;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  /** Fields rendered as password inputs (secret fields). */
  secretFields?: string[];
  /** Secret fields that already hold a value (edit: empty keeps it). */
  secretsSet?: string[];
  disabled?: boolean;
}

export function SchemaForm({ schema, values, onChange, secretFields = [], secretsSet = [], disabled }: Props) {
  const { t } = useTranslation('plugins');
  const props = Object.entries(schema?.properties ?? {});
  const required = new Set(schema?.required ?? []);
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });

  if (props.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('form.noFields')}</p>;
  }
  return (
    <div className="space-y-3">
      {props.map(([key, p]) => {
        const id = `pf-${key}`;
        const label = p.title || key;
        const kd = kind(p);
        const secret = secretFields.includes(key);
        const v = values[key];
        return (
          <div key={key} className="space-y-1">
            <Label htmlFor={id} className="text-xs">
              {label}
              {required.has(key) && <span className="text-destructive"> *</span>}
            </Label>
            {kd === 'boolean' ? (
              <div>
                <Switch id={id} checked={Boolean(v)} onCheckedChange={(c) => set(key, c)} disabled={disabled} />
              </div>
            ) : kd === 'enum' ? (
              <select
                id={id}
                className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                value={v === undefined ? '' : String(v)}
                onChange={(e) => {
                  const opt = (p.enum ?? []).find((o) => String(o) === e.target.value);
                  set(key, opt ?? e.target.value);
                }}
                disabled={disabled}
              >
                <option value="">—</option>
                {(p.enum ?? []).map((o) => (
                  <option key={String(o)} value={String(o)}>{String(o)}</option>
                ))}
              </select>
            ) : kd === 'object' || kd === 'array' ? (
              <Textarea
                id={id}
                className="font-mono text-xs"
                rows={4}
                value={typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v, null, 2)}
                onChange={(e) => set(key, e.target.value)}
                placeholder={kd === 'array' ? '[]' : '{}'}
                disabled={disabled}
              />
            ) : (
              <Input
                id={id}
                type={secret ? 'password' : kd === 'number' || kd === 'integer' ? 'number' : 'text'}
                autoComplete={secret ? 'new-password' : 'off'}
                value={v === undefined || v === null ? '' : String(v)}
                placeholder={secret && secretsSet.includes(key) ? t('form.secretKept') : undefined}
                onChange={(e) => set(key, e.target.value)}
                disabled={disabled}
              />
            )}
            {p.description && <p className="text-[11px] text-muted-foreground">{p.description}</p>}
          </div>
        );
      })}
    </div>
  );
}
