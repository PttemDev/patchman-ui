import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConflictBlock, ConflictSegment } from './util';

// JetBrains "Merge Revisions" layout (GIT_IDE_PLAN §C): Yours | Result |
// Theirs, aligned block by block. Unchanged text shows once per column
// (collapsed when long); each conflict gets » / « to take a side (both =
// yours then theirs), × to drop a side, and an editable Result. F7 / ⇧F7 jump
// between unresolved conflicts. State lives in GitConflictResolver.

export type ThreeChoice = 'current' | 'incoming' | 'both' | 'edit';
export interface ThreeState { choice: ThreeChoice; edited: string }

type Segment = ConflictSegment;

function resolved(block: ConflictBlock, st?: ThreeState): string[] | null {
  if (!st) return null;
  switch (st.choice) {
    case 'current': return block.ours;
    case 'incoming': return block.theirs;
    case 'both': return [...block.ours, ...block.theirs];
    case 'edit': return st.edited === '' ? [] : st.edited.split('\n');
  }
}

function Lines({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <pre className={cn('min-h-[1.25rem] overflow-x-auto whitespace-pre px-2 py-0.5 font-mono text-[12px] leading-5', className)}>
      {lines.length ? lines.join('\n') : ' '}
    </pre>
  );
}

function TextRow({ lines }: { lines: string[] }) {
  const { t } = useTranslation('git');
  const [open, setOpen] = useState(false);
  const long = lines.length > 8 && !open;
  const head = long ? lines.slice(0, 3) : lines;
  const tail = long ? lines.slice(-3) : [];
  const col = (
    <div className="min-w-0 text-muted-foreground">
      <Lines lines={head} />
      {long && (
        <button type="button" onClick={() => setOpen(true)} className="w-full border-y border-dashed bg-muted/30 py-0.5 text-[10px] hover:bg-muted/60">
          {t('resolver3.unchanged', { count: lines.length - 6 })}
        </button>
      )}
      {long && <Lines lines={tail} />}
    </div>
  );
  return <div className="grid grid-cols-3 divide-x">{col}{col}{col}</div>;
}

export function GitMergeThreePane({ segments, choices, onChoose, oursLabel, theirsLabel }: {
  segments: Segment[];
  choices: Record<number, ThreeState>;
  onChoose: (idx: number, choice: ThreeChoice | null, edited?: string) => void;
  oursLabel: string;
  theirsLabel: string;
}) {
  const { t } = useTranslation('git');
  const refs = useRef<Record<number, HTMLDivElement | null>>({});
  const [active, setActive] = useState(0);
  const conflicts = segments.filter((s) => s.kind === 'conflict').length;

  const jump = (dir: 1 | -1) => {
    for (let step = 1; step <= conflicts; step++) {
      const i = (active + dir * step + conflicts) % conflicts;
      if (!choices[i]) {
        setActive(i);
        refs.current[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }
  };
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F7') return;
      e.preventDefault();
      jump(e.shiftKey ? -1 : 1);
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

  const take = (idx: number, side: 'ours' | 'theirs') => {
    const cur = choices[idx]?.choice;
    if (side === 'ours') onChoose(idx, cur === 'incoming' ? 'both' : 'current');
    else onChoose(idx, cur === 'current' ? 'both' : 'incoming');
  };
  const drop = (idx: number, side: 'ours' | 'theirs') => {
    const cur = choices[idx]?.choice;
    if (cur === 'both') onChoose(idx, side === 'ours' ? 'incoming' : 'current');
    else if ((side === 'ours' && cur === 'current') || (side === 'theirs' && cur === 'incoming')) onChoose(idx, null);
    else if (!cur) onChoose(idx, side === 'ours' ? 'incoming' : 'current');
  };

  let ci = -1;
  return (
    <div ref={containerRef} tabIndex={0} className="flex min-h-0 flex-1 flex-col outline-none">
      <div className="grid shrink-0 grid-cols-3 divide-x border-b bg-muted/30 text-[11px]">
        <div className="truncate px-2 py-1"><span className="font-semibold text-sky-600 dark:text-sky-400">{t('resolver3.yours')}</span> <span className="text-muted-foreground">{oursLabel}</span></div>
        <div className="flex items-center justify-between px-2 py-1">
          <span className="font-semibold">{t('resolver3.result')}</span>
          <span className="text-muted-foreground">{t('resolver3.navHint')}</span>
        </div>
        <div className="truncate px-2 py-1"><span className="font-semibold text-emerald-600 dark:text-emerald-400">{t('resolver3.theirs')}</span> <span className="text-muted-foreground">{theirsLabel}</span></div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {segments.map((seg, si) => {
          if (seg.kind === 'text') return <TextRow key={si} lines={seg.lines} />;
          ci++;
          const idx = ci;
          const st = choices[idx];
          const res = resolved(seg.block, st);
          const usesOurs = st?.choice === 'current' || st?.choice === 'both';
          const usesTheirs = st?.choice === 'incoming' || st?.choice === 'both';
          const pending = !st;
          return (
            <div
              key={si}
              ref={(el) => { refs.current[idx] = el; }}
              onClick={() => setActive(idx)}
              className={cn('grid grid-cols-3 divide-x border-y', idx === active && 'ring-1 ring-inset ring-primary/60')}
            >
              <div className={cn('relative min-w-0', pending ? 'bg-red-500/10' : usesOurs ? 'bg-sky-500/15' : 'bg-muted/40 opacity-60')}>
                <Lines lines={seg.block.ours} className="pt-6" />
                <div className="absolute right-1 top-0.5 flex gap-0.5">
                  <button type="button" title={t('resolver3.dropYours')} aria-label={t('resolver3.dropYours')} onClick={() => drop(idx, 'ours')} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                  <button type="button" title={t('resolver3.takeYours')} aria-label={t('resolver3.takeYours')} onClick={() => take(idx, 'ours')} disabled={usesOurs} className="rounded p-0.5 text-sky-600 hover:bg-sky-500/20 disabled:opacity-30 dark:text-sky-400"><ChevronsRight className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <div className={cn('min-w-0', pending ? 'bg-red-500/5' : 'bg-emerald-500/5')}>
                <textarea
                  value={res ? res.join('\n') : (seg.block.base ?? []).join('\n')}
                  onChange={(e) => onChoose(idx, 'edit', e.target.value)}
                  spellCheck={false}
                  rows={Math.max(1, (res ?? seg.block.base ?? []).length, seg.block.ours.length, seg.block.theirs.length)}
                  className={cn('block w-full resize-none bg-transparent px-2 pb-0.5 pt-6 font-mono text-[12px] leading-5 outline-none', pending && 'text-muted-foreground italic')}
                  title={pending ? t('resolver3.pendingTitle') : undefined}
                />
              </div>
              <div className={cn('relative min-w-0', pending ? 'bg-red-500/10' : usesTheirs ? 'bg-emerald-500/15' : 'bg-muted/40 opacity-60')}>
                <Lines lines={seg.block.theirs} className="pt-6" />
                <div className="absolute left-1 top-0.5 flex gap-0.5">
                  <button type="button" title={t('resolver3.takeTheirs')} aria-label={t('resolver3.takeTheirs')} onClick={() => take(idx, 'theirs')} disabled={usesTheirs} className="rounded p-0.5 text-emerald-600 hover:bg-emerald-500/20 disabled:opacity-30 dark:text-emerald-400"><ChevronsLeft className="h-3.5 w-3.5" /></button>
                  <button type="button" title={t('resolver3.dropTheirs')} aria-label={t('resolver3.dropTheirs')} onClick={() => drop(idx, 'theirs')} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
