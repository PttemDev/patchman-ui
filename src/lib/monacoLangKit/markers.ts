import type { Monaco } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';

// Shared marker helper for the lang-kit providers. `owner` namespaces the
// diagnostics so several passes (e.g. 'redis-arity') can coexist on one model
// without clobbering each other. Passing an empty array clears that owner's
// markers. Mirrors monaco.editor.setModelMarkers so callers stay thin.
export function setMarkers(
  monaco: Monaco,
  model: MonacoType.editor.ITextModel,
  owner: string,
  diags: MonacoType.editor.IMarkerData[],
): void {
  monaco.editor.setModelMarkers(model, owner, diags);
}
