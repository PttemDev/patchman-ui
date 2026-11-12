import type { Monaco } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';
import i18n from '@/i18n';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { findVarTokens, previewValue, suggestVars, varStatus } from './envVarTokens';

// `{{var}}` completion + hover for the request BODY Monaco editors. Monaco
// providers are global per language, so they're registered once and then act
// only on models a body editor opted in via enableEnvVars() — other JSON/XML
// editors in the app (Kafka messages, Redis values, the response viewer) don't
// substitute env vars, and suggesting them there would be a lie.
//
// The env is read at provide time (never captured), so switching environments
// or editing a value is reflected immediately.

const BODY_LANGUAGES = ['json', 'xml', 'plaintext', 'graphql'];
const enabledModels = new Set<string>();
let providersRegistered = false;

export function enableEnvVars(ed: MonacoType.editor.IStandaloneCodeEditor, monaco: Monaco) {
  registerProviders(monaco);
  let key = ed.getModel()?.uri.toString();
  if (key) enabledModels.add(key);
  ed.onDidChangeModel((e) => {
    if (key) enabledModels.delete(key);
    key = e.newModelUrl?.toString();
    if (key) enabledModels.add(key);
  });
  ed.onDidDispose(() => { if (key) enabledModels.delete(key); });
}

function fence(value: string): string {
  return '```\n' + value.replace(/```/g, '`​``') + '\n```';
}

function registerProviders(monaco: Monaco) {
  if (providersRegistered) return;
  providersRegistered = true;

  for (const lang of BODY_LANGUAGES) {
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ['{'],
      provideCompletionItems(model: MonacoType.editor.ITextModel, position: MonacoType.Position) {
        if (!enabledModels.has(model.uri.toString())) return { suggestions: [] };
        const line = model.getLineContent(position.lineNumber);
        const m = line.slice(0, position.column - 1).match(/\{\{(\w*)$/);
        if (!m) return { suggestions: [] };
        const after = line.slice(position.column - 1);
        const tail = after.match(/^\w*/)![0];
        // Replace the rest of a partial name and an existing `}}` (Monaco may
        // have auto-closed the braces) so the result is exactly `{{name}}`.
        const closed = after.startsWith('}}', tail.length);
        const range = new monaco.Range(
          position.lineNumber,
          position.column - m[1].length,
          position.lineNumber,
          position.column + tail.length + (closed ? 2 : 0),
        );
        const env = useEnvironmentStore.getState().activeEnvironment;
        return {
          suggestions: suggestVars(env, '').map((v, i) => ({
            label: v.key,
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: previewValue(v),
            documentation: env?.name,
            insertText: `${v.key}}}`,
            filterText: v.key,
            sortText: String(i).padStart(4, '0'),
            range,
          })),
        };
      },
    });

    monaco.languages.registerHoverProvider(lang, {
      provideHover(model: MonacoType.editor.ITextModel, position: MonacoType.Position) {
        if (!enabledModels.has(model.uri.toString())) return null;
        const col = position.column - 1;
        const tk = findVarTokens(model.getLineContent(position.lineNumber)).find((t) => col >= t.start && col < t.end);
        if (!tk) return null;
        const env = useEnvironmentStore.getState().activeEnvironment;
        const { status, variable } = varStatus(env, tk.name);
        const t = i18n.getFixedT(null, 'environment');
        const body =
          status === 'resolved' ? fence(previewValue(variable!))
          : status === 'disabled' ? t('varPopover.disabled', { env: env?.name })
          : status === 'missing' ? t('varPopover.missing', { env: env?.name })
          : t('varPopover.noEnv');
        return {
          range: new monaco.Range(position.lineNumber, tk.start + 1, position.lineNumber, tk.end + 1),
          contents: [{ value: `**\`{{${tk.name}}}\`**${env ? ` · ${env.name}` : ''}` }, { value: body }],
        };
      },
    });
  }
}
