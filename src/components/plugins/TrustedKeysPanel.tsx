import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { confirmDialog } from '@/components/ui/confirm';
import { pluginAPI, type TrustedKey } from '@/lib/plugins/pluginApi';
import { errorMessage } from './util';

// Trusted publishers (RFC §18): plugins signed by one of these keys can be
// installed. Adding or removing a key asks for step-up.
export function TrustedKeysPanel() {
  const { t } = useTranslation('plugins');
  const [keys, setKeys] = useState<TrustedKey[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      setKeys(await pluginAPI.trustedKeys());
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    setErr('');
    try {
      await pluginAPI.addTrustedKey(name.trim(), key.trim());
      setName('');
      setKey('');
      setAdding(false);
      await load();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  const remove = async (k: TrustedKey) => {
    const ok = await confirmDialog({
      title: t('keys.removeTitle', { name: k.name }),
      description: t('keys.removeBody'),
      destructive: true,
    });
    if (!ok) return;
    setErr('');
    try {
      await pluginAPI.deleteTrustedKey(k.keyId);
      await load();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">{t('keys.title')}</p>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            {t('keys.add')}
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('keys.hint')}</p>
      {keys.length === 0 && <p className="text-[11px] text-muted-foreground">{t('keys.none')}</p>}
      <ul className="space-y-1">
        {keys.map((k) => (
          <li key={k.keyId} className="flex items-center gap-2 text-xs">
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{k.name}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{k.keyId}</span>
            {k.fromEnv ? (
              <span className="text-[10px] text-muted-foreground">{t('keys.fromEnv')}</span>
            ) : (
              <button type="button" aria-label={t('keys.remove')} className="ml-auto rounded p-0.5 hover:bg-accent" onClick={() => remove(k)}>
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <div className="space-y-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('keys.namePlaceholder')} className="text-xs" />
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('keys.keyPlaceholder')} className="font-mono text-xs" />
          <div className="flex gap-2">
            <Button size="sm" onClick={add} disabled={!name.trim() || !key.trim()}>{t('keys.save')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t('keys.cancel')}</Button>
          </div>
        </div>
      )}
      {err && <p className="break-all text-xs text-destructive">{err}</p>}
    </div>
  );
}
