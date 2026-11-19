import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Lock, Pencil, Plus, Trash2, X, Check } from 'lucide-react';
import { gitAPI } from '@/services/api';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { confirmDialog } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import type { GitRemote } from '@/types';
import { extractErr } from './util';

// ── Name prompt (new branch / rename / checkout revision) ────────────────────

export interface NamePromptState {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  /** Shows a "Checkout branch" switch (new branch). */
  checkoutToggle?: boolean;
  submitLabel: string;
  onSubmit: (value: string, checkout: boolean) => Promise<boolean>;
}

export function GitNamePrompt({ state, onClose }: { state: NamePromptState | null; onClose: () => void }) {
  const { t } = useTranslation('git');
  const [value, setValue] = useState('');
  const [checkout, setCheckout] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (state) { setValue(state.initial ?? ''); setCheckout(true); setBusy(false); }
  }, [state]);
  // Light client-side check; git's check-ref-format decides on the BE.
  const invalid = /\s|\.\.|[~^:?*[\\]|^-|\/$|\.lock$|@\{/.test(value);
  const submit = async () => {
    if (!state || !value.trim() || invalid) return;
    setBusy(true);
    const ok = await state.onSubmit(value.trim(), checkout);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Dialog open={!!state} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs">{state?.label}</Label>
          <Input
            autoFocus
            value={value}
            placeholder={state?.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            className={cn('font-mono text-xs', invalid && value && 'border-destructive')}
          />
          {invalid && value && <p className="text-[11px] text-destructive">{t('vcs.invalidName')}</p>}
          {state?.checkoutToggle && (
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={checkout} onCheckedChange={setCheckout} />
              {t('vcs.checkoutNew')}
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>{t('vcs.cancel')}</Button>
          <Button size="sm" disabled={busy || !value.trim() || invalid} onClick={submit}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {state?.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Update Project (pull with a strategy) ────────────────────────────────────

export type PullStrategy = 'merge' | 'rebase' | 'ff';
const PREF_KEY = 'patchman.git.updateStrategy';

function loadPref(): { strategy: PullStrategy; autostash: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
    if (v.strategy === 'merge' || v.strategy === 'rebase' || v.strategy === 'ff') {
      return { strategy: v.strategy, autostash: v.autostash !== false };
    }
  } catch { /* storage blocked */ }
  return { strategy: 'merge', autostash: true };
}

export function GitUpdateDialog({
  open, onOpenChange, branch, upstream, onRun,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branch: string;
  upstream?: string;
  onRun: (strategy: PullStrategy, autostash: boolean) => Promise<void>;
}) {
  const { t } = useTranslation('git');
  const [strategy, setStrategy] = useState<PullStrategy>('merge');
  const [autostash, setAutostash] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { const p = loadPref(); setStrategy(p.strategy); setAutostash(p.autostash); }
  }, [open]);
  const go = async () => {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ strategy, autostash })); } catch { /* ignore */ }
    setBusy(true);
    await onRun(strategy, autostash);
    setBusy(false);
    onOpenChange(false);
  };
  const opts: { v: PullStrategy; title: string; hint: string }[] = [
    { v: 'merge', title: t('vcs.update.merge'), hint: t('vcs.update.mergeHint') },
    { v: 'rebase', title: t('vcs.update.rebase'), hint: t('vcs.update.rebaseHint') },
    { v: 'ff', title: t('vcs.update.ff'), hint: t('vcs.update.ffHint') },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('vcs.update.title')}</DialogTitle>
          <DialogDescription className="text-xs">
            {upstream ? t('vcs.update.desc', { branch, upstream }) : t('vcs.update.noUpstream', { branch })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5" role="radiogroup">
          {opts.map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={strategy === o.v}
              onClick={() => setStrategy(o.v)}
              className={cn(
                'w-full flex items-start gap-2 rounded-md border px-3 py-2 text-left',
                strategy === o.v ? 'border-primary bg-primary/5' : 'hover:bg-accent/40',
              )}
            >
              <span className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border', strategy === o.v && 'border-[4px] border-primary')} />
              <span className="min-w-0">
                <span className="block text-xs font-medium">{o.title}</span>
                <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <label className={cn('flex items-center gap-2 text-xs', strategy === 'ff' && 'opacity-50')}>
          <Switch checked={autostash && strategy !== 'ff'} disabled={strategy === 'ff'} onCheckedChange={setAutostash} />
          {t('vcs.update.autostash')}
        </label>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>{t('vcs.cancel')}</Button>
          <Button size="sm" disabled={busy || !upstream} onClick={go}>
            {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            {t('vcs.update.run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Remotes ──────────────────────────────────────────────────────────────────

export function GitRemotesDialog({ repoId, open, onOpenChange, onChanged }: {
  repoId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation('git');
  const [list, setList] = useState<GitRemote[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<string | null>(null); // remote name or '+' for new
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await gitAPI.remotes(repoId);
      setList((res.data as GitRemote[]) ?? []);
      setErr('');
    } catch (e) {
      setErr(extractErr(e, t('vcs.failed')));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { if (open) { setEditing(null); void load(); } }, [open, repoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (r?: GitRemote) => {
    setEditing(r ? r.name : '+');
    setName(r?.name ?? '');
    setUrl(r?.fetchUrl ?? '');
  };
  const save = async () => {
    setErr('');
    try {
      if (editing === '+') await gitAPI.addRemote(repoId, { name: name.trim(), url: url.trim() });
      else if (editing) {
        const cur = list.find((r) => r.name === editing);
        await gitAPI.updateRemote(repoId, {
          name: editing,
          url: url.trim() !== cur?.fetchUrl ? url.trim() : undefined,
          newName: name.trim() !== editing ? name.trim() : undefined,
        });
      }
      setEditing(null);
      await load();
      onChanged();
    } catch (e) {
      setErr(extractErr(e, t('vcs.failed')));
    }
  };
  const remove = async (r: GitRemote) => {
    const ok = await confirmDialog({ title: t('vcs.remotes.removeTitle', { name: r.name }), description: t('vcs.remotes.removeBody'), destructive: true });
    if (!ok) return;
    try {
      await gitAPI.deleteRemote(repoId, { name: r.name });
      await load();
      onChanged();
    } catch (e) {
      setErr(extractErr(e, t('vcs.failed')));
    }
  };

  const editor = (
    <div className="flex items-center gap-1.5 px-2 py-1.5">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="upstream" disabled={editing === 'origin'} className="h-7 w-28 font-mono text-xs" />
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://host/group/project.git" className="h-7 flex-1 font-mono text-xs" />
      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('vcs.save')} disabled={!name.trim() || !url.trim()} onClick={save}><Check className="h-3.5 w-3.5" /></Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('vcs.cancel')} onClick={() => setEditing(null)}><X className="h-3.5 w-3.5" /></Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('vcs.remotes.title')}</DialogTitle>
          <DialogDescription className="text-xs">{t('vcs.remotes.hint')}</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border divide-y">
          {loading && list.length === 0 && <div className="p-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /></div>}
          {list.map((r) => editing === r.name ? <div key={r.name}>{editor}</div> : (
            <div key={r.name} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <span className="w-24 shrink-0 font-medium">{r.name}</span>
              <span className="flex-1 min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={r.fetchUrl}>{r.fetchUrl}</span>
              {r.authenticated && (
                <span title={t('vcs.remotes.authenticated')}><Lock className="h-3 w-3 text-emerald-600" /></span>
              )}
              <button type="button" aria-label={t('vcs.remotes.edit')} className="rounded p-1 hover:bg-accent" onClick={() => startEdit(r)}><Pencil className="h-3 w-3" /></button>
              {r.name !== 'origin' && (
                <button type="button" aria-label={t('vcs.remotes.remove')} className="rounded p-1 hover:bg-accent" onClick={() => remove(r)}><Trash2 className="h-3 w-3" /></button>
              )}
            </div>
          ))}
          {editing === '+' && editor}
        </div>
        {err && <p className="break-all text-xs text-destructive">{err}</p>}
        <DialogFooter className="sm:justify-between">
          <Button size="sm" variant="outline" disabled={editing !== null} onClick={() => startEdit()}>
            <Plus className="mr-1 h-3.5 w-3.5" /> {t('vcs.remotes.add')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>{t('vcs.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
