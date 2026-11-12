import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Search, Trash2, UserCircle2, Users2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { gitAPI, teamsAPI, usersAPI } from '@/services/api';
import { useGitConnectionStore } from '@/stores/gitConnectionStore';
import { extractErr } from './util';
import type { GitConnection, Team } from '@/types';

interface GitShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: GitConnection;
}

interface AddOption {
  kind: 'user' | 'team';
  id: string;
  label: string;
}

// Git grants have NO surrogate id — the composite {subjectKind, subjectId}
// IS the key (mirrors GitConnectionGrant). So rows are keyed by that pair and
// removal rides in the request body via the store's removeGrant (Wave-1
// deviation #4), not a grantId path segment.
interface GitGrant {
  subjectKind: 'user' | 'team';
  subjectId: string;
  label?: string;
  role?: 'read' | 'write';
}

export function GitShareDialog({ open, onOpenChange, connection }: GitShareDialogProps) {
  const { t } = useTranslation('git');
  const addGrant = useGitConnectionStore((s) => s.addGrant);
  const removeGrant = useGitConnectionStore((s) => s.removeGrant);

  const [grants, setGrants] = useState<GitGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AddOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [role, setRole] = useState<'read' | 'write'>('read');
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await gitAPI.grants(connection.id, connection.scope);
      setGrants((res.data as GitGrant[]) ?? []);
    } catch {
      setGrants([]);
    }
    setLoading(false);
  }, [connection.id, connection.scope]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    setError('');
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const [u, tm] = await Promise.all([usersAPI.search(q), teamsAPI.list()]);
        const users = (u.data as { id: string; email: string; name: string }[]) ?? [];
        const teams = (tm.data as Team[]) ?? [];
        const lower = q.toLowerCase();
        const out: AddOption[] = [];
        for (const team of teams) {
          if (team.name.toLowerCase().includes(lower)) {
            out.push({ kind: 'team', id: team.id, label: t('shareDialog.teamOption', { name: team.name }) });
          }
        }
        for (const x of users) {
          out.push({ kind: 'user', id: x.id, label: `${x.name || x.email} · ${x.email}` });
        }
        setResults(out);
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 250);
  }, [t]);

  const handleAdd = async (opt: AddOption) => {
    setAdding(true);
    setError('');
    try {
      await addGrant(
        connection.id,
        { subjectKind: opt.kind, subjectId: opt.id, role },
        connection.scope,
      );
      setQuery('');
      setResults([]);
      await reload();
    } catch (err) {
      setError(extractErr(err, t('errors.add')));
    }
    setAdding(false);
  };

  const handleRemove = async (g: GitGrant) => {
    // Optimistic removal keyed by the composite pair.
    setGrants((gs) => gs.filter((x) => !(x.subjectKind === g.subjectKind && x.subjectId === g.subjectId)));
    try {
      await removeGrant(
        connection.id,
        { subjectKind: g.subjectKind, subjectId: g.subjectId },
        connection.scope,
      );
    } catch {
      reload();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{t('shareDialog.title', { name: connection.name })}</DialogTitle>
          <DialogDescription>
            {t('shareDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder={t('shareDialog.searchPlaceholder')}
                className="h-8 text-xs pl-7"
              />
              {searching && (
                <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
              )}
              {results.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 border rounded-md bg-popover shadow-lg max-h-[200px] overflow-auto">
                  {results.map((r) => (
                    <button
                      key={`${r.kind}:${r.id}`}
                      onClick={() => handleAdd(r)}
                      disabled={adding}
                      className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-left hover:bg-accent disabled:opacity-50"
                    >
                      {r.kind === 'team'
                        ? <Users2 className="h-3.5 w-3.5 text-muted-foreground" />
                        : <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground" />}
                      <span>{r.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Select value={role} onValueChange={(v) => setRole(v as 'read' | 'write')}>
              <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="read">{t('role.read')}</SelectItem>
                <SelectItem value="write">{t('role.write')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="border rounded-lg p-2 min-h-[80px]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {t('shareDialog.granted')} <Badge variant="secondary" className="text-[9px]">{grants.length}</Badge>
            </div>
            {loading ? (
              <p className="text-xs text-muted-foreground italic">{t('common:loading')}</p>
            ) : grants.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">{t('shareDialog.empty')}</p>
            ) : (
              <ul className="space-y-0.5">
                {grants.map((g) => (
                  <li
                    key={`${g.subjectKind}:${g.subjectId}`}
                    className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent/40 text-xs"
                  >
                    {g.subjectKind === 'team'
                      ? <Users2 className="h-3 w-3 text-muted-foreground shrink-0" />
                      : <UserCircle2 className="h-3 w-3 text-muted-foreground shrink-0" />}
                    <span className="flex-1 truncate">{g.label || g.subjectId}</span>
                    <Badge variant="secondary" className="text-[9px]">{g.role === 'write' ? t('role.write') : t('role.read')}</Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(g)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
