import type { Monaco } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';
import { useNotesStore } from '@/stores/notesStore';

// `[[` in a note editor suggests other notes by title and inserts a markdown
// link to them — [Title](note:<id>) — which survives renames (it's by id).
// In a knowledge card the link also asks for its type, kept as the link
// title — [Title](note:<id> "depends_on") — which the backend turns into a
// typed link. Registered once for the markdown language; only models enabled
// here get suggestions.
const LINK_TYPES = ['related', 'depends_on', 'part_of', 'example_of', 'contradicts', 'supersedes'];
const enabledModels = new Map<string, { self: string; typed: boolean }>(); // model uri → own note
let registered = false;

export function enableNoteLinks(monaco: Monaco, model: MonacoType.editor.ITextModel, ownNoteId: string, typed = false): () => void {
  enabledModels.set(model.uri.toString(), { self: ownNoteId, typed });
  if (!registered) {
    registered = true;
    monaco.languages.registerCompletionItemProvider('markdown', {
      triggerCharacters: ['['],
      provideCompletionItems(m: MonacoType.editor.ITextModel, position: MonacoType.Position) {
        const own = enabledModels.get(m.uri.toString());
        if (own === undefined) return { suggestions: [] };
        const self = own.self;
        const line = m.getLineContent(position.lineNumber);
        const match = line.slice(0, position.column - 1).match(/\[\[([^\]]*)$/);
        if (!match) return { suggestions: [] };
        // Swallow an auto-closed "]]" after the cursor too.
        const after = line.slice(position.column - 1);
        const closing = after.startsWith(']]') ? 2 : after.startsWith(']') ? 1 : 0;
        const range = new monaco.Range(
          position.lineNumber,
          position.column - match[1].length - 2,
          position.lineNumber,
          position.column + closing,
        );
        const { notes, shared } = useNotesStore.getState();
        const all = [...notes, ...shared];
        const byId = new Map(all.map((n) => [n.id, n]));
        const pathOf = (id: string) => {
          const parts: string[] = [];
          let cur = byId.get(id)?.parentId;
          for (let i = 0; i < 6 && cur; i++) {
            const p = byId.get(cur);
            if (!p) break;
            parts.unshift(p.title);
            cur = p.parentId;
          }
          return parts.join(' / ');
        };
        const seen = new Set<string>();
        return {
          suggestions: all
            .filter((n) => n.id !== self && n.type !== 'folder' && !seen.has(n.id) && seen.add(n.id))
            .map((n, i) => ({
              label: n.title,
              kind: n.type === 'card' ? monaco.languages.CompletionItemKind.Reference : monaco.languages.CompletionItemKind.File,
              detail: pathOf(n.id),
              // Snippet: the link text and, in a card, a choice of link type.
              insertText: own.typed
                ? `[${snippetText(n.title)}](note:${n.id} "\${1|${LINK_TYPES.join(',')}|}")`
                : `[${snippetText(n.title)}](note:${n.id})`,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              filterText: '[[' + n.title,
              sortText: String(i).padStart(5, '0'),
              range,
            })),
        };
      },
    });
  }
  const key = model.uri.toString();
  return () => { enabledModels.delete(key); };
}

// A title inside a snippet: no brackets (they'd end the link text) and the
// snippet syntax characters escaped.
function snippetText(title: string): string {
  return title.replace(/[[\]]/g, '').replace(/[\\$}]/g, (c) => `\\${c}`);
}
