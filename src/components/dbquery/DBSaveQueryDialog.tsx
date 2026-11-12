import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, MonitorSmartphone, Save } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const CHIP_LIMIT = 6;

export type SaveScope = 'local' | 'remote';

export interface SaveQueryPayload {
  name: string;
  folder: string;
  scope: SaveScope;
}

interface DBSaveQueryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName?: string;
  defaultFolder?: string;
  defaultScope?: SaveScope;
  /** Folders already in use for this connection — surfaced as a combobox
   *  so the user can pick one with one click or type a new one. */
  existingFolders?: string[];
  onSave: (payload: SaveQueryPayload) => Promise<void> | void;
  /** Disable remote (e.g. when offline / not logged in). */
  remoteAvailable?: boolean;
}

// DBSaveQueryDialog replaces the chained window.prompt() with a proper
// form. Scope picker lets the user decide whether the snippet stays on
// this device (localStorage) or syncs to their account through the BE.
export function DBSaveQueryDialog({
  open, onOpenChange,
  defaultName = '', defaultFolder = '',
  defaultScope = 'remote',
  existingFolders = [],
  onSave,
  remoteAvailable = true,
}: DBSaveQueryDialogProps) {
  const { t } = useTranslation('dbquery');
  const [name, setName] = useState(defaultName);
  const [folder, setFolder] = useState(defaultFolder);
  const [scope, setScope] = useState<SaveScope>(remoteAvailable ? defaultScope : 'local');
  const [saving, setSaving] = useState(false);

  // Re-seed when the dialog (re-)opens against a different tab.
  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setFolder(defaultFolder);
    setScope(remoteAvailable ? defaultScope : 'local');
  }, [open, defaultName, defaultFolder, defaultScope, remoteAvailable]);

  const handleSubmit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), folder: folder.trim(), scope });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const datalistId = 'dbsq-folders';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="h-4 w-4" /> {t('save.title')}
          </DialogTitle>
          <DialogDescription>
            {t('save.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="dbsq-name" className="text-xs">{t('common:name')}</Label>
            <Input
              id="dbsq-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('save.namePlaceholder')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
              }}
            />
          </div>

          <div>
            <Label htmlFor="dbsq-folder" className="text-xs">
              {t('save.folder')} <span className="text-muted-foreground">{t('save.folderOptional')}</span>
            </Label>
            <Input
              id="dbsq-folder"
              value={folder}
              list={existingFolders.length > 0 ? datalistId : undefined}
              onChange={(e) => setFolder(e.target.value)}
              placeholder={existingFolders.length > 0 ? existingFolders[0] : t('save.folderPlaceholder')}
            />
            {existingFolders.length > 0 && (
              <datalist id={datalistId}>
                {existingFolders.map((f) => <option key={f} value={f} />)}
              </datalist>
            )}
            {existingFolders.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                {existingFolders.slice(0, CHIP_LIMIT).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFolder(f)}
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      folder === f
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-accent/50'
                    }`}
                  >
                    {f}
                  </button>
                ))}
                {existingFolders.length > CHIP_LIMIT && (
                  <span
                    className="text-[10px] text-muted-foreground italic"
                    title={t('save.moreTitle')}
                  >
                    {t('save.moreChips', { count: existingFolders.length - CHIP_LIMIT })}
                  </span>
                )}
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">{t('save.saveTo')}</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <ScopeCard
                icon={<MonitorSmartphone className="h-4 w-4" />}
                title={t('save.scopeLocalTitle')}
                desc={t('save.scopeLocalDesc')}
                active={scope === 'local'}
                onClick={() => setScope('local')}
              />
              <ScopeCard
                icon={<Cloud className="h-4 w-4" />}
                title={t('save.scopeRemoteTitle')}
                desc={t('save.scopeRemoteDesc')}
                active={scope === 'remote'}
                onClick={() => remoteAvailable && setScope('remote')}
                disabled={!remoteAvailable}
                disabledHint={t('save.notSignedIn')}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common:cancel')}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!name.trim() || saving}>
            {saving ? t('save.saving') : t('common:save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopeCard({
  icon, title, desc, active, onClick, disabled, disabledHint,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'text-left rounded-md border p-2.5 transition-colors',
        active && !disabled
          ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
          : 'border-border hover:bg-accent/50',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        {icon}
        {title}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{desc}</p>
      {disabled && disabledHint && (
        <p className="text-[10px] text-amber-500 mt-1">{disabledHint}</p>
      )}
    </button>
  );
}
