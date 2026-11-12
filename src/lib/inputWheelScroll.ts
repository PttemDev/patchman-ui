// Two-finger horizontal trackpad swipe (and shift+wheel) scrolls the text of
// ANY single-line text field app-wide. Chromium does this natively for
// <input>; WebKit — the macOS desktop shell — doesn't (measured: scrollLeft
// stays 0), so a long URL / base URL / token is only reachable by caret keys.
//
// Design notes:
//  - One document-level capture listener instead of per-field wiring, so raw
//    <input>s and the shared <Input> alike get it, including ones mounted
//    later (dialogs, popovers).
//  - Only horizontal-dominant gestures are taken: a vertical wheel over a
//    field still scrolls the surrounding panel (KV tables, dialogs).
//  - preventDefault only when scrollLeft actually moves — at either edge the
//    event is left alone, so an outer horizontal scroller (or the swipe-back
//    gesture) still gets it. Non-passive for that reason.
//  - Textareas are skipped: they wrap and scroll natively. Monaco / xterm own
//    their hidden fields.
//  - After moving the text a `scroll` event is dispatched: setting scrollLeft
//    on an <input> doesn't fire one reliably, and overlays that mirror the
//    text (VariableInput's {{var}} pills) resync on it.

const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password']);

function onWheel(e: WheelEvent): void {
  if (e.ctrlKey) return; // pinch-zoom
  const el = e.target;
  if (!(el instanceof HTMLInputElement) || !TEXT_TYPES.has(el.type)) return;
  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
  if (el.closest('.monaco-editor, .xterm')) return;
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 0) return;
  const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX; // line-mode wheels
  const next = Math.max(0, Math.min(max, el.scrollLeft + dx));
  if (next === el.scrollLeft) return;
  e.preventDefault();
  el.scrollLeft = next;
  el.dispatchEvent(new Event('scroll'));
}

let installed = false;

export function installInputWheelScroll(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
}
