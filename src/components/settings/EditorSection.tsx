// Settings → Editor: code-editor behaviour for the Git workspace editor.
// Auto save mode (per device, stores/editorPrefsStore.ts).

import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEditorPrefsStore, type AutoSaveMode } from '@/stores/editorPrefsStore';

const MODES: AutoSaveMode[] = ['onFocusChange', 'afterDelay', 'off'];

export function EditorSection() {
  const { t } = useTranslation('settings');
  const { autoSave, setAutoSave } = useEditorPrefsStore();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('editor.heading')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('editor.description')}</p>
      </div>
      <div>
        <div className="mb-1.5 text-sm font-medium">{t('editor.autoSave')}</div>
        <div className="max-w-xl space-y-1.5" role="radiogroup" aria-label={t('editor.autoSave')}>
          {MODES.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={autoSave === m} onClick={() => setAutoSave(m)}
              className={cn('flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                autoSave === m ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/40 hover:bg-accent/40')}>
              <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', autoSave === m && 'border-primary bg-primary text-primary-foreground')}>
                {autoSave === m && <Check className="h-3 w-3" />}
              </span>
              <span>
                <span className="block text-sm font-medium">{t(`editor.mode.${m}.title`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`editor.mode.${m}.hint`)}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{t('editor.guardNote')}</p>
      </div>
    </div>
  );
}
