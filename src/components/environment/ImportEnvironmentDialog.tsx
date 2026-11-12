// Unified environment import. Single surface for paste + file +
// (later) URL — format auto-detected from the JSON shape:
//
//   PatchMan       → top-level "variables" array of { key, value, ... }
//   Postman env    → top-level "values" array (or "_postman_variable_scope")
//
// Mirrors the collection import dialog's tabless flow. Import button
// stays disabled until we have non-empty content; format detection
// surfaces inline so the user knows what we're about to send.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, FileText, FileJson, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { environmentsAPI } from '@/services/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import type { AxiosError } from 'axios';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type DetectedFormat = 'patchman' | 'postman' | 'unknown';

function detectFormat(text: string): DetectedFormat {
  const t = text.trim();
  if (!t) return 'unknown';
  try {
    const parsed = JSON.parse(t);
    if (parsed && typeof parsed === 'object') {
      // Postman environments carry their values under "values" with
      // {key, value, type} objects. They also stamp
      // _postman_variable_scope === "environment" at the root, but a
      // simple "values is an array of {key,value}" check covers
      // hand-edited and older exports too.
      if (Array.isArray(parsed.values)) return 'postman';
      if (parsed._postman_variable_scope === 'environment') return 'postman';
      // PatchMan env JSON has "variables" as the array of
      // {key, value, enabled, secret}.
      if (Array.isArray(parsed.variables)) return 'patchman';
    }
  } catch {
    return 'unknown';
  }
  return 'unknown';
}

export function ImportEnvironmentDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('environment');
  const { fetchEnvironments } = useEnvironmentStore();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const detected = useMemo(() => detectFormat(text), [text]);

  const reset = () => {
    setText('');
    setError('');
  };

  const handleImport = async () => {
    if (!text.trim()) {
      setError(t('importDialog.pasteOrLoad'));
      return;
    }
    if (detected === 'unknown') {
      setError(t('importDialog.couldNotDetect'));
      return;
    }

    setLoading(true);
    setError('');
    const tt = toast({ title: t('importDialog.importing') });
    try {
      const parsed = JSON.parse(text.trim());
      const res = await environmentsAPI.import(parsed);
      const data = (res.data as { data?: { name?: string }; name?: string }) || {};
      const name = data.data?.name ?? data.name ?? t('importDialog.importedFallback');
      await fetchEnvironments();
      reset();
      onOpenChange(false);
      tt.update({
        id: tt.id,
        title: t('importDialog.imported'),
        description: t('importDialog.importedDesc', { name, format: detected === 'postman' ? 'Postman' : 'PatchMan' }),
      });
    } catch (err) {
      let msg = t('importDialog.failed');
      if (err instanceof SyntaxError) msg = t('importDialog.invalidJson');
      else {
        const ax = err as AxiosError<{ error?: string }>;
        msg = ax.response?.data?.error || ax.message || t('importDialog.failed');
      }
      setError(msg);
      tt.update({ id: tt.id, title: t('importDialog.failed'), description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const v = ev.target?.result;
      if (typeof v === 'string') {
        setText(v);
        setError('');
      }
    };
    reader.readAsText(file);
    // Allow re-uploading the same file (the input remembers the
    // previous value otherwise).
    e.target.value = '';
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(n) => {
        if (loading) return;
        if (!n) reset();
        onOpenChange(n);
      }}
    >
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t('importDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('importDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <FileText className="h-3.5 w-3.5 mr-1" />
                {t('importDialog.loadFromFile')}
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </label>
            </Button>
            <FormatBadge format={detected} hasText={!!text.trim()} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="env-import-json" className="text-xs">
              {t('importDialog.jsonLabel')}
            </Label>
            <Textarea
              id="env-import-json"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (error) setError('');
              }}
              placeholder={t('importDialog.placeholder')}
              rows={11}
              className="font-mono text-xs"
            />
          </div>

          {error && (
            <div className="text-xs text-destructive flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('common:cancel')}
          </Button>
          <Button
            onClick={handleImport}
            disabled={loading || !text.trim() || detected === 'unknown'}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t('importDialog.import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormatBadge({ format, hasText }: { format: DetectedFormat; hasText: boolean }) {
  const { t } = useTranslation('environment');
  if (!hasText) {
    return (
      <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
        <FileJson className="h-3 w-3" />
        {t('importDialog.autoDetectOnPaste')}
      </span>
    );
  }
  if (format === 'unknown') {
    return (
      <span className="text-[11px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1">
        <AlertCircle className="h-3 w-3" />
        {t('importDialog.formatUnrecognised')}
      </span>
    );
  }
  return (
    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
      <CheckCircle2 className="h-3 w-3" />
      {format === 'postman' ? t('importDialog.detectedPostman') : t('importDialog.detectedPatchman')}
    </span>
  );
}
