import { Suspense, useCallback } from 'react';
import type { EditorProps, DiffEditorProps } from '@monaco-editor/react';
import { Loader2 } from 'lucide-react';
import { lazyWithReload } from '@/lib/lazyWithReload';

// CodeEditor / CodeDiffEditor are drop-in replacements for @monaco-editor/react's
// <Editor> / <DiffEditor> that keep Monaco OUT of the eager bundle: the actual
// editor (and the ~10MB monaco library it pulls via monacoBootstrap) loads in a
// lazy chunk the first time an editor is shown. Props pass straight through, so
// migrating a call site is just Editor → CodeEditor.
const LazyEditor = lazyWithReload(() => import('./monacoImpl').then((m) => ({ default: m.Editor })));
const LazyDiffEditor = lazyWithReload(() => import('./monacoImpl').then((m) => ({ default: m.DiffEditor })));

function EditorFallback() {
  return (
    <div className="h-full w-full min-h-[80px] flex items-center justify-center text-muted-foreground/60">
      <Loader2 className="h-4 w-4 animate-spin" />
    </div>
  );
}

export function CodeEditor(props: EditorProps) {
  return (
    <Suspense fallback={<EditorFallback />}>
      <LazyEditor {...props} />
    </Suspense>
  );
}

// @monaco-editor/react disposes a diff editor's models BEFORE the editor on
// unmount, which Monaco ≥0.50 rejects ("TextModel got disposed before
// DiffEditorWidget model got reset" — an uncaught error on every close). Keep
// the library's hands off the models and dispose them ourselves once the
// editor itself is gone.
export function CodeDiffEditor({ onMount, keepCurrentOriginalModel, keepCurrentModifiedModel, ...props }: DiffEditorProps) {
  const handleMount = useCallback<NonNullable<DiffEditorProps['onMount']>>((editor, monaco) => {
    const models = editor.getModel();
    editor.onDidDispose(() => {
      setTimeout(() => {
        if (!keepCurrentOriginalModel) models?.original.dispose();
        if (!keepCurrentModifiedModel) models?.modified.dispose();
      }, 0);
    });
    onMount?.(editor, monaco);
  }, [onMount, keepCurrentOriginalModel, keepCurrentModifiedModel]);
  return (
    <Suspense fallback={<EditorFallback />}>
      <LazyDiffEditor {...props} keepCurrentOriginalModel keepCurrentModifiedModel onMount={handleMount} />
    </Suspense>
  );
}
