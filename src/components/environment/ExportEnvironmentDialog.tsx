// Multi-env, multi-format export with explicit secrets policy.
//
// One env + dotenv → text/plain ".env" download
// Multi env + dotenv → application/zip with one .env per environment
// patchman / postman → JSON download (single object for one env, array
//                      under {environments:[…]} for multi)
//
// Secrets default to redacted ("***"). The user has to opt in with a
// confirmation toggle to export real values; the toggle is paired
// with a one-line warning so it's obvious what's about to leave the
// system.

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Download, KeyRound, Check, FileJson, FileText, Files } from 'lucide-react';
import { environmentsAPI } from '@/services/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/components/ui/use-toast';
import type { Environment } from '@/types';
import type { AxiosError } from 'axios';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Pre-selected ids (e.g. the env open in the editor). The dialog
  // shows the full list and lets the user pick more.
  initialIds?: string[];
  environments: Environment[];
}

type Format = 'patchman' | 'postman' | 'dotenv';

export function ExportEnvironmentDialog({ open, onOpenChange, initialIds, environments }: Props) {
  const { t } = useTranslation('environment');
  const [format, setFormat] = useState<Format>('patchman');
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(initialIds ?? []));
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Re-seed selection whenever the dialog opens. Closing-and-reopening
  // resets to the caller's initial set rather than persisting stale
  // checkboxes from a previous export.
  useMemo(() => {
    if (open) setSelectedIds(new Set(initialIds ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return environments;
    return environments.filter((e) => e.name.toLowerCase().includes(q));
  }, [environments, search]);

  const totalSelected = selectedIds.size;
  const selectedSecretCount = useMemo(() => {
    let n = 0;
    for (const e of environments) {
      if (!selectedIds.has(e.id)) continue;
      n += e.variables?.filter((v) => v.secret).length ?? 0;
    }
    return n;
  }, [environments, selectedIds]);

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(visible.map((e) => e.id)));
  const clearAll = () => setSelectedIds(new Set());

  const handleExport = async () => {
    if (totalSelected === 0) {
      toast({ title: t('export.pickAtLeastOne'), variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    const tt = toast({ title: t('export.exporting') });
    try {
      const res = await environmentsAPI.bulkExport({
        ids: Array.from(selectedIds),
        format,
        includeSecrets,
        enabledOnly,
      });
      // BE returns either JSON (wrapped in {data:…}) or a binary
      // blob (zip / .env). The axios `responseType:'blob'` we set
      // means the browser hands us a Blob in both cases — JSON
      // bodies are still binary-encoded so we have to peek at the
      // content-type.
      const ct = (res.headers as Record<string, string>)['content-type'] || '';
      const blob = res.data as Blob;
      let downloadBlob: Blob = blob;
      let filename = '';
      if (ct.includes('application/json')) {
        // Server returned JSON {data: …}. Re-serialise to a clean
        // file so the user gets the inner payload, not the wrapper.
        const text = await blob.text();
        try {
          const parsed = JSON.parse(text);
          const inner = parsed?.data ?? parsed;
          downloadBlob = new Blob([JSON.stringify(inner, null, 2)], { type: 'application/json' });
        } catch {
          downloadBlob = new Blob([text], { type: 'application/json' });
        }
        filename =
          totalSelected === 1
            ? `${sanitize(environments.find((e) => selectedIds.has(e.id))?.name || 'environment')}.${format === 'postman' ? 'postman_environment.json' : 'json'}`
            : `patchman-environments.${format === 'postman' ? 'postman.json' : 'json'}`;
      } else if (ct.includes('application/zip')) {
        filename = 'patchman-environments.zip';
      } else if (ct.includes('text/plain') || format === 'dotenv') {
        filename = `${sanitize(environments.find((e) => selectedIds.has(e.id))?.name || 'environment')}.env`;
      } else {
        filename = 'patchman-export';
      }

      const url = URL.createObjectURL(downloadBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      tt.update({
        id: tt.id,
        title: t('export.ready'),
        description: t('export.readyDesc', {
          envs: t(totalSelected === 1 ? 'envCountOne' : 'envCountOther', { count: totalSelected }),
          format,
          secrets: includeSecrets ? t('export.withSecrets') : t('export.withoutSecrets'),
        }),
      });
      onOpenChange(false);
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      // axios with responseType:'blob' wraps server JSON errors in a
      // blob too — read it back if present.
      let msg = ax.response?.data ? '' : ax.message;
      if (ax.response?.data instanceof Blob) {
        try {
          const txt = await (ax.response.data as Blob).text();
          msg = JSON.parse(txt)?.error || txt || ax.message;
        } catch {
          msg = ax.message;
        }
      }
      tt.update({
        id: tt.id,
        title: t('export.failed'),
        description: msg || t('tryAgain'),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(n) => !submitting && onOpenChange(n)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            {t('export.title')}
          </DialogTitle>
          <DialogDescription>
            {t('export.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: selection */}
          <div className="space-y-2 min-w-0">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                {t('export.selectionCount', { selected: totalSelected, total: environments.length })}
              </Label>
              <div className="flex gap-1 text-xs">
                <button onClick={selectAll} className="text-primary hover:underline" type="button">{t('export.all')}</button>
                <span className="text-muted-foreground">·</span>
                <button onClick={clearAll} className="text-primary hover:underline" type="button">{t('export.none')}</button>
              </div>
            </div>
            <Input
              placeholder={t('export.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs"
            />
            <ScrollArea className="h-56 rounded-md border bg-muted/20 p-1">
              <div className="space-y-0.5">
                {visible.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-2 py-4 text-center">
                    {t('export.noMatch')}
                  </p>
                ) : (
                  visible.map((env) => {
                    const checked = selectedIds.has(env.id);
                    const secretN = env.variables?.filter((v) => v.secret).length ?? 0;
                    return (
                      <button
                        key={env.id}
                        type="button"
                        onClick={() => toggleId(env.id)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors ${
                          checked ? 'bg-primary/10' : 'hover:bg-accent'
                        }`}
                      >
                        <span
                          className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${
                            checked ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'
                          }`}
                        >
                          {checked && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <span className="flex-1 truncate">{env.name}</span>
                        {secretN > 0 && (
                          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5 shrink-0">
                            <KeyRound className="h-2.5 w-2.5" />
                            {secretN}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Right: format + policy */}
          <div className="space-y-4 min-w-0">
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t('export.format')}</Label>
              <div className="grid grid-cols-3 gap-1.5">
                <FormatPick label="PatchMan" sub="JSON" icon={FileJson} active={format === 'patchman'} onClick={() => setFormat('patchman')} />
                <FormatPick label="Postman" sub="env JSON" icon={FileJson} active={format === 'postman'} onClick={() => setFormat('postman')} />
                <FormatPick label=".env" sub={totalSelected > 1 ? 'zip' : t('export.plain')} icon={totalSelected > 1 ? Files : FileText} active={format === 'dotenv'} onClick={() => setFormat('dotenv')} />
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">{t('export.enabledOnly')}</Label>
                  <p className="text-xs text-muted-foreground">{t('export.enabledOnlyHint')}</p>
                </div>
                <Switch checked={enabledOnly} onCheckedChange={setEnabledOnly} />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">{t('export.includeSecrets')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {selectedSecretCount > 0
                      ? t(selectedSecretCount === 1 ? 'export.secretCountOne' : 'export.secretCountOther', { count: selectedSecretCount })
                      : t('export.noSecrets')}
                  </p>
                </div>
                <Switch
                  checked={includeSecrets}
                  onCheckedChange={setIncludeSecrets}
                  disabled={selectedSecretCount === 0}
                />
              </div>

              {includeSecrets && selectedSecretCount > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                  <KeyRound className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    {t('export.secretWarning')}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('common:cancel')}
          </Button>
          <Button onClick={handleExport} disabled={submitting || totalSelected === 0}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Download className="h-4 w-4 mr-1" />
            {t('export.exportButton')} {totalSelected > 0 ? `(${totalSelected})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FormatPickProps {
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
}

function FormatPick({ label, sub, active, onClick, icon: Icon }: FormatPickProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1 rounded-md border px-2 py-3 text-xs transition-colors ${
        active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="font-medium text-sm">{label}</span>
      <span className="text-[10px] text-muted-foreground">{sub}</span>
    </button>
  );
}

function sanitize(name: string): string {
  return (name || 'environment').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'environment';
}
