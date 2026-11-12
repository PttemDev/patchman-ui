import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';
import type { ResponseData } from '@/types';

interface HeadersViewerProps {
  response: ResponseData;
}

export function HeadersViewer({ response }: HeadersViewerProps) {
  const { t } = useTranslation(['response', 'common']);
  const headerEntries = Object.entries(response.headers);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (headerEntries.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
        {t('response:headers.empty')}
      </div>
    );
  }

  const copy = (key: string, value: string) => {
    navigator.clipboard?.writeText(value)
      .then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
      })
      .catch(() => {});
  };

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full table-fixed text-xs">
        <thead>
          <tr className="bg-muted/50">
            <th className="w-[240px] text-left px-3 py-2 font-medium text-muted-foreground border-b">
              {t('common:name')}
            </th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground border-b">
              {t('response:table.value')}
            </th>
          </tr>
        </thead>
        <tbody>
          {headerEntries.map(([key, value]) => (
            <tr key={key} className="group border-b last:border-0 hover:bg-muted/30 transition-colors">
              <td className="px-3 py-2 font-mono font-medium text-foreground align-top break-words">
                {key}
              </td>
              <td className="px-3 py-2 align-top">
                <button
                  type="button"
                  onClick={() => copy(key, value)}
                  title={t('response:clickToCopyValue')}
                  className="w-full text-left inline-flex items-start gap-1.5 font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <span className="break-all min-w-0">{value}</span>
                  {copiedKey === key ? (
                    <Check className="h-3 w-3 shrink-0 mt-0.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3 w-3 shrink-0 mt-0.5 opacity-0 group-hover:opacity-40" />
                  )}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
