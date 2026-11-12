import type { ComponentProps } from 'react';
import { Excalidraw, convertToExcalidrawElements, CaptureUpdateAction } from '@excalidraw/excalidraw';
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw';

// The imperative handle Excalidraw hands back via its `excalidrawAPI` prop.
// Derived from the component so we never import version-fragile named types.
export type BoardApi = Parameters<NonNullable<ComponentProps<typeof Excalidraw>['excalidrawAPI']>>[0];

// A whiteboardId → live canvas handle registry, so anything outside the canvas
// (the diagram dialog, a future AI action) can insert into the OPEN board
// without prop-drilling. Populated by ExcalidrawCanvas on mount.
const registry = new Map<string, BoardApi>();

export function registerBoard(id: string, api: BoardApi): void {
  if (id) registry.set(id, api);
}
export function unregisterBoard(id: string): void {
  registry.delete(id);
}
export function getBoardApi(id: string): BoardApi | undefined {
  return registry.get(id);
}

// Strip a Markdown ```mermaid fence if a model wrapped the code in one. Models
// routinely add a lead-in ("Here's your diagram:") or a trailing sentence, so we
// take the FIRST fenced block found anywhere — not one that must span the whole
// string — and fall back to the raw text when there's no fence.
export function stripMermaidFence(text: string): string {
  const t = text.trim();
  const fence = t.match(/```(?:mermaid)?[ \t]*\r?\n([\s\S]*?)```/i);
  return (fence ? fence[1] : t).trim();
}

// Parse Mermaid → element skeleton → full Excalidraw elements, then MERGE onto
// the board's current scene (updateScene REPLACES, so we concat the existing
// elements), register any generated image files, and scroll the new content
// into view. The insert fires the canvas onChange → the existing debounced
// autosave persists it, so there's nothing extra to save here.
export async function insertMermaid(id: string, mermaid: string): Promise<void> {
  const api = registry.get(id);
  if (!api) throw new Error('The whiteboard is not open.');
  const def = stripMermaidFence(mermaid);
  if (!def) throw new Error('Empty diagram.');
  const { elements: skeleton, files } = await parseMermaidToExcalidraw(def);
  const converted = convertToExcalidrawElements(skeleton);
  const existing = api.getSceneElements();
  api.updateScene({
    elements: [...existing, ...converted] as Parameters<BoardApi['updateScene']>[0]['elements'],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  if (files) api.addFiles(Object.values(files) as Parameters<BoardApi['addFiles']>[0]);
  api.scrollToContent(converted as Parameters<BoardApi['scrollToContent']>[0], { fitToContent: true });
}
