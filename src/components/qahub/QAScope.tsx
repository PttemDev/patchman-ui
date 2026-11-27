import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Users } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/use-toast';
import { qaAPI } from '@/services/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useQAScopeStore } from '@/stores/qaScopeStore';
import type { Workspace } from '@/types';

const PERSONAL = '__personal__';

/** Workspaces whose team can share QA items (a team is bound). */
export function useSharedWorkspaces(): Workspace[] {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);
  useEffect(() => { if (workspaces.length === 0) void fetchWorkspaces(); }, [workspaces.length, fetchWorkspaces]);
  return (workspaces ?? []).filter((w) => !!w.teamId);
}

// "Personal / <team workspace>" — which QA space the Hub shows.
export function QAScopeSelect() {
  const { t } = useTranslation('qa');
  const shared = useSharedWorkspaces();
  const workspaceId = useQAScopeStore((s) => s.workspaceId);
  const setWorkspaceId = useQAScopeStore((s) => s.setWorkspaceId);
  // A workspace the user left or that was deleted falls back to personal.
  useEffect(() => {
    if (workspaceId && shared.length > 0 && !shared.some((w) => w.id === workspaceId)) setWorkspaceId(null);
  }, [workspaceId, shared, setWorkspaceId]);
  return (
    <Select value={workspaceId ?? PERSONAL} onValueChange={(v) => setWorkspaceId(v === PERSONAL ? null : v)}>
      <SelectTrigger className="h-8 w-[220px] text-xs" aria-label={t('hub.scope.label')} title={t('hub.scope.hint')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={PERSONAL} className="text-xs">
          <span className="flex items-center gap-1.5"><Lock className="h-3 w-3" /> {t('hub.scope.personal')}</span>
        </SelectItem>
        {shared.map((w) => (
          <SelectItem key={w.id} value={w.id} className="text-xs">
            <span className="flex items-center gap-1.5"><Users className="h-3 w-3" /> {w.name}</span>
          </SelectItem>
        ))}
        {shared.length === 0 && (
          <div className="px-2 py-1.5 text-[11px] text-muted-foreground">{t('hub.scope.none')}</div>
        )}
      </SelectContent>
    </Select>
  );
}

// "Move to…" for a QA item its creator owns: Personal or a team workspace.
export function QAMoveSubmenu({ kind, id, currentWorkspaceId, onMoved }: {
  kind: 'case' | 'folder' | 'plan' | 'defect' | 'requirement' | 'sharedStep' | 'loadTest';
  id: string;
  currentWorkspaceId?: string | null;
  onMoved: () => void;
}) {
  const { t } = useTranslation('qa');
  const shared = useSharedWorkspaces();
  const move = async (ws: string | null) => {
    try {
      const res = await qaAPI.move(kind, id, ws);
      const name = ws ? shared.find((w) => w.id === ws)?.name ?? '' : t('hub.scope.personal');
      toast({ title: t('hub.move.done', { count: res.data?.moved ?? 1, target: name }), duration: 2500 });
      onMoved();
    } catch (err) {
      toast({ title: t('hub.move.failed'), description: extractApiError(err), variant: 'destructive' });
    }
  };
  const current = currentWorkspaceId ?? null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="text-xs">
        <Users className="mr-2 h-3.5 w-3.5" />{t('hub.move.to')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-52">
        <DropdownMenuItem className="text-xs" disabled={current === null} onSelect={() => void move(null)}>
          <Lock className="mr-2 h-3.5 w-3.5" />{t('hub.scope.personal')}
        </DropdownMenuItem>
        {shared.map((w) => (
          <DropdownMenuItem key={w.id} className="text-xs" disabled={current === w.id} onSelect={() => void move(w.id)}>
            <Users className="mr-2 h-3.5 w-3.5" />{w.name}
          </DropdownMenuItem>
        ))}
        {shared.length === 0 && <div className="px-2 py-1.5 text-[11px] text-muted-foreground">{t('hub.scope.none')}</div>}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function extractApiError(err: unknown): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.message ?? '';
}
