import { Send, ChevronDown, X, Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useAutoGrow } from '@/hooks/useAutoGrow';
import { useRequestStore } from '@/stores/requestStore';
import { useHistoryStore } from '@/stores/historyStore';
import { Button } from '@/components/ui/button';
import { VariableInput, VariableTextarea } from '@/components/environment/VariableInput';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import type { Tab } from '@/types';
import { parseCurl, looksLikeCurlCommand } from '@/lib/parseCurl';
import { parsedCurlToTab } from '@/lib/curlToTab';
import { ExecutionTargetPicker } from './ExecutionTargetPicker';

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const methodColors: Record<string, string> = {
  GET: 'text-green-500',
  POST: 'text-yellow-500',
  PUT: 'text-blue-500',
  PATCH: 'text-purple-500',
  DELETE: 'text-red-500',
  HEAD: 'text-teal-500',
  OPTIONS: 'text-gray-500',
};

interface UrlBarProps {
  tab: Tab;
}

export function UrlBar({ tab }: UrlBarProps) {
  const { t } = useTranslation('request');
  const { updateTab, sendRequest, cancelRequest } = useRequestStore();
  const { items: historyItems, fetchHistory } = useHistoryStore();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [protocolOpen, setProtocolOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  // Expanded URL editor — a wrapping, auto-growing view of the whole URL for
  // when it's longer than the field (opened from the icon next to the count).
  const [expanded, setExpanded] = useState(false);
  const { ref: setExpandEl, elRef: expandRef } = useAutoGrow(tab.url);
  const expandBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Click outside handler for history
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Extract protocol from URL for display
  const currentProtocol = tab.protocol || 'https://';

  // Get URL without protocol for display in input
  const displayUrl = tab.url;

  const handleProtocolChange = (value: string) => {
    updateTab(tab.id, { protocol: value });
    setProtocolOpen(false);
  };

  const handleSend = () => {
    if (tab.loading) {
      cancelRequest(tab.id);
      return;
    }
    if (!tab.url.trim()) return;
    sendRequest(tab.id);
  };

  // Global Cmd/Ctrl+Enter (dispatched by useKeyboardShortcuts) sends the
  // active request from anywhere in the app. A ref keeps the listener bound
  // once while always invoking the latest handleSend (closes over live tab).
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;
  useEffect(() => {
    const onSend = () => handleSendRef.current();
    window.addEventListener('patchman:send-request', onSend);
    return () => window.removeEventListener('patchman:send-request', onSend);
  }, []);

  const handleCancel = () => {
    cancelRequest(tab.id);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text');
    // Strict: only hijack the paste when input clearly carries curl
    // semantics. The URL-only fallback the Import dialog uses would be
    // surprising here — pasting a plain URL should just update the URL
    // bar, not overwrite the current tab's method/headers.
    if (!looksLikeCurlCommand(pastedText)) return;
    const parsed = parseCurl(pastedText);
    if (parsed) {
      e.preventDefault();
      const { patch } = parsedCurlToTab(parsed);
      updateTab(tab.id, patch);
    }
  };

  const filteredHistory = historyItems
    .filter((item) => {
      if (!tab.url.trim()) return true;
      return item.url.toLowerCase().includes(tab.url.toLowerCase());
    })
    .slice(0, 10);

  const handleSelectHistory = (url: string, method: string) => {
    let processedUrl = url;
    let protocol = tab.protocol || 'https://';
    if (processedUrl.startsWith('https://')) {
      protocol = 'https://';
      processedUrl = processedUrl.slice(8);
    } else if (processedUrl.startsWith('http://')) {
      protocol = 'http://';
      processedUrl = processedUrl.slice(7);
    }
    updateTab(tab.id, { url: processedUrl, method, protocol });
    setHistoryOpen(false);
    inputRef.current?.focus();
  };

  // Env-variable highlight/hover/autocomplete live in VariableInput.
  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => applyUrl(e.target.value);
  const applyUrl = (value: string) => {
    // Smart protocol detection: strip protocol prefix and update selector
    if (value.startsWith('https://')) {
      updateTab(tab.id, { url: value.slice(8), protocol: 'https://' });
    } else if (value.startsWith('http://')) {
      updateTab(tab.id, { url: value.slice(7), protocol: 'http://' });
    } else {
      updateTab(tab.id, { url: value });
    }
  };

  return (
    <div className="space-y-0">
      <div className="flex items-center gap-2">
        <Select
          value={tab.method}
          onValueChange={(value) => updateTab(tab.id, { method: value })}
        >
          <SelectTrigger className="w-[120px] h-10 font-bold">
            <SelectValue>
              <span className={cn('font-bold', methodColors[tab.method])}>
                {tab.method}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {methods.map((method) => (
              <SelectItem key={method} value={method}>
                <span className={cn('font-bold', methodColors[method])}>
                  {method}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Combined protocol + URL input */}
        <div className="relative flex-1" ref={historyRef}>
          <Popover open={expanded} onOpenChange={setExpanded}>
          <PopoverAnchor asChild>
          <div className="flex items-center flex-1 h-10 border rounded-md bg-background overflow-hidden">
            <Popover open={protocolOpen} onOpenChange={setProtocolOpen}>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1 px-2 text-xs font-mono text-muted-foreground hover:text-foreground shrink-0 h-full border-r cursor-pointer">
                  {currentProtocol}<ChevronDown className="h-3 w-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-28 p-1" align="start">
                <button
                  className="w-full text-left px-2 py-1.5 text-xs font-mono rounded hover:bg-accent cursor-pointer"
                  onClick={() => handleProtocolChange('https://')}
                >
                  https://
                </button>
                <button
                  className="w-full text-left px-2 py-1.5 text-xs font-mono rounded hover:bg-accent cursor-pointer"
                  onClick={() => handleProtocolChange('http://')}
                >
                  http://
                </button>
              </PopoverContent>
            </Popover>

            <div className="relative flex-1 flex items-center">
              <VariableInput
                bare
                ref={inputRef}
                data-url-bar
                value={displayUrl}
                onChange={handleUrlChange}
                placeholder={t('urlBar.urlPlaceholder')}
                wrapperClassName="flex-1 h-full"
                className="h-full px-2 font-mono text-sm bg-transparent outline-none pr-20"
                autoComplete="off"
                spellCheck={false}
                onPaste={handlePaste}
                onKeyDown={(e) => {
                  // Cmd/Ctrl+Enter is handled globally (useKeyboardShortcuts →
                  // patchman:send-request) so it fires regardless of focus.
                  if (e.key === 'Escape') setHistoryOpen(false);
                }}
              />
              {/* Char count + expand, inside the input */}
              {tab.url.length > 0 && (
                <>
                  <span className="absolute right-[3.25rem] top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50 font-mono pointer-events-none">
                    {tab.url.length}
                  </span>
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          ref={expandBtnRef}
                          type="button"
                          aria-label={t('urlBar.expandUrl')}
                          className="absolute right-7 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={() => { setHistoryOpen(false); setExpanded((v) => !v); }}
                        >
                          <Maximize2 className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom"><p>{t('urlBar.expandUrl')}</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}
              {/* History caret button */}
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={() => setHistoryOpen(!historyOpen)}
                      type="button"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('urlBar.urlHistory')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          </PopoverAnchor>
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={4}
            className="w-auto p-2"
            style={{ width: 'var(--radix-popover-trigger-width)' }}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              const el = expandRef.current;
              if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
            }}
            onCloseAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
            // The toggle button sits in the anchor (outside the content) — let its
            // own click close the editor instead of close-then-reopen.
            onInteractOutside={(e) => { if (expandBtnRef.current?.contains(e.target as Node)) e.preventDefault(); }}
          >
            <VariableTextarea
              ref={setExpandEl}
              wrapperClassName="w-full"
              value={tab.url}
              // A URL is one line: newlines from typing or pasting are dropped.
              onChange={(e) => applyUrl(e.target.value.replace(/[\r\n]+/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setExpanded(false); }
              }}
              rows={1}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              placeholder={t('urlBar.urlPlaceholder')}
              className="block w-full resize-none overflow-y-auto bg-transparent px-1 py-1 font-mono text-sm leading-relaxed outline-none break-all whitespace-pre-wrap"
            />
            <p className="mt-1 px-1 text-[10px] text-muted-foreground">{t('urlBar.expandHint')}</p>
          </PopoverContent>
          </Popover>

          {/* History dropdown */}
          {historyOpen && (
            <div className="absolute left-0 right-0 top-full mt-1 z-50 border rounded-md bg-popover shadow-md p-1">
              <div className="max-h-[300px] overflow-auto">
                {filteredHistory.length > 0 ? (
                  filteredHistory.map((item) => (
                    <button
                      key={item.id}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors cursor-pointer text-left"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectHistory(item.url, item.method);
                      }}
                    >
                      <span
                        className={cn(
                          'text-[10px] font-bold uppercase w-12 shrink-0',
                          methodColors[item.method] || 'text-gray-500'
                        )}
                      >
                        {item.method}
                      </span>
                      <span className="truncate flex-1 font-mono">
                        {item.url}
                      </span>
                      {item.statusCode > 0 && (
                        <span
                          className={cn(
                            'text-[10px] shrink-0',
                            item.statusCode >= 200 && item.statusCode < 300
                              ? 'text-green-500'
                              : item.statusCode >= 400
                                ? 'text-red-500'
                                : 'text-yellow-500'
                          )}
                        >
                          {item.statusCode}
                        </span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-xs text-muted-foreground text-center">
                    {t('urlBar.noRecentRequests')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <ExecutionTargetPicker />

        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              {tab.loading ? (
                <Button
                  onClick={handleCancel}
                  variant="destructive"
                  className="h-10 px-6 font-semibold shrink-0"
                >
                  <X className="h-4 w-4 mr-2" />
                  {t('common:cancel')}
                </Button>
              ) : (
                <Button
                  onClick={handleSend}
                  disabled={!tab.url.trim()}
                  className="h-10 px-6 font-semibold shrink-0"
                >
                  <Send className="h-4 w-4 mr-2" />
                  {t('actions.send')}
                </Button>
              )}
            </TooltipTrigger>
            <TooltipContent>
              <p>{tab.loading ? t('urlBar.cancelTip') : t('urlBar.sendTip')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
