import { useMemo, useState } from 'react';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { REGEX_LIBRARY } from '../regexPatterns';

// Canonical flag order — toggles rebuild the flags string in this order so it
// stays stable regardless of the sequence a user clicks the chips in. `descKey`
// is an i18n key (devtools ns) resolved in the component's tooltip.
const FLAG_DEFS: { flag: string; descKey: string }[] = [
  { flag: 'g', descKey: 'regex.flag.g' },
  { flag: 'i', descKey: 'regex.flag.i' },
  { flag: 'm', descKey: 'regex.flag.m' },
  { flag: 's', descKey: 'regex.flag.s' },
  { flag: 'u', descKey: 'regex.flag.u' },
  { flag: 'y', descKey: 'regex.flag.y' },
];
const FLAG_ORDER = FLAG_DEFS.map((f) => f.flag);

const MAX_MATCHES = 1000;
const MAX_LISTED = 50;

interface MatchInfo {
  index: number;
  text: string;
  groups: (string | undefined)[];
  named: [string, string][];
}

function CopyButton({
  value,
  label,
  variant = 'ghost',
}: {
  value: string;
  label?: string;
  variant?: 'ghost' | 'outline';
}) {
  const { t } = useTranslation('devtools');
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: t('copy.toClipboard') });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: t('copy.failed'), variant: 'destructive' });
    }
  };
  return (
    <Button type="button" size="sm" variant={variant} className={label ? '' : 'h-7 w-7 p-0 shrink-0'} onClick={copy} disabled={!value}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

export function RegexTool() {
  const { t } = useTranslation('devtools');
  const [pattern, setPattern] = useState('(\\d{4})-(\\d{2})-(\\d{2})');
  const [flags, setFlags] = useState('g');
  const [text, setText] = useState('Events on 2026-07-24 and 2026-12-31 are scheduled.');
  const [replacement, setReplacement] = useState('$3/$2/$1');

  const toggleFlag = (flag: string) => {
    setFlags((prev) => {
      const next = prev.includes(flag) ? prev.replace(flag, '') : prev + flag;
      return FLAG_ORDER.filter((c) => next.includes(c)).join('');
    });
  };

  // Compile on every change. Empty pattern is a valid "no-op" (no error,
  // no matches); anything else is compiled inside try/catch.
  const compiled = useMemo(() => {
    if (!pattern) return { re: null as RegExp | null, error: null as string | null };
    try {
      return { re: new RegExp(pattern, flags), error: null as string | null };
    } catch (e) {
      return { re: null as RegExp | null, error: e instanceof Error ? e.message : t('regex.invalidFallback') };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern, flags]);

  // Run the compiled regex over the test string. Global patterns loop with
  // exec (guarding zero-length matches against an infinite loop); non-global
  // patterns take the single first match. Capped at MAX_MATCHES.
  const analysis = useMemo(() => {
    const re = compiled.re;
    const matches: MatchInfo[] = [];
    let truncated = false;
    if (!re) return { matches, truncated };

    const toInfo = (m: RegExpExecArray): MatchInfo => ({
      index: m.index,
      text: m[0],
      groups: m.slice(1),
      named: m.groups ? Object.entries(m.groups).map(([k, v]) => [k, v ?? ''] as [string, string]) : [],
    });

    if (re.global) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        matches.push(toInfo(m));
        // Guard: a zero-length match leaves lastIndex where it started —
        // bump it manually or exec would spin forever on the same spot.
        if (m.index === re.lastIndex) re.lastIndex++;
        if (matches.length >= MAX_MATCHES) {
          truncated = true;
          break;
        }
      }
    } else {
      const m = re.exec(text);
      if (m) matches.push(toInfo(m));
    }
    return { matches, truncated };
  }, [compiled.re, text]);

  // Build the highlighted view: plain-text spans interleaved with <mark>ed
  // matches. Zero-length matches advance the cursor without drawing a mark.
  const highlighted = useMemo(() => {
    const segs: React.ReactNode[] = [];
    let lastEnd = 0;
    analysis.matches.forEach((mm, i) => {
      if (mm.index < lastEnd) return; // overlap guard
      if (mm.index > lastEnd) segs.push(<span key={`t${i}`}>{text.slice(lastEnd, mm.index)}</span>);
      if (mm.text.length > 0) {
        segs.push(
          <mark key={`m${i}`} className="bg-yellow-300/40 dark:bg-yellow-500/30 rounded-sm">
            {mm.text}
          </mark>,
        );
        lastEnd = mm.index + mm.text.length;
      } else {
        lastEnd = mm.index;
      }
    });
    segs.push(<span key="tail">{text.slice(lastEnd)}</span>);
    return segs;
  }, [analysis.matches, text]);

  const replacePreview = useMemo(() => {
    if (!compiled.re) return null;
    try {
      return text.replace(compiled.re, replacement);
    } catch (e) {
      return e instanceof Error ? `⚠ ${e.message}` : `⚠ ${t('regex.invalidReplacement')}`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compiled.re, text, replacement]);

  const loadPattern = (p: { pattern: string; flags: string; sample: string }) => {
    setPattern(p.pattern);
    setFlags(FLAG_ORDER.filter((c) => p.flags.includes(c)).join(''));
    setText(p.sample);
  };

  return (
    <div className="flex min-h-0 h-full">
      {/* Common-patterns library — a separate left panel, Cookbook-style. */}
      <div className="w-80 shrink-0 border-r overflow-y-auto p-2 space-y-3">
        <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t('regex.commonPatterns')}</p>
        {REGEX_LIBRARY.map((cat) => (
          <div key={cat.id} className="space-y-0.5">
            <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">{t(`regexLib.cat.${cat.id}`)}</p>
            {cat.patterns.map((p) => {
              const active = p.pattern === pattern;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => loadPattern(p)}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-left transition-colors',
                    active ? 'bg-accent' : 'hover:bg-accent/60',
                  )}
                >
                  <span className="block text-xs font-medium">{t(`regexLib.${p.id}.name`)}</span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">{t(`regexLib.${p.id}.description`)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Tester */}
      <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
        {/* Pattern row: /source/flags */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">{t('regex.pattern')}</Label>
            <CopyButton value={pattern} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground font-mono text-sm select-none">/</span>
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="\d+"
              className="font-mono text-xs"
              spellCheck={false}
            />
            <span className="text-muted-foreground font-mono text-sm select-none">/</span>
            <span className="text-muted-foreground font-mono text-xs w-12 shrink-0">{flags || '—'}</span>
          </div>
          <TooltipProvider delayDuration={100}>
            <div className="flex flex-wrap items-center gap-1 pt-1">
              {FLAG_DEFS.map(({ flag, descKey }) => {
                const active = flags.includes(flag);
                return (
                  <Tooltip key={flag}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        className="h-7 w-7 p-0 font-mono"
                        aria-pressed={active}
                        onClick={() => toggleFlag(flag)}
                      >
                        {flag}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{t(descKey)}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
        </div>

        {compiled.error && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{t('regex.invalidLabel')} — {compiled.error}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">{t('regex.testString')}</Label>
            <Button size="sm" variant="ghost" onClick={() => setText('')} disabled={!text}>
              {t('actions.clear')}
            </Button>
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('regex.testPlaceholder')}
            className="font-mono text-xs min-h-[140px]"
            spellCheck={false}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('regex.matches')}</Label>
          <div className="rounded-md border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words min-h-[60px]">
            {text ? highlighted : <span className="text-muted-foreground">{t('regex.noTestString')}</span>}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">
              {t(analysis.matches.length === 1 ? 'regex.matchCountOne' : 'regex.matchCountOther', { count: analysis.matches.length })}
            </Label>
            {analysis.truncated && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                {t('regex.cappedAt', { max: MAX_MATCHES })}
              </span>
            )}
          </div>
          {analysis.matches.length > 0 && (
            <div className="space-y-1.5">
              {analysis.matches.slice(0, MAX_LISTED).map((m, i) => (
                <div key={i} className="rounded-md border px-2.5 py-1.5 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0">
                      @{m.index}
                    </Badge>
                    <span className="font-mono text-xs break-all flex-1">{m.text || t('placeholders.empty')}</span>
                  </div>
                  {m.groups.length > 0 && (
                    <div className="flex flex-col gap-0.5 pl-1">
                      {m.groups.map((g, gi) => (
                        <div key={gi} className="flex items-center gap-1.5 text-[11px]">
                          <span className="text-muted-foreground font-mono w-8 shrink-0">${gi + 1}</span>
                          <span className="font-mono break-all">
                            {g === undefined ? <span className="text-muted-foreground italic">{t('placeholders.undefined')}</span> : g || t('placeholders.empty')}
                          </span>
                        </div>
                      ))}
                      {m.named.map(([name, val]) => (
                        <div key={name} className="flex items-center gap-1.5 text-[11px]">
                          <span className="text-muted-foreground font-mono shrink-0">{'$<' + name + '>'}</span>
                          <span className="font-mono break-all">{val || t('placeholders.empty')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {analysis.matches.length > MAX_LISTED && (
                <p className="text-[10px] text-muted-foreground">
                  {t('regex.andMore', { count: analysis.matches.length - MAX_LISTED })}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Replace */}
        <div className="space-y-1.5 border-t pt-4">
          <Label className="text-xs text-muted-foreground">
            {t('regex.replaceWith')} <span className="font-mono">$1</span> / <span className="font-mono">{'$<name>'}</span>
          </Label>
          <Input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="$1"
            className="font-mono text-xs"
            spellCheck={false}
          />
          {compiled.re && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">{t('regex.result')}</Label>
                <CopyButton value={replacePreview ?? ''} label={t('common:copy')} variant="outline" />
              </div>
              <pre className="rounded-md border bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words min-h-[60px] max-h-60 overflow-auto">
                {replacePreview}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
