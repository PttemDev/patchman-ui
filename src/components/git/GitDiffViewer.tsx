import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeDiffEditor } from '@/components/ui/CodeEditor';
import { Columns2, Rows2 } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import { Button } from '@/components/ui/button';
import { languageForPath } from './util';

interface GitDiffViewerProps {
  /** Base-ref content (left / removed side). Empty for an added file. */
  original: string;
  /** New content (right / added side). Empty for a deleted file. */
  modified: string;
  /** File path — used to infer the Monaco language when none is given. */
  path?: string;
  language?: string;
}

// GitDiffViewer is the reusable Monaco DiffEditor for the Git tab: original =
// base-ref content, modified = the new content. Read-only, with an
// inline/side-by-side toggle and hideUnchangedRegions so large files collapse
// to just the changed spans. Teardown races (Monaco disposing its models on
// unmount) surface as benign "TextModel got disposed" errors that the App.tsx
// global listener already swallows app-wide — so no local error boundary is
// needed here beyond letting the library own disposal.
export function GitDiffViewer({ original, modified, path, language }: GitDiffViewerProps) {
  const { t } = useTranslation('git');
  const { theme } = useThemeStore();
  const [sideBySide, setSideBySide] = useState(true);
  const lang = language ?? languageForPath(path);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 px-2 py-1 border-b shrink-0 bg-muted/20">
        <span className="text-[11px] font-mono text-muted-foreground truncate min-w-0" title={path}>
          {path ?? ''}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 text-[11px] shrink-0"
          onClick={() => setSideBySide((v) => !v)}
          title={sideBySide ? t('diffViewer.switchInline') : t('diffViewer.switchSideBySide')}
        >
          {sideBySide ? <Rows2 className="h-3 w-3" /> : <Columns2 className="h-3 w-3" />}
          {sideBySide ? t('diffViewer.inline') : t('diffViewer.sideBySide')}
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <CodeDiffEditor
          height="100%"
          language={lang}
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          original={original}
          modified={modified}
          options={{
            readOnly: true,
            originalEditable: false,
            renderSideBySide: sideBySide,
            hideUnchangedRegions: { enabled: true },
            minimap: { enabled: false },
            fontSize: 12,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: 'off',
            padding: { top: 8 },
          }}
        />
      </div>
    </div>
  );
}
