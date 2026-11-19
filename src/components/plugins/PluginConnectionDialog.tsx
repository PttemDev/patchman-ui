import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { pluginAPI, type PluginConnection, type PluginInfo } from '@/lib/plugins/pluginApi';
import { usePluginStore } from '@/stores/pluginStore';
import { SchemaForm } from './SchemaForm';
import { schemaDefaults, schemaValues } from './schema';
import { errorMessage } from './util';

interface Props {
  plugin: PluginInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: PluginConnection | null;
}

// Connection dialog generated from the plugin's connection.schema. Secret
// fields travel separately from config and are only sent when typed; on edit
// an empty secret keeps the stored value.
export function PluginConnectionDialog({ plugin, open, onOpenChange, editing }: Props) {
  const { t } = useTranslation('plugins');
  const upsert = usePluginStore((s) => s.upsertConnection);
  const schema = plugin.connection.schema;
  const secretFields = plugin.connection.secretFields ?? [];

  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [allowWrite, setAllowWrite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testHint, setTestHint] = useState(false);
  const [error, setError] = useState('');
  const hasWrite = Object.values(plugin.ops).some((o) => o.write);
  const hasTest = Boolean(plugin.ops.test);

  useEffect(() => {
    if (!open) return;
    setError('');
    setTest(null);
    setName(editing?.name ?? '');
    setValues(schemaDefaults(schema, editing?.config));
    setAllowWrite(editing?.allowWrite ?? false);
  }, [open, editing, schema]);

  const build = () => {
    const cfg = schemaValues(schema, values, secretFields);
    if (cfg.error) return { error: t('form.badValue', { field: cfg.error }) };
    const secrets: Record<string, string> = {};
    for (const f of secretFields) {
      const v = values[f];
      if (typeof v === 'string' && v !== '') secrets[f] = v;
    }
    return { config: cfg.value, secrets };
  };

  const onTest = async () => {
    const b = build();
    if ('error' in b && b.error) return setError(b.error);
    setTesting(true);
    setTest(null);
    try {
      const unchanged = editing && Object.keys(b.secrets ?? {}).length === 0
        && JSON.stringify(b.config ?? {}) === JSON.stringify(schemaValues(schema, editing.config, secretFields).value);
      setTestHint(Boolean(editing && !unchanged && secretFields.length > 0 && Object.keys(b.secrets ?? {}).length === 0));
      const r = unchanged
        ? await pluginAPI.testConnection(plugin.id, editing.id)
        : await pluginAPI.testConnection(plugin.id, null, { name: name || 'test', config: b.config ?? {}, secrets: b.secrets });
      setTest({ ok: r.ok, error: r.error });
    } catch (err) {
      setTest({ ok: false, error: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const onSave = async () => {
    if (!name.trim()) return setError(t('dialog.nameRequired'));
    const b = build();
    if ('error' in b && b.error) return setError(b.error);
    setSaving(true);
    setError('');
    try {
      const saved = editing
        ? await pluginAPI.updateConnection(plugin.id, editing.id, { name: name.trim(), config: b.config ?? {}, secrets: b.secrets, allowWrite })
        : await pluginAPI.createConnection(plugin.id, { id: crypto.randomUUID(), name: name.trim(), config: b.config ?? {}, secrets: b.secrets, allowWrite });
      upsert(saved);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t('dialog.editTitle', { plugin: plugin.name }) : t('dialog.addTitle', { plugin: plugin.name })}</DialogTitle>
          <DialogDescription>{t('dialog.description', { publisher: plugin.publisher })}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label htmlFor="pc-name" className="text-xs">{t('dialog.name')}</Label>
            <Input id="pc-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <SchemaForm
            schema={schema}
            values={values}
            onChange={setValues}
            secretFields={secretFields}
            secretsSet={editing?.secretsSet}
          />
          {hasWrite && (
            <div className="flex items-center justify-between rounded-md border p-2">
              <div>
                <p className="text-xs font-medium">{t('dialog.allowWrite')}</p>
                <p className="text-[11px] text-muted-foreground">{t('dialog.allowWriteHint')}</p>
              </div>
              <Switch checked={allowWrite} onCheckedChange={setAllowWrite} />
            </div>
          )}
          {test && (
            <div className={`flex items-start gap-2 rounded-md p-2 text-xs ${test.ok ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive'}`}>
              {test.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
              <span className="break-all">{test.ok ? t('dialog.testOk') : test.error}</span>
            </div>
          )}
          {test && testHint && <p className="text-[11px] text-muted-foreground">{t('dialog.testEditHint')}</p>}
          {error && <p className="text-xs text-destructive break-all">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          {hasTest && (
            <Button variant="outline" onClick={onTest} disabled={testing || saving}>
              {testing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {t('dialog.test')}
            </Button>
          )}
          <Button onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {t('dialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
