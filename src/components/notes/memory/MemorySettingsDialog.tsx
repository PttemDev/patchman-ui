import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useMemoryStore } from '@/stores/memoryStore';
import { useLLMProviderStore } from '@/stores/llmProviderStore';
import { useAuthStore } from '@/stores/authStore';
import { ScopeBadge } from './MemoryBits';

const NONE = '__none__';

// TeamMemoryInfo explains what a team memory is for and how to set one up,
// as the backend behaves: remember(scope: team) goes to the only team memory
// the person can write to, else the default picked here; with several and no
// default the agent must pass a folderId. recall reads every memory shared
// with the person, so teammates' agents find what one of them saved.
function TeamMemoryInfo() {
  const { t } = useTranslation(['notes', 'sharing']);
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 text-violet-400" /> {t('memory.teamInfo.title')}
      </p>
      <p>{t('memory.teamInfo.what')}</p>
      <p>{t('memory.teamInfo.when')}</p>
      <p>
        {t('memory.teamInfo.setup', {
          useAsMemory: t('memory.useAsMemory'),
          share: t('share'),
          public: t('sharing:public'),
          editors: t('sharing:editors'),
        })}
      </p>
    </div>
  );
}

// MemorySettingsDialog: which team memory remember(scope=team) writes to when
// several are shared with the person, and the AI provider that splits what
// agents remember into cards. The provider must live on the backend that
// holds the notes (the worker runs there).
export function MemorySettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation(['notes', 'common']);
  const { toast } = useToast();
  const folders = useMemoryStore((s) => s.folders);
  const settings = useMemoryStore((s) => s.settings);
  const saveSettings = useMemoryStore((s) => s.saveSettings);
  const fetchMemory = useMemoryStore((s) => s.fetch);
  const providers = useLLMProviderStore((s) => s.providers);
  const fetchProviders = useLLMProviderStore((s) => s.fetchProviders);
  const dataSource = useAuthStore((s) => s.dataSource);
  const [team, setTeam] = useState(settings.teamFolderId || NONE);
  const [provider, setProvider] = useState(settings.llmProviderId || NONE);
  const [model, setModel] = useState(settings.llmModel);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void fetchMemory();
    void fetchProviders();
  }, [open, fetchMemory, fetchProviders]);
  useEffect(() => {
    setTeam(settings.teamFolderId || NONE);
    setProvider(settings.llmProviderId || NONE);
    setModel(settings.llmModel);
  }, [settings]);

  const teamFolders = useMemo(() => folders.filter((f) => f.scope.kind === 'team' && f.canWrite), [folders]);
  const usable = useMemo(
    () => providers.filter((p) => !p.availableScopes || p.availableScopes.includes(dataSource)),
    [providers, dataSource],
  );
  const chosen = usable.find((p) => p.id === provider);

  const save = async () => {
    setSaving(true);
    try {
      await saveSettings({
        teamFolderId: team === NONE ? '' : team,
        llmProviderId: provider === NONE ? '' : provider,
        llmModel: provider === NONE ? '' : model.trim(),
      });
      toast({ title: t('memory.saved') });
      onOpenChange(false);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      toast({ title: t('memory.saveFailed'), description: msg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('memory.settings')}</DialogTitle>
          <DialogDescription>{t('memory.settingsDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label className="text-xs">{t('memory.teamDefault')}</Label>
            <TeamMemoryInfo />
            <Select value={team} onValueChange={setTeam}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} className="text-xs">{t('memory.none')}</SelectItem>
                {teamFolders.map((f) => (
                  <SelectItem key={f.id} value={f.id} className="text-xs">
                    <span className="flex items-center gap-2">{f.title}<ScopeBadge scope={f.scope} /></span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {teamFolders.length === 0 && <p className="text-[11px] text-muted-foreground">{t('memory.noTeamMemory')}</p>}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t('memory.splitter')}</Label>
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <Select value={provider} onValueChange={(v) => { setProvider(v); setModel(''); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="text-xs">{t('memory.noSplitter')}</SelectItem>
                  {usable.map((p) => <SelectItem key={p.id} value={p.id} className="text-xs">{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={provider === NONE}
                placeholder={chosen?.model || t('memory.modelPlaceholder')}
                className="h-8 text-xs"
                aria-label={t('memory.model')}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {usable.length === 0 ? t('memory.noProviders') : t('memory.splitterHint')}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common:cancel')}</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}{t('common:save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
