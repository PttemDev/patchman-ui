import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import type { Tab } from '@/types';

interface RequestViewerProps {
  tab: Tab;
}

export function RequestViewer({ tab }: RequestViewerProps) {
  const { t } = useTranslation(['response', 'common']);
  const sent = tab.sentRequest;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!sent) {
    return (
      <div className="text-xs text-muted-foreground text-center py-8">
        {t('response:request.empty')}
      </div>
    );
  }

  const headerEntries = Object.entries(sent.headers);
  const paramEntries = Object.entries(sent.params);

  const copy = (key: string, value: string) => {
    navigator.clipboard?.writeText(value)
      .then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
      })
      .catch(() => {});
  };

  const ValueCell = ({ ck, value }: { ck: string; value: string }) => (
    <td className="px-3 py-1.5 align-top">
      <button
        type="button"
        onClick={() => copy(ck, value)}
        title={t('response:clickToCopyValue')}
        className="w-full text-left inline-flex items-start gap-1.5 font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <span className="break-all min-w-0">{value}</span>
        {copiedKey === ck ? (
          <Check className="h-3 w-3 shrink-0 mt-0.5 text-emerald-500" />
        ) : (
          <Copy className="h-3 w-3 shrink-0 mt-0.5 opacity-0 group-hover:opacity-40" />
        )}
      </button>
    </td>
  );

  return (
    <div className="space-y-4">
      {/* Method + URL */}
      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase">{t('response:request.heading')}</h4>
        <div className="border rounded-md p-3">
          <span className="text-xs font-bold text-primary mr-2">{sent.method}</span>
          <span className="text-xs font-mono break-all">{sent.url}</span>
        </div>
      </div>

      {/* Headers */}
      {headerEntries.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">
            {t('response:request.headersCount', { count: headerEntries.length })}
          </h4>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="w-[240px] text-left px-3 py-1.5 font-medium">{t('common:name')}</th>
                  <th className="text-left px-3 py-1.5 font-medium">{t('response:table.value')}</th>
                </tr>
              </thead>
              <tbody>
                {headerEntries.map(([key, value]) => (
                  <tr key={key} className="group border-b last:border-b-0">
                    <td className="px-3 py-1.5 font-mono font-medium align-top break-words">{key}</td>
                    <ValueCell ck={`h:${key}`} value={value} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Query Params */}
      {paramEntries.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">
            {t('response:request.paramsCount', { count: paramEntries.length })}
          </h4>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="w-[240px] text-left px-3 py-1.5 font-medium">{t('response:table.key')}</th>
                  <th className="text-left px-3 py-1.5 font-medium">{t('response:table.value')}</th>
                </tr>
              </thead>
              <tbody>
                {paramEntries.map(([key, value]) => (
                  <tr key={key} className="group border-b last:border-b-0">
                    <td className="px-3 py-1.5 font-mono font-medium align-top break-words">{key}</td>
                    <ValueCell ck={`p:${key}`} value={value} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Body */}
      {sent.body && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">{t('response:request.body')}</h4>
          <div className="border rounded-md p-3 max-h-[250px] overflow-auto">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">
              {sent.body}
            </pre>
          </div>
        </div>
      )}

      {/* Auth info */}
      {tab.auth.type !== 'none' && (
        <div className="space-y-1">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">{t('response:request.auth')}</h4>
          <div className="border rounded-md p-3">
            <span className="text-xs font-medium capitalize">{tab.auth.type}</span>
          </div>
        </div>
      )}
    </div>
  );
}
