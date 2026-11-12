// Centralised state for the GitLab account-linking flow. Two consumers
// (Settings → Integrations and Import dialog → GitLab tab) drive Connect/
// Disconnect from the same store so the OAuth callback always lands in the
// right place regardless of which button initiated it.

import { create } from 'zustand';
import { gitIntegrationAPI, type GitLabIntegrationStatus } from '@/services/api';
import { isDesktop } from '@/lib/platform';
import { gitlabHostname } from '@/lib/tenant';
import { toast } from '@/components/ui/use-toast';
import type { AxiosError } from 'axios';

type ConnectState = 'idle' | 'pending' | 'finalizing';

interface GitIntegrationState {
  status: GitLabIntegrationStatus | null;
  loading: boolean;
  error: string | null;
  connectState: ConnectState;
  expectedState: string | null;
  // Lifecycle
  refresh: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  // Internal — used by the OAuth result listener; do not call directly.
  finalize: (code: string, state: string) => Promise<void>;
  reset: () => void;
}

export const useGitIntegrationStore = create<GitIntegrationState>((set, get) => ({
  status: null,
  loading: false,
  error: null,
  connectState: 'idle',
  expectedState: null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const res = await gitIntegrationAPI.status();
      set({ status: res.data ?? null, loading: false });
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      const status = ax.response?.status;
      if (status === 404) {
        set({ status: null, loading: false });
      } else {
        set({
          loading: false,
          error: ax.response?.data?.error || ax.message || 'Failed to load integration status',
        });
      }
    }
  },

  connect: async () => {
    set({ connectState: 'pending', error: null });
    try {
      const surface = isDesktop() ? 'desktop' : 'web';
      const res = await gitIntegrationAPI.start(surface);
      set({ expectedState: res.data.state });
      if (isDesktop()) {
        // Tauri's webview opens window.open() URLs *inside* the app by
        // default. We need the SYSTEM browser so GitLab can redirect back
        // via the patchman:// deep-link scheme.
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(res.data.authUrl);
      } else {
        window.open(res.data.authUrl, '_blank', 'noopener,noreferrer');
      }
      toast({
        title: 'Continue in your browser',
        description: `Approve PatchMan on ${gitlabHostname()} — this view updates automatically.`,
      });
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      set({
        connectState: 'idle',
        error: ax.response?.data?.error || ax.message || 'Failed to start OAuth',
      });
    }
  },

  disconnect: async () => {
    try {
      await gitIntegrationAPI.disconnect();
      set({ status: null });
      toast({ title: 'GitLab disconnected' });
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      toast({
        title: 'Disconnect failed',
        description: ax.response?.data?.error || ax.message,
        variant: 'destructive',
      });
    }
  },

  finalize: async (code, state) => {
    const expected = get().expectedState;
    if (!expected || state !== expected) {
      toast({ title: 'GitLab linking aborted', description: 'state mismatch', variant: 'destructive' });
      set({ connectState: 'idle', expectedState: null });
      return;
    }
    set({ connectState: 'finalizing' });
    try {
      const res = await gitIntegrationAPI.callback(code, state);
      set({ status: res.data, connectState: 'idle', expectedState: null });
      toast({ title: 'GitLab connected', description: `Linked as @${res.data.gitlabUsername}` });
    } catch (err) {
      const ax = err as AxiosError<{ error?: string }>;
      set({ connectState: 'idle', expectedState: null });
      toast({
        title: 'GitLab linking failed',
        description: ax.response?.data?.error || ax.message,
        variant: 'destructive',
      });
    }
  },

  reset: () => set({ connectState: 'idle', expectedState: null, error: null }),
}));

// Wire the cross-tab callback listener once at module load so it stays
// connected even if no consumer is currently mounted (e.g. the user closed
// the Settings dialog while waiting for GitLab consent).
if (typeof window !== 'undefined') {
  const KEY = 'patchman_gitlab_oauth_result';
  window.addEventListener('storage', async (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      const payload = JSON.parse(e.newValue) as { code: string; state: string; error?: string };
      if (payload.error) {
        toast({ title: 'GitLab linking failed', description: payload.error, variant: 'destructive' });
        useGitIntegrationStore.setState({ connectState: 'idle', expectedState: null });
      } else if (payload.code && payload.state) {
        await useGitIntegrationStore.getState().finalize(payload.code, payload.state);
      }
    } finally {
      try {
        localStorage.removeItem(KEY);
      } catch {
        // ignore
      }
    }
  });
}
