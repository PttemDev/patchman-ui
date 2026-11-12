import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Crown,
  Eye,
  Globe2,
  Loader2,
  Plus,
  Search,
  Trash2,
  Users2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  collectionSharingAPI,
  environmentSharingAPI,
  whiteboardSharingAPI,
  teamsAPI,
  usersAPI,
  noteSharingAPI,
} from '@/services/api';
import type { PublicGrant, Team } from '@/types';

interface PublicSharingPanelProps {
  kind: 'collection' | 'environment' | 'whiteboard' | 'note';
  assetId: string;
  assetName: string;
  currentVisibility: 'private' | 'public';
  /** Owner's userId — needed so the UI can render the "you (owner)"
   *  card with a fixed badge and block its removal. */
  ownerId: string;
  /** Called after a successful visibility flip so the parent (e.g.
   *  ShareCollectionDialog) can refresh its own derived state. */
  onVisibilityChange?: (next: 'private' | 'public') => void;
  /** Non-owner editors can manage the Editors/Viewers grant lists but
   *  cannot flip visibility or wipe everything via Make Private. When
   *  false we render only the grant section + the Add row so editors
   *  get exactly the slice they need without the owner-only toggle. */
  canManageVisibility?: boolean;
}

interface AddOption {
  kind: 'user' | 'team' | 'everyone';
  id?: string;       // user_id or team_id
  email?: string;    // for user search results
  label: string;
}

// PublicSharingPanel renders the "Public + Editors + Viewers" surface
// described in the Teams + Public Sharing RFC. Behavior is identical
// across collections and environments — only the API binding differs,
// chosen via the `kind` prop.
//
// Layout:
//   [Switch] Public      <tooltip>...</tooltip>
//   ── Editors list (one row per grant; everyone-takes-over guard)
//   ── Viewers list (same shape)
//   ── Add new entry: search box + role select + add button
export function PublicSharingPanel({
  kind,
  assetId,
  assetName,
  currentVisibility,
  ownerId,
  onVisibilityChange,
  canManageVisibility = true,
}: PublicSharingPanelProps) {
  const { t } = useTranslation('sharing');
  const kindLabel = t(
    kind === 'collection' ? 'kindCollection' : kind === 'environment' ? 'kindEnvironment' : kind === 'note' ? 'kindNote' : 'kindWhiteboard',
  );
  const api =
    kind === 'collection' ? collectionSharingAPI
    : kind === 'environment' ? environmentSharingAPI
    : kind === 'note' ? noteSharingAPI
    : whiteboardSharingAPI;
  const [visibility, setVisibility] = useState<'private' | 'public'>(currentVisibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmMakePrivate, setConfirmMakePrivate] = useState(false);

  const [grants, setGrants] = useState<PublicGrant[]>([]);
  const [loadingGrants, setLoadingGrants] = useState(false);

  // "Add subject" form state
  const [addRole, setAddRole] = useState<'editor' | 'viewer'>('viewer');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AddOption[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const [adding, setAdding] = useState(false);

  // Sync local visibility when parent prop changes (e.g. after a refresh).
  useEffect(() => setVisibility(currentVisibility), [currentVisibility]);

  // Fetch grants whenever asset or visibility changes to public.
  const fetchGrants = useCallback(async () => {
    if (visibility !== 'public') {
      setGrants([]);
      return;
    }
    setLoadingGrants(true);
    try {
      const response = await api.listGrants(assetId);
      const data = (response.data as PublicGrant[]) ?? [];
      setGrants(data);
    } catch {
      setGrants([]);
    }
    setLoadingGrants(false);
  }, [api, assetId, visibility]);

  useEffect(() => {
    fetchGrants();
  }, [fetchGrants]);

  // Buckets used for rendering — editor & viewer rows kept stable in
  // insertion order so the UI doesn't reshuffle when a row is added/removed.
  const editors = useMemo(() => grants.filter((g) => g.role === 'editor'), [grants]);
  const viewers = useMemo(() => grants.filter((g) => g.role === 'viewer'), [grants]);

  const editorsHasEveryone = editors.some((g) => g.subjectKind === 'everyone');
  const viewersHasEveryone = viewers.some((g) => g.subjectKind === 'everyone');

  // Flip visibility on/off
  const togglePublic = async (next: boolean) => {
    setError('');
    if (!next) {
      // private → confirm
      setConfirmMakePrivate(true);
      return;
    }
    setBusy(true);
    try {
      await api.setVisibility(assetId, 'public');
      setVisibility('public');
      onVisibilityChange?.('public');
      await fetchGrants();
    } catch (err) {
      setError(extractErr(err, t('errors.makePublic')));
    }
    setBusy(false);
  };

  const performMakePrivate = async () => {
    setConfirmMakePrivate(false);
    setBusy(true);
    setError('');
    try {
      await api.setVisibility(assetId, 'private');
      setVisibility('private');
      onVisibilityChange?.('private');
      setGrants([]);
    } catch (err) {
      setError(extractErr(err, t('errors.makePrivate')));
    }
    setBusy(false);
  };

  // Combined typeahead: search users + match user's teams + offer everyone.
  // The search query filters team names locally; user search hits BE.
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setError('');
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        // Fetch user matches + load teams once, intersected client-side.
        const [usersRes, teamsRes] = await Promise.all([
          usersAPI.search(query),
          teamsAPI.list(),
        ]);
        const users = ((usersRes.data as { id: string; email: string; name: string }[]) ?? []);
        const teams = ((teamsRes.data as Team[]) ?? []);
        const lower = query.toLowerCase();
        const out: AddOption[] = [];
        // Everyone — always offered as a typeahead option when query
        // starts with "e" so the keyboard-driven user can find it.
        if ('everyone'.startsWith(lower)) {
          out.push({ kind: 'everyone', label: t('everyoneOption') });
        }
        for (const tm of teams) {
          if (tm.name.toLowerCase().includes(lower)) {
            out.push({ kind: 'team', id: tm.id, label: `${tm.name} · ${t('teamSuffix')}` });
          }
        }
        for (const u of users) {
          out.push({ kind: 'user', id: u.id, email: u.email, label: `${u.name || u.email} · ${u.email}` });
        }
        setSearchResults(out);
      } catch {
        setSearchResults([]);
      }
      setSearching(false);
    }, 250);
    // t intentionally omitted: this is a load-shaped callback (react-i18next's
    // t resolves language at call time, so a stable closure still translates).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddSubject = async (opt: AddOption) => {
    setAdding(true);
    setError('');
    try {
      await api.addGrant(assetId, {
        role: addRole,
        subjectKind: opt.kind,
        subjectId: opt.id,
      });
      setSearchQuery('');
      setSearchResults([]);
      await fetchGrants();
    } catch (err) {
      setError(extractErr(err, t('errors.add')));
    }
    setAdding(false);
  };

  const handleRemoveGrant = async (g: PublicGrant) => {
    setError('');
    try {
      await api.deleteGrant(assetId, g.id);
      setGrants((prev) => prev.filter((x) => x.id !== g.id));
    } catch (err) {
      setError(extractErr(err, t('errors.remove')));
    }
  };

  return (
    <div className="min-w-0 space-y-3">
      {/* Public toggle — owner-only. Editors who land here are already on
          a public collection (they wouldn't see the dialog otherwise) so
          hiding the toggle removes the only owner-only action from the
          panel. */}
      {canManageVisibility && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 p-3 border rounded-lg">
            <Globe2 className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">{t('public')}</div>
              <div className="text-xs text-muted-foreground">
                {visibility === 'public'
                  ? t('publicDescPublic', { kind: kindLabel })
                  : t('publicDescPrivate', { kind: kindLabel })}
              </div>
            </div>
            <Switch
              checked={visibility === 'public'}
              disabled={busy}
              onCheckedChange={togglePublic}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-2 rounded-md border border-destructive/40 bg-destructive/5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {visibility === 'public' && (
        <>
          {/* Editors list */}
          <GrantList
            title={t('editors')}
            subtitle={t('editorsSubtitle')}
            icon={<Crown className="h-3.5 w-3.5 text-amber-500" />}
            grants={editors}
            ownerId={ownerId}
            hasEveryone={editorsHasEveryone}
            onRemove={handleRemoveGrant}
            loading={loadingGrants}
          />

          {/* Viewers list */}
          <GrantList
            title={t('viewers')}
            subtitle={t('viewersSubtitle')}
            icon={<Eye className="h-3.5 w-3.5 text-muted-foreground" />}
            grants={viewers}
            ownerId={ownerId}
            hasEveryone={viewersHasEveryone}
            onRemove={handleRemoveGrant}
            loading={loadingGrants}
          />

          {/* Add subject row */}
          <div className="p-3 border rounded-lg space-y-2 bg-muted/20">
            <div className="text-xs font-medium text-muted-foreground">{t('addToList')}</div>
            {/* `relative` anchor + `absolute` dropdown so the typeahead
                results overlay the helper text instead of pushing the
                modal layout downward whenever a query lands. z-50 sits
                above radix Select but below toast/portal layers. */}
            <div className="relative">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder={t('searchPlaceholder')}
                    className="h-8 text-xs pl-7"
                  />
                  {searching && (
                    <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                </div>
                <Select value={addRole} onValueChange={(v) => setAddRole(v as 'editor' | 'viewer')}>
                  <SelectTrigger className="h-8 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">{t('roleEditor')}</SelectItem>
                    <SelectItem value="viewer">{t('roleViewer')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {searchResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 border rounded-md bg-popover shadow-lg max-h-[200px] overflow-auto">
                  {searchResults.map((opt, i) => (
                    <button
                      key={`${opt.kind}:${opt.id ?? 'everyone'}:${i}`}
                      className="w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                      onClick={() => handleAddSubject(opt)}
                      disabled={adding}
                    >
                      {opt.kind === 'everyone' && <Globe2 className="h-3.5 w-3.5 text-primary" />}
                      {opt.kind === 'team' && <Users2 className="h-3.5 w-3.5 text-muted-foreground" />}
                      {opt.kind === 'user' && <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                      <span className="text-xs">{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              <Trans t={t} i18nKey="everyoneHint" components={{ b: <span className="font-medium" /> }} />
            </p>
          </div>
        </>
      )}

      {/* Confirm "make private" — public→private wipes all grants.
          Owner-only just like the toggle itself. */}
      {canManageVisibility && confirmMakePrivate && (
        <div className="p-3 border border-destructive/40 bg-destructive/5 rounded-lg space-y-2">
          <div className="text-xs font-medium text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            {t('makePrivateConfirm', { name: assetName })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t('makePrivateBody')}
          </p>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setConfirmMakePrivate(false)}>
              {t('common:cancel')}
            </Button>
            <Button size="sm" variant="destructive" onClick={performMakePrivate}>
              {t('makePrivate')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface GrantListProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  grants: PublicGrant[];
  ownerId: string;
  hasEveryone: boolean;
  loading: boolean;
  onRemove: (g: PublicGrant) => void;
}

function GrantList({ title, subtitle, icon, grants, ownerId, hasEveryone, loading, onRemove }: GrantListProps) {
  const { t } = useTranslation('sharing');
  return (
    <div className="border rounded-lg">
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        {icon}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold">{title}</div>
          <div className="text-[10px] text-muted-foreground">{subtitle}</div>
        </div>
        <Badge variant="secondary" className="text-[10px]">{grants.length}</Badge>
      </div>
      <div className="p-2 space-y-1 min-h-[60px]">
        {loading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          </div>
        ) : grants.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic px-2 py-1">
            {hasEveryone ? '' : t('noOne')}
          </div>
        ) : (
          grants.map((g) => {
            // Owner can never be removed from the Editors list — UI guard
            // mirrors the BE 403.
            const isOwnerEditor =
              g.role === 'editor' && g.subjectKind === 'user' && g.subjectId === ownerId;
            return (
              <div
                key={g.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/40 text-xs"
              >
                {g.subjectKind === 'everyone' && <Globe2 className="h-3 w-3 text-primary" />}
                {g.subjectKind === 'team' && <Users2 className="h-3 w-3 text-muted-foreground" />}
                {g.subjectKind === 'user' && <Eye className="h-3 w-3 text-muted-foreground" />}
                <span className="flex-1 min-w-0 truncate font-mono">{g.label || g.subjectId}</span>
                {isOwnerEditor && (
                  <Badge variant="secondary" className="text-[9px] px-1 py-0">{t('ownerBadge')}</Badge>
                )}
                {!isOwnerEditor && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(g)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}

// `Trash2` + `Plus` not currently rendered above but kept imported in
// case future polish wants them; suppress unused-import warning.
void Trash2;
void Plus;
