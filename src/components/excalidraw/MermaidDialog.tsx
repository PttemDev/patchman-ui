import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Sparkles, Database } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { streamLLMChat, llmDiagramAPI } from '@/services/api';
import { useLLMProviderStore } from '@/stores/llmProviderStore';
import { insertMermaid, stripMermaidFence } from './excalidrawInsert';

// Keep the model on-task: Mermaid only, no prose, no fences (we also strip a
// stray fence on insert).
const MERMAID_SYSTEM =
  'You generate diagrams as Mermaid code. Reply with ONLY valid Mermaid source — no prose, no explanations, and no Markdown code fences.';

// MermaidDialog turns Mermaid text into Excalidraw shapes on the open board.
// You can paste/write Mermaid directly, or describe the diagram and have the
// active AI provider draft the Mermaid for you (plain chat — no tool-calling).
export function MermaidDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const { t } = useTranslation('excalidraw');
  const [mermaid, setMermaid] = useState('');
  const [prompt, setPrompt] = useState('');
  const [dataPrompt, setDataPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generatingData, setGeneratingData] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [inserting, setInserting] = useState(false);
  const [error, setError] = useState('');
  const acRef = useRef<AbortController | null>(null);

  const providers = useLLMProviderStore((s) => s.providers);
  const activeProviderId = useLLMProviderStore((s) => s.activeProviderId);
  const fetchProviders = useLLMProviderStore((s) => s.fetchProviders);
  const active = providers.find((p) => p.id === activeProviderId) ?? providers[0];

  useEffect(() => {
    if (providers.length === 0) void fetchProviders();
  }, [providers.length, fetchProviders]);

  const generate = async () => {
    if (!active || !prompt.trim() || generating) return;
    setError('');
    setMermaid('');
    setGenerating(true);
    const ac = new AbortController();
    acRef.current = ac;
    try {
      await streamLLMChat(
        { providerId: active.id, system: MERMAID_SYSTEM, messages: [{ role: 'user', content: prompt }] },
        active.scope,
        {
          onToken: (tok) => setMermaid((m) => m + tok),
          onError: (m) => setError(m),
          onDone: () => setGenerating(false),
          signal: ac.signal,
        },
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setGenerating(false);
    }
  };

  // "From your live data" — the BE runs a ReAct loop over read-only MCP tools
  // (ES indices, K8s topology, Kafka topics, …) and returns Mermaid. Slower than
  // a plain description (it inspects real data), so no streaming — one call.
  const generateFromData = async () => {
    if (!active || !dataPrompt.trim() || generatingData) return;
    setError('');
    setSteps([]);
    setGeneratingData(true);
    try {
      const res = await llmDiagramAPI.generate({ providerId: active.id, prompt: dataPrompt }, active.scope);
      const data = res.data as { mermaid?: string; steps?: string[]; error?: string };
      setSteps(data.steps ?? []);
      if (data.mermaid) setMermaid(stripMermaidFence(data.mermaid));
      if (data.error && !data.mermaid) setError(data.error);
    } catch (e) {
      // The BE puts the provider's real message in response.data.error; prefer
      // it over axios's generic "Request failed with status code …".
      const beErr = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(beErr || (e instanceof Error ? e.message : String(e)));
    } finally {
      setGeneratingData(false);
    }
  };

  const insert = async () => {
    if (!mermaid.trim() || inserting) return;
    setError('');
    setInserting(true);
    try {
      await insertMermaid(boardId, mermaid);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInserting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) { acRef.current?.abort(); onClose(); } }}>
      <DialogContent className="max-w-2xl w-[90vw]">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">{t('diagramTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Describe → AI drafts Mermaid */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> {t('diagramDescribe')}
            </label>
            <div className="flex gap-2">
              <Input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void generate(); } }}
                placeholder={t('diagramDescribePlaceholder')}
                disabled={!active || generating}
              />
              <Button onClick={generate} disabled={!active || !prompt.trim() || generating} className="shrink-0">
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : t('diagramGenerate')}
              </Button>
            </div>
            {!active && <p className="text-[11px] text-muted-foreground">{t('diagramNoProvider')}</p>}
          </div>

          {/* From live data → AI inspects real data via tools, drafts Mermaid */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5" /> {t('diagramFromData')}
            </label>
            <div className="flex gap-2">
              <Input
                value={dataPrompt}
                onChange={(e) => setDataPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void generateFromData(); } }}
                placeholder={t('diagramFromDataPlaceholder')}
                disabled={!active || generatingData}
              />
              <Button variant="outline" onClick={generateFromData} disabled={!active || !dataPrompt.trim() || generatingData} className="shrink-0">
                {generatingData ? <Loader2 className="h-4 w-4 animate-spin" /> : t('diagramGenerate')}
              </Button>
            </div>
            {generatingData && <p className="text-[11px] text-muted-foreground">{t('diagramInspecting')}</p>}
            {steps.length > 0 && (
              <p className="text-[11px] text-muted-foreground">{t('diagramUsedTools', { tools: steps.join(', ') })}</p>
            )}
          </div>

          {/* Mermaid source (editable — from AI or typed) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Mermaid</label>
            <Textarea
              value={mermaid}
              onChange={(e) => setMermaid(e.target.value)}
              placeholder={t('diagramSourcePlaceholder')}
              className="font-mono text-xs h-48 resize-none"
            />
          </div>

          {error && <p className="text-xs text-destructive break-words">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={() => { acRef.current?.abort(); onClose(); }}>
            {t('common:cancel')}
          </Button>
          <Button onClick={insert} disabled={!mermaid.trim() || inserting}>
            {inserting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('diagramInsert')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
