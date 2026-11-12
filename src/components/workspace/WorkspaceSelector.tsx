import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Users2 } from 'lucide-react';
import { useWorkspaceStore, WORKSPACE_ALL, WORKSPACE_NONE } from '@/stores/workspaceStore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { WorkspaceManager } from './WorkspaceManager';
import { TeamsManager } from './TeamsManager';

export function WorkspaceSelector() {
  const { t } = useTranslation('workspace');
  const { workspaces, activeWorkspaceId, fetchWorkspaces, setActiveWorkspace } = useWorkspaceStore();
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [teamsManagerOpen, setTeamsManagerOpen] = useState(false);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  // The collection tree listens for activeWorkspaceId changes and refetches
  // itself, so the setter is all we need here.
  const handleChange = (value: string) => setActiveWorkspace(value);

  return (
    <div className="flex items-center gap-1.5">
      <Select value={activeWorkspaceId ?? ''} onValueChange={handleChange}>
        <SelectTrigger className="w-[180px] h-8 text-xs">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground mr-1 shrink-0" />
          <SelectValue placeholder={t('selector.placeholder')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={WORKSPACE_ALL}>{t('selector.all')}</SelectItem>
          {workspaces.map((ws) => (
            <SelectItem key={ws.id} value={ws.id}>
              {ws.name}
            </SelectItem>
          ))}
          <SelectItem value={WORKSPACE_NONE} className="text-muted-foreground">
            {t('selector.none')}
          </SelectItem>
        </SelectContent>
      </Select>
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setWorkspaceManagerOpen(true)}
            >
              <Building2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>{t('selector.manageWorkspaces')}</p></TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setTeamsManagerOpen(true)}
            >
              <Users2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>{t('selector.manageTeams')}</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <WorkspaceManager open={workspaceManagerOpen} onOpenChange={setWorkspaceManagerOpen} />
      <TeamsManager open={teamsManagerOpen} onOpenChange={setTeamsManagerOpen} />
    </div>
  );
}
