import { useRef, useCallback } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useRequestStore } from '@/stores/requestStore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Tab, RequestBody, FormField } from '@/types';
import {type Monaco} from '@monaco-editor/react';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { VariableInput } from '@/components/environment/VariableInput';
import { enableEnvVars } from '@/lib/monacoEnvVars';
import type { editor } from 'monaco-editor';
import { useThemeStore } from '@/stores/themeStore';
import { cn } from '@/lib/utils';

const bodyTypes: { value: RequestBody['type']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'form', label: 'Form' },
  { value: 'xml', label: 'XML' },
  { value: 'soap', label: 'SOAP' },
  { value: 'raw', label: 'Raw' },
  { value: 'graphql', label: 'GraphQL' },
];

function getLanguage(type: RequestBody['type']) {
  switch (type) {
    case 'json': return 'json';
    case 'xml': return 'xml';
    case 'soap': return 'xml';
    case 'graphql': return 'graphql';
    default: return 'plaintext';
  }
}

function soapSkeleton(version: '1.1' | '1.2'): string {
  const ns = version === '1.2'
    ? 'http://www.w3.org/2003/05/soap-envelope'
    : 'http://schemas.xmlsoap.org/soap/envelope/';
  return `<soapenv:Envelope xmlns:soapenv="${ns}">
  <soapenv:Header/>
  <soapenv:Body>

  </soapenv:Body>
</soapenv:Envelope>`;
}

interface BodyEditorProps {
  tab: Tab;
}

export function BodyEditor({ tab }: BodyEditorProps) {
  const { t } = useTranslation('request');
  const { updateTab } = useRequestStore();
  const { theme } = useThemeStore();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // JSON/XML/SOAP/GraphQL are protocol tokens kept in English; only the
  // generic type names (None/Form/Raw) are translated.
  const bodyTypeLabel = (bt: (typeof bodyTypes)[number]) => {
    switch (bt.value) {
      case 'none': return t('body.typeNone');
      case 'form': return t('body.typeForm');
      case 'raw': return t('body.typeRaw');
      default: return bt.label;
    }
  };

  const handleTypeChange = (type: string) => {
    updateTab(tab.id, {
      body: { ...tab.body, type: type as RequestBody['type'] },
    });
  };

  const handleContentChange = (value: string | undefined) => {
    updateTab(tab.id, {
      body: { ...tab.body, content: value || '' },
    });
  };

  // Every body editor opts into {{var}} completion + hover; the ref is only
  // read by JSON Beautify, and only the active body tab's editor is mounted.
  const handleEditorMount = useCallback((editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    enableEnvVars(editor, monaco);
    editorRef.current = editor;
  }, []);

  const handleBeautify = useCallback(() => {
    if (tab.body.type !== 'json') return;
    try {
      const parsed = JSON.parse(tab.body.content);
      const formatted = JSON.stringify(parsed, null, 2);
      handleContentChange(formatted);
    } catch {
      // Invalid JSON — trigger format action from Monaco as fallback
      editorRef.current?.getAction('editor.action.formatDocument')?.run();
    }
  }, [tab.body.type, tab.body.content]);

  // SOAP mode helpers — version/action live on the body blob; the send path
  // derives Content-Type + SOAPAction placement from them.
  const soapVersion = tab.body.soapVersion || '1.1';
  const soapAction = tab.body.soapAction || '';
  const setSoapVersion = (v: '1.1' | '1.2') =>
    updateTab(tab.id, { body: { ...tab.body, soapVersion: v } });
  const setSoapAction = (a: string) =>
    updateTab(tab.id, { body: { ...tab.body, soapAction: a } });
  const insertSoapSkeleton = () =>
    updateTab(tab.id, { body: { ...tab.body, content: soapSkeleton(soapVersion) } });

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      <Tabs value={tab.body.type} onValueChange={handleTypeChange} className="flex flex-col flex-1 min-h-0">
        <TabsList className="h-8 shrink-0 self-start">
          {bodyTypes.map((bt) => (
            <TabsTrigger key={bt.value} value={bt.value} className="text-xs h-6 px-3">
              {bodyTypeLabel(bt)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="none">
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            {t('body.noBody')}
          </div>
        </TabsContent>

        {['json', 'xml', 'raw', 'graphql'].map((type) => (
          <TabsContent key={type} value={type} className="mt-2 flex-1 flex flex-col min-h-0">
            <div className="relative border rounded-md overflow-hidden flex-1 min-h-0 pb-2">
              {type === 'json' && (
                <button
                  type="button"
                  onClick={handleBeautify}
                  className="absolute top-2 right-2 z-10 px-2 py-1 text-xs rounded-md bg-secondary hover:bg-accent border text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title={t('body.beautifyTitle')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block mr-1 -mt-0.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                  {t('body.beautify')}
                </button>
              )}
              <CodeEditor
                height="100%"
                language={getLanguage(type as RequestBody['type'])}
                theme={theme === 'dark' ? 'vs-dark' : 'light'}
                value={tab.body.content}
                onChange={handleContentChange}
                onMount={handleEditorMount}
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
          </TabsContent>
        ))}

        <TabsContent value="soap" className="mt-2 flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 mb-2 shrink-0 flex-wrap">
            <span className="text-xs text-muted-foreground">SOAP</span>
            <div className="flex rounded-md border overflow-hidden text-xs">
              {(['1.1', '1.2'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSoapVersion(v)}
                  className={cn(
                    'px-2.5 py-1 transition-colors',
                    soapVersion === v ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <input
              value={soapAction}
              onChange={(e) => setSoapAction(e.target.value)}
              placeholder={t('body.soapActionPlaceholder')}
              spellCheck={false}
              className="h-7 px-2 text-xs font-mono rounded-md border bg-transparent outline-none focus:ring-1 focus:ring-ring flex-1 min-w-[160px]"
            />
            <button
              type="button"
              onClick={insertSoapSkeleton}
              className="h-7 px-2.5 text-xs rounded-md border bg-secondary hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title={t('body.insertEnvelopeTitle')}
            >
              {t('body.insertEnvelope')}
            </button>
          </div>
          <div className="relative border rounded-md overflow-hidden flex-1 min-h-0 pb-2">
            <CodeEditor
              height="100%"
              language="xml"
              theme={theme === 'dark' ? 'vs-dark' : 'light'}
              value={tab.body.content}
              onChange={handleContentChange}
              onMount={handleEditorMount}
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
          <p className="text-[10px] text-muted-foreground mt-1 shrink-0">
            <Trans
              t={t}
              i18nKey="body.soapFootnote"
              components={{ mono: <span className="font-mono" /> }}
            />
          </p>
        </TabsContent>

        <TabsContent value="form" className="mt-2 flex-1 overflow-auto">
          <FormDataEditor tab={tab} />
        </TabsContent>

        <TabsContent value="binary" className="mt-2">
          <div className="flex items-center justify-center h-32 border rounded-md text-sm text-muted-foreground">
            {t('body.binaryUnsupported')}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function parseFormFields(content: string): FormField[] {
  const empty: FormField = { key: '', value: '', type: 'text', enabled: true };
  if (!content) return [empty];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // Legacy URL-encoded format migration
    try {
      const pairs = content.split('&').map((pair) => {
        const [key, ...valueParts] = pair.split('=');
        return {
          key: decodeURIComponent(key || ''),
          value: decodeURIComponent(valueParts.join('=') || ''),
          type: 'text' as const,
          enabled: true,
        };
      });
      if (pairs.length > 0 && pairs.some((p) => p.key)) return pairs;
    } catch {
      // ignore
    }
  }
  return [empty];
}

function serializeFormFields(fields: FormField[]): string {
  return JSON.stringify(fields);
}

function FormDataEditor({ tab }: { tab: Tab }) {
  const { t } = useTranslation('request');
  const { updateTab } = useRequestStore();
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const fields = parseFormFields(tab.body.content);

  const updateFields = (newFields: FormField[]) => {
    updateTab(tab.id, {
      body: { ...tab.body, content: serializeFormFields(newFields) },
    });
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };
    updateFields(newFields);
  };

  const addField = () => {
    updateFields([...fields, { key: '', value: '', type: 'text', enabled: true }]);
  };

  const removeField = (index: number) => {
    const newFields = fields.filter((_, i) => i !== index);
    updateFields(newFields.length > 0 ? newFields : [{ key: '', value: '', type: 'text', enabled: true }]);
  };

  const handleTypeChange = (index: number, newType: 'text' | 'file') => {
    updateField(index, { type: newType, value: '', fileName: undefined, fileType: undefined });
  };

  const handleFileSelect = (index: number, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1];
      updateField(index, {
        value: base64,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
      });
    };
    reader.readAsDataURL(file);
  };

  // A file field always forces multipart; otherwise honor the stored choice,
  // defaulting to url-encoded (the legacy behavior when unset).
  const hasFile = fields.some((f) => f.type === 'file' && f.enabled);
  const encoding: 'multipart' | 'urlencoded' = hasFile
    ? 'multipart'
    : tab.body.formEncoding ?? 'urlencoded';
  const setEncoding = (enc: 'multipart' | 'urlencoded') => {
    updateTab(tab.id, { body: { ...tab.body, formEncoding: enc } });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <span className="text-xs font-medium text-muted-foreground">{t('body.form.encoding')}</span>
        <div className="inline-flex rounded-md border p-0.5">
          {(['multipart', 'urlencoded'] as const).map((enc) => (
            <button
              key={enc}
              type="button"
              disabled={hasFile && enc === 'urlencoded'}
              onClick={() => setEncoding(enc)}
              className={cn(
                'px-2 py-0.5 text-xs rounded transition-colors',
                encoding === enc ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                hasFile && enc === 'urlencoded' && 'opacity-40 cursor-not-allowed hover:bg-transparent',
              )}
            >
              {enc === 'multipart' ? t('body.form.multipart') : t('body.form.urlencoded')}
            </button>
          ))}
        </div>
        {hasFile && (
          <span className="text-[10px] text-muted-foreground">{t('body.form.encodingLockedHint')}</span>
        )}
      </div>
      <div className="grid grid-cols-[80px_1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground px-1">
        <span>{t('common:type')}</span>
        <span>{t('kv.key')}</span>
        <span>{t('kv.value')}</span>
        <span className="w-8"></span>
      </div>
      {fields.map((field, index) => (
        <div key={index} className="grid grid-cols-[80px_1fr_1fr_auto] gap-2 items-center">
          <Select value={field.type} onValueChange={(v) => handleTypeChange(index, v as 'text' | 'file')}>
            <SelectTrigger className="h-8 w-[80px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">{t('body.form.text')}</SelectItem>
              <SelectItem value="file">{t('body.form.file')}</SelectItem>
            </SelectContent>
          </Select>
          <VariableInput
            bare
            className="h-8 px-3 text-xs font-mono rounded-md border bg-transparent outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('kv.key')}
            value={field.key}
            onChange={(e) => updateField(index, { key: e.target.value })}
          />
          {field.type === 'file' ? (
            <div className="flex items-center gap-1 min-w-0">
              <input
                ref={(el) => { fileInputRefs.current[index] = el; }}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(index, file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="h-8 px-3 text-xs rounded-md border bg-transparent hover:bg-accent transition-colors cursor-pointer flex items-center gap-2 min-w-0 text-left flex-1"
                onClick={() => fileInputRefs.current[index]?.click()}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                <span className="truncate">
                  {field.fileName ? field.fileName : <span className="text-muted-foreground">{t('body.form.chooseFile')}</span>}
                </span>
              </button>
              {field.fileName && (
                <button
                  type="button"
                  className="h-8 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer shrink-0"
                  onClick={() => updateField(index, { value: '', fileName: undefined, fileType: undefined })}
                  title={t('body.form.clearFileTitle')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              )}
            </div>
          ) : (
            <VariableInput
              bare
              className="h-8 px-3 text-xs font-mono rounded-md border bg-transparent outline-none focus:ring-1 focus:ring-ring"
              placeholder={t('kv.value')}
              value={field.value}
              onChange={(e) => updateField(index, { value: e.target.value })}
            />
          )}
          <button
            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground cursor-pointer"
            onClick={() => removeField(index)}
          >
            &times;
          </button>
        </div>
      ))}
      <button
        className="w-full h-8 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-accent transition-colors cursor-pointer"
        onClick={addField}
      >
        + {t('body.form.addField')}
      </button>
    </div>
  );
}
