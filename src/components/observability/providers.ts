import type { ObservabilityAuthKind, ObservabilityProviderName } from '@/types';

// What the connection dialog needs to know per observability backend. The
// BE (internal/apm) is the source of truth for accepted auth kinds; this
// mirrors it for the form.
export interface ProviderMeta {
  name: ObservabilityProviderName;
  title: string;
  auth: ObservabilityAuthKind[];
  urlPlaceholder: string;
  /** What the connection scope means for this backend, if anything. */
  scope?: 'project' | 'env' | 'namespaces';
  scopeRequired?: boolean;
  /** Brand-neutral accent for the sidebar glyph. */
  accent: string;
}

export const PROVIDERS: ProviderMeta[] = [
  { name: 'coroot', title: 'Coroot', auth: ['bearer', 'login', 'session', 'apikey'], urlPlaceholder: 'https://coroot.example.com', scope: 'project', accent: 'text-emerald-500' },
  { name: 'prometheus', title: 'Prometheus', auth: ['none', 'basic', 'bearer', 'apikey'], urlPlaceholder: 'https://prometheus.example.com', accent: 'text-orange-500' },
  { name: 'jaeger', title: 'Jaeger', auth: ['none', 'basic', 'bearer'], urlPlaceholder: 'https://jaeger.example.com', accent: 'text-sky-500' },
  { name: 'kiali', title: 'Kiali', auth: ['none', 'bearer', 'basic'], urlPlaceholder: 'https://kiali.example.com/kiali', scope: 'namespaces', accent: 'text-indigo-500' },
  { name: 'signoz', title: 'SigNoz', auth: ['apikey', 'bearer', 'none'], urlPlaceholder: 'https://signoz.example.com', accent: 'text-rose-500' },
  { name: 'datadog', title: 'Datadog', auth: ['datadog', 'bearer'], urlPlaceholder: 'https://api.datadoghq.com', scope: 'env', scopeRequired: true, accent: 'text-violet-500' },
];

export function providerMeta(name?: string): ProviderMeta {
  return PROVIDERS.find((p) => p.name === name) ?? PROVIDERS[0];
}

/** Test notes from the BE ("family:istio", "services:12") in words. */
export function noteText(t: (k: string, o?: Record<string, unknown>) => string, note: string): string {
  const [key, ...rest] = note.split(':');
  const value = rest.join(':');
  return t(`notes.${key}`, { value, defaultValue: note });
}
