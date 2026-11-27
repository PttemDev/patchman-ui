import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkdownView } from '@/components/notes/MarkdownView';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// GitLab-style Write / Preview editor for MR comments and descriptions
// (GitLab and GitHub both render markdown). ⌘↵ / Ctrl↵ submits.
export function MarkdownEditor({ value, onChange, onSubmit, placeholder, minHeight = 64, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  minHeight?: number;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation('git');
  const [preview, setPreview] = useState(false);
  return (
    <div className="rounded-md border">
      <div className="flex gap-3 border-b px-2 pt-1 text-[11px]">
        {([false, true] as const).map((p) => (
          <button key={String(p)} type="button" onClick={() => setPreview(p)}
            className={cn('-mb-px border-b-2 pb-1', preview === p ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {p ? t('mr.md.preview') : t('mr.md.write')}
          </button>
        ))}
        <span className="ml-auto self-center text-[10px] text-muted-foreground">{t('mr.md.supported')}</span>
      </div>
      {preview ? (
        <div className="break-words p-2 text-xs" style={{ minHeight }}>
          {value.trim() ? <MarkdownView markdown={value} className="md-compact" /> : <span className="text-muted-foreground">{t('mr.md.nothing')}</span>}
        </div>
      ) : (
        <Textarea autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          onKeyDown={(e) => { if (onSubmit && (e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
          className="rounded-none border-0 text-xs shadow-none focus-visible:ring-0" style={{ minHeight }} />
      )}
    </div>
  );
}
