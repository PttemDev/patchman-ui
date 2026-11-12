import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { useRequestStore } from '@/stores/requestStore';
import { useThemeStore } from '@/stores/themeStore';
import { Button } from '@/components/ui/button';
import { ScriptGuide } from './ScriptGuide';
import type { Tab } from '@/types';

interface PreRequestScriptProps {
  tab: Tab;
}

export function PreRequestScript({ tab }: PreRequestScriptProps) {
  const { t } = useTranslation('request');
  const { updateTab } = useRequestStore();
  const { theme } = useThemeStore();
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div className="flex items-center justify-between shrink-0 gap-2">
        <p className="text-xs text-muted-foreground">
          <Trans
            t={t}
            i18nKey="scripts.preRequest.description"
            components={{ code: <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]" /> }}
          />
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs shrink-0"
          onClick={() => setGuideOpen(true)}
        >
          <BookOpen className="h-3 w-3 mr-1" />
          {t('actions.guide')}
        </Button>
      </div>
      <div className="border rounded-md overflow-hidden flex-1 min-h-0 pb-2">
        <CodeEditor
          height="100%"
          language="javascript"
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          value={tab.preRequestScript}
          onChange={(value) =>
            updateTab(tab.id, { preRequestScript: value || '' })
          }
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            automaticLayout: true,
            padding: { top: 8 },
          }}
        />
      </div>
      <ScriptGuide open={guideOpen} onOpenChange={setGuideOpen} initialTab="pre-request" />
    </div>
  );
}
