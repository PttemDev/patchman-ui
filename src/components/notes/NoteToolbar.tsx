import { forwardRef, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Monaco } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';
import {
  Bold, Code, FileSymlink, Heading, HelpCircle, ImagePlus, Italic, Link, List, ListChecks, ListOrdered, Minus,
  SquareCode, Strikethrough, Table, TextQuote, Workflow,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { insertBlock, insertLink, prefixLines, startNoteLink, wrapSelection } from './markdownActions';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

// NoteToolbar puts markdown within reach of people who don't know the syntax:
// every button inserts (or toggles) the markdown for that element, and the
// "?" popover is a short cheat sheet. Writes go through the editor, so Undo
// works and the result stays plain markdown.
export function NoteToolbar({
  editor,
  monaco,
  onImages,
  className,
}: {
  editor: MonacoType.editor.IStandaloneCodeEditor | null;
  monaco: Monaco | null;
  onImages: (files: File[]) => void;
  className?: string;
}) {
  const { t } = useTranslation('notes');
  const fileRef = useRef<HTMLInputElement>(null);
  const ready = !!editor && !!monaco;
  const run = (fn: (e: MonacoType.editor.IStandaloneCodeEditor, m: Monaco) => void) => () => {
    if (editor && monaco) fn(editor, monaco);
  };

  const tableBlock = [
    `| ${t('toolbar.tableColumn', { n: 1 })} | ${t('toolbar.tableColumn', { n: 2 })} | ${t('toolbar.tableColumn', { n: 3 })} |`,
    '| --- | --- | --- |',
    '|  |  |  |',
    '|  |  |  |',
  ].join('\n');
  const mermaidBlock = [
    '```mermaid',
    'flowchart TD',
    `  A[${t('toolbar.mermaidStart')}] --> B{${t('toolbar.mermaidDecision')}}`,
    `  B -->|${t('toolbar.mermaidYes')}| C[${t('toolbar.mermaidDone')}]`,
    `  B -->|${t('toolbar.mermaidNo')}| A`,
    '```',
  ].join('\n');

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn('flex flex-wrap items-center gap-0.5', className)} role="toolbar" aria-label={t('toolbar.label')}>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <ToolButton disabled={!ready} label={t('toolbar.heading')}><Heading className="h-3.5 w-3.5" /></ToolButton>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p>{t('toolbar.heading')}</p></TooltipContent>
          </Tooltip>
          {/* Hand focus back to the editor, not the menu button, so typing continues there. */}
          <DropdownMenuContent align="start" className="w-44" onCloseAutoFocus={(e) => { e.preventDefault(); editor?.focus(); }}>
            <DropdownMenuItem onClick={run((e, m) => prefixLines(e, m, 'heading', 1))}><span className="text-lg font-bold">{t('toolbar.h1')}</span></DropdownMenuItem>
            <DropdownMenuItem onClick={run((e, m) => prefixLines(e, m, 'heading', 2))}><span className="text-base font-bold">{t('toolbar.h2')}</span></DropdownMenuItem>
            <DropdownMenuItem onClick={run((e, m) => prefixLines(e, m, 'heading', 3))}><span className="text-sm font-semibold">{t('toolbar.h3')}</span></DropdownMenuItem>
            <DropdownMenuItem onClick={run((e, m) => prefixLines(e, m, 'heading', 0))}><span className="text-sm">{t('toolbar.paragraph')}</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tip label={`${t('toolbar.bold')} (${mod}B)`}><ToolButton disabled={!ready} label={t('toolbar.bold')} onClick={run((e, m) => wrapSelection(e, m, '**', '**', t('toolbar.boldText')))}><Bold className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Tip label={`${t('toolbar.italic')} (${mod}I)`}><ToolButton disabled={!ready} label={t('toolbar.italic')} onClick={run((e, m) => wrapSelection(e, m, '_', '_', t('toolbar.italicText')))}><Italic className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Tip label={t('toolbar.strike')}><ToolButton disabled={!ready} label={t('toolbar.strike')} onClick={run((e, m) => wrapSelection(e, m, '~~', '~~', t('toolbar.strikeText')))}><Strikethrough className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Tip label={t('toolbar.code')}><ToolButton disabled={!ready} label={t('toolbar.code')} onClick={run((e, m) => wrapSelection(e, m, '`', '`', 'code'))}><Code className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Sep />
        <Tip label={t('toolbar.bulletList')}><ToolButton disabled={!ready} label={t('toolbar.bulletList')} onClick={run((e, m) => prefixLines(e, m, 'bullet'))}><List className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Tip label={t('toolbar.numberedList')}><ToolButton disabled={!ready} label={t('toolbar.numberedList')} onClick={run((e, m) => prefixLines(e, m, 'number'))}><ListOrdered className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Tip label={t('toolbar.taskList')}><ToolButton disabled={!ready} label={t('toolbar.taskList')} onClick={run((e, m) => prefixLines(e, m, 'task'))}><ListChecks className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Tip label={t('toolbar.quote')}><ToolButton disabled={!ready} label={t('toolbar.quote')} onClick={run((e, m) => prefixLines(e, m, 'quote'))}><TextQuote className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Sep />
        <Tip label={t('toolbar.link')}><ToolButton disabled={!ready} label={t('toolbar.link')} onClick={run((e, m) => insertLink(e, m, t('toolbar.linkText')))}><Link className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Tip label={t('toolbar.noteLink')}><ToolButton disabled={!ready} label={t('toolbar.noteLink')} onClick={run((e) => startNoteLink(e))}><FileSymlink className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Tip label={t('toolbar.image')}><ToolButton disabled={!ready} label={t('toolbar.image')} onClick={() => fileRef.current?.click()}><ImagePlus className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Tip label={t('toolbar.table')}><ToolButton disabled={!ready} label={t('toolbar.table')} onClick={run((e, m) => insertBlock(e, m, tableBlock, t('toolbar.tableColumn', { n: 1 })))}><Table className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Tip label={t('toolbar.codeBlock')}><ToolButton disabled={!ready} label={t('toolbar.codeBlock')} onClick={run((e, m) => insertBlock(e, m, '```\ncode\n```', 'code'))}><SquareCode className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Tip label={t('toolbar.diagram')}><ToolButton disabled={!ready} label={t('toolbar.diagram')} onClick={run((e, m) => insertBlock(e, m, mermaidBlock))}><Workflow className="h-3.5 w-3.5" /></ToolButton></Tip>
        <Tip label={t('toolbar.divider')}><ToolButton disabled={!ready} label={t('toolbar.divider')} onClick={run((e, m) => insertBlock(e, m, '---'))}><Minus className="h-3.5 w-3.5" /></ToolButton></Tip>
        <div className="flex-1" />
        <MarkdownHelp />
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) onImages(files);
          }}
        />
      </div>
    </TooltipProvider>
  );
}

const ToolButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  function ToolButton({ children, label, onMouseDown, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        // A mousedown would steal focus (and the selection) from the editor.
        onMouseDown={(e) => { e.preventDefault(); onMouseDown?.(e); }}
        className={cn(
          'h-7 w-7 shrink-0 rounded flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:pointer-events-none',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom"><p>{label}</p></TooltipContent>
    </Tooltip>
  );
}

function Sep() {
  return <div className="mx-1 h-4 w-px bg-border shrink-0" />;
}

function MarkdownHelp() {
  const { t } = useTranslation('notes');
  const rows: [string, string][] = [
    ['# ' + t('toolbar.h1'), t('help.heading')],
    ['**' + t('toolbar.boldText') + '**', t('toolbar.bold')],
    ['_' + t('toolbar.italicText') + '_', t('toolbar.italic')],
    ['~~' + t('toolbar.strikeText') + '~~', t('toolbar.strike')],
    ['`code`', t('toolbar.code')],
    ['- ' + t('help.item'), t('toolbar.bulletList')],
    ['1. ' + t('help.item'), t('toolbar.numberedList')],
    ['- [ ] ' + t('help.item'), t('toolbar.taskList')],
    ['> ' + t('help.quoteText'), t('toolbar.quote')],
    ['[' + t('toolbar.linkText') + '](https://…)', t('toolbar.link')],
    ['[[', t('toolbar.noteLink')],
    ['```', t('toolbar.codeBlock')],
    ['```mermaid', t('toolbar.diagram')],
    ['| a | b |', t('toolbar.table')],
    ['---', t('toolbar.divider')],
  ];
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t('help.button')}
              className="h-7 px-2 shrink-0 rounded flex items-center gap-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('help.button')}</span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom"><p>{t('help.title')}</p></TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="text-sm font-medium mb-1">{t('help.title')}</div>
        <p className="text-[11px] text-muted-foreground mb-2">{t('help.intro')}</p>
        <table className="w-full text-xs">
          <tbody>
            {rows.map(([syntax, what]) => (
              <tr key={syntax} className="border-t first:border-t-0">
                <td className="py-1 pr-2 font-mono text-[11px] whitespace-nowrap">{syntax}</td>
                <td className="py-1 text-muted-foreground">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-muted-foreground mt-2">{t('help.images')}</p>
      </PopoverContent>
    </Popover>
  );
}
