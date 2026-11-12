import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Download, BookmarkPlus } from 'lucide-react';
import { CodeEditor } from '@/components/ui/CodeEditor';
import { useThemeStore } from '@/stores/themeStore';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ResponseData } from '@/types';

interface BodyViewerProps {
  response: ResponseData;
  /** Opens "Save response" (keeps request + response under a collection). */
  onSave?: () => void;
}

function getContentType(headers: Record<string, string>): string {
  return Object.entries(headers).find(
    ([key]) => key.toLowerCase() === 'content-type'
  )?.[1] || '';
}

function detectLanguage(body: string, headers: Record<string, string>): string {
  const contentType = getContentType(headers);
  if (contentType.includes('json') || body.trim().startsWith('{') || body.trim().startsWith('[')) {
    return 'json';
  }
  if (contentType.includes('xml') || body.trim().startsWith('<?xml') || body.trim().startsWith('<')) {
    return 'xml';
  }
  if (contentType.includes('html')) {
    return 'html';
  }
  return 'plaintext';
}

type RenderKind = 'image' | 'pdf' | 'html' | 'audio' | 'video';

// renderKind returns the visual category the Preview tab can render, or
// null for plain JSON/text/etc. (where Preview falls back to text).
function renderKind(contentType: string): RenderKind | null {
  const t = contentType.toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.includes('pdf')) return 'pdf';
  if (t.includes('html')) return 'html';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  return null;
}

// bodyDataUrl builds a data: URL the browser can render. Binary responses
// arrive base64-encoded (BE sets bodyBase64); text-ish renderables (svg)
// are percent-encoded.
function bodyDataUrl(response: ResponseData): string {
  const ct = getContentType(response.headers) || 'application/octet-stream';
  if (response.bodyBase64) return `data:${ct};base64,${response.body}`;
  return `data:${ct};charset=utf-8,${encodeURIComponent(response.body)}`;
}

function downloadName(contentType: string): string {
  const subtype = (contentType.split('/')[1] || 'bin').split(';')[0].split('+')[0].replace(/^x-/, '');
  return `response.${subtype || 'bin'}`;
}

function humanSize(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// formatXml re-indents a (well-formed) XML/SOAP document. It collapses the
// existing whitespace between tags then re-adds indentation, leaving text
// content and self-closing/declaration nodes intact. Best-effort: on anything
// unexpected it returns the original so a response is never mangled.
function formatXml(xml: string): string {
  try {
    const withBreaks = xml
      .replace(/>\s*</g, '><') // collapse inter-tag whitespace
      .replace(/(>)(<)(\/*)/g, '$1\n$2$3');
    const lines = withBreaks.split('\n');
    let pad = 0;
    const out: string[] = [];
    for (let raw of lines) {
      raw = raw.trim();
      if (!raw) continue;
      const isClosing = /^<\//.test(raw);
      const isSelfContained =
        /^<[^>]+\/>$/.test(raw) || // self-closing <a/>
        /^<\?/.test(raw) || // <?xml ?>
        /^<!--/.test(raw) || // comment
        /^<[^>]+>[^<]*<\/[^>]+>$/.test(raw); // <a>text</a> on one line
      const isOpening = /^<[^!?/][^>]*[^/]>$/.test(raw) && !isSelfContained;
      if (isClosing) pad = Math.max(pad - 1, 0);
      out.push('  '.repeat(pad) + raw);
      if (isOpening) pad += 1;
    }
    return out.join('\n');
  } catch {
    return xml;
  }
}

function prettyPrint(body: string, language: string): string {
  if (language === 'json') {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  if (language === 'xml') return formatXml(body);
  return body;
}

interface SoapFault {
  code: string;
  message: string;
}

// detectSoapFault recognizes both SOAP 1.1 (faultcode/faultstring) and
// SOAP 1.2 (Code/Value + Reason/Text) fault envelopes so we can flag them
// prominently — a SOAP fault is an application error, not a transport one.
function detectSoapFault(body: string, language: string): SoapFault | null {
  if (language !== 'xml') return null;
  if (!/<(?:[\w-]+:)?Fault[\s>]/.test(body)) return null;
  const pick = (re: RegExp) => body.match(re)?.[1]?.trim() || '';
  const decode = (s: string) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  const message =
    pick(/<(?:[\w-]+:)?faultstring[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?faultstring>/i) ||
    pick(/<(?:[\w-]+:)?Text[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Text>/i);
  const code =
    pick(/<(?:[\w-]+:)?faultcode[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?faultcode>/i) ||
    pick(/<(?:[\w-]+:)?Value[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Value>/i);
  if (!message && !code) return null;
  return { code: decode(code), message: decode(message) };
}

export function BodyViewer({ response, onSave }: BodyViewerProps) {
  const { t } = useTranslation(['response', 'common']);
  const { theme } = useThemeStore();
  const contentType = getContentType(response.headers);
  const kind = renderKind(contentType);
  // Binary renderables (image/pdf/audio/video) are unreadable as Pretty/Raw
  // text, so default straight to Preview. HTML/JSON/text keep Pretty.
  const rendersBinary = kind !== null && kind !== 'html';
  const [viewMode, setViewMode] = useState<'pretty' | 'raw' | 'preview'>(rendersBinary ? 'preview' : 'pretty');
  const [copied, setCopied] = useState(false);
  // Natural pixel dimensions of a rendered image, filled in on <img> load.
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (rendersBinary) setViewMode('preview');
    setImgDims(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  const language = detectLanguage(response.body, response.headers);
  const prettyBody = prettyPrint(response.body, language);
  const soapFault = detectSoapFault(response.body, language);
  const dataUrl = kind ? bodyDataUrl(response) : '';
  // A download URL for the response body regardless of type (the preview bar
  // only offers download for renderable binaries). Memoised so a large text
  // body isn't re-encoded on every render.
  const downloadUrl = useMemo(() => (response.body ? bodyDataUrl(response) : ''), [response]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2">
      <div className="flex items-center justify-between shrink-0">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as typeof viewMode)}>
          <TabsList className="h-7">
            <TabsTrigger value="pretty" className="text-[11px] h-5 px-2">{t('response:body.pretty')}</TabsTrigger>
            <TabsTrigger value="raw" className="text-[11px] h-5 px-2">{t('response:body.raw')}</TabsTrigger>
            <TabsTrigger value="preview" className="text-[11px] h-5 px-2">{t('response:body.preview')}</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCopy}>
            {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
            {copied ? t('common:copied') : t('common:copy')}
          </Button>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={downloadName(contentType)}
              className="inline-flex h-7 items-center rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={t('response:body.download')}
            >
              <Download className="h-3 w-3 mr-1" />
              {t('response:body.download')}
            </a>
          )}
          {onSave && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onSave} title={t('response:save.title')}>
              <BookmarkPlus className="h-3 w-3 mr-1" />
              {t('response:body.save')}
            </Button>
          )}
        </div>
      </div>

      {soapFault && (
        <div className="shrink-0 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          <span className="font-semibold">{t('response:body.soapFault')}</span>
          {soapFault.code && <span className="font-mono"> · {soapFault.code}</span>}
          {soapFault.message && <div className="mt-0.5 break-words text-red-800 dark:text-red-300">{soapFault.message}</div>}
        </div>
      )}

      {viewMode === 'pretty' && (
        <div className="border rounded-md overflow-hidden flex-1 min-h-0">
          <CodeEditor
            height="100%"
            language={language}
            theme={theme === 'dark' ? 'vs-dark' : 'light'}
            value={prettyBody}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              tabSize: 2,
              automaticLayout: true,
              padding: { top: 8 },
              domReadOnly: true,
            }}
          />
        </div>
      )}

      {viewMode === 'raw' && (
        <div className="border rounded-md p-3 flex-1 min-h-0 overflow-auto">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
            {response.body}
          </pre>
        </div>
      )}

      {viewMode === 'preview' && (
        <div className="border rounded-md overflow-hidden flex-1 min-h-0 flex flex-col">
          {/* Renderable binary responses get a content-type + download bar. */}
          {kind && kind !== 'html' && (
            <div className="flex items-center justify-between px-3 py-1.5 border-b text-[11px] text-muted-foreground bg-muted/30 shrink-0">
              <span className="font-mono truncate">
                {contentType || t('response:body.unknownType')}
                {kind === 'image' && imgDims && ` · ${imgDims.w}×${imgDims.h}px`}
                {response.size != null && ` · ${humanSize(response.size)}`}
              </span>
              <a
                href={dataUrl}
                download={downloadName(contentType)}
                className="inline-flex items-center gap-1 hover:text-foreground shrink-0"
              >
                <Download className="h-3 w-3" /> {t('response:body.download')}
              </a>
            </div>
          )}

          {kind === 'html' ? (
            <iframe
              srcDoc={response.body}
              className="w-full flex-1 min-h-0 bg-white"
              sandbox="allow-same-origin"
              title={t('response:body.previewTitle')}
            />
          ) : kind === 'image' ? (
            <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center bg-muted/20 p-3">
              <img
                src={dataUrl}
                alt={t('response:body.imageAlt')}
                className="max-w-full max-h-full object-contain"
                onLoad={(e) => setImgDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              />
            </div>
          ) : kind === 'pdf' ? (
            <iframe src={dataUrl} title={t('response:body.pdfTitle')} className="w-full flex-1 min-h-0 bg-white" />
          ) : kind === 'audio' ? (
            <div className="flex-1 min-h-0 flex items-center justify-center p-4">
              <audio controls src={dataUrl} className="w-full max-w-lg" />
            </div>
          ) : kind === 'video' ? (
            <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center bg-muted/20 p-3">
              <video controls src={dataUrl} className="max-w-full max-h-full" />
            </div>
          ) : (
            <div className="p-3 flex-1 min-h-0 overflow-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">{prettyBody}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
