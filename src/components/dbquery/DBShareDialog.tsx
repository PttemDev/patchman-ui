import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Loader2, Search, Trash2, UserCircle2, Users2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { dbConnectionAPI, teamsAPI, usersAPI } from '@/services/api';
import type { DBConnection, DBConnectionGrant, Team } from '@/types';

interface DBShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: DBConnection;
}

interface AddOption {
  kind: 'user' | 'team';
  id: string;
  label: string;
}

// Delegated share for a DB connection. Owner (or co-owner) picks people /
// teams from a typeahead; the connection password never leaves the BE.
// Two grant roles: 'read' (run SELECT/find, no password, no management) and
// 'write' (full co-owner — edit/share/delete + write queries when the
// connection's read-write switch is on).
export function DBShareDialog({ open, onOpenChange, connection }: DBShareDialogProps) {
  const { t } = useTranslation('dbquery');
  const [grants, setGrants] = useState<DBConnectionGrant[]>([]);
  const [loading, setLoading] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AddOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  // Which role the next grant confers. Defaults to the safer read-only.
  const [role, setRole] = useState<'read' | 'write'>('read');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await dbConnectionAPI.listGrants(connection.id, connection.scope);
      setGrants((res.data as DBConnectionGrant[]) ?? []);
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
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const [u, tm] = await Promise.all([usersAPI.search(q), teamsAPI.list()]);
        const users = ((u.data as { id: string; email: string; name: string }[]) ?? []);
        const teams = ((tm.data as Team[]) ?? []);
        const lower = q.toLowerCase();
        const out: AddOption[] = [];
        for (const team of teams) {
          if (team.name.toLowerCase().includes(lower)) {
            out.push({ kind: 'team', id: team.id, label: t('share.teamOption', { name: team.name }) });
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
      await dbConnectionAPI.addGrant(connection.id, { subjectKind: opt.kind, subjectId: opt.id, role }, connection.scope);
      setQuery('');
      setResults([]);
      await reload();
    } catch (err) {
      setError(extractErr(err, t('share.addFailed')));
    }
    setAdding(false);
  };

  const handleRemove = async (grantId: string) => {
    try {
      await dbConnectionAPI.deleteGrant(connection.id, grantId, connection.scope);
      setGrants((gs) => gs.filter((g) => g.id !== grantId));
    } catch {
      /* ignore */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t('share.title', { name: connection.name })}
          </DialogTitle>
          <DialogDescription>
            <Trans t={t} i18nKey="share.description" components={{ strong: <strong /> }} />
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Role selector — governs the NEXT grant added. */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('share.grantAs')}
            </span>
            <div className="flex items-center gap-1">
              <RoleBtn active={role === 'read'} onClick={() => setRole('read')} label={t('share.roleReadonly')} />
              <RoleBtn active={role === 'write'} onClick={() => setRole('write')} label={t('share.roleCoowner')} />
            </div>
          </div>
          {role === 'write' && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              {t('share.coownerWarning')}
            </p>
          )}

          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={t('share.searchPlaceholder')}
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

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="border rounded-lg p-2 min-h-[80px]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {t('share.granted')} <Badge variant="secondary" className="text-[9px]">{grants.length}</Badge>
            </div>
            {loading ? (
              <p className="text-xs text-muted-foreground italic">{t('common:loading')}</p>
            ) : grants.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">{t('share.noOne')}</p>
            ) : (
              <ul className="space-y-0.5">
                {grants.map((g) => (
                  <li key={g.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent/40 text-xs">
                    {g.subjectKind === 'team'
                      ? <Users2 className="h-3 w-3 text-muted-foreground shrink-0" />
                      : <UserCircle2 className="h-3 w-3 text-muted-foreground shrink-0" />}
                    <span className="flex-1 truncate">{g.label || g.subjectId}</span>
                    <Badge
                      variant="secondary"
                      className={
                        g.role === 'write'
                          ? 'text-[9px] bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : 'text-[9px]'
                      }
                    >
                      {g.role === 'write' ? t('role.coowner') : t('role.read')}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(g.id)}
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

function RoleBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'px-2 py-0.5 rounded border text-[11px] transition-colors border-primary bg-primary/10 text-primary'
          : 'px-2 py-0.5 rounded border text-[11px] transition-colors border-border text-muted-foreground hover:bg-accent/50'
      }
    >
      {label}
    </button>
  );
}

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}
