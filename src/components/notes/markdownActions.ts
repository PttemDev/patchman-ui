import type { Monaco } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';

// Markdown formatting commands for the note editor's toolbar. They act on the
// Monaco editor directly (one undoable edit each), work on every selection,
// and toggle: applying bold to "**x**" unwraps it, a list prefix on lines that
// all have it removes it.
type Editor = MonacoType.editor.IStandaloneCodeEditor;

function edit(editor: Editor, edits: MonacoType.editor.IIdentifiedSingleEditOperation[], selections?: MonacoType.Selection[]) {
  editor.pushUndoStop();
  editor.executeEdits('note-toolbar', edits, selections);
  editor.pushUndoStop();
  editor.focus();
}

/** Wrap each selection in `before`/`after` (or unwrap if already wrapped). */
export function wrapSelection(editor: Editor, monaco: Monaco, before: string, after: string, placeholder: string) {
  const model = editor.getModel();
  if (!model) return;
  const edits: MonacoType.editor.IIdentifiedSingleEditOperation[] = [];
  const selections: MonacoType.Selection[] = [];
  for (const sel of editor.getSelections() ?? []) {
    const text = model.getValueInRange(sel);
    // Unwrap when the selection itself carries the markers…
    if (text.length >= before.length + after.length && text.startsWith(before) && text.endsWith(after)) {
      const inner = text.slice(before.length, text.length - after.length);
      edits.push({ range: sel, text: inner });
      selections.push(new monaco.Selection(sel.startLineNumber, sel.startColumn, sel.startLineNumber, sel.startColumn + inner.length));
      continue;
    }
    // …or when the markers sit just outside it.
    const outer = new monaco.Range(sel.startLineNumber, Math.max(1, sel.startColumn - before.length), sel.endLineNumber, sel.endColumn + after.length);
    const around = model.getValueInRange(outer);
    if (!sel.isEmpty() && around.startsWith(before) && around.endsWith(after) && around.length === text.length + before.length + after.length) {
      edits.push({ range: outer, text });
      selections.push(new monaco.Selection(outer.startLineNumber, outer.startColumn, outer.endLineNumber, outer.startColumn + text.length));
      continue;
    }
    const body = text || placeholder;
    edits.push({ range: sel, text: before + body + after });
    const start = sel.startColumn + before.length;
    if (body.includes('\n')) {
      selections.push(new monaco.Selection(sel.startLineNumber, start, sel.startLineNumber, start));
    } else {
      selections.push(new monaco.Selection(sel.startLineNumber, start, sel.startLineNumber, start + body.length));
    }
  }
  edit(editor, edits, selections);
}

const HEADING_RE = /^(#{1,6})\s+/;
const LIST_RE = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/;

/**
 * Prefix every line touched by the selection. kind:
 *  - 'heading' with level 1-6 (level 0 = plain paragraph)
 *  - 'bullet' | 'number' | 'task' | 'quote' (toggle when every line has it)
 */
export function prefixLines(editor: Editor, monaco: Monaco, kind: 'heading' | 'bullet' | 'number' | 'task' | 'quote', level = 0) {
  const model = editor.getModel();
  const sel = editor.getSelection();
  if (!model || !sel) return;
  const first = sel.startLineNumber;
  const last = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber;
  const lines: string[] = [];
  for (let n = first; n <= last; n++) lines.push(model.getLineContent(n));

  const marker = (i: number) => (kind === 'bullet' ? '- ' : kind === 'number' ? `${i + 1}. ` : kind === 'task' ? '- [ ] ' : '> ');
  const has = (line: string) => {
    const m = line.match(LIST_RE)?.[2] ?? '';
    if (kind === 'task') return /^[-*+]\s+\[[ xX]\]/.test(m);
    if (kind === 'bullet') return /^[-*+]\s+$/.test(m);
    if (kind === 'number') return /^\d+[.)]\s+$/.test(m);
    return m.startsWith('>');
  };

  let next: string[];
  if (kind === 'heading') {
    next = lines.map((l) => {
      const stripped = l.replace(HEADING_RE, '');
      const current = l.match(HEADING_RE)?.[1].length ?? 0;
      return level === 0 || current === level ? stripped : `${'#'.repeat(level)} ${stripped}`;
    });
  } else {
    const nonEmpty = lines.filter((l) => l.trim() !== '');
    const all = nonEmpty.length > 0 && nonEmpty.every(has);
    let i = 0;
    next = lines.map((l) => {
      if (l.trim() === '' && lines.length > 1) return l;
      const m = l.match(LIST_RE);
      const indent = m?.[1] ?? l.match(/^\s*/)![0];
      const rest = m ? l.slice(m[0].length) : l.slice(indent.length);
      if (all) return indent + rest;
      return indent + marker(i++) + rest;
    });
  }
  const range = new monaco.Range(first, 1, last, model.getLineMaxColumn(last));
  const text = next.join('\n');
  const endCol = next[next.length - 1].length + 1;
  // Several lines stay selected (so the button toggles them back); a single
  // line leaves the caret at its end, ready to type.
  const after = first === last
    ? new monaco.Selection(last, endCol, last, endCol)
    : new monaco.Selection(first, 1, last, endCol);
  edit(editor, [{ range, text }], [after]);
}

/** Insert a block on its own lines (after the current line unless it's
 *  empty), separated by a blank line from text above; select `select` in it. */
export function insertBlock(editor: Editor, monaco: Monaco, block: string, select?: string) {
  const model = editor.getModel();
  const sel = editor.getSelection();
  if (!model || !sel) return;
  // After the whole current block (paragraph, list, table…), never inside it.
  let lineNo = sel.endLineNumber;
  if (model.getLineContent(lineNo).trim() !== '') {
    while (lineNo < model.getLineCount() && model.getLineContent(lineNo + 1).trim() !== '') lineNo++;
  }
  const emptyLine = model.getLineContent(lineNo).trim() === '';
  const prevNonBlank = lineNo > 1 && model.getLineContent(lineNo - 1).trim() !== '';
  const at = emptyLine
    ? new monaco.Range(lineNo, 1, lineNo, model.getLineMaxColumn(lineNo))
    : new monaco.Range(lineNo, model.getLineMaxColumn(lineNo), lineNo, model.getLineMaxColumn(lineNo));
  const lead = emptyLine ? (prevNonBlank ? '\n' : '') : '\n\n';
  const text = `${lead}${block}\n`;
  const startOffset = model.getOffsetAt({ lineNumber: at.startLineNumber, column: at.startColumn });
  edit(editor, [{ range: at, text }]);
  const target = select && text.indexOf(select) >= 0 ? text.indexOf(select) : text.length;
  const startPos = model.getPositionAt(startOffset + target);
  const endPos = model.getPositionAt(startOffset + target + (select && text.includes(select) ? select.length : 0));
  editor.setSelection(new monaco.Selection(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column));
  editor.revealPositionInCenterIfOutsideViewport(startPos);
}

/** [text](url): the selection becomes the text; the url placeholder is selected. */
export function insertLink(editor: Editor, monaco: Monaco, textPlaceholder: string) {
  const model = editor.getModel();
  const sel = editor.getSelection();
  if (!model || !sel) return;
  const text = model.getValueInRange(sel).replace(/\n/g, ' ');
  const url = 'https://';
  const label = text || textPlaceholder;
  edit(editor, [{ range: sel, text: `[${label}](${url})` }]);
  const line = sel.startLineNumber;
  if (text) {
    const col = sel.startColumn + label.length + 3;
    editor.setSelection(new monaco.Selection(line, col, line, col + url.length));
  } else {
    editor.setSelection(new monaco.Selection(line, sel.startColumn + 1, line, sel.startColumn + 1 + label.length));
  }
}

/** Type "[[" and open the note-link suggestions. */
export function startNoteLink(editor: Editor) {
  const sel = editor.getSelection();
  if (!sel) return;
  edit(editor, [{ range: sel, text: '[[' }]);
  editor.trigger('note-toolbar', 'editor.action.triggerSuggest', {});
}
