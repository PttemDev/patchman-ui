/**
 * Paste-history insertion helpers.
 *
 * `getInsertTarget` decides whether the currently-focused element can receive
 * text; `insertIntoTarget` actually splices the chosen entry in at the caret.
 */

// Input types we treat as text-insertable. Password is deliberately excluded.
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', '']);

/**
 * Returns the element to insert into if `el` is a valid text-insertable
 * target, otherwise null.
 *
 * Valid targets: a texty <input>, a <textarea> (this also covers Monaco's
 * hidden `.inputarea` textarea), or a contentEditable element. Rejects
 * password fields, readOnly/disabled fields, and our own overlay's search box.
 */
export function getInsertTarget(el: Element | null): HTMLElement | null {
  if (!el) return null;
  const html = el as HTMLElement;

  // Never target the Paste History overlay's own search box.
  if (html.closest?.('[data-paste-history]')) return null;

  const tag = html.tagName;

  if (tag === 'TEXTAREA') {
    const ta = html as HTMLTextAreaElement;
    if (ta.readOnly || ta.disabled) return null;
    return ta;
  }

  if (tag === 'INPUT') {
    const input = html as HTMLInputElement;
    if (input.readOnly || input.disabled) return null;
    const type = (input.type || 'text').toLowerCase();
    if (type === 'password') return null;
    if (TEXT_INPUT_TYPES.has(type)) return input;
    return null;
  }

  if (html.isContentEditable) return html;

  return null;
}

/**
 * Inserts `text` into `el` at the given selection, replacing any selected
 * range.
 *
 * Primary path is `document.execCommand('insertText')`: it inserts at the
 * live caret and fires the native `input`/`beforeinput` events that
 * React-controlled inputs AND Monaco rely on to stay in sync. It also works
 * for contentEditable and Monaco's hidden textarea.
 *
 * Fallback (execCommand unavailable/refused, e.g. Firefox on <input>): splice
 * via the native value setter and dispatch a bubbling `input` event. Plain
 * input/textarea only — contentEditable/Monaco depend on execCommand.
 */
export function insertIntoTarget(
  el: HTMLElement,
  selStart: number | null,
  selEnd: number | null,
  text: string,
): void {
  if (!text) return;

  // Refocus the target — the overlay stole focus while open.
  el.focus();

  const isField =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  const isMonaco = !!el.closest?.('.monaco-editor');

  // Restore the caret/selection for plain fields only. For Monaco, its hidden
  // textarea's selection is NOT the editor cursor — forcing it confuses
  // Monaco's input handling, so we let Monaco insert at its own cursor.
  if (isField && !isMonaco && selStart != null && selEnd != null) {
    try {
      (el as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(
        selStart,
        selEnd,
      );
    } catch {
      /* some input types reject setSelectionRange */
    }
  }

  let ok = false;
  try {
    ok = document.execCommand('insertText', false, text);
  } catch {
    ok = false;
  }
  if (ok) return;

  // Native-setter fallback for plain input/textarea.
  if (isField) {
    const field = el as HTMLInputElement | HTMLTextAreaElement;
    const value = field.value;
    const start = selStart ?? value.length;
    const end = selEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);

    const proto =
      el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(field, next);
    else field.value = next;

    const caret = start + text.length;
    try {
      field.setSelectionRange(caret, caret);
    } catch {
      /* ignore */
    }
    // Bubbling input event so React's onChange (and any listeners) fire.
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
