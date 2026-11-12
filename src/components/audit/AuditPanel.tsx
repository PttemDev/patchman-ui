import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Shield,
  Activity,
  Clock,
  User,
  FileText,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { auditAPI } from '@/services/api';
import type { AuditLog } from '@/types';

interface ActivityItem {
  id: string;
  userId: string;
  action: string;
  resource: string;
  resourceId: string;
  details: string;
  createdAt: string;
}

const actionColors: Record<string, 'default' | 'success' | 'destructive' | 'warning' | 'info' | 'secondary'> = {
  create: 'success',
  created: 'success',
  update: 'info',
  updated: 'info',
  delete: 'destructive',
  deleted: 'destructive',
  execute: 'warning',
  executed: 'warning',
  login: 'secondary',
  logout: 'secondary',
};

function getActionVariant(action: string): 'default' | 'success' | 'destructive' | 'warning' | 'info' | 'secondary' {
  const lower = action.toLowerCase();
  for (const [key, variant] of Object.entries(actionColors)) {
    if (lower.includes(key)) return variant;
  }
  return 'secondary';
}

function formatTimestamp(dateStr: string, t: TFunction<'audit'>): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return t('time.justNow');
    if (diffMins < 60) return t('time.minutesAgo', { count: diffMins });
    if (diffHours < 24) return t('time.hoursAgo', { count: diffHours });
    if (diffDays < 7) return t('time.daysAgo', { count: diffDays });
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}

function AuditLogsTab() {
  const { t } = useTranslation('audit');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const response = await auditAPI.logs();
      const logs = response.data?.data ?? response.data;
      setLogs(Array.isArray(logs) ? logs : []);
    } catch {
      setLogs([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t(logs.length === 1 ? 'logs.countOne' : 'logs.countOther', { count: logs.length })}
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchLogs} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading && logs.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-8">
          <Shield className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-xs text-muted-foreground">{t('logs.empty')}</p>
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-300px)] min-h-[200px]">
          <div className="space-y-1 pr-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className="p-2 rounded-md border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant={getActionVariant(log.action)}
                    className="text-[10px] px-1.5 py-0 shrink-0"
                  >
                    {log.action}
                  </Badge>
                  <span className="text-xs font-medium truncate flex-1">
                    {log.resource}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatTimestamp(log.createdAt, t)}
                  </span>
                </div>
                {log.details && (
                  <p className="text-[10px] text-muted-foreground mt-1 truncate">
                    {log.details}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-1">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <User className="h-2.5 w-2.5" />
                    <span>{log.userId}</span>
                  </div>
                  {log.ipAddress && (
                    <span className="text-[10px] text-muted-foreground">
                      {log.ipAddress}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function ActivityFeedTab() {
  const { t } = useTranslation('audit');
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    try {
      const response = await auditAPI.activity();
      const items = response.data?.data ?? response.data;
      setActivities(Array.isArray(items) ? items : []);
    } catch {
      setActivities([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t(activities.length === 1 ? 'activity.countOne' : 'activity.countOther', { count: activities.length })}
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchActivity} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading && activities.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : activities.length === 0 ? (
        <div className="text-center py-8">
          <Activity className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-xs text-muted-foreground">{t('activity.empty')}</p>
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-300px)] min-h-[200px]">
          <div className="space-y-1 pr-2">
            {activities.map((item) => (
              <div
                key={item.id}
                className="p-2 rounded-md hover:bg-accent/50 transition-colors flex items-start gap-2"
              >
                <div className="mt-0.5 p-1 rounded-full bg-muted shrink-0">
                  <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant={getActionVariant(item.action)}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {item.action}
                    </Badge>
                    <span className="text-xs truncate">
                      {item.resource}
                    </span>
                  </div>
                  {item.details && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {item.details}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">
                      {formatTimestamp(item.createdAt, t)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

export function AuditPanel() {
  const { t } = useTranslation('audit');
  return (
    <div className="p-2">
      <Tabs defaultValue="audit">
        <TabsList className="w-full h-auto flex-wrap gap-0.5 p-1">
          <TabsTrigger value="audit" className="text-sm h-6 px-2 flex-1 min-w-0">
            <Shield className="h-3 w-3 mr-1 shrink-0" />
            {t('tabs.auditLogs')}
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-sm h-6 px-2 flex-1 min-w-0">
            <Activity className="h-3 w-3 mr-1 shrink-0" />
            {t('tabs.activity')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="audit">
          <AuditLogsTab />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityFeedTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
