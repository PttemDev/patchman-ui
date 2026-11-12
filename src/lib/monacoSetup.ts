// Point @monaco-editor/react at the BUNDLED monaco-editor instead of the
// jsdelivr CDN it loads from by default, and wire Monaco's web workers through
// Vite so they're served same-origin.
//
// Without this the app fetches Monaco (and its workers) from the network on
// first use of any editor — which (a) breaks completely offline, the whole
// point of the desktop build, and (b) surfaces cross-origin "Script error." /
// "Canceled" crashes from the CDN worker in the error dialog. Importing this
// module once at startup (before any <Editor> mounts) fixes both.
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import yamlWorker from 'monaco-yaml/yaml.worker?worker';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      case 'yaml':
        return new yamlWorker();
      default:
        return new editorWorker();
    }
  },
};

// Tell @monaco-editor/react to use the local instance rather than the CDN.
loader.config({ monaco });
