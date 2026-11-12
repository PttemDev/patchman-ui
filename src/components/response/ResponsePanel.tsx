import { ArrowDown, Loader2, Copy, Check, ArrowUpDown, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { useRequestStore } from '@/stores/requestStore';
import { BodyViewer } from './BodyViewer';
import { SaveResponseDialog } from './SaveResponseDialog';
import { ResponseTransform } from './ResponseTransform';
import { HeadersViewer } from './HeadersViewer';
import { TimingViewer } from './TimingViewer';
import { RequestViewer } from './RequestViewer';
import { CookiesViewer } from './CookiesViewer';
import type { Tab } from '@/types';

function statusVariant(code: number) {
  if (code >= 200 && code < 300) return 'success' as const;
  if (code >= 300 && code < 400) return 'info' as const;
  if (code >= 400 && code < 500) return 'warning' as const;
  return 'destructive' as const;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function byteSize(str: string): number {
  return new Blob([str]).size;
}

function headersSize(headers: Record<string, string>): number {
  return Object.entries(headers).reduce(
    (sum, [k, v]) => sum + byteSize(`${k}: ${v}\r\n`),
    0,
  );
}

function cookieSize(headers: Record<string, string>): number {
  const cookie = headers['cookie'] || headers['Cookie'] || '';
  const setCookie = headers['set-cookie'] || headers['Set-Cookie'] || '';
  return byteSize(cookie) + byteSize(setCookie);
}

interface SizeBreakdown {
  headers: number;
  body: number;
  cookies: number;
  total: number;
}

function calcRequestSize(sentRequest?: Tab['sentRequest']): SizeBreakdown {
  if (!sentRequest) return { headers: 0, body: 0, cookies: 0, total: 0 };
  const h = headersSize(sentRequest.headers);
  const b = byteSize(sentRequest.body || '');
  const c = cookieSize(sentRequest.headers);
  return { headers: h, body: b, cookies: c, total: h + b };
}

function calcResponseSize(
  headers: Record<string, string>,
  body: string,
): SizeBreakdown {
  const h = headersSize(headers);
  const b = byteSize(body);
  const c = cookieSize(headers);
  return { headers: h, body: b, cookies: c, total: h + b };
}

interface ResponsePanelProps {
  tab: Tab;
}

export function ResponsePanel({ tab }: ResponsePanelProps) {
  const { t } = useTranslation(['response', 'common']);
  const [copied, setCopied] = useState(false);
  const [ipCopied, setIpCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  // Response view is kept per-tab (on the tab, not a global store) so each
  // request tab remembers its own open section — matching the request editor.
  const updateTab = useRequestStore((s) => s.updateTab);
  const activeView = tab.responseView ?? 'body';
  const setActiveView = (v: string) => updateTab(tab.id, { responseView: v });
  const reqSize = useMemo(() => calcRequestSize(tab.sentRequest), [tab.sentRequest]);
  const resSize = useMemo(
    () => tab.response ? calcResponseSize(tab.response.headers, tab.response.body) : { headers: 0, body: 0, cookies: 0, total: 0 },
    [tab.response],
  );
  const totalSize = reqSize.total + resSize.total;

  if (tab.loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t('response:loading')}</p>
        </div>
      </div>
    );
  }

  if (!tab.response) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <ArrowDown className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {t('response:empty.title')}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('response:empty.hint')}
          </p>
        </div>
      </div>
    );
  }

  const { response } = tab;
  const headersCount = Object.keys(response.headers).length;
  const consoleCount = tab.consoleOutput?.length || 0;
  const cookiesCount = response.responseCookies?.length || 0;

  const handleCopyResponse = async () => {
    await navigator.clipboard.writeText(response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-4 h-full flex flex-col min-h-0">
      <Tabs value={activeView} onValueChange={setActiveView} className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-4 shrink-0">
          <TabsList className="h-8">
            <TabsTrigger value="body" className="text-xs h-6 px-3">
              {t('response:tabs.body')}
            </TabsTrigger>
            <TabsTrigger value="transform" className="text-xs h-6 px-3">
              {t('response:tabs.transform')}
            </TabsTrigger>
            <TabsTrigger value="headers" className="text-xs h-6 px-3">
              {t('response:tabs.headers')}
              {headersCount > 0 && (
                <span className="ml-1 text-[10px] bg-primary/10 text-primary px-1 rounded">
                  {headersCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="cookies" className="text-xs h-6 px-3">
              {t('response:tabs.cookies')}
              {cookiesCount > 0 && (
                <span className="ml-1 text-[10px] bg-primary/10 text-primary px-1 rounded">
                  {cookiesCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="timing" className="text-xs h-6 px-3">
              {t('response:tabs.timing')}
            </TabsTrigger>
            <TabsTrigger value="request" className="text-xs h-6 px-3">
              {t('response:tabs.request')}
            </TabsTrigger>
            <TabsTrigger value="console" className="text-xs h-6 px-3">
              {t('response:tabs.console')}
              {consoleCount > 0 && (
                <span className="ml-1 text-[10px] bg-primary/10 text-primary px-1 rounded">
                  {consoleCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Response info bar */}
          <div className="flex items-center gap-3 text-xs shrink-0">
            <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={handleCopyResponse}
                >
                  {copied ? (
                    <Check className="h-3 w-3 mr-1" />
                  ) : (
                    <Copy className="h-3 w-3 mr-1" />
                  )}
                  {copied ? t('common:copied') : t('common:copy')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('response:meta.copyBody')}</p>
              </TooltipContent>
            </Tooltip>
            <Badge variant={statusVariant(response.statusCode)} className="text-[11px]">
              {response.statusCode} {response.statusText.replace(/^\d+\s*/, '')}
            </Badge>
            {response.contentEncoding && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-default">
                    <Badge variant="outline" className="text-[11px] font-mono uppercase">
                      {response.contentEncoding}
                    </Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <p>{t('response:meta.encodingTooltip', { encoding: response.contentEncoding })}</p>
                </TooltipContent>
              </Tooltip>
            )}
            <span className="text-muted-foreground font-mono">
              {response.duration} ms
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-muted-foreground font-mono cursor-default hover:text-foreground transition-colors">
                  <ArrowUpDown className="h-3 w-3" />
                  {formatSize(totalSize)}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs p-0 w-56 bg-popover text-popover-foreground border-border">
                <div className="p-2 space-y-2">
                  <div>
                    <div className="font-semibold mb-1 text-foreground">{t('response:meta.sizeRequest', { size: formatSize(reqSize.total) })}</div>
                    <div className="grid grid-cols-2 gap-x-3 text-muted-foreground">
                      <span>{t('response:meta.sizeHeaders')}</span><span className="text-right font-mono">{formatSize(reqSize.headers)}</span>
                      <span>{t('response:meta.sizeBody')}</span><span className="text-right font-mono">{formatSize(reqSize.body)}</span>
                      {reqSize.cookies > 0 && <><span>{t('response:meta.sizeCookies')}</span><span className="text-right font-mono">{formatSize(reqSize.cookies)}</span></>}
                    </div>
                  </div>
                  <div className="border-t border-border pt-2">
                    <div className="font-semibold mb-1 text-foreground">{t('response:meta.sizeResponse', { size: formatSize(resSize.total) })}</div>
                    <div className="grid grid-cols-2 gap-x-3 text-muted-foreground">
                      <span>{t('response:meta.sizeHeaders')}</span><span className="text-right font-mono">{formatSize(resSize.headers)}</span>
                      <span>{t('response:meta.sizeBody')}</span><span className="text-right font-mono">{formatSize(resSize.body)}</span>
                      {resSize.cookies > 0 && <><span>{t('response:meta.sizeCookies')}</span><span className="text-right font-mono">{formatSize(resSize.cookies)}</span></>}
                    </div>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
            {response.remoteAddr && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('response:meta.remoteAria')}
                    onClick={() => {
                      const addr = response.remoteAddr;
                      if (!addr) return;
                      navigator.clipboard?.writeText(addr)
                        .then(() => { setIpCopied(true); setTimeout(() => setIpCopied(false), 1500); })
                        .catch(() => {});
                    }}
                    className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    {ipCopied
                      ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                      : <Server className="h-3.5 w-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs max-w-[280px]">
                  <div className="font-medium">{t('response:meta.remoteTitle')}</div>
                  <div className="mt-0.5">
                    <span className="font-mono">{response.remoteAddr}</span>
                    <span className="ml-1.5 opacity-70">· {ipCopied ? t('common:copied') : t('response:meta.clickToCopy')}</span>
                  </div>
                  <div className="mt-1 opacity-70">
                    {t('response:meta.remoteHint')}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            </TooltipProvider>
          </div>
        </div>

        <TabsContent value="body" className="flex-1 min-h-0 flex flex-col">
          <BodyViewer response={response} onSave={() => setSaving(true)} />
        </TabsContent>
        <TabsContent value="transform" className="flex-1 min-h-0 flex flex-col">
          <ResponseTransform body={response.body} />
        </TabsContent>
        <TabsContent value="headers" className="flex-1 min-h-0 overflow-auto">
          <HeadersViewer response={response} />
        </TabsContent>
        <TabsContent value="cookies" className="flex-1 min-h-0 overflow-auto">
          <CookiesViewer response={response} />
        </TabsContent>
        <TabsContent value="timing" className="flex-1 min-h-0 overflow-auto">
          <TimingViewer response={response} />
        </TabsContent>
        <TabsContent value="request" className="flex-1 min-h-0 overflow-auto">
          <RequestViewer tab={tab} />
        </TabsContent>
        <TabsContent value="console" className="flex-1 min-h-0 flex flex-col">
          <div className="border rounded-md p-3 flex-1 min-h-0 overflow-auto bg-muted/30">
            {tab.consoleOutput && tab.consoleOutput.length > 0 ? (
              <div className="space-y-1">
                {tab.consoleOutput.map((line, idx) => (
                  <div key={idx} className="text-xs font-mono text-muted-foreground">
                    <span className="text-[10px] text-muted-foreground/50 mr-2">{idx + 1}</span>
                    {line}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">
                {t('response:console.empty')}
              </p>
            )}
          </div>
        </TabsContent>
      </Tabs>
      {saving && <SaveResponseDialog open={saving} onOpenChange={setSaving} tab={tab} />}
    </div>
  );
}
