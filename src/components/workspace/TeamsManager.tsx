import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Crown,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  Users2,
} from 'lucide-react';
import { teamsAPI, usersAPI } from '@/services/api';
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
import type { Team, TeamMember } from '@/types';

interface TeamsManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface TeamApiResponse {
  data?: Team[];
}
interface MemberApiResponse {
  data?: TeamMember[];
}

// Team management dialog — sibling of WorkspaceManager but for the new
// Team entity. Three tabs: list / form / members. Teams are global
// (every user can see + create), so the listing isn't workspace-scoped.
//
// Permissions enforced by BE: admin-only mutations (rename, delete,
// add/remove member, change role), member-self for self-removal.
// Last-admin guard is BE-side; UI surfaces the resulting 409 error.
export function TeamsManager({ open, onOpenChange }: TeamsManagerProps) {
  const { t } = useTranslation('workspace');
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('list');

  // Form (create / edit) state
  const [editing, setEditing] = useState<Team | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Members panel state
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);
  const [memberError, setMemberError] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState<{ id: string; name: string; email: string }[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Delete confirmation target
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    try {
      const response = (await teamsAPI.list()) as TeamApiResponse;
      setTeams(Array.isArray(response.data) ? response.data : []);
    } catch {
      setTeams([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) fetchTeams();
  }, [open, fetchTeams]);

  const fetchMembers = useCallback(async (teamId: string) => {
    setMembersLoading(true);
    try {
      const response = (await teamsAPI.listMembers(teamId)) as MemberApiResponse;
      setMembers(Array.isArray(response.data) ? response.data : []);
    } catch {
      setMembers([]);
    }
    setMembersLoading(false);
  }, []);

  const handleCreateOrEdit = async () => {
    if (!formName.trim()) {
      setFormError(t('validation.nameRequired'));
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await teamsAPI.update(editing.id, { name: formName, description: formDescription });
      } else {
        await teamsAPI.create({ name: formName, description: formDescription });
      }
      await fetchTeams();
      setActiveTab('list');
      setEditing(null);
      setFormName('');
      setFormDescription('');
    } catch (err: unknown) {
      setFormError(extractErr(err, t('error.operationFailed')));
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await teamsAPI.delete(deleteTarget.id);
      await fetchTeams();
      if (selectedTeam?.id === deleteTarget.id) {
        setSelectedTeam(null);
        setMembers([]);
      }
    } catch {
      // ignore — common case is "not admin"; toast not strictly required here
    }
    setDeleteTarget(null);
  };

  const handleUserSearch = useCallback((query: string) => {
    setUserSearch(query);
    setMemberError('');
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!query.trim()) {
      setUserResults([]);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      setSearchingUsers(true);
      try {
        const response = await usersAPI.search(query);
        const data = Array.isArray(response.data) ? response.data : [];
        setUserResults(data as { id: string; name: string; email: string }[]);
      } catch {
        setUserResults([]);
      }
      setSearchingUsers(false);
    }, 300);
  }, []);

  const selectUser = (user: { id: string; name: string; email: string }) => {
    setInviteEmail(user.email);
    setUserSearch('');
    setUserResults([]);
  };

  const handleInvite = async () => {
    if (!selectedTeam || !inviteEmail.trim()) return;
    setInviting(true);
    setMemberError('');
    try {
      await teamsAPI.addMember(selectedTeam.id, { email: inviteEmail, role: inviteRole });
      setInviteEmail('');
      setInviteRole('member');
      await fetchMembers(selectedTeam.id);
      await fetchTeams(); // refresh memberCount on the list
    } catch (err: unknown) {
      setMemberError(extractErr(err, t('error.inviteFailed')));
    }
    setInviting(false);
  };

  const handleRoleChange = async (userId: string, role: 'admin' | 'member') => {
    if (!selectedTeam) return;
    try {
      await teamsAPI.updateMemberRole(selectedTeam.id, userId, { role });
      await fetchMembers(selectedTeam.id);
    } catch (err: unknown) {
      setMemberError(extractErr(err, t('error.changeRoleFailed')));
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedTeam) return;
    try {
      await teamsAPI.removeMember(selectedTeam.id, userId);
      await fetchMembers(selectedTeam.id);
      await fetchTeams();
    } catch (err: unknown) {
      setMemberError(extractErr(err, t('error.removeMemberFailed')));
    }
  };

  const openEdit = (team: Team) => {
    setEditing(team);
    setFormName(team.name);
    setFormDescription(team.description);
    setFormError('');
    setActiveTab('form');
  };

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormDescription('');
    setFormError('');
    setActiveTab('form');
  };

  const openMembers = (team: Team) => {
    setSelectedTeam(team);
    setInviteEmail('');
    setInviteRole('member');
    setMemberError('');
    fetchMembers(team.id);
    setActiveTab('members');
  };

  // Active user's role on selected team — drives the UI's "you cannot
  // edit this" guards. Drawn from team.myRole on the listing.
  const myRoleOnSelected: Team['myRole'] = selectedTeam?.myRole ?? '';
  const canManageSelected = myRoleOnSelected === 'admin';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[640px] max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users2 className="h-5 w-5" />
              {t('teams.title')}
            </DialogTitle>
            <DialogDescription>
              {t('teams.description')}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0">
            <TabsList className="w-full">
              <TabsTrigger value="list" className="flex-1">{t('teams.tabList')}</TabsTrigger>
              <TabsTrigger value="form" className="flex-1">
                {editing ? t('common:edit') : t('form.create')}
              </TabsTrigger>
              {selectedTeam && (
                <TabsTrigger value="members" className="flex-1">{t('teams.tabMembers')}</TabsTrigger>
              )}
            </TabsList>

            {/* Team list */}
            <TabsContent value="list" className="mt-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground">
                  {teams.length === 1
                    ? t('teams.countOne', { count: teams.length })
                    : t('teams.countOther', { count: teams.length })}
                </span>
                <Button size="sm" className="h-7 text-xs" onClick={openCreate}>
                  <Plus className="h-3 w-3 mr-1" />
                  {t('teams.newTeam')}
                </Button>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : teams.length === 0 ? (
                <div className="text-center py-8">
                  <Users2 className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">{t('teams.empty')}</p>
                  <Button size="sm" className="mt-2 h-7 text-xs" onClick={openCreate}>
                    {t('teams.createFirst')}
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-[300px]">
                  <div className="space-y-2 pr-3">
                    {teams.map((team) => (
                      <div
                        key={team.id}
                        className="p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">{team.name}</span>
                              {team.myRole === 'admin' && (
                                <Badge variant="info" className="text-[10px] px-1.5 py-0">
                                  <Crown className="h-2.5 w-2.5 mr-0.5" />
                                  {t('teams.roleAdmin')}
                                </Badge>
                              )}
                              {team.myRole === 'member' && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                  {t('teams.roleMember')}
                                </Badge>
                              )}
                            </div>
                            {team.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {team.description}
                              </p>
                            )}
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {(team.memberCount ?? 0) === 1
                                ? t('teams.memberCountOne', { count: team.memberCount ?? 0 })
                                : t('teams.memberCountOther', { count: team.memberCount ?? 0 })}
                              {team.creatorName ? t('teams.byCreator', { name: team.creatorName }) : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => openMembers(team)}
                              title={t('teams.tabMembers')}
                            >
                              <Users className="h-3.5 w-3.5" />
                            </Button>
                            {team.myRole === 'admin' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => openEdit(team)}
                                  title={t('common:edit')}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => setDeleteTarget(team)}
                                  title={t('common:delete')}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>

            {/* Create / Edit form */}
            <TabsContent value="form" className="mt-3">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="team-name">{t('common:name')}</Label>
                  <Input
                    id="team-name"
                    value={formName}
                    onChange={(e) => { setFormName(e.target.value); setFormError(''); }}
                    placeholder={t('form.teamNamePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team-desc">{t('form.description')}</Label>
                  <Input
                    id="team-desc"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder={t('form.descriptionPlaceholder')}
                  />
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

            {/* Members panel */}
            {selectedTeam && (
              <TabsContent value="members" className="mt-3">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Users2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{selectedTeam.name}</span>
                    {!canManageSelected && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {t('members.viewOnly')}
                      </Badge>
                    )}
                  </div>

                  {/* Invite block — only renders for admins. Members still
                      see the roster but can't add or change roles. */}
                  {canManageSelected && (
                    <div className="p-3 border rounded-lg space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <UserPlus className="h-3 w-3" />
                        {t('members.addMember')}
                      </div>
                      <div className="relative">
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                            <Input
                              value={userSearch || inviteEmail}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (inviteEmail) setInviteEmail('');
                                handleUserSearch(val);
                              }}
                              placeholder={t('members.searchPlaceholder')}
                              className="h-8 text-xs pl-7"
                            />
                            {searchingUsers && (
                              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
                            )}
                          </div>
                          <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as 'admin' | 'member')}>
                            <SelectTrigger className="h-8 w-24 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">{t('members.roleAdmin')}</SelectItem>
                              <SelectItem value="member">{t('members.roleMember')}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            className="h-8 text-xs"
                            onClick={handleInvite}
                            disabled={inviting || !inviteEmail.trim()}
                          >
                            {inviting ? <Loader2 className="h-3 w-3 animate-spin" /> : t('common:add')}
                          </Button>
                        </div>
                        {userResults.length > 0 && (
                          <div className="absolute z-50 top-9 left-0 right-32 bg-popover border rounded-md shadow-lg max-h-[160px] overflow-auto">
                            {userResults.map((user) => (
                              <button
                                key={user.id}
                                className="w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center gap-2 cursor-pointer"
                                onClick={() => selectUser(user)}
                              >
                                <div className="min-w-0 flex-1">
                                  <span className="text-xs font-medium block truncate">{user.name || user.email}</span>
                                  {user.name && (
                                    <span className="text-[10px] text-muted-foreground block truncate">{user.email}</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {inviteEmail && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{t('members.selected')}</span>
                          <Badge variant="secondary" className="text-[10px]">{inviteEmail}</Badge>
                        </div>
                      )}
                    </div>
                  )}

                  {memberError && (
                    <p className="text-xs text-destructive">{memberError}</p>
                  )}

                  {/* Member list */}
                  {membersLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : members.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      {t('members.empty')}
                    </p>
                  ) : (
                    <ScrollArea className="h-[220px]">
                      <div className="space-y-1 pr-3">
                        {members.map((member) => (
                          <div
                            key={member.userId}
                            className="flex items-center gap-2 p-2 rounded-md hover:bg-accent transition-colors"
                          >
                            {member.role === 'admin' ? (
                              <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            ) : (
                              <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-medium truncate block">
                                {member.name || member.email}
                              </span>
                              {member.name && (
                                <span className="text-[10px] text-muted-foreground truncate block">
                                  {member.email}
                                </span>
                              )}
                            </div>
                            {canManageSelected ? (
                              <Select
                                value={member.role}
                                onValueChange={(role) => handleRoleChange(member.userId, role as 'admin' | 'member')}
                              >
                                <SelectTrigger className="h-6 w-20 text-[10px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="admin">{t('members.roleAdmin')}</SelectItem>
                                  <SelectItem value="member">{t('members.roleMember')}</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge variant="secondary" className="text-[10px]">
                                {member.role === 'admin' ? t('members.roleAdmin') : t('members.roleMember')}
                              </Badge>
                            )}
                            {canManageSelected && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive hover:text-destructive"
                                onClick={() => handleRemoveMember(member.userId)}
                                title={t('common:remove')}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              </TabsContent>
            )}
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete.teamTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('delete.teamDescription', { name: deleteTarget?.name })}
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

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}
