import { Activity, Dog, Flame, Network, Radar, Waypoints } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ObservabilityProviderName } from '@/types';
import { providerMeta } from './providers';

// Generic glyph per observability backend (no vendor logos).
export function ProviderGlyph({ provider, className }: { provider: ObservabilityProviderName; className?: string }) {
  const cls = cn('shrink-0', providerMeta(provider).accent, className);
  switch (provider) {
    case 'coroot':
      return <Radar className={cls} />;
    case 'prometheus':
      return <Flame className={cls} />;
    case 'jaeger':
      return <Waypoints className={cls} />;
    case 'kiali':
      return <Network className={cls} />;
    case 'signoz':
      return <Activity className={cls} />;
    case 'datadog':
      return <Dog className={cls} />;
  }
  return <Activity className={cls} />;
}
