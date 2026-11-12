import type { Monaco } from '@monaco-editor/react';
import { registerRedisLang } from './redis';
import { registerEsCompletion } from './es';
import { registerYamlK8sSchemas } from './yaml';

// registerLangKit installs every custom Monaco language the app ships that
// isn't a Monaco built-in — the 'redis' command language (Monarch highlighting
// + completion + hover + signature help + arity diagnostics) and the
// Elasticsearch console's Kibana-grammar completion (endpoint catalog + live
// index names + mapping-driven field paths, scoped per model URI). Call once at
// startup, AFTER monacoSetup has pointed @monaco-editor/react at the bundled
// monaco instance (see main.tsx ordering contract). Idempotent.
export function registerLangKit(monaco: Monaco): void {
  registerRedisLang(monaco);
  registerEsCompletion(monaco);
  registerYamlK8sSchemas(monaco);
}
