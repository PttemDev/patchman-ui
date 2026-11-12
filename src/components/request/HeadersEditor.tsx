import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useRequestStore } from '@/stores/requestStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VariableInput } from '@/components/environment/VariableInput';
import { KVToggle } from './KVToggle';
import type { Tab, KeyValue } from '@/types';

interface HeadersEditorProps {
  tab: Tab;
}

export function HeadersEditor({ tab }: HeadersEditorProps) {
  const { t } = useTranslation('request');
  const { updateTab } = useRequestStore();
  const [commonExpanded, setCommonExpanded] = useState(false);

  // Defensive: a malformed/older persisted tab may show up with
  // `headers: undefined`. The store's onRehydrateStorage backfills it, but
  // belt-and-braces here means a stray missing-headers tab can never lock
  // the editor — `.filter` on undefined was the symptom Hakan hit.
  const headers = Array.isArray(tab.headers) ? tab.headers : [];
  const commonHeaders = headers.filter((h) => h.isDefault);
  const userHeaders = headers.filter((h) => !h.isDefault);

  const updateHeader = (index: number, field: keyof KeyValue, value: string | boolean) => {
    const newHeaders = [...headers];
    newHeaders[index] = { ...newHeaders[index], [field]: value };
    updateTab(tab.id, { headers: newHeaders });
  };

  const getGlobalIndex = (header: KeyValue, isDefault: boolean): number => {
    if (isDefault) {
      return headers.indexOf(header);
    }
    return headers.indexOf(header);
  };

  const addHeader = () => {
    updateTab(tab.id, {
      headers: [...headers, { key: '', value: '', enabled: true }],
    });
  };

  const removeHeader = (index: number) => {
    const newHeaders = headers.filter((_, i) => i !== index);
    const remainingUser = newHeaders.filter((h) => !h.isDefault);
    if (remainingUser.length === 0) {
      updateTab(tab.id, {
        headers: [...newHeaders, { key: '', value: '', enabled: true }],
      });
    } else {
      updateTab(tab.id, { headers: newHeaders });
    }
  };

  const renderHeaderRow = (header: KeyValue, globalIndex: number, muted: boolean) => (
    <div
      key={globalIndex}
      className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-2 items-center"
    >
      <div className="w-9 flex justify-center">
        <KVToggle enabled={header.enabled} onChange={(v) => updateHeader(globalIndex, 'enabled', v)} />
      </div>
      <VariableInput
        placeholder={t('headers.headerName')}
        value={header.key}
        onChange={(e) => updateHeader(globalIndex, 'key', e.target.value)}
        className={cn('h-8 text-xs font-mono', (muted || !header.enabled) && 'text-muted-foreground', !header.enabled && 'opacity-50')}
      />
      <VariableInput
        placeholder={t('kv.value')}
        value={header.value}
        onChange={(e) => updateHeader(globalIndex, 'value', e.target.value)}
        className={cn('h-8 text-xs font-mono', (muted || !header.enabled) && 'text-muted-foreground', !header.enabled && 'opacity-50')}
      />
      <Input
        placeholder={t('kv.description')}
        value={header.description || ''}
        onChange={(e) => updateHeader(globalIndex, 'description', e.target.value)}
        className={cn('h-8 text-xs', (muted || !header.enabled) && 'text-muted-foreground', !header.enabled && 'opacity-50')}
      />
      {!header.isDefault ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => removeHeader(globalIndex)}
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      ) : (
        <div className="w-8" />
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      {/* Common Headers - Collapsible */}
      {commonHeaders.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setCommonExpanded(!commonExpanded)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            {commonExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {t('headers.commonHeaders')}
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
              {commonHeaders.filter((h) => h.enabled).length}/{commonHeaders.length}
            </span>
          </button>

          {commonExpanded && (
            <div className="space-y-1.5 pl-2 border-l-2 border-muted">
              {commonHeaders.map((header) => {
                const globalIndex = getGlobalIndex(header, true);
                return renderHeaderRow(header, globalIndex, true);
              })}
            </div>
          )}
        </div>
      )}

      {/* Column headers */}
      <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-2 items-center text-xs font-medium text-muted-foreground px-1">
        <span className="w-9 text-center">{t('kv.on')}</span>
        <span>{t('kv.key')}</span>
        <span>{t('kv.value')}</span>
        <span>{t('kv.description')}</span>
        <span className="w-8"></span>
      </div>

      {/* User headers */}
      {userHeaders.map((header) => {
        const globalIndex = getGlobalIndex(header, false);
        return renderHeaderRow(header, globalIndex, false);
      })}

      <Button variant="outline" size="sm" onClick={addHeader} className="w-full mt-2">
        <Plus className="h-3.5 w-3.5 mr-1" />
        {t('headers.addHeader')}
      </Button>
    </div>
  );
}
