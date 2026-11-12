// monacoBootstrap is the ONE module that statically pulls in the Monaco editor
// library. Everything that renders an editor imports it only through the lazy
// `CodeEditor` wrapper, whose impl chunk imports THIS module — so Monaco
// (~10MB) lands in an async chunk instead of the eager entry bundle. Importing
// this module has two side effects, both of which must run before the first
// <Editor> mounts (guaranteed structurally: the wrapper's impl chunk evaluates
// this before it renders Editor):
//   1. monacoSetup wires @monaco-editor/react to the BUNDLED monaco + same-origin
//      workers (offline-safe; no jsdelivr CDN).
//   2. registerLangKit installs the custom languages (redis, ES console, K8s YAML).
import './monacoSetup';
import * as monaco from 'monaco-editor';
import { registerLangKit } from './monacoLangKit';

// Runs once — ESM evaluates a module body a single time, so this is idempotent.
registerLangKit(monaco);
