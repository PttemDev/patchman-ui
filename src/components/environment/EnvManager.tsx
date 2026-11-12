// Environment Manager (refreshed v1.7.5).
//
// Layout:
//   ┌─────────────────────────────────────────────────────────────┐
//   │ header: title + search + saving-indicator + + New ▾         │
//   ├─────────┬───────────────────────────────────────────────────┤
//   │ sidebar │  inline-edit name · scope chip · Activate · ⋯     │
//   │ list w/ │  bulk paste · variable rows (key, value, secret)  │
//   │ badges  │  + add variable                                    │
//   └─────────┴───────────────────────────────────────────────────┘
//
// Sidebar rows show, per env:
//   - Active dot (●) when this user has activated it for the current
//     workspace
//   - Owner / Shared / Editor / Viewer badge so it's obvious where
//     each row came from
//   - Workspace scope: 🌐 global, 🟦 scoped (tooltip names workspace)
//
// Read-only mode kicks in when role==='viewer'. Inputs disabled, no
// add/remove, secret values come back masked from the BE; the eye
// icon still works but hits the reveal endpoint and surfaces the
// real value transiently.
//
// Debounced autosave kept from the previous implementation. New: a
// "Saved/Saving…/Save failed" pill in the header so the user can see
// the network status at a glance.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Globe,
  Building2,
  Copy,
  Check,
  CheckCircle2,
  Search,
  Share2,
  Download,
  Upload,
  ChevronDown,
  Wand2,
  Loader2,
  AlertCircle,
  Lock,
  KeyRound,
  RefreshCw,
  Maximize2,
} from 'lucide-react';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { useWorkspaceStore, resolveWorkspaceFilter } from '@/stores/workspaceStore';
import { environmentsAPI } from '@/services/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useAutoGrow } from '@/hooks/useAutoGrow';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { ImportEnvironmentDialog } from './ImportEnvironmentDialog';
import { ShareEnvironmentDialog } from './ShareEnvironmentDialog';
import { ExportEnvironmentDialog } from './ExportEnvironmentDialog';
import type { Environment } from '@/types';

interface EnvManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function EnvManager({ open, onOpenChange }: EnvManagerProps) {
  const { t } = useTranslation('environment');
  const {
    environments,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    activateEnvironment,
    fetchEnvironments,
  } = useEnvironmentStore();
  const [refreshing, setRefreshing] = useState(false);
  const activeWorkspaceId = useWorkspaceStore((s) => resolveWorkspaceFilter(s.activeWorkspaceId));
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [bulkPasteOpen, setBulkPasteOpen] = useState(false);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // Confirm dialog state — single shared instance for delete / leave
  // so we don't have window.confirm()'s native iOS-style popup that
  // ignores the app theme. action runs on OK; cancel just closes.
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    actionLabel: string;
    destructive?: boolean;
    action: () => void | Promise<void>;
  } | null>(null);

  // Local draft state so typing doesn't trigger an API call per keystroke.
  const [draftName, setDraftName] = useState('');
  const [draftVars, setDraftVars] = useState<Environment['variables']>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const prevEnvIdRef = useRef<string | null>(null);
  // Set true right before a delete so the env-switch flush effect
  // skips the doomed env. Without this, setSelectedEnvId(null) before
  // the DELETE fired a concurrent PUT (the autosave flush), and that
  // PUT's own fetchEnvironments could land AFTER the DELETE's fetch,
  // re-introducing the deleted row into the list.
  const skipFlushIdRef = useRef<string | null>(null);
  // Signature of the selected env as it last lived in the store when we
  // synced it into the draft. Lets us detect external updates (e.g. a test
  // script's pm.environment.set) and re-sync the draft instead of showing —
  // or flushing back — a stale copy.
  const lastSyncedSigRef = useRef<string>('');

  const selectedEnv = environments.find((e) => e.id === selectedEnvId);
  const role: 'owner' | 'editor' | 'viewer' = selectedEnv?.role ?? 'owner';
  const canEdit = role === 'owner' || role === 'editor';
  const canRename = role === 'owner';

  // Signature of the selected env's current store copy — changes when the
  // env is edited elsewhere (notably a test script's pm.environment.set,
  // which writes through the environment store).
  const selectedSig = useMemo(
    () => (selectedEnv ? JSON.stringify({ n: selectedEnv.name, v: selectedEnv.variables }) : ''),
    [selectedEnv],
  );

  // Sync the local draft from the store. Runs on env switch (flushing pending
  // edits on the previous env first) AND when the selected env changes in the
  // store while we have no unsaved local edits — so a script that sets an
  // env var shows up live in an open manager, and the close/switch flush no
  // longer writes a stale draft back over it (previously this only ran on
  // selectedEnvId change, so pm.environment.set looked like a no-op / got
  // clobbered when the manager was open).
  useEffect(() => {
    const idChanged = prevEnvIdRef.current !== selectedEnvId;
    if (prevEnvIdRef.current && idChanged) {
      clearTimeout(debounceRef.current);
      const prev = environments.find((e) => e.id === prevEnvIdRef.current);
      // Skip the flush PUT if this switch is part of a delete flow —
      // racing the in-flight DELETE made the row briefly reappear in
      // the list when fetchEnvironments responses landed out of order.
      const skipFlush = skipFlushIdRef.current === prevEnvIdRef.current;
      if (skipFlush) {
        skipFlushIdRef.current = null;
      } else if (prev) {
        // Only flush if we previously had write access — viewer rows
        // shouldn't trigger writes on tab-out.
        if (prev.role !== 'viewer') {
          updateEnvironment(prevEnvIdRef.current, { name: draftName, variables: draftVars });
        }
      }
    }
    prevEnvIdRef.current = selectedEnvId;
    if (!selectedEnv) return;
    // Adopt store values when we switched envs, or when the store copy
    // changed underneath us and there are no pending local edits
    // (saveState 'idle' = debounce not in flight). Guarding on idle avoids
    // clobbering the user's in-progress typing.
    const storeChanged = lastSyncedSigRef.current !== selectedSig;
    if (idChanged || (storeChanged && saveState === 'idle')) {
      setDraftName(selectedEnv.name);
      setDraftVars(selectedEnv.variables.map((v) => ({ ...v })));
      setRevealedSecrets({});
      lastSyncedSigRef.current = selectedSig;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEnvId, selectedSig, saveState]);

  const flushUpdate = useCallback(
    (name: string, vars: Environment['variables']) => {
      if (!selectedEnvId || !canEdit) return;
      clearTimeout(debounceRef.current);
      setSaveState('saving');
      debounceRef.current = setTimeout(async () => {
        try {
          await updateEnvironment(selectedEnvId, { name, variables: vars });
          setSaveState('saved');
          // Auto-fade the "Saved" pill back to idle so it doesn't stick.
          setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 1200);
        } catch {
          setSaveState('error');
        }
      }, 500);
    },
    [selectedEnvId, canEdit, updateEnvironment],
  );

  const handleOpenChange = (v: boolean) => {
    if (!v && selectedEnvId && canEdit) {
      clearTimeout(debounceRef.current);
      updateEnvironment(selectedEnvId, { name: draftName, variables: draftVars });
    }
    onOpenChange(v);
  };

  const handleNameChange = (value: string) => {
    setDraftName(value);
    flushUpdate(value, draftVars);
  };

  const handleUpdateVariable = (index: number, field: string, value: string | boolean) => {
    if (!canEdit) return;
    const newVars = draftVars.map((v, i) => (i === index ? { ...v, [field]: value } : v));
    setDraftVars(newVars);
    flushUpdate(draftName, newVars);
  };

  const handleAddVariable = () => {
    if (!canEdit) return;
    const newVars = [...draftVars, { key: '', value: '', enabled: true, secret: false }];
    setDraftVars(newVars);
    flushUpdate(draftName, newVars);
  };

  const handleRemoveVariable = (index: number) => {
    if (!canEdit) return;
    const newVars = draftVars.filter((_, i) => i !== index);
    setDraftVars(newVars);
    flushUpdate(draftName, newVars);
  };

  const handleCreateEnv = async (kind: 'blank' | 'duplicate') => {
    const name =
      kind === 'duplicate' && selectedEnv ? t('manager.copyName', { name: selectedEnv.name }) : t('manager.newEnvironmentName');
    await createEnvironment({
      name,
      isActive: false,
      workspaceId: activeWorkspaceId || undefined,
      variables:
        kind === 'duplicate' && selectedEnv
          ? selectedEnv.variables.map((v) => ({ ...v }))
          : [{ key: '', value: '', enabled: true, secret: false }],
    });
  };

  const handleScopeChange = (scoped: boolean) => {
    if (!selectedEnv || !canRename) return;
    updateEnvironment(selectedEnv.id, { workspaceId: scoped ? activeWorkspaceId || '' : '' });
  };

  const handleMoveToWorkspace = async (workspaceId: string) => {
    if (!selectedEnv || !canRename) return;
    const wsName = workspaces.find((w) => w.id === workspaceId)?.name || t('manager.workspaceFallback');
    const tt = toast({ title: t('manager.movingTo', { name: wsName }) });
    try {
      await updateEnvironment(selectedEnv.id, { workspaceId });
      tt.update({ id: tt.id, title: t('manager.moved'), description: t('manager.movedDesc', { name: selectedEnv.name, target: wsName }) });
    } catch {
      tt.update({ id: tt.id, title: t('manager.moveFailed'), variant: 'destructive' });
    }
  };

  const handleDelete = () => {
    if (!selectedEnv || !canRename) return;
    const target = selectedEnv;
    setConfirmState({
      title: t('manager.deleteConfirmTitle', { name: target.name }),
      description: t('manager.deleteConfirmDescription'),
      actionLabel: t('manager.deleteEnvironment'),
      destructive: true,
      action: async () => {
        // Cancel any pending autosave on the doomed env so a debounced
        // PUT doesn't race the DELETE (the PUT used to land first
        // sometimes, which made the row briefly reappear in the list
        // before the DELETE settled — looked like "delete didn't work
        // until I clicked elsewhere").
        clearTimeout(debounceRef.current);
        // Tell the env-switch flush effect to skip THIS env when the
        // selection swaps to null below. Without it, the flush fired
        // a concurrent PUT and its fetchEnvironments could land after
        // the DELETE's fetch, re-introducing the row.
        skipFlushIdRef.current = target.id;
        // Clear selection up-front so the editor pane swaps to the
        // empty state immediately. Without this the UI showed stale
        // draft fields for the in-flight delete window.
        setSelectedEnvId(null);
        // Show a single in-place toast that flips on the network
        // result, so the user gets confirmation when the BE actually
        // settles — important because the previous version returned
        // synchronously and looked like nothing happened.
        const tt = toast({ title: t('manager.deletingToast', { name: target.name }) });
        try {
          await deleteEnvironment(target.id);
          tt.update({ id: tt.id, title: t('manager.deleted') });
        } catch (err) {
          const ax = err as { response?: { data?: { error?: string } }; message?: string };
          tt.update({
            id: tt.id,
            title: t('manager.couldNotDelete'),
            description: ax.response?.data?.error || ax.message || t('tryAgain'),
            variant: 'destructive',
          });
        }
      },
    });
  };

  const handleActivate = async () => {
    if (!selectedEnv) return;
    await activateEnvironment(selectedEnv.id);
    toast({ title: t('manager.activated'), description: t('manager.activatedDesc', { name: selectedEnv.name }) });
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    // Flush any in-flight autosave first so we don't fetch a stale
    // list and immediately overwrite the user's pending edits.
    if (selectedEnvId && canEdit) {
      clearTimeout(debounceRef.current);
      try {
        await updateEnvironment(selectedEnvId, { name: draftName, variables: draftVars });
      } catch {
        // Non-fatal — proceed with the refresh anyway.
      }
    }
    setRefreshing(true);
    try {
      await fetchEnvironments();
    } finally {
      // Tiny min-duration so the spinner doesn't blink invisibly on
      // a sub-100ms response — gives the user a clear "I refreshed".
      setTimeout(() => setRefreshing(false), 250);
    }
  };

  const handleRevealSecret = async (key: string) => {
    if (!selectedEnv) return;
    if (revealedSecrets[key] !== undefined) {
      // Toggle off — just drop from the local map.
      const next = { ...revealedSecrets };
      delete next[key];
      setRevealedSecrets(next);
      return;
    }
    if (canEdit) {
      // Owner / editor sees raw value already in draftVars; reveal
      // is just a UI toggle.
      const v = draftVars.find((v) => v.key === key);
      if (v) setRevealedSecrets((prev) => ({ ...prev, [key]: v.value }));
      return;
    }
    // Viewer: hit the reveal endpoint, BE logs an audit entry.
    try {
      const res = await environmentsAPI.revealSecret(selectedEnv.id, key);
      setRevealedSecrets((prev) => ({ ...prev, [key]: res.data.value }));
    } catch {
      toast({ title: t('manager.couldNotReveal'), variant: 'destructive' });
    }
  };

  const handleBulkPaste = () => {
    if (!canEdit) return;
    const lines = bulkPasteText.split(/\r?\n/);
    const additions: Environment['variables'] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      // Strip matching outer quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      additions.push({ key, value, enabled: true, secret: /secret|key|token|pass/i.test(key) });
    }
    if (additions.length === 0) {
      toast({ title: t('manager.noKeyValueLines'), variant: 'destructive' });
      return;
    }
    const newVars = [...draftVars, ...additions];
    setDraftVars(newVars);
    flushUpdate(draftName, newVars);
    setBulkPasteText('');
    setBulkPasteOpen(false);
    toast({ title: t('manager.variablesAdded'), description: t('manager.variablesAddedDesc', { count: additions.length }) });
  };

  const filteredEnvs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return environments;
    return environments.filter((e) => e.name.toLowerCase().includes(q));
  }, [environments, search]);

  const currentWorkspaceName = workspaces.find((w) => w.id === activeWorkspaceId)?.name;
  const secretCount = useMemo(() => draftVars.filter((v) => v.secret).length, [draftVars]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl w-full h-[82vh] max-h-[92vh] min-h-[640px] overflow-hidden flex flex-col">
        <DialogHeader className="space-y-2">
          {/* pr-8 keeps the action cluster clear of Radix's absolute
              close button (top-right of DialogContent). Without it the
              "New ▾" trigger sat directly under the X and the two
              hitboxes collided. */}
          <div className="flex items-center justify-between gap-3 pr-8">
            <div className="space-y-0.5 min-w-0">
              <DialogTitle>{t('manager.title')}</DialogTitle>
              <DialogDescription>
                {t(environments.length === 1 ? 'envCountOne' : 'envCountOther', { count: environments.length })}
                {currentWorkspaceName ? ` · ${currentWorkspaceName}` : ''}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <SaveStatePill state={saveState} disabled={!canEdit} />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={handleRefresh}
                disabled={refreshing}
                title={t('common:refresh')}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    {t('manager.new')}
                    <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => handleCreateEnv('blank')}>
                    <Plus className="h-3.5 w-3.5 mr-2" />
                    {t('manager.blankEnvironment')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleCreateEnv('duplicate')}
                    disabled={!selectedEnv}
                  >
                    <Copy className="h-3.5 w-3.5 mr-2" />
                    {t('manager.duplicateSelected')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setImportOpen(true)}>
                    <Upload className="h-3.5 w-3.5 mr-2" />
                    {t('manager.importEllipsis')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setExportOpen(true)} disabled={environments.length === 0}>
                    <Download className="h-3.5 w-3.5 mr-2" />
                    {t('manager.exportEllipsis')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </DialogHeader>

        <div className="flex gap-4 flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-56 shrink-0 border-r pr-3 flex flex-col gap-2 overflow-hidden">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('manager.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-0.5">
              {filteredEnvs.length === 0 ? (
                <EmptyEnvList total={environments.length} onNew={() => handleCreateEnv('blank')} onImport={() => setImportOpen(true)} />
              ) : (
                filteredEnvs.map((env) => (
                  <SidebarRow
                    key={env.id}
                    env={env}
                    selected={selectedEnvId === env.id}
                    workspaceName={workspaces.find((w) => w.id === env.workspaceId)?.name}
                    onSelect={() => setSelectedEnvId(env.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selectedEnv ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Input
                    value={draftName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    className="h-8 text-sm font-medium flex-1 min-w-0"
                    disabled={!canRename}
                    placeholder={t('manager.namePlaceholder')}
                  />
                  <Button
                    size="sm"
                    variant={selectedEnv.isActive ? 'outline' : 'default'}
                    onClick={handleActivate}
                    disabled={selectedEnv.isActive}
                    className={`shrink-0 ${
                      selectedEnv.isActive
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15 disabled:opacity-100'
                        : ''
                    }`}
                  >
                    {selectedEnv.isActive ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        {t('manager.active')}
                      </>
                    ) : (
                      t('manager.activate')
                    )}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuLabel className="text-xs">{selectedEnv.name}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {role === 'owner' && (
                        <DropdownMenuItem onClick={() => setShareOpen(true)}>
                          <Share2 className="h-3.5 w-3.5 mr-2" />
                          {t('manager.shareEllipsis')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setExportOpen(true)}>
                        <Download className="h-3.5 w-3.5 mr-2" />
                        {t('manager.exportEllipsis')}
                      </DropdownMenuItem>
                      {canEdit && (
                        <DropdownMenuItem onClick={() => setBulkPasteOpen((b) => !b)}>
                          <Wand2 className="h-3.5 w-3.5 mr-2" />
                          {t('manager.pasteKeyValue')}
                        </DropdownMenuItem>
                      )}
                      {canRename && (
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <Building2 className="h-3.5 w-3.5 mr-2" />
                            {t('manager.moveToWorkspace')}
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-48">
                            {workspaces.map((ws) => (
                              <DropdownMenuItem
                                key={ws.id}
                                disabled={ws.id === selectedEnv.workspaceId}
                                onClick={() => handleMoveToWorkspace(ws.id)}
                              >
                                {ws.name}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleScopeChange(false)}
                              disabled={!selectedEnv.workspaceId}
                            >
                              <Globe className="h-3.5 w-3.5 mr-2" />
                              <span className="text-muted-foreground">{t('manager.makeGlobal')}</span>
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      )}
                      {/* Leave action removed in 1.16 — env sharing no
                          longer uses the legacy share-code path with a
                          per-user CollectionShare row to drop. Access
                          via public-grants is owner-managed; if a
                          non-owner wants out, they ask the owner to
                          remove their grant in the share dialog. */}
                      {canRename && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={handleDelete}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            {t('manager.deleteEnvironment')}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Scope chip */}
                <ScopeChip
                  scoped={!!selectedEnv.workspaceId}
                  workspaceName={
                    workspaces.find((w) => w.id === selectedEnv.workspaceId)?.name ?? t('manager.thisWorkspace')
                  }
                  currentWorkspaceName={currentWorkspaceName}
                  canEdit={canRename}
                  onToggle={handleScopeChange}
                />

                {/* Read-only banner for viewers */}
                {role === 'viewer' && (
                  <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-md border border-blue-500/40 bg-blue-500/10 text-xs">
                    <Lock className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    <span className="flex-1">
                      {t('manager.readOnlySharedBy', { owner: selectedEnv.ownerName || t('manager.someone') })}{' '}
                      {secretCount > 0 && (
                        <Trans
                          t={t}
                          i18nKey="manager.secretsMasked"
                          components={{ eye: <Eye className="inline h-3 w-3" /> }}
                        />
                      )}
                    </span>
                  </div>
                )}

                {/* Bulk paste textarea */}
                {bulkPasteOpen && canEdit && (
                  <div className="mb-2 space-y-1.5 rounded-md border bg-muted/20 p-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium">{t('manager.pasteKeyValue')}</label>
                      <Button size="sm" variant="ghost" onClick={() => setBulkPasteOpen(false)} className="h-6">
                        {t('common:cancel')}
                      </Button>
                    </div>
                    <Textarea
                      placeholder={t('manager.bulkPastePlaceholder')}
                      value={bulkPasteText}
                      onChange={(e) => setBulkPasteText(e.target.value)}
                      rows={4}
                      className="font-mono text-xs"
                    />
                    <div className="flex justify-end">
                      <Button size="sm" onClick={handleBulkPaste} disabled={!bulkPasteText.trim()}>
                        {t('manager.addToEnvironment')}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Variables list */}
                <div className="grid grid-cols-[auto_1fr_1.4fr_auto_auto] gap-2 mb-1 text-xs font-medium text-muted-foreground px-1">
                  <span>{t('manager.colOn')}</span>
                  <span>{t('manager.colKey')}</span>
                  <span>{t('manager.colValue')}</span>
                  <span>{t('manager.colSecret')}</span>
                  <span></span>
                </div>
                <ScrollArea className="flex-1 -mr-2 pr-2">
                  <div className="space-y-1.5">
                    {draftVars.map((variable, index) => {
                      const revealed = revealedSecrets[variable.key];
                      const showAsText = !variable.secret || revealed !== undefined;
                      const displayValue = revealed !== undefined ? revealed : variable.value;
                      return (
                        <div
                          key={index}
                          className="grid grid-cols-[auto_1fr_1.4fr_auto_auto] gap-2 items-center"
                        >
                          <Switch
                            checked={variable.enabled}
                            onCheckedChange={(v) => handleUpdateVariable(index, 'enabled', v)}
                            disabled={!canEdit}
                          />
                          <Input
                            placeholder={t('manager.keyPlaceholder')}
                            value={variable.key}
                            onChange={(e) => handleUpdateVariable(index, 'key', e.target.value)}
                            className="h-8 text-xs"
                            disabled={!canEdit}
                          />
                          <ValueCell
                            value={displayValue}
                            onChange={(v) => handleUpdateVariable(index, 'value', v)}
                            // A textarea can't mask — no expand while a secret is hidden.
                            expandable={showAsText && !!displayValue}
                            readOnly={!canEdit}
                          >
                            <Input
                              placeholder={t('manager.valuePlaceholder')}
                              type={showAsText ? 'text' : 'password'}
                              value={displayValue}
                              onChange={(e) => handleUpdateVariable(index, 'value', e.target.value)}
                              className={cn('h-8 text-xs font-mono', showAsText && displayValue ? 'pr-14' : 'pr-8')}
                              disabled={!canEdit && !revealed}
                            />
                            {(variable.secret || displayValue) && (
                              <button
                                type="button"
                                onClick={() => handleRevealSecret(variable.key)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                                title={revealed !== undefined ? t('manager.hide') : t('manager.reveal')}
                                disabled={!variable.secret && !canEdit}
                              >
                                {revealed !== undefined ? (
                                  <EyeOff className="h-3 w-3" />
                                ) : (
                                  <Eye className="h-3 w-3" />
                                )}
                              </button>
                            )}
                          </ValueCell>
                          <Switch
                            checked={variable.secret}
                            onCheckedChange={(v) => handleUpdateVariable(index, 'secret', v)}
                            disabled={!canEdit}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleRemoveVariable(index)}
                            disabled={!canEdit}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>

                {canEdit && (
                  <Button variant="outline" size="sm" className="mt-2 w-full" onClick={handleAddVariable}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    {t('manager.addVariable')}
                  </Button>
                )}
              </>
            ) : (
              <EmptyEditor onNew={() => handleCreateEnv('blank')} onImport={() => setImportOpen(true)} />
            )}
          </div>
        </div>
      </DialogContent>

      <ImportEnvironmentDialog open={importOpen} onOpenChange={setImportOpen} />
      {selectedEnv && (
        <ShareEnvironmentDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          environment={selectedEnv}
        />
      )}
      <ExportEnvironmentDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        environments={environments}
        initialIds={selectedEnv ? [selectedEnv.id] : []}
      />

      {/* Themed confirm — replaces window.confirm() so the prompt
          inherits the app's dark surface, fonts, and button styles
          instead of the browser's native iOS-style alert. Single
          instance reused for delete + leave. */}
      <AlertDialog open={!!confirmState} onOpenChange={(o) => !o && setConfirmState(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmState?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirmState?.destructive
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : ''
              }
              onClick={async () => {
                const action = confirmState?.action;
                setConfirmState(null);
                await action?.();
              }}
            >
              {confirmState?.actionLabel ?? t('common:ok')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

// --------------------------------------------------------------------
// Sub-components
// --------------------------------------------------------------------

// Value cell: the input (children) plus a ⤢ that opens a wrapping,
// auto-growing editor anchored on it — same idea as the URL bar's — for
// values longer than the column (base URLs, tokens). A value is one line:
// newlines are dropped and Enter closes the editor.
function ValueCell({
  value,
  onChange,
  expandable,
  readOnly,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  expandable: boolean;
  readOnly: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('environment');
  const [open, setOpen] = useState(false);
  const { ref, elRef } = useAutoGrow(value);
  const btnRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  return (
    <Popover open={open && expandable} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={wrapRef} className="relative group/value">
          {children}
          {expandable && (
            <button
              ref={btnRef}
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="absolute right-7 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover/value:opacity-100 focus-visible:opacity-100 transition-opacity cursor-pointer"
              title={t('manager.expandValue')}
              aria-label={t('manager.expandValue')}
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-auto p-2"
        style={{ width: 'max(var(--radix-popover-trigger-width), 24rem)', maxWidth: 'calc(100vw - 2rem)' }}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const el = elRef.current;
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        }}
        onCloseAutoFocus={(e) => { e.preventDefault(); wrapRef.current?.querySelector('input')?.focus(); }}
        // The toggle sits outside the content — let its own click close it.
        onInteractOutside={(e) => { if (btnRef.current?.contains(e.target as Node)) e.preventDefault(); }}
      >
        <textarea
          ref={ref}
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setOpen(false); } }}
          rows={1}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="block w-full resize-none overflow-y-auto bg-transparent px-1 py-1 font-mono text-xs leading-relaxed outline-none break-all whitespace-pre-wrap"
        />
        <p className="mt-1 px-1 text-[10px] text-muted-foreground">{t('manager.expandHint')}</p>
      </PopoverContent>
    </Popover>
  );
}

function SidebarRow({
  env,
  selected,
  workspaceName,
  onSelect,
}: {
  env: Environment;
  selected: boolean;
  workspaceName?: string;
  onSelect: () => void;
}) {
  const { t } = useTranslation('environment');
  const role = env.role ?? 'owner';
  const Badge = roleBadge(role, env.shared, env.sharedByMe);
  return (
    <button
      onClick={onSelect}
      className={`group w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer flex items-center gap-2 ${
        selected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
      }`}
    >
      {/* Active dot */}
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
          env.isActive
            ? selected
              ? 'bg-green-300'
              : 'bg-green-500'
            : 'bg-transparent'
        }`}
      />
      <span className="flex-1 truncate">{env.name}</span>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="shrink-0 inline-flex items-center">{Badge}</span>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {env.shared
              ? t('manager.sharedByRole', { owner: env.ownerName || t('manager.someone'), role: t(`role${role.charAt(0).toUpperCase()}${role.slice(1)}`) })
              : env.sharedByMe
                ? t('manager.sharedByYou')
                : t('manager.ownedByYou')}
            <br />
            {env.workspaceId ? t('manager.scopeNamed', { name: workspaceName || t('manager.workspaceFallback') }) : t('manager.scopeGlobal')}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </button>
  );
}

function roleBadge(role: 'owner' | 'editor' | 'viewer', shared?: boolean, sharedByMe?: boolean) {
  if (shared && role === 'viewer') return <Eye className="h-3 w-3 text-blue-400" />;
  if (shared && role === 'editor') return <KeyRound className="h-3 w-3 text-amber-400" />;
  if (sharedByMe) return <Share2 className="h-3 w-3 text-green-500" />;
  return null;
}

function ScopeChip({
  scoped,
  workspaceName,
  currentWorkspaceName,
  canEdit,
  onToggle,
}: {
  scoped: boolean;
  workspaceName: string;
  currentWorkspaceName?: string;
  canEdit: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { t } = useTranslation('environment');
  return (
    <div className="flex items-center gap-2 mb-2">
      <button
        type="button"
        onClick={() => canEdit && onToggle(!scoped)}
        disabled={!canEdit || (!scoped && !currentWorkspaceName)}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] transition-colors ${
          scoped
            ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-400'
            : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
        } ${canEdit ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
        title={
          canEdit
            ? scoped
              ? t('manager.clickMakeGlobal')
              : t('manager.clickScopeTo', { name: currentWorkspaceName ?? t('manager.thisWorkspace') })
            : t('manager.readOnly')
        }
      >
        {scoped ? <Building2 className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
        {scoped ? t('manager.workspaceScope', { name: workspaceName }) : t('manager.globalScope')}
      </button>
    </div>
  );
}

function SaveStatePill({ state, disabled }: { state: SaveState; disabled?: boolean }) {
  const { t } = useTranslation('environment');
  if (disabled) return null;
  if (state === 'idle') return null;
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('manager.saving')}
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <Check className="h-3 w-3" />
        {t('manager.saved')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
      <AlertCircle className="h-3 w-3" />
      {t('manager.saveFailed')}
    </span>
  );
}

function EmptyEnvList({
  total,
  onNew,
  onImport,
}: {
  total: number;
  onNew: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation('environment');
  if (total === 0) {
    return (
      <div className="text-xs text-muted-foreground px-2 py-6 space-y-2 text-center">
        <p>{t('manager.noEnvironments')}</p>
        <div className="flex flex-col gap-1">
          <Button size="sm" variant="outline" onClick={onNew}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t('manager.createOne')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onImport}>
            <Upload className="h-3.5 w-3.5 mr-1" />
            {t('manager.import')}
          </Button>
        </div>
      </div>
    );
  }
  return <p className="text-xs text-muted-foreground px-2 py-4 text-center">{t('manager.noMatches')}</p>;
}

function EmptyEditor({ onNew, onImport }: { onNew: () => void; onImport: () => void }) {
  const { t } = useTranslation('environment');
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center text-sm text-muted-foreground gap-3 p-8">
      <Globe className="h-10 w-10 text-muted-foreground/40" />
      <p>{t('manager.selectPrompt')}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onNew}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('manager.blankEnvironment')}
        </Button>
        <Button size="sm" variant="outline" onClick={onImport}>
          <Upload className="h-3.5 w-3.5 mr-1" />
          {t('manager.import')}
        </Button>
      </div>
    </div>
  );
}
