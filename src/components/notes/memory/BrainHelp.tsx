import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, CircleHelp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useMemoryStore } from '@/stores/memoryStore';
import { useSettingsUIStore } from '@/stores/settingsUIStore';
import { cn } from '@/lib/utils';
import { MemorySettingsDialog } from './MemorySettingsDialog';

const DISMISS_KEY = 'patchman_brain_help_dismissed';

// BrainHelpSteps: how Brain gets its cards — connect an agent over MCP, let
// it remember (the personal "Agent Memory" folder is created on its first
// remember; any own folder can be made a memory too), then open the memory in
// the Brain view. onLeave runs before jumping elsewhere (MCP settings, the
// team-memory explanation) so a surrounding dialog can close first.
function BrainHelpSteps({ intro, onLeave, onTeam, className }: { intro: boolean; onLeave?: () => void; onTeam: () => void; className?: string }) {
  const { t } = useTranslation(['notes', 'common', 'settings']);
  const openSettings = useSettingsUIStore((s) => s.openSettings);
  const link = 'font-medium text-foreground underline underline-offset-2 hover:text-violet-500';
  return (
    <div className={cn('space-y-1.5', className)}>
      {intro && <p>{t('memory.brainHelp.intro')}</p>}
      <ol className="list-decimal pl-4 space-y-1.5">
        <li>
          {t('memory.brainHelp.connect', { path: `${t('common:settings')} → ${t('settings:nav.mcp')}` })}{' '}
          <button type="button" className={link} onClick={() => { onLeave?.(); openSettings('mcp'); }}>
            {t('memory.brainHelp.openMcp')}
          </button>
        </li>
        <li>{t('memory.brainHelp.remember', { myNotes: t('myNotes'), useAsMemory: t('memory.useAsMemory') })}</li>
        <li>{t('memory.brainHelp.view', { brain: t('memory.brainView') })}</li>
      </ol>
      <p>
        {t('memory.brainHelp.team')}{' '}
        <button type="button" className={link} onClick={() => { onLeave?.(); onTeam(); }}>
          {t('memory.brainHelp.teamLink')}
        </button>
      </p>
    </div>
  );
}

function readDismissed(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

// BrainHelpCard: a dismissible "Turn on Brain" card for the Notes sidebar,
// shown once memory is loaded and the person has no agent memory folder yet.
// Dismissing it is a per-viewer convenience kept in localStorage; the same
// help stays reachable from BrainHelpButton.
export function BrainHelpCard() {
  const { t } = useTranslation('notes');
  const loaded = useMemoryStore((s) => s.loaded);
  const hasMemory = useMemoryStore((s) => s.folders.length > 0);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [team, setTeam] = useState(false);
  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* per-viewer convenience only */ }
  };
  return (
    <>
      {loaded && !hasMemory && !dismissed && (
        <div className="rounded-md border border-violet-500/20 bg-violet-500/5 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Brain className="h-3.5 w-3.5 shrink-0 text-violet-400" />
            <span className="flex-1 min-w-0 truncate">{t('memory.brainHelp.title')}</span>
            <button
              type="button"
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t('memory.brainHelp.dismiss')}
              title={t('memory.brainHelp.dismiss')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <BrainHelpSteps intro onTeam={() => setTeam(true)} />
        </div>
      )}
      {team && <MemorySettingsDialog open={team} onOpenChange={setTeam} />}
    </>
  );
}

// BrainHelpButton: a small "?" that opens the same help in a dialog — next to
// the Brain view toggle and in the Notes panel header.
export function BrainHelpButton({ className, variant = 'ghost' }: { className?: string; variant?: 'ghost' | 'outline' }) {
  const { t } = useTranslation('notes');
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState(false);
  return (
    <>
      <Button
        size="icon"
        variant={variant}
        className={cn('h-6 w-6', className)}
        onClick={() => setOpen(true)}
        title={t('memory.brainHelp.open')}
        aria-label={t('memory.brainHelp.open')}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-violet-400" /> {t('memory.brainHelp.title')}
            </DialogTitle>
            <DialogDescription>{t('memory.brainHelp.intro')}</DialogDescription>
          </DialogHeader>
          <BrainHelpSteps intro={false} onLeave={() => setOpen(false)} onTeam={() => setTeam(true)} className="text-sm text-muted-foreground" />
        </DialogContent>
      </Dialog>
      {team && <MemorySettingsDialog open={team} onOpenChange={setTeam} />}
    </>
  );
}
