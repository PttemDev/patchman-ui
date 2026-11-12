import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Send, Square, Sparkles, AlertTriangle, Loader2, MessageSquare, TerminalSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useThemeStore } from '@/stores/themeStore';
import { isDesktop } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { ClaudeTerminal } from './ClaudeTerminal';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import {
  streamLLMChat,
  remoteStreamBuffered,
  llmProviderAPI,
  type LLMProvider,
  type DBScope,
} from '@/services/api';
import { dualWrite } from '@/stores/dbConnectionStore';
import { confirmDialog } from '@/components/ui/confirm';
import { useLLMProviderStore } from '@/stores/llmProviderStore';
import { LLMProviderDialog } from './LLMProviderDialog';

// LLMPanel is the dedicated "AI" surface: pick a provider, optionally set a
// system prompt + model, send a single prompt, and watch the answer stream in.
// The request is proxied + streamed by the BE (key never touches the browser).
// Local-pinned providers always stream; a remote backend whose ingress buffers
// SSE is detected and warned about.
export function LLMPanel() {
  const { t } = useTranslation('ai');
  const { toast } = useToast();
  const providers = useLLMProviderStore((s) => s.providers);
  const loading = useLLMProviderStore((s) => s.loading);
  const activeId = useLLMProviderStore((s) => s.activeProviderId);
  const setActive = useLLMProviderStore((s) => s.setActiveProvider);
  const fetchProviders = useLLMProviderStore((s) => s.fetchProviders);
  const removeLocal = useLLMProviderStore((s) => s.removeLocal);

  const theme = useThemeStore((s) => s.theme);
  const desktop = isDesktop();
  const [view, setView] = useState<'chat' | 'terminal'>('chat');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LLMProvider | null>(null);

  const [model, setModel] = useState('');
  const [system, setSystem] = useState('');
  const [showSystem, setShowSystem] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [buffered, setBuffered] = useState(false);
  const acRef = useRef<AbortController | null>(null);

  const active = providers.find((p) => p.id === activeId) ?? null;

  useEffect(() => {
    void fetchProviders();
  }, [fetchProviders]);

  // Show the up-front buffered warning when this remote backend previously
  // failed to stream; local-pinned providers never buffer.
  useEffect(() => {
    setBuffered(active?.scope === 'remote' && remoteStreamBuffered());
  }, [active?.id, active?.scope]);

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = () => { if (active) { setEditing(active); setDialogOpen(true); } };

  const handleDelete = async () => {
    if (!active) return;
    if (!(await confirmDialog({ title: t('deleteConfirm', { name: active.name }), destructive: true }))) return;
    const targets: DBScope[] = active.availableScopes && active.availableScopes.length > 0
      ? (active.availableScopes as DBScope[])
      : [active.scope ?? 'remote'];
    try {
      await dualWrite((s) => llmProviderAPI.delete(active.id, s), targets);
      removeLocal(active.id);
      toast({ title: t('deleted') });
      await fetchProviders();
    } catch (e) {
      toast({ title: t('deleteFailed'), description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  const stop = () => acRef.current?.abort();

  const run = async () => {
    if (!active || !prompt.trim() || streaming) return;
    setOutput('');
    setError('');
    setStreaming(true);
    const ac = new AbortController();
    acRef.current = ac;
    try {
      await streamLLMChat(
        {
          providerId: active.id,
          model: model.trim() || undefined,
          system: system.trim() || undefined,
          messages: [{ role: 'user', content: prompt }],
        },
        active.scope,
        {
          onToken: (tok) => setOutput((o) => o + tok),
          onError: (m) => setError(m),
          onBuffered: () => setBuffered(true),
          onDone: () => setStreaming(false),
          signal: ac.signal,
        },
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Header / provider bar */}
      <div className="flex items-center gap-2 border-b p-2">
        <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium shrink-0">{t('title')}</span>
        {desktop && (
          <div className="ml-1 inline-flex shrink-0 rounded-md border p-0.5">
            <button
              onClick={() => setView('chat')}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors cursor-pointer',
                view === 'chat' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" /> {t('tabChat')}
            </button>
            <button
              onClick={() => setView('terminal')}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors cursor-pointer',
                view === 'terminal' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              <TerminalSquare className="h-3.5 w-3.5" /> {t('tabTerminal')}
            </button>
          </div>
        )}
        <div className={cn('ml-2 flex min-w-0 flex-1 items-center gap-1', view === 'terminal' && 'hidden')}>
          {providers.length > 0 && (
            <Select value={activeId ?? undefined} onValueChange={setActive}>
              <SelectTrigger className="h-8 min-w-0 max-w-[16rem]"><SelectValue placeholder={t('selectProvider')} /></SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} <span className="text-muted-foreground">· {p.kind}{p.scope === 'local' ? ' · ' + t('deviceTag') : ''}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {active && (
            <>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={openEdit} title={t('edit')}><Pencil className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDelete} title={t('delete')}><Trash2 className="h-4 w-4" /></Button>
            </>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1 ml-auto shrink-0" onClick={openAdd}><Plus className="h-4 w-4" />{t('addProvider')}</Button>
        </div>
      </div>

      {/* Body */}
      {view === 'terminal' ? (
        <ClaudeTerminal theme={theme} />
      ) : providers.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <>
              <Sparkles className="h-8 w-8" />
              <p className="text-sm">{t('emptyState')}</p>
              <Button onClick={openAdd} className="gap-1"><Plus className="h-4 w-4" />{t('addProvider')}</Button>
            </>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          {buffered && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('bufferedWarning')}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={active?.model ? t('modelPlaceholder', { model: active.model }) : t('modelPlaceholderEmpty')}
              className="h-8 max-w-xs"
            />
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setShowSystem((v) => !v)}>
              {showSystem ? t('hideSystem') : t('addSystem')}
            </Button>
          </div>

          {showSystem && (
            <Textarea
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder={t('systemPlaceholder')}
              className="min-h-[60px] font-mono text-xs"
            />
          )}

          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('promptPlaceholder')}
            className="min-h-[90px]"
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void run(); } }}
          />

          <div className="flex items-center gap-2">
            {streaming ? (
              <Button onClick={stop} variant="destructive" className="gap-1"><Square className="h-4 w-4" />{t('stop')}</Button>
            ) : (
              <Button onClick={run} disabled={!active || !prompt.trim()} className="gap-1"><Send className="h-4 w-4" />{t('run')}</Button>
            )}
            <span className="text-xs text-muted-foreground">{t('runHint')}</span>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30 p-3">
            {output ? (
              <pre className="whitespace-pre-wrap break-words font-sans text-sm">{output}{streaming && <span className="animate-pulse">▋</span>}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">{streaming ? t('thinking') : t('outputEmpty')}</p>
            )}
          </div>
        </div>
      )}

      <LLMProviderDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </div>
  );
}
