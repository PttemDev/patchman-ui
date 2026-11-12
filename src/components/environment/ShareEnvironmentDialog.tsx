// Owner-side share dialog for an Environment.
//
// Post-1.16 the dialog is just the PublicSharingPanel surface — the
// legacy share-code flow was removed and existing collaborator rows
// were migrated to public-grants on the BE (see
// database.migrateEnvironmentSharesToPublicGrants). All env sharing
// now happens via visibility=public + Editors / Viewers + team /
// everyone grants, same model collections use.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PublicSharingPanel } from '@/components/sharing/PublicSharingPanel';
import { useAuthStore } from '@/stores/authStore';
import type { Environment } from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environment: Environment;
}

export function ShareEnvironmentDialog({ open, onOpenChange, environment }: Props) {
  const { t } = useTranslation('environment');
  const currentUserId = useAuthStore((s) => s.user?.id) ?? '';
  const ownerId = environment.userId || currentUserId;
  const isOwner = currentUserId === ownerId;

  const [visibility, setVisibility] = useState<'private' | 'public'>(
    environment.visibility ?? 'private',
  );
  useEffect(() => {
    setVisibility(environment.visibility ?? 'private');
  }, [environment.visibility, environment.id]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t('share.title')}
          </DialogTitle>
          <DialogDescription>
            {t('share.description', { name: environment.name })}
          </DialogDescription>
        </DialogHeader>

        {/* overflow-y-auto on a plain flex child handles short
            viewports more reliably than radix ScrollArea's Viewport,
            which can fail to compute its height from a flex-1
            min-h-0 parent. */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-2">
          <PublicSharingPanel
            kind="environment"
            assetId={environment.id}
            assetName={environment.name}
            currentVisibility={visibility}
            ownerId={ownerId}
            onVisibilityChange={setVisibility}
            canManageVisibility={isOwner}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
