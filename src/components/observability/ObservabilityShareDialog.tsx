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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { observabilityConnectionAPI, teamsAPI, usersAPI } from '@/services/api';
import type { ObservabilityConnection, Team } from '@/types';

interface ObservabilityShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: ObservabilityConnection;
}

interface AddOption {
  kind: 'user' | 'team';
  id: string;
  label: string;
}

interface ObservabilityGrant {
  id: string;
  subjectKind: 'user' | 'team';
  subjectId: string;
  label?: string;
  role?: 'read' | 'write';
}

// Delegated share for an observability connection. Everything the service
// map does with it is read-only, so a grant is always 'read'; the stored
// credential never leaves the BE — only the right to read the map through it.
export function ObservabilityShareDialog({ open, onOpenChange, connection }: ObservabilityShareDialogProps) {
  const { t } = useTranslation('servicemap');
  const [grants, setGrants] = useState<ObservabilityGrant[]>([]);
  const [loading, setLoading] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AddOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await observabilityConnectionAPI.listGrants(connection.id, connection.beScope);
      setGrants((res.data as ObservabilityGrant[]) ?? []);
    } catch {
      setGrants([]);
    }
    setLoading(false);
  }, [connection.id, connection.beScope]);

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
            out.push({ kind: 'team', id: team.id, label: `${team.name} · ${t('share.teamSuffix')}` });
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
  }, []);

  const handleAdd = async (opt: AddOption) => {
    setAdding(true);
    setError('');
    try {
      await observabilityConnectionAPI.addGrant(
        connection.id,
        { subjectKind: opt.kind, subjectId: opt.id, role: 'read' },
        connection.beScope,
      );
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
      await observabilityConnectionAPI.deleteGrant(connection.id, grantId, connection.beScope);
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
            {t('share.description')}
          </DialogDescription>
          {(connection.authKind === 'basic' || connection.authKind === 'login' || connection.authKind === 'session') && (
            <p className="text-[11px] rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-1.5">
              {t('share.identityWarning')}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
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
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="border rounded-lg p-2 min-h-[80px]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              {t('share.granted')} <Badge variant="secondary" className="text-[9px]">{grants.length}</Badge>
            </div>
            {loading ? (
              <p className="text-xs text-muted-foreground italic">{t('common:loading')}</p>
            ) : grants.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">{t('share.empty')}</p>
            ) : (
              <ul className="space-y-0.5">
                {grants.map((g) => (
                  <li key={g.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent/40 text-xs">
                    {g.subjectKind === 'team'
                      ? <Users2 className="h-3 w-3 text-muted-foreground shrink-0" />
                      : <UserCircle2 className="h-3 w-3 text-muted-foreground shrink-0" />}
                    <span className="flex-1 truncate">{g.label || g.subjectId}</span>
                    <Badge variant="secondary" className="text-[9px]">{t('share.roleRead')}</Badge>
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

function extractErr(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const e = err as { response?: { data?: { error?: string } } };
    return e.response?.data?.error || fallback;
  }
  return fallback;
}
