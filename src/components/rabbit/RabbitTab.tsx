import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { reportCrash } from '@/lib/errorReporter';
import type { Tab } from '@/types';
import { ClusterView } from './ClusterView';
import { QueueView } from './QueueView';
import { ExchangeView } from './ExchangeView';

// Main-pane body of a `type: 'rabbit'` tab (lazy-loaded by TabBody): the
// cluster view (overview, queues, exchanges, connections, topology), a
// queue or an exchange. Own error boundary — one view failing must not take
// the app down.
export default function RabbitTab({ tab }: { tab: Tab }) {
  const view = tab.rabbitView ?? 'cluster';
  return (
    <RabbitBoundary key={`${tab.rabbitConnectionId}:${view}:${tab.rabbitVhost}:${tab.rabbitQueue}:${tab.rabbitExchange}`}>
      {view === 'queue' ? <QueueView tab={tab} /> : view === 'exchange' ? <ExchangeView tab={tab} /> : <ClusterView tab={tab} />}
    </RabbitBoundary>
  );
}

class RabbitBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportCrash({
      source: 'boundary',
      message: `[rabbit] ${error.message}`,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }
  render() {
    if (this.state.error) return <TabError message={this.state.error.message} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

function TabError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation('rabbit');
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-2">
        <AlertTriangle className="h-6 w-6 mx-auto text-amber-500" />
        <div className="text-sm font-medium">{t('renderError')}</div>
        <div className="text-xs text-muted-foreground break-words font-mono">{message}</div>
        <Button size="sm" variant="outline" onClick={onRetry}>{t('common:retry')}</Button>
      </div>
    </div>
  );
}
