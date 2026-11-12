import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Check, Trash2, Plus, RefreshCw, ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { useAuthStore } from '@/stores/authStore';
import {
  useRemoteStore,
  BUILTIN_REMOTE_ID,
  builtinRemoteUrl,
  builtinUrlNormalized,
  resolveBackendUrl,
  type Remote,
  type RemoteCompat,
} from '@/stores/remoteStore';

// Show a relative "/api" as an absolute URL against this app's origin so the
// value is meaningful/copyable; leave absolute URLs untouched.
function displayUrl(u: string): string {
  if (/^https?:\/\//i.test(u)) return u;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${u.startsWith('/') ? '' : '/'}${u}`;
  }
  return u;
}

// The compatMap key for a row. Resolved to absolute so a relative built-in
// "/api" (web / dev, served same-origin) is keyed + probed the same way the
// startup guard keys it — otherwise its badge stays "Not checked" and its
// Refresh button is hidden even though the backend is reachable.
function compatKey(r: Remote): string {
  return resolveBackendUrl(r.builtin ? builtinUrlNormalized() : r.url);
}

// Switching or deleting the ACTIVE backend invalidates the current session
// (the JWT belongs to the old backend), so we sign out and reload to re-init
// axios / SSE / caches against the new one. Only relevant to a synced login.
function needsReauth(): boolean {
  const { isAuthenticated, mode } = useAuthStore.getState();
  return isAuthenticated && mode === 'synced';
}

function signOutForSwitch(): void {
  useAuthStore.getState().logout();
  // logout() doesn't clear impersonation — don't leak it to the new backend.
  localStorage.removeItem('patchman_act_as_user');
  localStorage.removeItem('patchman_act_as_user_name');
}

// A small compatibility badge (compatible / incompatible / unchecked) for a row.
function CompatBadge({ compat }: { compat: RemoteCompat | undefined }) {
  const { t } = useTranslation('settings');
  if (compat === 'ok') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <ShieldCheck className="h-3.5 w-3.5" />
        {t('remote.compatOk')}
      </span>
    );
  }
  if (compat === 'incompatible') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
        <ShieldAlert className="h-3.5 w-3.5" />
        {t('remote.compatIncompatible')}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
      <ShieldQuestion className="h-3.5 w-3.5" />
      {t('remote.compatUnknown')}
    </span>
  );
}

export function RemoteSection() {
  const { t } = useTranslation('settings');
  // Subscribe to remotes, activeId AND compatMap so add/remove/switch/refresh re-render.
  const activeId = useRemoteStore((s) => s.activeId);
  const userRemotes = useRemoteStore((s) => s.remotes);
  const compatMap = useRemoteStore((s) => s.compatMap);
  const addRemote = useRemoteStore((s) => s.addRemote);
  const removeRemote = useRemoteStore((s) => s.removeRemote);
  const setActive = useRemoteStore((s) => s.setActive);
  const refreshRemote = useRemoteStore((s) => s.refreshRemote);

  const remotes: Remote[] = [
    { id: BUILTIN_REMOTE_ID, label: t('remote.builtin'), url: builtinRemoteUrl(), builtin: true },
    ...userRemotes,
  ];

  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [refreshingUrl, setRefreshingUrl] = useState<string | null>(null);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectErr, setSelectErr] = useState<string | null>(null);
  // A pending backend switch awaiting the sign-out confirmation.
  const [pending, setPending] = useState<{ id: string; url: string } | null>(null);

  async function handleAdd() {
    if (adding) return;
    setAdding(true);
    setErr(null);
    const res = await addRemote(label, url);
    setAdding(false);
    if (res === 'ok') {
      setLabel('');
      setUrl('');
      return;
    }
    const messages: Record<string, string> = {
      invalid: t('remote.invalidUrl'),
      duplicate: t('remote.duplicate'),
      unreachable: t('remote.unreachable'),
      not_patchman: t('remote.notPatchman'),
      incompatible: t('remote.incompatible'),
    };
    setErr(messages[res] ?? t('remote.invalidUrl'));
  }

  async function handleRefresh(r: Remote) {
    const key = compatKey(r);
    if (refreshingUrl) return;
    setRefreshNote(null);
    setRefreshingUrl(key);
    const outcome = await refreshRemote(key);
    setRefreshingUrl(null);
    // ok / incompatible update the badge reactively; surface the "nothing
    // changed" cases so a refresh press always has visible feedback.
    if (outcome.verdict === 'unreachable') setRefreshNote(t('remote.stillUnreachable', { name: r.label || displayUrl(r.url) }));
    else if (outcome.verdict === 'not_patchman') setRefreshNote(t('remote.notPatchman'));
  }

  function applySwitch(id: string) {
    if (needsReauth()) signOutForSwitch();
    setActive(id);
    window.location.reload();
  }

  // "Set as default": validate the target's version/compatibility FIRST, then
  // switch. A known-compatible backend that's momentarily unreachable is still
  // allowed (VPN drop); anything else (incompatible / not-PatchMan / can't
  // verify a never-checked one) is refused instead of switching into a broken
  // backend.
  async function handleSelect(id: string) {
    if (id === activeId || selectingId) return;
    const target = remotes.find((x) => x.id === id);
    if (!target) return;
    const key = compatKey(target);
    setSelectErr(null);
    setRefreshNote(null);
    setSelectingId(id);
    const outcome = await refreshRemote(key);
    setSelectingId(null);
    const stored = useRemoteStore.getState().compatMap[key];
    const okToSwitch = outcome.verdict === 'ok' || (outcome.verdict === 'unreachable' && stored?.compat === 'ok');
    if (!okToSwitch) {
      setSelectErr(
        outcome.verdict === 'incompatible'
          ? t('remote.incompatible')
          : outcome.verdict === 'not_patchman'
            ? t('remote.notPatchman')
            : t('remote.unreachable'),
      );
      return;
    }
    if (needsReauth()) {
      setPending({ id, url: displayUrl(target.url) });
      return;
    }
    applySwitch(id);
  }

  // The store refuses to delete the built-in or the active remote, so this
  // only ever removes an inactive user remote — no session/reload impact.
  function handleDelete(id: string) {
    removeRemote(id);
  }

  function confirmPending() {
    if (!pending) return;
    applySwitch(pending.id);
    setPending(null);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{t('remote.heading')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t('remote.description')}</p>
      </div>

      {/* Remote list */}
      <div className="max-w-xl space-y-2">
        {remotes.map((r) => {
          const active = r.id === activeId;
          const key = compatKey(r);
          const rec = compatMap[key];
          // A relative built-in URL can't be probed from tauri://localhost.
          const canRefresh = /^https?:\/\//i.test(key);
          const refreshing = refreshingUrl === key;
          return (
            <div
              key={r.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border',
              )}
            >
              <Cloud className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {r.label || (r.builtin ? t('remote.builtin') : displayUrl(r.url))}
                  </span>
                  {r.builtin && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t('remote.builtinBadge')}
                    </span>
                  )}
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">{displayUrl(r.url)}</div>
                <div className="mt-1"><CompatBadge compat={rec?.compat} /></div>
              </div>

              {canRefresh && (
                <button
                  type="button"
                  onClick={() => handleRefresh(r)}
                  disabled={refreshing}
                  title={t('remote.refresh')}
                  aria-label={t('remote.refresh')}
                  className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
                </button>
              )}

              {active ? (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                  <Check className="h-3 w-3" />
                  {t('remote.active')}
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 h-7 text-xs"
                  disabled={selectingId === r.id}
                  onClick={() => void handleSelect(r.id)}
                >
                  {selectingId === r.id && <RefreshCw className="mr-1 h-3 w-3 animate-spin" />}
                  {selectingId === r.id ? t('remote.checking') : t('remote.setDefault')}
                </Button>
              )}

              {!r.builtin && (
                <button
                  type="button"
                  onClick={() => handleDelete(r.id)}
                  disabled={active}
                  title={active ? t('remote.deleteActiveHint') : t('common:delete')}
                  aria-label={t('common:delete')}
                  className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}
        {refreshNote && <p className="text-xs text-amber-600 dark:text-amber-400">{refreshNote}</p>}
        {selectErr && <p className="text-xs text-destructive">{selectErr}</p>}
      </div>

      {/* Add a remote */}
      <div className="max-w-xl space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('remote.addTitle')}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={label}
            onChange={(e) => { setLabel(e.target.value); setErr(null); }}
            placeholder={t('remote.namePlaceholder')}
            className="sm:w-40"
          />
          <Input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
            placeholder={t('remote.urlPlaceholder')}
            className="flex-1 font-mono text-xs"
          />
          <Button size="sm" onClick={() => void handleAdd()} disabled={!url.trim() || adding} className="shrink-0">
            {adding ? <RefreshCw className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
            {adding ? t('remote.checking') : t('common:add')}
          </Button>
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>

      <p className="text-[11px] text-muted-foreground max-w-xl">{t('remote.note')}</p>

      <AlertDialog open={!!pending} onOpenChange={(o) => { if (!o) setPending(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('remote.switchTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('remote.switchBody', { url: pending?.url ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPending}>{t('remote.confirmSwitch')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
