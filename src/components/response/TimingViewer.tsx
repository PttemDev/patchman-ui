import { useTranslation } from 'react-i18next';
import type { ResponseData } from '@/types';

interface TimingViewerProps {
  response: ResponseData;
}

const timingSegments = [
  { key: 'dns' as const, color: 'bg-emerald-500', barColor: '#10b981' },
  { key: 'tcp' as const, color: 'bg-blue-500', barColor: '#3b82f6' },
  { key: 'tls' as const, color: 'bg-purple-500', barColor: '#a855f7' },
  { key: 'ttfb' as const, color: 'bg-amber-500', barColor: '#f59e0b' },
  { key: 'total' as const, color: 'bg-primary', barColor: 'hsl(var(--primary))' },
];

export function TimingViewer({ response }: TimingViewerProps) {
  const { t } = useTranslation('response');
  const { timing } = response;
  const maxTime = Math.max(timing.total, 1);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {timingSegments.map((segment) => {
          const value = timing[segment.key];
          const percentage = (value / maxTime) * 100;

          return (
            <div key={segment.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-sm ${segment.color}`} />
                  <span className="font-medium">{t(`response:timing.${segment.key}`)}</span>
                </div>
                <span className="text-muted-foreground font-mono">{value}ms</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${segment.color}`}
                  style={{ width: `${Math.max(percentage, 1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Chrome DevTools-inspired waterfall */}
      <div className="border rounded-md p-4 mt-4">
        <p className="text-xs font-medium mb-3">{t('response:timing.waterfall')}</p>

        {/* Scale bar */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1 px-1">
          <span>0ms</span>
          <span>{Math.round(maxTime / 4)}ms</span>
          <span>{Math.round(maxTime / 2)}ms</span>
          <span>{Math.round((maxTime * 3) / 4)}ms</span>
          <span>{maxTime}ms</span>
        </div>

        {/* Grid lines + waterfall */}
        <div className="relative h-8 bg-muted/50 rounded overflow-hidden border">
          {/* Vertical grid lines */}
          {[25, 50, 75].map((pct) => (
            <div
              key={pct}
              className="absolute top-0 h-full w-px bg-border/50"
              style={{ left: `${pct}%` }}
            />
          ))}

          {/* Waterfall segments */}
          {(() => {
            let offset = 0;
            return timingSegments
              .filter((s) => s.key !== 'total')
              .map((segment) => {
                const value = timing[segment.key];
                const width = (value / maxTime) * 100;
                const left = (offset / maxTime) * 100;
                offset += value;
                if (value === 0) return null;
                return (
                  <div
                    key={segment.key}
                    className={`absolute top-1 bottom-1 rounded-sm ${segment.color}`}
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 0.5)}%`,
                    }}
                    title={`${t(`response:timing.${segment.key}`)}: ${value}ms`}
                  />
                );
              });
          })()}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 flex-wrap">
          {timingSegments
            .filter((s) => s.key !== 'total')
            .map((segment) => (
              <div key={segment.key} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-sm ${segment.color}`} />
                <span className="text-[10px] text-muted-foreground">
                  {t(`response:timing.${segment.key}`)}: {timing[segment.key]}ms
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
