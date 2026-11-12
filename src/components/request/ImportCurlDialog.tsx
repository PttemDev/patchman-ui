import { useMemo, useState } from 'react';
import { Terminal, X } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { parseCurl } from '@/lib/parseCurl';
import { parsedCurlToTab } from '@/lib/curlToTab';
import { useRequestStore } from '@/stores/requestStore';
import { useToast } from '@/components/ui/use-toast';

export function ImportCurlDialog() {
  const { t } = useTranslation('request');
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Preserve file refs OFF by default — the typical pasted cURL points at
  // a file path on the source machine, not the importing one. With the
  // toggle off, file fields land with key + type=file but no fileName,
  // forcing a fresh attach before send. Toggle on only when the user
  // happens to have the same file locally.
  const [preserveFileRefs, setPreserveFileRefs] = useState(false);
  const addTab = useRequestStore((s) => s.addTab);
  const { toast } = useToast();

  // Live-parse the textarea content so the preview reflects what would be
  // imported on every keystroke. Cheap — parser is pure-JS string work
  // and inputs are short enough that we don't need debouncing.
  const parsed = useMemo(() => (value.trim() ? parseCurl(value) : null), [value]);
  const fileFieldCount = parsed?.formFields?.filter((f) => f.type === 'file').length ?? 0;

  const handleImport = () => {
    if (!parsed) {
      setError(t('curl.parseError'));
      return;
    }
    const { patch, name } = parsedCurlToTab(parsed, { preserveFileRefs });
    addTab({ ...patch, name }, true);
    toast({ title: t('curl.importedTitle'), description: `${parsed.method} ${patch.url ?? ''}` });
    setValue('');
    setError(null);
    setOpen(false);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setValue('');
      setError(null);
    }
  };

  return (
    <>
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 shrink-0 text-xs"
              onClick={() => setOpen(true)}
            >
              <Terminal className="h-3.5 w-3.5" />
              {t('curl.importCurl')}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{t('curl.buttonTooltip')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('curl.importCurl')}</DialogTitle>
            <DialogDescription>
              {t('curl.dialogDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Textarea
              autoFocus
              placeholder="curl 'https://api.example.com/users?role=admin' -H 'Authorization: Bearer ...'"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              className="font-mono text-xs min-h-[180px]"
            />
            {error && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <X className="h-3 w-3" /> {error}
              </p>
            )}
            {fileFieldCount > 0 && (
              <label className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={preserveFileRefs}
                  onChange={(e) => setPreserveFileRefs(e.target.checked)}
                  className="mt-0.5 shrink-0"
                />
                <span className="leading-snug">
                  <Trans
                    t={t}
                    i18nKey={fileFieldCount === 1 ? 'curl.preserveFileRefsOne' : 'curl.preserveFileRefsOther'}
                    values={{ count: fileFieldCount }}
                    components={{ b: <span className="font-medium" />, m: <span className="text-muted-foreground" /> }}
                  />
                </span>
              </label>
            )}
            <ImportPreview parsed={parsed} hasInput={!!value.trim()} />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => handleOpenChange(false)}>
              {t('common:cancel')}
            </Button>
            <Button onClick={handleImport} disabled={!parsed}>
              {t('actions.import')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface PreviewProps {
  parsed: ReturnType<typeof parseCurl>;
  hasInput: boolean;
}

function ImportPreview({ parsed, hasInput }: PreviewProps) {
  const { t } = useTranslation('request');
  if (!hasInput) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {t('curl.previewEmpty')}
      </div>
    );
  }
  if (!parsed) {
    return (
      <div className="rounded-md border border-dashed border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <Trans
          t={t}
          i18nKey="curl.previewInvalid"
          components={{ c: <code className="font-mono" /> }}
        />
      </div>
    );
  }

  // Show method + URL prominently so the preview is self-contained — the
  // counts below only make sense in the context of "which request am I
  // looking at?". Strip our auto-prepended scheme from the displayed URL
  // and re-attach via the protocol field so the user sees the same shape
  // the URL bar will adopt after import.
  const pathOnly = parsed.url.replace(/^https?:\/\//, '');
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1.5 text-xs overflow-hidden">
      <div className="flex items-baseline gap-2 pb-1 border-b border-border/50 min-w-0">
        <span className="font-mono font-bold uppercase text-primary shrink-0">{parsed.method}</span>
        <span className="font-mono text-muted-foreground truncate min-w-0 flex-1" title={`${parsed.protocol}${pathOnly}`}>
          {parsed.protocol}
          {pathOnly}
        </span>
      </div>
      <PreviewRow
        label={t('subTabs.headers')}
        count={parsed.headers.length}
        sample={parsed.headers.slice(0, 3).map((h) => h.key).join(', ')}
      />
      <PreviewRow
        label={t('subTabs.params')}
        count={parsed.params.length}
        sample={parsed.params.slice(0, 3).map((p) => p.key).join(', ')}
      />
      <PreviewRow
        label={t('subTabs.body')}
        count={parsed.body ? 1 : 0}
        sample={parsed.body ? parsed.bodyType : ''}
        hideCount
      />
      <PreviewRow
        label={t('subTabs.auth')}
        count={parsed.auth ? 1 : 0}
        sample={parsed.auth?.type ?? ''}
        hideCount
      />
    </div>
  );
}

interface PreviewRowProps {
  label: string;
  count: number;
  sample: string;
  hideCount?: boolean;
}

function PreviewRow({ label, count, sample, hideCount }: PreviewRowProps) {
  const { t } = useTranslation('request');
  const isEmpty = count === 0;
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      {isEmpty ? (
        <span className="text-muted-foreground/60">{t('curl.none')}</span>
      ) : (
        <>
          {!hideCount && <span className="font-mono text-foreground shrink-0">({count})</span>}
          {sample && <span className="truncate text-muted-foreground font-mono min-w-0 flex-1">{sample}</span>}
        </>
      )}
    </div>
  );
}

