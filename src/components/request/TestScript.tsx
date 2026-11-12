import { useState } from 'react';
import { BookOpen, Wand2 } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { useRequestStore } from '@/stores/requestStore';
import { useThemeStore } from '@/stores/themeStore';
import { Button } from '@/components/ui/button';
import { ScriptGuide } from './ScriptGuide';
import { ExtractToEnvDialog } from './ExtractToEnvDialog';
import type { Tab } from '@/types';

interface TestScriptProps {
  tab: Tab;
}

export function TestScript({ tab }: TestScriptProps) {
  const { t } = useTranslation('request');
  const { updateTab } = useRequestStore();
  const { theme } = useThemeStore();
  const [guideOpen, setGuideOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);

  function insertSnippet(snippet: string) {
    const current = tab.testScript || '';
    const next = current.trim() ? `${current.replace(/\s*$/, '')}\n\n${snippet}` : snippet;
    updateTab(tab.id, { testScript: next });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div className="flex items-center justify-between shrink-0 gap-2">
        <p className="text-xs text-muted-foreground">
          <Trans
            t={t}
            i18nKey="scripts.tests.description"
            components={{ code: <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]" /> }}
          />
        </p>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setExtractOpen(true)}
            disabled={!tab.response?.body}
            title={tab.response?.body ? t('scripts.extractTitleReady') : t('scripts.extractTitleSendFirst')}
          >
            <Wand2 className="h-3 w-3 mr-1" />
            {t('actions.extractToEnv')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setGuideOpen(true)}
          >
            <BookOpen className="h-3 w-3 mr-1" />
            {t('actions.guide')}
          </Button>
        </div>
      </div>
      <div className="border rounded-md overflow-hidden flex-1 min-h-0 pb-2">
        <CodeEditor
          height="100%"
          language="javascript"
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          value={tab.testScript}
          onChange={(value) =>
            updateTab(tab.id, { testScript: value || '' })
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
      <ScriptGuide open={guideOpen} onOpenChange={setGuideOpen} initialTab="tests" />
      <ExtractToEnvDialog
        open={extractOpen}
        onOpenChange={setExtractOpen}
        responseBody={tab.response?.body}
        onInsert={insertSnippet}
      />
    </div>
  );
}
