import * as React from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Eye, EyeOff, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useAutoGrow } from '@/hooks/useAutoGrow';
import { useEnvironmentStore } from '@/stores/environmentStore';
import {
  applyVar,
  findVarTokens,
  previewValue,
  suggestVars,
  varQueryAt,
  varStatus,
  type VarQuery,
  type VarStatus,
} from '@/lib/envVarTokens';

// VariableInput — a drop-in <input> that understands `{{var}}` env variables
// (Postman-style):
//   • highlights each `{{name}}` (resolved / disabled / missing),
//   • hovering one opens a card to view + edit its value in the active env,
//   • typing `{{…` (or clicking into an empty `{{}}`) opens a suggestion list
//     of the active environment's variables (↑↓ Enter/Tab Esc).
//
// The highlight is a pointer-events-none overlay ON TOP of the native input
// with transparent text and translucent "pills", so the input keeps its own
// text rendering, caret, selection and placeholder. Its metrics (padding,
// border, font) are copied from the input's computed style and its content is
// shifted by the input's scrollLeft. Layout classes (width / flex-1 / min-w)
// belong on `wrapperClassName`; the input fills the wrapper.
//
// Programmatic inserts go through the native value setter + an `input` event,
// so the caller's normal onChange(e) fires — call sites need no new props.

export interface VariableInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Classes for the positioning wrapper (flex-1 / w-* / min-w-*). Default: w-full. */
  wrapperClassName?: string;
  /** Render a bare <input> styled only by `className` (instead of the shadcn Input). */
  bare?: boolean;
}

export interface VariableTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Classes for the positioning wrapper. Default: w-full. */
  wrapperClassName?: string;
}

// 'runtime': not in the env, but defined by the run itself before this field
// is used (see RuntimeVarsProvider) — substituted, so not an error.
type FieldVarStatus = VarStatus | 'runtime';

const PILL: Record<FieldVarStatus, string> = {
  resolved: 'bg-sky-500/15 ring-1 ring-sky-500/40',
  disabled: 'bg-amber-500/15 ring-1 ring-amber-500/50',
  missing: 'bg-red-500/15 ring-1 ring-red-500/50',
  noEnv: 'bg-red-500/15 ring-1 ring-red-500/50',
  runtime: 'bg-violet-500/15 ring-1 ring-violet-500/40',
};

// Variable names a run defines before the fields inside this provider are used
// — e.g. a QA test case's variables extracted by earlier steps. The runner
// substitutes them although they aren't in the environment, so the fields
// below highlight them as such (not "missing") and offer them in the `{{`
// list after the env's own variables. Empty (no provider) everywhere else.
const RuntimeVarsContext = React.createContext<readonly string[]>([]);

export function RuntimeVarsProvider({ names, children }: { names: readonly string[]; children: React.ReactNode }) {
  return <RuntimeVarsContext.Provider value={names}>{children}</RuntimeVarsContext.Provider>;
}

interface SuggestItem {
  key: string;
  preview: string;
  runtime?: boolean;
}

const HOVER_OPEN_MS = 250;
const HOVER_CLOSE_MS = 150;

type FieldEl = HTMLInputElement | HTMLTextAreaElement;

function setNativeValue(el: FieldEl, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, cs: CSSStyleDeclaration): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return 0;
  measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return measureCtx.measureText(text).width;
}

const px = (v: string) => parseFloat(v) || 0;

interface Box { left: number; top: number; width: number; height: number }

export const VariableInput = React.forwardRef<HTMLInputElement, VariableInputProps>(function VariableInput(props, ref) {
  return <VarField {...(props as FieldProps)} multiline={false} fieldRef={ref as React.ForwardedRef<FieldEl>} />;
});

// VariableTextarea — the same {{var}} features on a wrapping, multi-line
// <textarea> (e.g. the URL bar's expanded editor). Always "bare": styled by
// `className`. The mirror overlay copies the textarea's wrapping rules and
// follows its scrollTop; hover hit-tests every line box of a wrapped token.
export const VariableTextarea = React.forwardRef<HTMLTextAreaElement, VariableTextareaProps>(function VariableTextarea(props, ref) {
  return <VarField {...(props as FieldProps)} multiline bare fieldRef={ref as React.ForwardedRef<FieldEl>} />;
});

// The shared implementation. Caller props are forwarded to the element as-is;
// the handful of handlers it wraps are chained to the caller's own.
type Handler<E> = ((e: E) => void) | undefined;
interface FieldProps {
  multiline: boolean;
  bare?: boolean;
  wrapperClassName?: string;
  className?: string;
  value?: unknown;
  type?: string;
  disabled?: boolean;
  autoComplete?: string;
  onChange?: Handler<React.ChangeEvent<FieldEl>>;
  onSelect?: Handler<React.SyntheticEvent<FieldEl>>;
  onKeyDown?: Handler<React.KeyboardEvent<FieldEl>>;
  onBlur?: Handler<React.FocusEvent<FieldEl>>;
  onScroll?: Handler<React.UIEvent<FieldEl>>;
  onMouseMove?: Handler<React.MouseEvent<FieldEl>>;
  onMouseLeave?: Handler<React.MouseEvent<FieldEl>>;
  fieldRef: React.ForwardedRef<FieldEl>;
}

function VarField({ multiline, wrapperClassName, bare, className, fieldRef, ...props }: FieldProps) {
  const inputRef = useRef<FieldEl | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const setRefs = useCallback(
    (el: FieldEl | null) => {
      inputRef.current = el;
      if (typeof fieldRef === 'function') fieldRef(el);
      else if (fieldRef) fieldRef.current = el;
    },
    [fieldRef],
  );

  const env = useEnvironmentStore((s) => s.activeEnvironment);
  const runtimeNames = React.useContext(RuntimeVarsContext);
  const statusOf = useCallback((name: string): FieldVarStatus => {
    const st = varStatus(env, name).status;
    return (st === 'missing' || st === 'noEnv') && runtimeNames.includes(name) ? 'runtime' : st;
  }, [env, runtimeNames]);
  const value = String(props.value ?? '');
  const tokens = useMemo(() => findVarTokens(value), [value]);
  const interactive = props.type !== 'password' && !props.disabled;

  // ── overlay sync ───────────────────────────────────────────────────────────
  const syncOverlay = useCallback(() => {
    const el = inputRef.current;
    const ov = overlayRef.current;
    const inner = innerRef.current;
    if (!el || !ov || !inner) return;
    const cs = getComputedStyle(el);
    // Position (not pad) the overlay onto the field's content box: overflow
    // clips at the padding box, so padding would let pills of a scrolled value
    // spill under controls sitting in the input's padding (UrlBar's pr-20).
    ov.style.left = `${px(cs.paddingLeft) + px(cs.borderLeftWidth)}px`;
    ov.style.fontFamily = cs.fontFamily;
    ov.style.fontSize = cs.fontSize;
    ov.style.fontWeight = cs.fontWeight;
    ov.style.fontStyle = cs.fontStyle;
    ov.style.letterSpacing = cs.letterSpacing;
    if (multiline) {
      // Same wrap width as the textarea's text: clientWidth excludes the border
      // and any vertical scrollbar, so the mirror re-wraps identically.
      ov.style.top = `${px(cs.paddingTop) + px(cs.borderTopWidth)}px`;
      ov.style.width = `${el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight)}px`;
      ov.style.height = `${el.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom)}px`;
      ov.style.lineHeight = cs.lineHeight;
      ov.style.whiteSpace = cs.whiteSpace;
      ov.style.wordBreak = cs.wordBreak;
      ov.style.overflowWrap = cs.overflowWrap;
      inner.style.transform = `translateY(${-el.scrollTop}px)`;
    } else {
      ov.style.right = `${px(cs.paddingRight) + px(cs.borderRightWidth)}px`;
      inner.style.transform = `translateX(${-el.scrollLeft}px)`;
    }
  }, [multiline]);
  useLayoutEffect(() => { syncOverlay(); });

  // The textarea's width can settle without a re-render (e.g. a popover that
  // sizes itself after its first positioning pass) — keep the mirror's wrap in
  // step with it.
  useEffect(() => {
    const el = inputRef.current;
    if (!multiline || !el) return;
    const ro = new ResizeObserver(() => syncOverlay());
    ro.observe(el);
    return () => ro.disconnect();
  }, [multiline, syncOverlay]);

  // Horizontal trackpad scrolling of the field is app-wide
  // (lib/inputWheelScroll) — it dispatches `scroll`, which resyncs the pills.

  // ── hover card ─────────────────────────────────────────────────────────────
  const [hover, setHover] = useState<{ name: string; box: Box } | null>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const cardFocused = useRef(false);
  const clearTimers = () => { window.clearTimeout(openTimer.current); window.clearTimeout(closeTimer.current); };
  const scheduleClose = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => { if (!cardFocused.current) setHover(null); }, HOVER_CLOSE_MS);
  }, []);
  useEffect(() => clearTimers, []);

  // ── suggestion list ────────────────────────────────────────────────────────
  // `top` is set in multi-line mode (the list opens under the caret's line);
  // single-line lists hang off the field's bottom edge.
  const [suggest, setSuggest] = useState<{ q: VarQuery; left: number; top?: number } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const items = useMemo<SuggestItem[]>(() => {
    if (!suggest) return [];
    const envItems: SuggestItem[] = suggestVars(env, suggest.q.query).map((v) => ({ key: v.key, preview: previewValue(v) }));
    const have = new Set(envItems.map((i) => i.key));
    const q = suggest.q.query.toLowerCase();
    const runtime = Array.from(new Set(runtimeNames))
      .filter((n) => !have.has(n) && /^\w+$/.test(n) && n.toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = a.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp || a.localeCompare(b);
      })
      .map((n) => ({ key: n, preview: '', runtime: true }));
    return [...envItems, ...runtime];
  }, [env, suggest, runtimeNames]);
  useEffect(() => { setActiveIdx(0); }, [suggest?.q.query]);

  // Viewport rect of the character at `index` in the mirror. The text before a
  // `{{` query is unchanged by the keystroke being handled, so the (one render
  // stale) mirror still places the query start correctly.
  const charRect = useCallback((index: number): DOMRect | null => {
    const inner = innerRef.current;
    if (!inner) return null;
    let acc = 0;
    let lastText: Node | null = null;
    for (const sp of Array.from(inner.children)) {
      const tn = sp.firstChild;
      const len = tn?.textContent?.length ?? 0;
      if (tn && len) {
        lastText = tn;
        if (index < acc + len) {
          const r = document.createRange();
          r.setStart(tn, index - acc);
          r.setEnd(tn, index - acc + 1);
          return r.getBoundingClientRect();
        }
      }
      acc += len;
    }
    if (lastText?.textContent) {
      const r = document.createRange();
      r.setStart(lastText, lastText.textContent.length - 1);
      r.setEnd(lastText, lastText.textContent.length);
      const b = r.getBoundingClientRect();
      return new DOMRect(b.right, b.top, 0, b.height);
    }
    return null;
  }, []);

  const openSuggest = useCallback((el: FieldEl, q: VarQuery) => {
    const cs = getComputedStyle(el);
    if (multiline) {
      const wrap = wrapRef.current?.getBoundingClientRect();
      const r = charRect(q.start);
      const left = wrap && r ? r.left - wrap.left : px(cs.paddingLeft) + px(cs.borderLeftWidth);
      const top = wrap && r ? r.bottom - wrap.top : px(cs.paddingTop) + px(cs.borderTopWidth) + px(cs.lineHeight);
      setSuggest({ q, left: Math.max(0, Math.min(left, el.clientWidth - 48)), top });
    } else {
      const pad = px(cs.paddingLeft) + px(cs.borderLeftWidth);
      const raw = pad + textWidth(el.value.slice(0, q.start), cs) - el.scrollLeft;
      setSuggest({ q, left: Math.max(0, Math.min(raw, el.clientWidth - 48)) });
    }
    setHover(null);
  }, [multiline, charRect]);

  // reason 'type': typing inside `{{…` opens/updates, anything else closes.
  // reason 'caret': a click/arrow into an EMPTY `{{}}` opens; leaving a token
  // closes; moving within one keeps the list (and its filter) in sync.
  const evaluate = useCallback(
    (el: FieldEl, reason: 'type' | 'caret') => {
      if (!interactive) return;
      const caret = el.selectionStart ?? el.value.length;
      const q = el.selectionStart === el.selectionEnd ? varQueryAt(el.value, caret) : null;
      if (!q) { setSuggest(null); return; }
      if (reason === 'type' || q.emptyBraces) { openSuggest(el, q); return; }
      setSuggest((s) => (s ? { ...s, q } : s));
    },
    [interactive, openSuggest],
  );

  const pick = useCallback((name: string) => {
    const el = inputRef.current;
    if (!el || !suggest) return;
    const { text, caret } = applyVar(el.value, suggest.q, name);
    setNativeValue(el, text);
    setSuggest(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); syncOverlay(); });
  }, [suggest, syncOverlay]);

  // ── event handlers (chain to the caller's) ─────────────────────────────────
  const onChange = (e: React.ChangeEvent<FieldEl>) => {
    props.onChange?.(e);
    setHover(null); // typing — get the card out of the way
    evaluate(e.currentTarget, 'type');
  };
  const onSelect = (e: React.SyntheticEvent<FieldEl>) => {
    props.onSelect?.(e);
    syncOverlay();
    evaluate(e.currentTarget, 'caret');
  };
  const onKeyDown = (e: React.KeyboardEvent<FieldEl>) => {
    if (suggest) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) setActiveIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && items.length) {
        e.preventDefault();
        pick(items[Math.min(activeIdx, items.length - 1)].key);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSuggest(null);
        return;
      }
    }
    props.onKeyDown?.(e);
  };
  const onBlur = (e: React.FocusEvent<FieldEl>) => {
    props.onBlur?.(e);
    setSuggest(null);
  };
  const onScroll = (e: React.UIEvent<FieldEl>) => {
    props.onScroll?.(e);
    syncOverlay();
  };
  const onMouseMove = (e: React.MouseEvent<FieldEl>) => {
    props.onMouseMove?.(e);
    // A wheel/trackpad scroll moves the text without a caret change, and
    // `scroll` on <input> isn't fired reliably everywhere — resync first.
    syncOverlay();
    if (suggest || !interactive) return;
    const wrap = wrapRef.current?.getBoundingClientRect();
    const spans = innerRef.current?.querySelectorAll<HTMLElement>('[data-var]');
    if (!wrap || !spans?.length) { scheduleClose(); return; }
    for (const s of spans) {
      // Single-line: a token spans the field's height, so x alone decides.
      // Multi-line: a wrapped token has one rect per line — test each in 2D.
      const rects = multiline ? Array.from(s.getClientRects()) : [s.getBoundingClientRect()];
      const r = rects.find((rc) =>
        e.clientX >= rc.left && e.clientX <= rc.right && (!multiline || (e.clientY >= rc.top && e.clientY <= rc.bottom)));
      if (!r) continue;
      const name = s.dataset.var!;
      const box = multiline
        ? { left: r.left - wrap.left, top: r.top - wrap.top, width: r.width, height: r.height }
        : { left: r.left - wrap.left, top: 0, width: r.width, height: wrap.height };
      window.clearTimeout(closeTimer.current);
      if (hover?.name === name && Math.abs(hover.box.left - box.left) < 1 && Math.abs(hover.box.top - box.top) < 1) return;
      window.clearTimeout(openTimer.current);
      // Switching between tokens while a card is open is instant; a fresh
      // open waits a beat so sweeping the mouse across the field is quiet.
      if (hover) setHover({ name, box });
      else openTimer.current = window.setTimeout(() => setHover({ name, box }), HOVER_OPEN_MS);
      return;
    }
    scheduleClose();
  };
  const onMouseLeave = (e: React.MouseEvent<FieldEl>) => {
    props.onMouseLeave?.(e);
    scheduleClose();
  };

  // Build overlay segments: plain text runs + token pills (text transparent).
  const segments = useMemo(() => {
    const out: Array<{ text: string; name?: string; status?: FieldVarStatus }> = [];
    let at = 0;
    for (const tk of tokens) {
      if (tk.start > at) out.push({ text: value.slice(at, tk.start) });
      out.push({ text: value.slice(tk.start, tk.end), name: tk.name, status: statusOf(tk.name) });
      at = tk.end;
    }
    if (at < value.length) out.push({ text: value.slice(at) });
    return out;
  }, [tokens, value, statusOf]);

  const fieldProps = {
    ...props,
    ref: setRefs,
    className: bare ? cn('w-full', className) : className,
    onChange,
    onSelect,
    onKeyDown,
    onBlur,
    onScroll,
    onMouseMove,
    onMouseLeave,
    autoComplete: props.autoComplete ?? 'off',
  };

  // Multi-line keeps the mirror mounted even without tokens: it's also what
  // places the suggestion list under the caret's line.
  const showOverlay = interactive && (multiline || tokens.length > 0);

  return (
    <div ref={wrapRef} className={cn('relative', wrapperClassName ?? 'w-full')}>
      {multiline ? (
        <textarea {...(fieldProps as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement> & React.RefAttributes<HTMLTextAreaElement>)} />
      ) : bare ? (
        <input {...(fieldProps as unknown as React.InputHTMLAttributes<HTMLInputElement> & React.RefAttributes<HTMLInputElement>)} />
      ) : (
        <Input {...(fieldProps as unknown as React.InputHTMLAttributes<HTMLInputElement> & React.RefAttributes<HTMLInputElement>)} />
      )}

      {showOverlay && (
        <div
          ref={overlayRef}
          aria-hidden
          className={multiline
            ? 'pointer-events-none absolute overflow-hidden'
            : 'pointer-events-none absolute top-0 bottom-0 flex items-center overflow-hidden'}
        >
          <div ref={innerRef} className={multiline ? 'text-transparent' : 'whitespace-pre text-transparent'}>
            {segments.map((sg, i) =>
              sg.name ? (
                <span key={i} data-var={sg.name} className={cn('rounded-sm', PILL[sg.status!])}>{sg.text}</span>
              ) : (
                <span key={i}>{sg.text}</span>
              ),
            )}
          </div>
        </div>
      )}

      {/* Hover card — view/edit the variable in the active environment. Keyed
          by token position so moving to another `{{var}}` re-anchors it (an
          anchor that only shifts isn't always picked up by the positioner). */}
      <Popover
        key={hover ? `${hover.name}@${Math.round(hover.box.left)}:${Math.round(hover.box.top)}` : ''}
        open={!!hover}
        onOpenChange={(o) => { if (!o) { cardFocused.current = false; setHover(null); } }}
      >
        <PopoverAnchor asChild>
          <span
            className="pointer-events-none absolute"
            style={hover ? { left: hover.box.left, top: hover.box.top, width: hover.box.width, height: hover.box.height } : { left: 0, top: 0, width: 0, height: 0 }}
          />
        </PopoverAnchor>
        {hover && (
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={4}
            // Width comes from the card itself — it widens when expanded.
            className="w-auto p-3"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onMouseEnter={() => window.clearTimeout(closeTimer.current)}
            onMouseLeave={scheduleClose}
            onFocus={() => { cardFocused.current = true; }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { cardFocused.current = false; scheduleClose(); }
            }}
          >
            <VarHoverCard name={hover.name} runtime={runtimeNames.includes(hover.name)} />
          </PopoverContent>
        )}
      </Popover>

      {/* Suggestion list — anchored under the `{{` being typed. */}
      <Popover open={!!suggest} onOpenChange={(o) => { if (!o) setSuggest(null); }}>
        <PopoverAnchor asChild>
          <span
            className="pointer-events-none absolute h-0 w-0"
            style={suggest?.top != null ? { left: suggest.left, top: suggest.top } : { left: suggest?.left ?? 0, bottom: 0 }}
          />
        </PopoverAnchor>
        {suggest && (
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={2}
            className="w-64 p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => { if (inputRef.current?.contains(e.target as Node)) e.preventDefault(); }}
          >
            <SuggestList items={items} activeIdx={activeIdx} envName={env?.name ?? null} onHover={setActiveIdx} onPick={pick} />
          </PopoverContent>
        )}
      </Popover>
    </div>
  );
}

function SuggestList({
  items,
  activeIdx,
  envName,
  onHover,
  onPick,
}: {
  items: SuggestItem[];
  activeIdx: number;
  envName: string | null;
  onHover: (i: number) => void;
  onPick: (name: string) => void;
}) {
  const { t } = useTranslation('environment');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  // Runtime (step-defined) names are listable even without an active env.
  if (!envName && items.length === 0) return <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('varPopover.noEnv')}</p>;
  return (
    <div>
      {envName && <div className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground truncate">{envName}</div>}
      {items.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground italic">{t('varPopover.noMatches')}</p>
      ) : (
        <div ref={listRef} role="listbox" className="max-h-60 overflow-y-auto">
          {items.map((v, i) => (
            <button
              key={v.key}
              type="button"
              role="option"
              data-idx={i}
              aria-selected={i === activeIdx}
              // mousedown + preventDefault: pick without blurring the input first.
              onMouseDown={(e) => { e.preventDefault(); onPick(v.key); }}
              onMouseEnter={() => onHover(i)}
              className={cn(
                'w-full flex items-center justify-between gap-3 px-2 py-1.5 text-xs rounded text-left',
                i === activeIdx ? 'bg-accent' : 'hover:bg-accent/60',
              )}
            >
              <span className="font-mono text-primary truncate">{v.key}</span>
              {v.runtime ? (
                <span className="text-violet-600 dark:text-violet-400 italic truncate max-w-[130px]">
                  {t('varPopover.runtimeTag', { defaultValue: 'from a step' })}
                </span>
              ) : (
                <span className="text-muted-foreground truncate max-w-[130px]">{v.preview}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Card content: status + value editor for one variable in the active env.
// Writes rebuild `variables` from the store at save time (not this render's
// closure) so a concurrent edit elsewhere — e.g. the Environment Manager — isn't
// clobbered by a stale list.
function VarHoverCard({ name, runtime = false }: { name: string; runtime?: boolean }) {
  const { t } = useTranslation('environment');
  const env = useEnvironmentStore((s) => s.activeEnvironment);
  const updateEnvironment = useEnvironmentStore((s) => s.updateEnvironment);
  const { status, variable } = varStatus(env, name);
  // Defined by an earlier step and absent from the env: nothing to edit here.
  const isRuntime = runtime && (status === 'missing' || status === 'noEnv');
  const readOnly = env?.role === 'viewer';
  const [draft, setDraft] = useState(variable?.value ?? '');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<'saved' | 'failed' | null>(null);
  useEffect(() => { setDraft(variable?.value ?? ''); setResult(null); }, [variable?.value, name]);
  // Expanded = the value wraps in an auto-growing textarea in a wider card,
  // inline (a nested popover would leave the card and close it). A textarea
  // can't mask, so a hidden secret stays a password field.
  const [expanded, setExpanded] = useState(false);
  const canExpand = !variable?.secret || reveal;
  const showExpanded = expanded && canExpand;
  const { ref: growRef, elRef: growEl } = useAutoGrow(draft);
  useEffect(() => {
    const el = growEl.current;
    if (showExpanded && el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, [showExpanded, growEl]);

  const commit = async (op: 'value' | 'enable' | 'add') => {
    const cur = useEnvironmentStore.getState().activeEnvironment;
    if (!cur || readOnly) return;
    const vars = cur.variables.slice();
    const idx = vars.findIndex((v) => v.key === name);
    if (op === 'add' && idx < 0) vars.push({ key: name, value: draft, enabled: true, secret: false });
    else if (idx >= 0) vars[idx] = op === 'enable' ? { ...vars[idx], enabled: true } : { ...vars[idx], value: draft };
    else return;
    setSaving(true);
    setResult(null);
    try {
      await updateEnvironment(cur.id, { variables: vars });
      // updateEnvironment swallows errors into store state; verify the write.
      const after = varStatus(useEnvironmentStore.getState().activeEnvironment, name).variable;
      const ok = !!after && (op === 'enable' ? after.enabled : after.value === draft);
      setResult(ok ? 'saved' : 'failed');
    } finally {
      setSaving(false);
    }
  };

  const onDraftKeyDown = (op: 'value' | 'add') => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void commit(op); }
  };

  const editor = (op: 'value' | 'add') => (
    <div className={cn('flex gap-1.5', showExpanded ? 'items-start' : 'items-center')}>
      <div className="relative flex-1 min-w-0">
        {showExpanded ? (
          <textarea
            ref={growRef}
            value={draft}
            readOnly={readOnly}
            placeholder={t('varPopover.valuePlaceholder')}
            // A value is one line: newlines from typing or pasting are dropped.
            onChange={(e) => { setDraft(e.target.value.replace(/[\r\n]+/g, '')); setResult(null); }}
            onKeyDown={onDraftKeyDown(op)}
            rows={1}
            spellCheck={false}
            className={cn(
              'block w-full resize-none overflow-y-auto rounded-md border border-input bg-transparent px-2 py-1 text-xs font-mono leading-relaxed break-all whitespace-pre-wrap outline-none focus-visible:ring-1 focus-visible:ring-ring',
              variable?.secret && 'pr-7',
            )}
          />
        ) : (
          <Input
            value={draft}
            type={variable?.secret && !reveal ? 'password' : 'text'}
            readOnly={readOnly}
            placeholder={t('varPopover.valuePlaceholder')}
            onChange={(e) => { setDraft(e.target.value); setResult(null); }}
            onKeyDown={onDraftKeyDown(op)}
            className={cn('h-7 text-xs font-mono', variable?.secret && 'pr-7')}
          />
        )}
        {variable?.secret && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className={cn('absolute right-1.5 text-muted-foreground hover:text-foreground', showExpanded ? 'top-1.5' : 'top-1/2 -translate-y-1/2')}
            title={reveal ? t('varPopover.hideValue') : t('varPopover.showValue')}
          >
            {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {canExpand && (
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0 text-muted-foreground"
          onClick={() => setExpanded((x) => !x)}
          title={showExpanded ? t('varPopover.collapse') : t('varPopover.expand')}
          aria-label={showExpanded ? t('varPopover.collapse') : t('varPopover.expand')}
        >
          {showExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
      )}
      {!readOnly && (
        <Button
          size="sm"
          className="h-7 px-2 text-xs shrink-0"
          disabled={saving || (op === 'value' && draft === (variable?.value ?? ''))}
          onClick={() => void commit(op)}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : op === 'add' ? t('varPopover.add') : t('varPopover.save')}
        </Button>
      )}
    </div>
  );

  return (
    <div className={cn('space-y-2 text-xs', showExpanded ? 'w-[26rem] max-w-[calc(100vw-3rem)]' : 'w-[16.5rem]')}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono font-medium text-foreground truncate">{`{{${name}}}`}</span>
        {env && <span className="ml-auto shrink-0 max-w-[45%] truncate text-muted-foreground">{env.name}</span>}
      </div>

      {isRuntime && (
        <p className="text-violet-600 dark:text-violet-400">
          {t('varPopover.runtime', { defaultValue: 'Set at run time by an earlier step.' })}
        </p>
      )}

      {status === 'noEnv' && !isRuntime && <p className="text-muted-foreground">{t('varPopover.noEnv')}</p>}

      {status === 'missing' && !isRuntime && (
        <>
          <p className="text-red-500">{t('varPopover.missing', { env: env?.name })}</p>
          {!readOnly && editor('add')}
        </>
      )}

      {status === 'disabled' && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-amber-600 dark:text-amber-500">{t('varPopover.disabled', { env: env?.name })}</p>
          {!readOnly && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs shrink-0" disabled={saving} onClick={() => void commit('enable')}>
              {t('varPopover.enable')}
            </Button>
          )}
        </div>
      )}

      {status === 'resolved' && editor('value')}

      {showExpanded && !readOnly && <p className="text-[10px] text-muted-foreground">{t('varPopover.expandHint')}</p>}
      {readOnly && status !== 'noEnv' && !isRuntime && <p className="text-[11px] text-muted-foreground">{t('varPopover.readOnly')}</p>}
      {result === 'saved' && (
        <p className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-500">
          <Check className="h-3 w-3" /> {t('varPopover.saved')}
        </p>
      )}
      {result === 'failed' && <p className="text-[11px] text-destructive">{t('varPopover.saveFailed')}</p>}
    </div>
  );
}
