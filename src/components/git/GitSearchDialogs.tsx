import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Braces, CaseSensitive, File, Hash, Loader2, Regex, Search, WholeWord, Zap } from 'lucide-react';
import { gitAPI } from '@/services/api';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { decodeGitContent } from './util';

// Find in Files (⌘⇧F) and Search Everywhere (⇧⇧) for the local clone
// (GIT_IDE_PLAN §F). Results open the file in the editor at the line.

interface Hit { path: string; line: number; col: number; text: string }
interface Sym { name: string; kind: string; path: string; line: number; text: string }

function Toggle({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} aria-pressed={on}
      className={cn('rounded p-1', on ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
      {children}
    </button>
  );
}

function highlight(text: string, q: string, opts: { regex: boolean; caseSensitive: boolean; word: boolean }) {
  if (!q) return text;
  let re: RegExp;
  try {
    const src = opts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(opts.word ? `\\b(?:${src})\\b` : src, opts.caseSensitive ? 'g' : 'gi');
  } catch { return text; }
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index === undefined || !m[0]) break;
    out.push(text.slice(last, m.index), <mark key={m.index} className="rounded-sm bg-amber-400/40 text-foreground">{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

export function GitFindInFiles({ repoId, open, onOpenChange, initial, onOpenHit }: {
  repoId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: { q: string; word?: boolean; caseSensitive?: boolean };
  onOpenHit: (path: string, line: number) => void;
}) {
  const { t } = useTranslation('git');
  const [q, setQ] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCase] = useState(false);
  const [word, setWord] = useState(false);
  const [mask, setMask] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const [preview, setPreview] = useState<{ path: string; lines: string[] } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ(initial?.q ?? ''); setWord(!!initial?.word); setCase(!!initial?.caseSensitive); setSel(0);
  }, [open, initial]);

  useEffect(() => {
    if (!open || !q.trim()) { setHits(null); setErr(''); return; }
    const ctl = new AbortController();
    const h = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await gitAPI.grep(repoId, { q, regex, case: caseSensitive, word, glob: mask.trim() || undefined }, ctl.signal);
        const d = res.data as { hits: Hit[]; truncated: boolean };
        setHits(d.hits); setTruncated(d.truncated); setErr(''); setSel(0);
      } catch (e) {
        if (!ctl.signal.aborted) { setErr((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? String(e)); setHits([]); }
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [open, q, regex, caseSensitive, word, mask, repoId]);

  const cur = hits?.[sel];
  useEffect(() => {
    if (!cur) { setPreview(null); return; }
    if (preview?.path === cur.path) return;
    let cancelled = false;
    gitAPI.localFile(repoId, { path: cur.path }).then((r) => {
      const d = r.data as { content?: string; encoding?: string };
      if (!cancelled) setPreview({ path: cur.path, lines: decodeGitContent(d.content, d.encoding).split('\n') });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [cur, repoId]); // eslint-disable-line react-hooks/exhaustive-deps
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => { previewRef.current?.querySelector('[data-hit="1"]')?.scrollIntoView({ block: 'center' }); }, [preview, sel]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const byFile = useMemo(() => {
    const m = new Map<string, { hit: Hit; i: number }[]>();
    (hits ?? []).forEach((h, i) => m.set(h.path, [...(m.get(h.path) ?? []), { hit: h, i }]));
    return [...m.entries()];
  }, [hits]);
  const files = byFile.length;
  const go = (h?: Hit) => { if (h) { onOpenChange(false); onOpenHit(h.path, h.line); } };
  const opts = { regex, caseSensitive, word };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[78vh] w-[92vw] max-w-[1200px] flex-col gap-0 overflow-hidden p-0"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min((hits?.length ?? 1) - 1, s + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          if (e.key === 'Enter') { e.preventDefault(); go(cur); }
        }}>
        <DialogTitle className="sr-only">{t('search.findInFiles')}</DialogTitle>
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 pr-12">
          <Search className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold">{t('search.findInFiles')}</span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.textPlaceholder')} spellCheck={false}
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring" />
          <Toggle on={caseSensitive} onClick={() => setCase((v) => !v)} title={t('search.matchCase')}><CaseSensitive className="h-4 w-4" /></Toggle>
          <Toggle on={word} onClick={() => setWord((v) => !v)} title={t('search.wholeWord')}><WholeWord className="h-4 w-4" /></Toggle>
          <Toggle on={regex} onClick={() => setRegex((v) => !v)} title={t('search.regex')}><Regex className="h-4 w-4" /></Toggle>
          <input value={mask} onChange={(e) => setMask(e.target.value)} placeholder={t('search.maskPlaceholder')} spellCheck={false}
            className="h-8 w-40 rounded-md border bg-background px-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1 text-[11px] text-muted-foreground">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {hits && t('search.summary', { count: hits.length, files })}{truncated && ` · ${t('search.truncated')}`}
          {err && <span className="text-destructive">{err}</span>}
        </div>
        <div className="flex min-h-0 flex-1">
          <div ref={listRef} className="w-1/2 min-w-0 overflow-auto border-r">
            {byFile.map(([path, list]) => (
              <div key={path}>
                <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b bg-muted/80 px-3 py-1 text-[11px] backdrop-blur">
                  <File className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate font-medium">{path.split('/').pop()}</span>
                  <span className="truncate text-muted-foreground">{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''}</span>
                  <span className="ml-auto text-muted-foreground">{list.length}</span>
                </div>
                {list.map(({ hit, i }) => (
                  <button key={i} type="button" data-i={i} onClick={() => setSel(i)} onDoubleClick={() => go(hit)}
                    className={cn('flex w-full items-baseline gap-2 px-3 py-0.5 text-left font-mono text-[12px]', i === sel ? 'bg-primary/15' : 'hover:bg-accent/40')}>
                    <span className="w-10 shrink-0 text-right text-[10px] text-muted-foreground">{hit.line}</span>
                    <span className="truncate">{highlight(hit.text.trim(), q, opts)}</span>
                  </button>
                ))}
              </div>
            ))}
            {hits && hits.length === 0 && !err && <p className="py-8 text-center text-xs text-muted-foreground">{t('search.noResults')}</p>}
          </div>
          <div ref={previewRef} className="w-1/2 min-w-0 overflow-auto font-mono text-[12px] leading-5">
            {preview && cur && preview.lines.map((l, n) => (
              <div key={n} data-hit={n + 1 === cur.line ? '1' : undefined} className={cn('flex', n + 1 === cur.line && 'bg-amber-400/15')}>
                <span className="w-10 shrink-0 select-none pr-2 text-right text-[10px] text-muted-foreground">{n + 1}</span>
                <span className="whitespace-pre">{n + 1 === cur.line ? highlight(l, q, opts) : l}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="shrink-0 border-t px-3 py-1 text-[10px] text-muted-foreground">{t('search.hintKeys')}</div>
      </DialogContent>
    </Dialog>
  );
}

export interface EverywhereAction { id: string; label: string; hint?: string; run: () => void }
type Row =
  | { kind: 'file'; path: string }
  | { kind: 'symbol'; sym: Sym }
  | { kind: 'action'; action: EverywhereAction }
  | { kind: 'text'; q: string };

export function GitSearchEverywhere({ repoId, open, onOpenChange, initialTab = 'all', actions, onOpenFile, onFindText }: {
  repoId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialTab?: 'all' | 'files' | 'symbols' | 'actions';
  actions: EverywhereAction[];
  onOpenFile: (path: string, line?: number) => void;
  onFindText: (q: string) => void;
}) {
  const { t } = useTranslation('git');
  const [tab, setTab] = useState(initialTab);
  const [q, setQ] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [syms, setSyms] = useState<Sym[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (open) { setTab(initialTab); setQ(''); setSel(0); } }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    const h = setTimeout(async () => {
      setLoading(true);
      try {
        const word = q.trim();
        const [f, s] = await Promise.all([
          tab === 'all' || tab === 'files' ? gitAPI.files(repoId, word, ctl.signal).then((r) => (r.data as string[]) ?? []) : Promise.resolve([]),
          (tab === 'all' || tab === 'symbols') && /^[A-Za-z_$][\w$]*$/.test(word) ? gitAPI.symbols(repoId, word, false, ctl.signal).then((r) => (r.data as Sym[]) ?? []) : Promise.resolve([]),
        ]);
        setFiles(f); setSyms(s); setSel(0);
      } catch { /* aborted */ } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [open, q, tab, repoId]);

  const rows: Row[] = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const acts = actions.filter((a) => !ql || a.label.toLowerCase().includes(ql));
    const r: Row[] = [];
    if (tab === 'all' || tab === 'files') r.push(...files.slice(0, tab === 'all' ? 8 : 60).map((path): Row => ({ kind: 'file', path })));
    if (tab === 'all' || tab === 'symbols') r.push(...syms.slice(0, tab === 'all' ? 8 : 100).map((sym): Row => ({ kind: 'symbol', sym })));
    if (tab === 'all' || tab === 'actions') r.push(...acts.slice(0, tab === 'all' ? 5 : 50).map((action): Row => ({ kind: 'action', action })));
    if (tab === 'all' && q.trim()) r.push({ kind: 'text', q: q.trim() });
    return r;
  }, [files, syms, actions, q, tab]);

  const run = (row?: Row) => {
    if (!row) return;
    onOpenChange(false);
    if (row.kind === 'file') onOpenFile(row.path);
    else if (row.kind === 'symbol') onOpenFile(row.sym.path, row.sym.line);
    else if (row.kind === 'action') row.action.run();
    else onFindText(row.q);
  };
  const TABS = ['all', 'files', 'symbols', 'actions'] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] max-w-2xl translate-y-0 gap-0 overflow-hidden p-0"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          if (e.key === 'Enter') { e.preventDefault(); run(rows[sel]); }
          if (e.key === 'Tab') { e.preventDefault(); setTab((x) => TABS[(TABS.indexOf(x) + (e.shiftKey ? 3 : 1)) % 4]); }
        }}>
        <DialogTitle className="sr-only">{t('search.everywhere')}</DialogTitle>
        <div className="flex items-center gap-3 border-b px-3 pr-12 pt-2 text-xs">
          {TABS.map((x) => (
            <button key={x} type="button" onClick={() => setTab(x)} className={cn('border-b-2 pb-1.5', tab === x ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {t(`search.tab.${x}`)}
            </button>
          ))}
          <span className="ml-auto pb-1.5 text-[10px] text-muted-foreground">{t('search.tabHint')}</span>
        </div>
        <div className="flex items-center gap-2 border-b px-3">
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Search className="h-4 w-4 text-muted-foreground" />}
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.everywherePlaceholder')} spellCheck={false}
            className="h-11 flex-1 bg-transparent text-sm outline-none" />
        </div>
        <div className="max-h-[420px] overflow-auto py-1">
          {rows.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">{t('search.noResults')}</p>}
          {rows.map((r, i) => {
            const active = i === sel;
            const base = cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs', active ? 'bg-primary/15' : 'hover:bg-accent/40');
            if (r.kind === 'file') {
              const name = r.path.split('/').pop()!;
              return (
                <button key={`f${r.path}`} type="button" className={base} onMouseEnter={() => setSel(i)} onClick={() => run(r)}>
                  <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="font-medium">{name}</span>
                  <span className="truncate text-muted-foreground">{r.path.slice(0, r.path.length - name.length)}</span>
                </button>
              );
            }
            if (r.kind === 'symbol') {
              return (
                <button key={`s${r.sym.path}:${r.sym.line}`} type="button" className={base} onMouseEnter={() => setSel(i)} onClick={() => run(r)}>
                  {r.sym.kind === 'class' ? <Braces className="h-3.5 w-3.5 shrink-0 text-violet-500" /> : <Hash className="h-3.5 w-3.5 shrink-0 text-sky-500" />}
                  <span className="font-mono font-medium">{r.sym.name}</span>
                  <span className="text-[10px] text-muted-foreground">{r.sym.kind}</span>
                  <span className="ml-auto truncate text-[10px] text-muted-foreground">{r.sym.path}:{r.sym.line}</span>
                </button>
              );
            }
            if (r.kind === 'action') {
              return (
                <button key={`a${r.action.id}`} type="button" className={base} onMouseEnter={() => setSel(i)} onClick={() => run(r)}>
                  <Zap className="h-3.5 w-3.5 shrink-0 text-amber-500" /><span>{r.action.label}</span>
                  {r.action.hint && <kbd className="ml-auto text-[10px] text-muted-foreground">{r.action.hint}</kbd>}
                </button>
              );
            }
            return (
              <button key="text" type="button" className={base} onMouseEnter={() => setSel(i)} onClick={() => run(r)}>
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{t('search.findText', { q: r.q })}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
