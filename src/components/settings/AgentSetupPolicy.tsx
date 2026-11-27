import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldQuestion } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { qaAPI } from '@/services/api';

// Settings → MCP: must an AI agent get your OK before it changes CR + QA
// setup (links, thresholds, schedules, channels, Jira connections)? Only you
// can change this; an agent can't.
export function AgentSetupPolicy() {
  const { t } = useTranslation('settings');
  const { toast } = useToast();
  const [ask, setAsk] = useState<boolean | null>(null);
  useEffect(() => { qaAPI.agentSetupPolicy().then((r) => setAsk(r.data.ask)).catch(() => setAsk(null)); }, []);
  if (ask === null) return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border p-3">
      <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{t('mcp.qaSetupAsk.title')}</div>
        <p className="text-xs text-muted-foreground">{ask ? t('mcp.qaSetupAsk.on') : t('mcp.qaSetupAsk.off')}</p>
      </div>
      <Switch checked={ask} aria-label={t('mcp.qaSetupAsk.title')} onCheckedChange={async (v) => {
        try { setAsk((await qaAPI.setAgentSetupPolicy(v)).data.ask); } catch { toast({ title: t('mcp.qaSetupAsk.failed'), variant: 'destructive' }); }
      }} />
    </div>
  );
}
