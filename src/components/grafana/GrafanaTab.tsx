import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { reportCrash } from '@/lib/errorReporter';
import type { Tab } from '@/types';
import { DashboardView } from './DashboardView';
import { ExploreView } from './ExploreView';

// Main-pane body of a `type: 'grafana'` tab (lazy-loaded by TabBody). Wrapped
// in its own error boundary: Grafana dashboards are arbitrary JSON from
// arbitrary versions, and one PatchMan can't draw must not take down the app.
export default function GrafanaTab({ tab }: { tab: Tab }) {
  return (
    <GrafanaBoundary key={`${tab.grafanaConnectionId}:${tab.grafanaDashboardUid}:${tab.grafanaPublicToken}:${tab.grafanaView}`}>
      {tab.grafanaView === 'explore' ? <ExploreView tab={tab} /> : <DashboardView tab={tab} />}
    </GrafanaBoundary>
  );
}

class GrafanaBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Forward to the team silently — the inline fallback replaces the
    // app-wide crash modal for this tab.
    reportCrash({
      source: 'boundary',
      message: `[grafana] ${error.message}`,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }
  render() {
    if (this.state.error) {
      return <TabError message={this.state.error.message} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

function TabError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation('grafana');
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-2">
        <AlertTriangle className="h-6 w-6 mx-auto text-amber-500" />
        <div className="text-sm font-medium">{t('dashboard.renderError')}</div>
        <div className="text-xs text-muted-foreground break-words font-mono">{message}</div>
        <Button size="sm" variant="outline" onClick={onRetry}>{t('common:retry')}</Button>
      </div>
    </div>
  );
}
