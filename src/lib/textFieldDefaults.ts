// Kill browser autocorrect / auto-capitalize / spellcheck on text fields
// app-wide. On the Tauri desktop app (WKWebView) macOS text substitution
// otherwise capitalizes and "corrects" as users type into URL bars, headers,
// JSON bodies, tokens — none of which are prose. The shared <Input>/<Textarea>
// set these attributes themselves, but many high-traffic fields are RAW
// elements (UrlBar, BodyEditor, search boxes, command palette), and
// autocapitalize/autocorrect don't inherit from an ancestor — each field needs
// its own attributes. So we set them on every text field at insertion time.
//
// Design notes:
//  - Set ONLY when the attribute is absent, so an explicit per-field value
//    (a prose textarea that opts back into spellCheck, or the shared
//    components' own attrs) is never overridden.
//  - Skip anything inside `.xterm` (the Claude Code terminal) — xterm manages
//    its own hidden textarea and emits a lot of DOM churn under output.
//  - Runs at insertion via a MutationObserver (not focus) so the attributes
//    exist before WebKit computes the field's text-input traits.

const SELECTOR =
  'input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="tel"], textarea';

function apply(el: Element): void {
  if (el.closest('.xterm')) return;
  if (!el.hasAttribute('autocorrect')) el.setAttribute('autocorrect', 'off');
  if (!el.hasAttribute('autocapitalize')) el.setAttribute('autocapitalize', 'off');
  if (!el.hasAttribute('spellcheck')) el.setAttribute('spellcheck', 'false');
}

let installed = false;

export function installTextFieldDefaults(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  const sweep = (root: ParentNode) => {
    root.querySelectorAll(SELECTOR).forEach(apply);
  };

  sweep(document);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as Element;
        if (el.closest('.xterm')) return; // skip terminal subtrees
        if (el.matches(SELECTOR)) apply(el);
        el.querySelectorAll(SELECTOR).forEach(apply);
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
