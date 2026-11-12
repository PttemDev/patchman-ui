import { memo, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeHighlight from 'rehype-highlight';
import { ImageOff, Loader2 } from 'lucide-react';
import { notesAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import { MermaidBlock } from './MermaidBlock';
import './markdown.css';

// Sanitizing schema: GitHub's defaults (no raw HTML, safe attributes) plus our
// two internal URL schemes — note:<id> links and attachment:<id> images.
const schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'note'],
    src: [...(defaultSchema.protocols?.src ?? []), 'attachment'],
  },
};

// react-markdown strips unknown URL schemes before sanitizing; let ours through.
function urlTransform(url: string) {
  return /^(note|attachment):/i.test(url) ? url : defaultUrlTransform(url);
}

// Fetched image object URLs, shared across views (attachments are immutable).
const imageCache = new Map<string, Promise<string>>();

function loadAttachment(id: string): Promise<string> {
  let p = imageCache.get(id);
  if (!p) {
    p = notesAPI.attachment(id).then((res) => URL.createObjectURL(res.data as Blob));
    p.catch(() => imageCache.delete(id));
    imageCache.set(id, p);
  }
  return p;
}

function AttachmentImage({ id, alt }: { id: string; alt?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadAttachment(id).then((u) => { if (!cancelled) setSrc(u); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [id]);
  if (failed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground border rounded px-2 py-1">
        <ImageOff className="h-3.5 w-3.5" /> {alt || 'image'}
      </span>
    );
  }
  if (!src) return <Loader2 className="inline h-4 w-4 animate-spin text-muted-foreground" />;
  return <img src={src} alt={alt ?? ''} loading="lazy" />;
}

export interface MarkdownViewProps {
  markdown: string;
  className?: string;
  /** Open another note (note:<id>[#anchor] links). */
  onOpenNote?: (id: string, anchor?: string) => void;
  /** Note ids that exist (links to others render as "missing"). */
  knownNoteIds?: Set<string>;
  /** Make GFM task checkboxes clickable: called with the 1-based source line. */
  onToggleTask?: (line: number) => void;
}

// MarkdownView renders note markdown: GFM (tables, task lists, strikethrough,
// autolinks), heading anchors, highlighted code, Mermaid fences, internal note
// links and attachment images. No raw HTML.
export const MarkdownView = memo(function MarkdownView({ markdown, className, onOpenNote, knownNoteIds, onToggleTask }: MarkdownViewProps) {
  const components: ComponentProps<typeof ReactMarkdown>['components'] = {
    a({ href, children, node: _node, ...rest }) {
      void _node;
      if (href?.startsWith('note:')) {
        const [noteId, anchor] = href.slice(5).split('#');
        const missing = knownNoteIds && !knownNoteIds.has(noteId);
        return (
          <a
            href="#"
            className={cn('md-note-link', missing && 'md-missing')}
            onClick={(e) => { e.preventDefault(); onOpenNote?.(noteId, anchor); }}
          >
            {children}
          </a>
        );
      }
      if (href?.startsWith('#')) {
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              const target = (e.currentTarget.closest('.md-view') ?? document).querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`);
              target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            {children}
          </a>
        );
      }
      return <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>;
    },
    img({ src, alt }) {
      if (typeof src === 'string' && src.startsWith('attachment:')) return <AttachmentImage id={src.slice(11)} alt={alt} />;
      return <img src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />;
    },
    code({ className: cls, children, node: _node, ...rest }) {
      void _node;
      if (cls?.includes('language-mermaid')) return <MermaidBlock code={String(children).replace(/\n$/, '')} />;
      return <code className={cls} {...rest}>{children}</code>;
    },
    pre({ children, node }) {
      // A mermaid fence renders its own block (no <pre> chrome around the SVG).
      const first = node?.children?.[0];
      const lang = first && 'properties' in first ? String((first.properties?.className as string[] | undefined)?.join(' ') ?? '') : '';
      if (lang.includes('language-mermaid')) return <>{children}</>;
      return <pre>{children}</pre>;
    },
    li({ children, className: cls, node }) {
      const line = node?.position?.start.line;
      const isTask = typeof cls === 'string' && cls.includes('task-list-item');
      return (
        <li
          className={cls}
          onClickCapture={isTask && onToggleTask && line ? (e) => {
            if ((e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); onToggleTask(line); }
          } : undefined}
        >
          {children as ReactNode}
        </li>
      );
    },
    input({ type, checked }) {
      if (type !== 'checkbox') return null;
      return <input type="checkbox" checked={!!checked} disabled={!onToggleTask} readOnly onChange={() => {}} />;
    },
  };

  return (
    <div className={cn('md-view', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema], rehypeSlug, [rehypeHighlight, { plainText: ['mermaid', 'text', 'txt', 'plain'] }]]}
        urlTransform={urlTransform}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
});
