import { create } from 'zustand';
import { llmProviderAPI, type LLMProvider, type DBScope } from '@/services/api';
import { availableDBScopes } from '@/stores/dbConnectionStore';

// LLM providers mirror the DB-connection dual-write model: the same FE-generated
// UUID is written to every backend the user chose to store it on, then the two
// list results are merged by id with `availableScopes` tracking where each copy
// actually lives. Unlike DB connections there are no grants — providers are
// personal (owner-only), so the merge has no `shared` case.
//
// Storage choice is the security boundary: a "this device only" provider is
// dual-written to ['local'] alone, so its encrypted key never reaches the remote
// backend. `scope`/`availableScopes` then pin every later call (chat, test,
// edit, delete) to where the row exists.

const ACTIVE_KEY = 'patchman_llm_active_provider';

interface LLMProviderState {
  providers: LLMProvider[];
  loading: boolean;
  activeProviderId: string | null;
  fetchProviders: () => Promise<void>;
  setActiveProvider: (id: string | null) => void;
  upsertLocal: (p: LLMProvider) => void;
  removeLocal: (id: string) => void;
}

function loadActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export const useLLMProviderStore = create<LLMProviderState>((set, get) => ({
  providers: [],
  loading: false,
  activeProviderId: loadActive(),

  fetchProviders: async () => {
    set({ loading: true });
    const scopes = availableDBScopes();
    const results = await Promise.allSettled(
      scopes.map((scope) =>
        llmProviderAPI.list(scope).then((res) => ({
          scope,
          rows: (res.data as { data?: LLMProvider[] }).data ?? (res.data as LLMProvider[]) ?? [],
        })),
      ),
    );

    // Merge by id, unioning availableScopes across backends.
    const byId = new Map<string, LLMProvider>();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const row of r.value.rows) {
        const existing = byId.get(row.id);
        if (existing) {
          const s = new Set<DBScope>([...(existing.availableScopes ?? []), r.value.scope]);
          existing.availableScopes = [...s];
          if (row.primaryScope && !existing.primaryScope) existing.primaryScope = row.primaryScope;
        } else {
          byId.set(row.id, { ...row, scope: r.value.scope, availableScopes: [r.value.scope] });
        }
      }
    }
    // Resolve the default acting scope from primaryScope, once availableScopes
    // is complete: honor the stored choice when that backend exists, else the
    // sole backend the row lives on (remote-preferred when both).
    const merged = [...byId.values()].map((p) => {
      const avail = p.availableScopes ?? [];
      if (p.primaryScope === 'local' && avail.includes('local')) return { ...p, scope: 'local' as const };
      if (p.primaryScope === 'remote' && avail.includes('remote')) return { ...p, scope: 'remote' as const };
      if (avail.includes('remote')) return { ...p, scope: 'remote' as const };
      return { ...p, scope: 'local' as const };
    });

    // Keep the active selection valid; default to the first provider.
    let active = get().activeProviderId;
    if (!active || !merged.some((p) => p.id === active)) {
      active = merged[0]?.id ?? null;
    }
    set({ providers: merged, loading: false, activeProviderId: active });
  },

  setActiveProvider: (id) => {
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* storage unavailable */
    }
    set({ activeProviderId: id });
  },

  upsertLocal: (p) =>
    set((s) => {
      const i = s.providers.findIndex((x) => x.id === p.id);
      if (i === -1) return { providers: [p, ...s.providers] };
      const next = [...s.providers];
      next[i] = { ...next[i], ...p };
      return { providers: next };
    }),

  removeLocal: (id) =>
    set((s) => ({
      providers: s.providers.filter((p) => p.id !== id),
      activeProviderId: s.activeProviderId === id ? (s.providers.find((p) => p.id !== id)?.id ?? null) : s.activeProviderId,
    })),
}));
