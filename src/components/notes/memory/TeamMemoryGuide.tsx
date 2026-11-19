import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Bot, Copy, Lightbulb, Plug, Search, Settings2, Sparkles, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useSettingsUIStore } from '@/stores/settingsUIStore';
import { cn } from '@/lib/utils';
import { MemorySettingsDialog } from './MemorySettingsDialog';

// TeamMemoryGuide explains team memory end to end, the way the backend
// behaves: an agent saves with remember(scope: team) into the team memory
// folder (signed with the agent's name), a teammate's agent finds it with
// recall, tagged [team: …]. Cards are meant to be written by agents over MCP —
// people often think they have to create them by hand, so the guide says so
// up front and gives prompts to copy. Agents never overwrite what a person
// wrote; they leave suggestions in the inbox.

const FLOW = [
  { key: 'learn', icon: Lightbulb },
  { key: 'remember', icon: Bot },
  { key: 'recall', icon: Search },
  { key: 'reuse', icon: Users },
] as const;

const PROMPTS = ['save', 'ask', 'review'] as const;

export function TeamMemoryGuideDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation(['notes', 'common', 'settings']);
  const { toast } = useToast();
  const openSettings = useSettingsUIStore((s) => s.openSettings);
  const [pickDefault, setPickDefault] = useState(false);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t('memory.teamGuide.copied') });
    } catch {
      toast({ title: t('memory.teamGuide.copyFailed'), variant: 'destructive' });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-violet-400" /> {t('memory.teamGuide.title')}
            </DialogTitle>
            <DialogDescription>{t('memory.teamGuide.intro')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 text-sm">
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('memory.teamGuide.howTitle')}</h3>
              <ol className="grid gap-2 sm:grid-cols-4">
                {FLOW.map(({ key, icon: Icon }, i) => (
                  <li key={key} className="relative rounded-md border bg-muted/30 p-2.5">
                    <div className="mb-1 flex items-center gap-1.5">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/15 text-[10px] font-semibold text-violet-500">{i + 1}</span>
                      <Icon className="h-3.5 w-3.5 text-violet-400" />
                      <span className="text-xs font-medium">{t(`memory.teamGuide.flow.${key}.title`)}</span>
                    </div>
                    <p className="text-[11px] leading-snug text-muted-foreground">{t(`memory.teamGuide.flow.${key}.body`)}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-amber-500" /> {t('memory.teamGuide.mcpTitle')}
              </h3>
              <p className="text-[12px] leading-snug text-muted-foreground">{t('memory.teamGuide.mcpBody')}</p>
              <ul className="space-y-1.5">
                {PROMPTS.map((key) => {
                  const text = t(`memory.teamGuide.prompts.${key}`);
                  return (
                    <li key={key} className="flex items-center gap-2 rounded border bg-background/60 px-2 py-1.5">
                      <code className="flex-1 min-w-0 text-[11px] leading-snug whitespace-pre-wrap break-words">{text}</code>
                      <button
                        type="button"
                        onClick={() => void copy(text)}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        title={t('memory.teamGuide.copy')}
                        aria-label={t('memory.teamGuide.copy')}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] leading-snug text-muted-foreground">{t('memory.teamGuide.mcpHandEdit')}</p>
            </section>

            <section className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('memory.teamGuide.whoTitle')}</h3>
              <ul className="list-disc space-y-1 pl-4 text-[12px] leading-snug text-muted-foreground">
                <li>{t('memory.teamGuide.who.personal')}</li>
                <li>{t('memory.teamGuide.who.team')}</li>
                <li>{t('memory.teamGuide.who.tagged')}</li>
                <li>{t('memory.teamGuide.who.secrets')}</li>
              </ul>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('memory.teamGuide.setupTitle')}</h3>
              <ol className="list-decimal space-y-1 pl-4 text-[12px] leading-snug text-muted-foreground">
                <li>{t('memory.teamGuide.setup.connect', { path: `${t('common:settings')} → ${t('settings:nav.mcp')}` })}</li>
                <li>{t('memory.teamGuide.setup.share', { useAsMemory: t('memory.useAsMemory'), share: t('share') })}</li>
                <li>{t('memory.teamGuide.setup.pick')}</li>
              </ol>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => { onOpenChange(false); openSettings('mcp'); }}>
                  <Plug className="h-3.5 w-3.5" /> {t('memory.brainHelp.openMcp')}
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setPickDefault(true)}>
                  <Settings2 className="h-3.5 w-3.5" /> {t('memory.teamGuide.pickDefault')}
                </Button>
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>
      {pickDefault && <MemorySettingsDialog open={pickDefault} onOpenChange={setPickDefault} />}
    </>
  );
}

// TeamMemoryGuideLink: an inline "How team memory works" link that opens the
// guide; used in the memory folder header, the Brain help and the settings.
export function TeamMemoryGuideLink({ className, onBeforeOpen }: { className?: string; onBeforeOpen?: () => void }) {
  const { t } = useTranslation('notes');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => { onBeforeOpen?.(); setOpen(true); }}
        className={cn('inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2 hover:text-violet-500', className)}
      >
        <BookOpen className="h-3 w-3" /> {t('memory.teamGuide.link')}
      </button>
      {open && <TeamMemoryGuideDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}

// AgentWritesHint: the short "your agent writes these, over MCP" line shown
// above a memory's cards, so nobody thinks cards must be opened by hand.
export function AgentWritesHint({ className }: { className?: string }) {
  const { t } = useTranslation('notes');
  return (
    <div className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md border border-violet-500/20 bg-violet-500/5 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground', className)}>
      <Bot className="h-3.5 w-3.5 shrink-0 text-violet-400" />
      <span>{t('memory.teamGuide.hint')}</span>
      <TeamMemoryGuideLink />
    </div>
  );
}
