import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Plus, Pencil, Trash2, Loader2, Users2, Lock } from 'lucide-react';
import { getRepo } from '@/data';
import { teamsAPI, workspacesAPI } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import type { Team } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Workspace } from '@/types';

interface WorkspaceManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Workspace manager — owner-only post-RFC. The members tab and all
// team-style sharing have been hoisted out into the dedicated Teams
// entity (see TeamsManager + TEAMS_AND_PUBLIC_SHARING_RFC.md). This
// component now just creates/edits/deletes a user's personal workspaces.
export function WorkspaceManager({ open, onOpenChange }: WorkspaceManagerProps) {
  const { t } = useTranslation('workspace');
  const currentUserId = useAuthStore((s) => s.user?.id) ?? '';
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('list');

  // Sentinel string for "no team / personal" because <Select> doesn't
  // accept empty-string values without a placeholder-collision bug.
  const TEAM_NONE = '__none__';

  // Create / edit form state
  const [editing, setEditing] = useState<Workspace | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formType, setFormType] = useState<string>('personal');
  const [formTeamId, setFormTeamId] = useState<string>(TEAM_NONE);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete confirmation target
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getRepo().workspaces.list();
      setWorkspaces(list);
    } catch {
      // API not available
    }
    setLoading(false);
  }, []);

  // Teams the current user belongs to — only these are valid bind
  // targets per the BE membership guard.
  const fetchTeams = useCallback(async () => {
    try {
      const res = await teamsAPI.list();
      setTeams((res.data as Team[]) ?? []);
    } catch {
      setTeams([]);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchWorkspaces();
      fetchTeams();
    }
  }, [open, fetchWorkspaces, fetchTeams]);

  const handleCreateOrEdit = async () => {
    if (!formName.trim()) {
      setFormError(t('validation.nameRequired'));
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const nextTeamId = formTeamId === TEAM_NONE ? null : formTeamId;
      if (editing) {
        await getRepo().workspaces.update(editing.id, { name: formName, description: formDescription });
        // Only call setTeam when the binding actually changed — avoids
        // a useless write + notify when the user just renamed.
        const prevTeamId = editing.teamId ?? null;
        if (prevTeamId !== nextTeamId) {
          await workspacesAPI.setTeam(editing.id, nextTeamId);
        }
      } else {
        const created = await getRepo().workspaces.create({
          name: formName,
          description: formDescription,
          type: formType as 'personal' | 'team',
        });
        if (nextTeamId && created?.id) {
          await workspacesAPI.setTeam(created.id, nextTeamId);
        }
      }
      await fetchWorkspaces();
      setActiveTab('list');
      setEditing(null);
      setFormName('');
      setFormDescription('');
      setFormType('personal');
      setFormTeamId(TEAM_NONE);
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response: { data: { error?: string } } }).response?.data?.error || t('error.operationFailed')
          : t('error.operationFailed');
      setFormError(message);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await getRepo().workspaces.remove(deleteTarget.id);
      await fetchWorkspaces();
    } catch {
      // ignore
    }
    setDeleteTarget(null);
  };

  const openEdit = (ws: Workspace) => {
    setEditing(ws);
    setFormName(ws.name);
    setFormDescription(ws.description);
    setFormType(ws.type);
    setFormTeamId(ws.teamId ?? TEAM_NONE);
    setFormError('');
    setActiveTab('form');
  };

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormDescription('');
    setFormType('personal');
    setFormTeamId(TEAM_NONE);
    setFormError('');
    setActiveTab('form');
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {t('manager.title')}
            </DialogTitle>
            <DialogDescription>
              {t('manager.description')}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0">
            <TabsList className="w-full">
              <TabsTrigger value="list" className="flex-1">{t('manager.tabList')}</TabsTrigger>
              <TabsTrigger value="form" className="flex-1">
                {editing ? t('common:edit') : t('form.create')}
              </TabsTrigger>
            </TabsList>

            {/* Workspace List */}
            <TabsContent value="list" className="mt-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground">
                  {workspaces.length === 1
                    ? t('manager.countOne', { count: workspaces.length })
                    : t('manager.countOther', { count: workspaces.length })}
                </span>
                <Button size="sm" className="h-7 text-xs" onClick={openCreate}>
                  <Plus className="h-3 w-3 mr-1" />
                  {t('manager.newWorkspace')}
                </Button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : workspaces.length === 0 ? (
                <div className="text-center py-8">
                  <Building2 className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">{t('manager.empty')}</p>
                  <Button size="sm" className="mt-2 h-7 text-xs" onClick={openCreate}>
                    {t('manager.createFirst')}
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2 pr-3">
                    {workspaces.map((ws) => {
                      // The list endpoint returns both owned and team-bound
                      // workspaces. Non-owners can SEE the row (it shows up
                      // in their selector) but cannot rename / rebind / delete
                      // it — those actions are owner-only.
                      const isOwner = !ws.ownerId || ws.ownerId === currentUserId;
                      return (
                      <div
                        key={ws.id}
                        className="p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium truncate">{ws.name}</span>
                              {ws.teamId ? (
                                <Badge variant="info" className="text-[10px] px-1.5 py-0 flex items-center gap-1">
                                  <Users2 className="h-2.5 w-2.5" />
                                  {ws.teamName || t('manager.teamFallback')}
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{t('manager.personal')}</Badge>
                              )}
                              {!isOwner && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex items-center gap-1">
                                  <Lock className="h-2.5 w-2.5" />
                                  {t('manager.sharedWithYou')}
                                </Badge>
                              )}
                            </div>
                            {ws.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {ws.description}
                              </p>
                            )}
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {t('manager.created', { date: new Date(ws.createdAt).toLocaleDateString() })}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {isOwner && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => openEdit(ws)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => setDeleteTarget(ws)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>

            {/* Create / Edit Form */}
            <TabsContent value="form" className="mt-3">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ws-name">{t('common:name')}</Label>
                  <Input
                    id="ws-name"
                    value={formName}
                    onChange={(e) => { setFormName(e.target.value); setFormError(''); }}
                    placeholder={t('form.namePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ws-desc">{t('form.description')}</Label>
                  <Input
                    id="ws-desc"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder={t('form.descriptionPlaceholder')}
                  />
                </div>
                {!editing && (
                  <div className="space-y-2">
                    <Label>{t('common:type')}</Label>
                    <Select value={formType} onValueChange={setFormType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="personal">{t('form.personal')}</SelectItem>
                        <SelectItem value="team">{t('form.team')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {/* Share with team — owner-only affordance. Binding a
                    workspace to a team makes it appear in every team
                    member's selector. Collections inside still respect
                    their own ACL — to grant the team access to content,
                    the owner uses the per-collection / per-environment
                    sharing dialog. */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Users2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {t('form.shareWithTeam')}
                  </Label>
                  <Select value={formTeamId} onValueChange={setFormTeamId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TEAM_NONE}>{t('form.personalNoTeam')}</SelectItem>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    {t('form.shareHint')}
                  </p>
                </div>
                {formError && (
                  <p className="text-xs text-destructive">{formError}</p>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setActiveTab('list')} disabled={saving}>
                    {t('common:cancel')}
                  </Button>
                  <Button onClick={handleCreateOrEdit} disabled={saving || !formName.trim()}>
                    {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    {editing ? t('form.saveChanges') : t('form.create')}
                  </Button>
                </DialogFooter>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete.workspaceTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('delete.workspaceDescription', { name: deleteTarget?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">
              {t('common:delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
