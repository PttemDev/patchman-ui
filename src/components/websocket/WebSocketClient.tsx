import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plug,
  Unplug,
  Send,
  ArrowUpRight,
  ArrowDownLeft,
  Trash2,
  Plus,
  Minus,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { wsAPI } from '@/services/api';

interface HeaderRow {
  key: string;
  value: string;
}

interface WsMessage {
  id: string;
  direction: 'sent' | 'received';
  content: string;
  timestamp: Date;
  type: 'text' | 'binary';
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type BinaryDisplayFormat = 'hex' | 'base64' | 'utf8';

/** Convert ArrayBuffer to hex string */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

/** Convert ArrayBuffer to base64 string */
function bufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/** Format binary data for display based on chosen format */
function formatBinaryContent(raw: ArrayBuffer, format: BinaryDisplayFormat): string {
  if (format === 'hex') return bufferToHex(raw);
  if (format === 'base64') return bufferToBase64(raw);
  // utf8
  return new TextDecoder().decode(raw);
}

export function WebSocketClient() {
  const { t } = useTranslation('websocket');
  const [url, setUrl] = useState('ws://localhost:8080');
  const [headers, setHeaders] = useState<HeaderRow[]>([
    { key: '', value: '' },
    { key: '', value: '' },
    { key: '', value: '' },
  ]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [messageType, setMessageType] = useState<'text' | 'binary'>('text');
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [binaryDisplayFormat, setBinaryDisplayFormat] = useState<BinaryDisplayFormat>('hex');
  const binaryBuffers = useRef<Map<string, ArrayBuffer>>(new Map());

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messageIdCounter = useRef(0);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const generateMessageId = () => {
    messageIdCounter.current += 1;
    return `msg-${Date.now()}-${messageIdCounter.current}`;
  };

  const handleConnect = useCallback(async () => {
    if (!url.trim()) return;

    setConnectionStatus('connecting');
    setError(null);

    try {
      // Build headers object from rows
      const headerObj: Record<string, string> = {};
      headers.forEach((h) => {
        if (h.key.trim() && h.value.trim()) {
          headerObj[h.key.trim()] = h.value.trim();
        }
      });

      // Establish connection via REST API first
      const response = await wsAPI.connect({
        url: url.trim(),
        headers: Object.keys(headerObj).length > 0 ? headerObj : undefined,
      });

      const connId = (response.data as { connectionId: string }).connectionId;
      setConnectionId(connId);

      // Open real WebSocket for bidirectional relay
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/ws/stream/${connId}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setConnectionStatus('connected');
      };

      ws.binaryType = 'arraybuffer';
      ws.onmessage = (event) => {
        const msgId = generateMessageId();
        if (event.data instanceof ArrayBuffer) {
          // Binary message received
          const buffer = event.data as ArrayBuffer;
          binaryBuffers.current.set(msgId, buffer);
          const size = buffer.byteLength;
          const preview = size <= 256
            ? bufferToHex(buffer)
            : t('binaryDataPreview', { n: size });
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              direction: 'received',
              content: preview,
              timestamp: new Date(),
              type: 'binary',
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: msgId,
              direction: 'received',
              content: event.data,
              timestamp: new Date(),
              type: 'text',
            },
          ]);
        }
      };

      ws.onerror = () => {
        setError(t('errors.connectionError'));
        setConnectionStatus('error');
      };

      ws.onclose = (event) => {
        setConnectionStatus('disconnected');
        wsRef.current = null;
        if (!event.wasClean) {
          setError(t('errors.closedUnexpectedly', { code: event.code }));
        }
      };

      wsRef.current = ws;
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'response' in err
            ? ((err as { response?: { data?: { error?: string } } }).response?.data?.error ??
              t('errors.connectFailed'))
            : t('errors.connectFailed');
      setError(message);
      setConnectionStatus('error');
    }
  }, [url, headers, t]);

  const handleDisconnect = useCallback(async () => {
    try {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (connectionId) {
        await wsAPI.disconnect(connectionId);
      }
    } catch {
      // Disconnect errors are not critical
    } finally {
      setConnectionStatus('disconnected');
      setConnectionId(null);
    }
  }, [connectionId]);

  const handleSend = useCallback(() => {
    if (!messageInput.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      if (messageType === 'binary') {
        // Convert text input to ArrayBuffer and send as binary
        const encoder = new TextEncoder();
        const buffer = encoder.encode(messageInput).buffer;
        wsRef.current.send(buffer);
      } else {
        wsRef.current.send(messageInput);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          direction: 'sent',
          content: messageInput,
          timestamp: new Date(),
          type: messageType,
        },
      ]);
      setMessageInput('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('errors.sendFailed'));
    }
  }, [messageInput, messageType, t]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearMessages = () => {
    setMessages([]);
  };

  const updateHeader = (index: number, field: 'key' | 'value', val: string) => {
    setHeaders((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: val };
      return next;
    });
  };

  const addHeaderRow = () => {
    setHeaders((prev) => [...prev, { key: '', value: '' }]);
  };

  const removeHeaderRow = (index: number) => {
    if (headers.length <= 1) return;
    setHeaders((prev) => prev.filter((_, i) => i !== index));
  };

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const isConnected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';

  return (
    <div className="flex flex-col h-full">
      {/* Connection Section */}
      <div className="p-3 space-y-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{t('title')}</h3>
            {/* Status indicator */}
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  'h-2 w-2 rounded-full',
                  connectionStatus === 'connected' && 'bg-green-500 shadow-sm shadow-green-500/50',
                  connectionStatus === 'connecting' && 'bg-yellow-500 animate-pulse',
                  connectionStatus === 'disconnected' && 'bg-gray-400',
                  connectionStatus === 'error' && 'bg-red-500'
                )}
              />
              <span className="text-[10px] text-muted-foreground capitalize">
                {t(`status.${connectionStatus}`)}
              </span>
            </div>
          </div>
          {isConnected ? (
            <Wifi className="h-4 w-4 text-green-500" />
          ) : (
            <WifiOff className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        {/* URL input */}
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('urlPlaceholder')}
            className="flex-1 font-mono text-xs"
            disabled={isConnected || isConnecting}
          />
          {isConnected ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDisconnect}
              className="shrink-0"
            >
              <Unplug className="h-3.5 w-3.5" />
              {t('common:disconnect')}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={!url.trim() || isConnecting}
              className="shrink-0"
            >
              {isConnecting ? (
                <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Plug className="h-3.5 w-3.5" />
              )}
              {t('common:connect')}
            </Button>
          )}
        </div>

        {/* Headers */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">{t('headers')}</Label>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={addHeaderRow}
              disabled={isConnected}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          {headers.map((header, idx) => (
            <div key={idx} className="flex gap-1.5 items-center">
              <Input
                value={header.key}
                onChange={(e) => updateHeader(idx, 'key', e.target.value)}
                placeholder={t('headerNamePlaceholder')}
                className="h-7 text-xs flex-1"
                disabled={isConnected}
              />
              <Input
                value={header.value}
                onChange={(e) => updateHeader(idx, 'value', e.target.value)}
                placeholder={t('headerValuePlaceholder')}
                className="h-7 text-xs flex-1"
                disabled={isConnected}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => removeHeaderRow(idx)}
                disabled={isConnected || headers.length <= 1}
              >
                <Minus className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>

        {/* Error display */}
        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}
      </div>

      {/* Messages Section */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Messages header */}
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-xs font-medium text-muted-foreground">
            {t('messagesCount', { n: messages.length })}
          </span>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={handleClearMessages}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>

        {/* Message history */}
        <ScrollArea className="flex-1 min-h-0">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <Wifi className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">{t('emptyTitle')}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {isConnected
                  ? t('emptyHintConnected')
                  : t('emptyHintDisconnected')}
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'rounded-md px-3 py-2 text-xs',
                    msg.direction === 'sent'
                      ? 'bg-primary/10 border border-primary/20 ml-4'
                      : 'bg-muted/60 border border-border mr-4'
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    {msg.direction === 'sent' ? (
                      <ArrowUpRight className="h-3 w-3 text-primary shrink-0" />
                    ) : (
                      <ArrowDownLeft className="h-3 w-3 text-green-500 shrink-0" />
                    )}
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {msg.direction === 'sent' ? t('sent') : t('received')}
                    </span>
                    {msg.type === 'binary' && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0">
                        {t('binaryBadge')}
                      </Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {formatTimestamp(msg.timestamp)}
                    </span>
                  </div>
                  <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
                    {msg.type === 'binary' && binaryBuffers.current.has(msg.id)
                      ? formatBinaryContent(binaryBuffers.current.get(msg.id)!, binaryDisplayFormat)
                      : msg.content}
                  </pre>
                  {msg.type === 'binary' && binaryBuffers.current.has(msg.id) && (
                    <div className="flex items-center gap-1 mt-1">
                      <button
                        className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          const buf = binaryBuffers.current.get(msg.id)!;
                          navigator.clipboard.writeText(bufferToHex(buf));
                        }}
                      >
                        {t('copyHex')}
                      </button>
                      <button
                        className="text-[9px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          const buf = binaryBuffers.current.get(msg.id)!;
                          navigator.clipboard.writeText(bufferToBase64(buf));
                        }}
                      >
                        {t('copyBase64')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ScrollArea>

        <Separator />

        {/* Message compose area */}
        <div className="p-3 space-y-2">
          <div className="flex gap-2">
            <Select
              value={messageType}
              onValueChange={(v) => setMessageType(v as 'text' | 'binary')}
            >
              <SelectTrigger className="w-24 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">{t('messageKind.text')}</SelectItem>
                <SelectItem value="binary">{t('messageKind.binary')}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={binaryDisplayFormat}
              onValueChange={(v) => setBinaryDisplayFormat(v as BinaryDisplayFormat)}
            >
              <SelectTrigger className="w-24 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hex">{t('binaryFormat.hex')}</SelectItem>
                <SelectItem value="base64">{t('binaryFormat.base64')}</SelectItem>
                <SelectItem value="utf8">{t('binaryFormat.utf8')}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1" />
            <Button
              size="sm"
              onClick={handleSend}
              disabled={!isConnected || !messageInput.trim()}
              className="h-7"
            >
              <Send className="h-3 w-3" />
              {t('common:send')}
            </Button>
          </div>
          <Textarea
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isConnected
                ? t('composePlaceholderConnected')
                : t('composePlaceholderDisconnected')
            }
            className="min-h-[60px] max-h-[120px] text-xs font-mono resize-y"
            disabled={!isConnected}
          />
        </div>
      </div>
    </div>
  );
}
