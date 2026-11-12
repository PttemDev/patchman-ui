// The lazy chunk boundary for Monaco. Importing monacoBootstrap first (a
// side-effect module) wires the bundled monaco + workers + custom languages
// before <Editor> mounts; re-exporting the @monaco-editor/react components from
// the SAME chunk keeps the whole Monaco graph out of the eager entry bundle.
// Loaded only via React.lazy in CodeEditor — never import this directly.
import '@/lib/monacoBootstrap';
export { default as Editor, DiffEditor } from '@monaco-editor/react';
