import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TransformEngine } from '@/lib/transformEngines';

// responsePrefsStore keeps the response viewer's selection sticky across
// request-tab switches and re-runs: which sub-tab is open (Body / Transform /
// …) and the Transform engine + per-engine query. So a user can set up a jq
// filter once, then flip between requests and re-send — the Transform tab
// stays selected and the filter stays applied to each new response. Persisted
// globally (not per request tab), matching "keep the rule on the tab always".
interface ResponsePrefsState {
  activeView: string;
  setActiveView: (v: string) => void;
  transformEngine: TransformEngine;
  setTransformEngine: (e: TransformEngine) => void;
  transformQueries: Record<TransformEngine, string>;
  setTransformQuery: (e: TransformEngine, q: string) => void;
}

export const useResponsePrefsStore = create<ResponsePrefsState>()(
  persist(
    (set) => ({
      activeView: 'body',
      setActiveView: (v) => set({ activeView: v }),
      transformEngine: 'jmespath',
      setTransformEngine: (e) => set({ transformEngine: e }),
      transformQueries: { jmespath: '@', jq: '.', jsonpath: '$' },
      setTransformQuery: (e, q) =>
        set((s) => ({ transformQueries: { ...s.transformQueries, [e]: q } })),
    }),
    { name: 'patchman-response-prefs' },
  ),
);
