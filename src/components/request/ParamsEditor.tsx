import { useEffect, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRequestStore } from '@/stores/requestStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VariableInput } from '@/components/environment/VariableInput';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { KVToggle } from './KVToggle';
import { extractPathParams } from '@/lib/pathParams';
import type { Tab, KeyValue } from '@/types';

interface ParamsEditorProps {
  tab: Tab;
}

/** Rebuild URL query string from params array */
function rebuildUrl(url: string, params: KeyValue[]): string {
  const pathPart = url.split('?')[0];
  const active = params.filter((p) => p.key && p.enabled);
  if (active.length === 0) return pathPart;
  const qs = active.map((p) => `${p.key}=${p.value}`).join('&');
  return `${pathPart}?${qs}`;
}

export function ParamsEditor({ tab }: ParamsEditorProps) {
  const { t } = useTranslation('request');
  const { updateTab } = useRequestStore();
  const prevUrlRef = useRef(tab.url);

  // URL → PathParams & QueryParams sync
  useEffect(() => {
    if (tab.url === prevUrlRef.current) return;
    prevUrlRef.current = tab.url;

    const updates: Partial<Tab> = {};

    // --- Path params ---
    const paramNames = extractPathParams(tab.url);
    const existingPath = tab.pathParams || [];

    if (paramNames.length === 0) {
      if (existingPath.length > 0) updates.pathParams = [];
    } else {
      const merged = paramNames.map((name) => {
        const found = existingPath.find((p) => p.key === name);
        return found ? { ...found } : { key: name, value: '', enabled: true };
      });
      const same =
        merged.length === existingPath.length &&
        merged.every((m, i) => m.key === existingPath[i]?.key && m.value === existingPath[i]?.value);
      if (!same) updates.pathParams = merged;
    }

    // --- Query params: parse from URL, sync to editor ---
    const qsIndex = tab.url.indexOf('?');
    const urlQueryMap = new Map<string, string>();
    if (qsIndex >= 0) {
      try {
        new URLSearchParams(tab.url.slice(qsIndex + 1)).forEach((v, k) =>
          urlQueryMap.set(k, v),
        );
      } catch {
        /* invalid qs */
      }
    }

    const newParams: KeyValue[] = [];
    const seenKeys = new Set<string>();

    // Keep params that exist in the new URL, drop stale ones
    for (const p of tab.params) {
      if (!p.key) {
        // Keep empty placeholder rows
        newParams.push({ ...p });
      } else if (urlQueryMap.has(p.key)) {
        newParams.push({ ...p, value: urlQueryMap.get(p.key)! });
        seenKeys.add(p.key);
      } else if (!p.enabled) {
        // Disabled params are intentionally absent from the URL — keep the row
        newParams.push({ ...p });
      }
      // else: enabled param key not in new URL → drop it
    }

    // Add new params from URL not yet in editor
    urlQueryMap.forEach((value, key) => {
      if (!seenKeys.has(key)) {
        newParams.push({ key, value, enabled: true });
      }
    });

    // Ensure at least one empty row
    if (newParams.length === 0) {
      newParams.push({ key: '', value: '', enabled: true });
    }

    const paramsChanged =
      newParams.length !== tab.params.length ||
      newParams.some(
        (p, i) =>
          p.key !== tab.params[i]?.key ||
          p.value !== tab.params[i]?.value ||
          p.enabled !== tab.params[i]?.enabled,
      );
    if (paramsChanged) updates.params = newParams;

    if (Object.keys(updates).length > 0) {
      updateTab(tab.id, updates);
    }
  }, [tab.url, tab.id, tab.pathParams, updateTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Path param handlers
  const updatePathParam = (index: number, field: keyof KeyValue, value: string | boolean) => {
    const newParams = [...(tab.pathParams || [])];
    newParams[index] = { ...newParams[index], [field]: value };
    updateTab(tab.id, { pathParams: newParams });
  };

  // Query param handlers (also sync URL)
  const updateParam = (index: number, field: keyof KeyValue, value: string | boolean) => {
    const newParams = [...tab.params];
    newParams[index] = { ...newParams[index], [field]: value };
    const newUrl = rebuildUrl(tab.url, newParams);
    prevUrlRef.current = newUrl; // prevent useEffect re-processing
    updateTab(tab.id, { params: newParams, url: newUrl });
  };

  const addParam = () => {
    updateTab(tab.id, {
      params: [...tab.params, { key: '', value: '', enabled: true }],
    });
  };

  const removeParam = (index: number) => {
    let newParams = tab.params.filter((_, i) => i !== index);
    if (newParams.length === 0) newParams = [{ key: '', value: '', enabled: true }];
    const newUrl = rebuildUrl(tab.url, newParams);
    prevUrlRef.current = newUrl;
    updateTab(tab.id, { params: newParams, url: newUrl });
  };

  const pathParams = tab.pathParams || [];
  const hasPathParams = pathParams.length > 0;

  return (
    <div className="space-y-4">
      {/* Path Parameters */}
      {hasPathParams && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t('params.pathParameters')}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {pathParams.length}
            </Badge>
          </div>
          <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-2 items-center text-xs font-medium text-muted-foreground px-1">
            <span className="w-9 text-center">{t('kv.on')}</span>
            <span>{t('kv.parameter')}</span>
            <span>{t('kv.value')}</span>
            <span>{t('kv.description')}</span>
          </div>
          {pathParams.map((param, index) => (
            <div
              key={param.key}
              className="grid grid-cols-[auto_1fr_1fr_1fr] gap-2 items-center"
            >
              <div className="w-9 flex justify-center">
                <KVToggle enabled={param.enabled} onChange={(v) => updatePathParam(index, 'enabled', v)} />
              </div>
              <div className={cn('h-8 flex items-center px-3 text-xs font-mono bg-muted rounded-md border text-muted-foreground', !param.enabled && 'opacity-50')}>
                <span className="text-primary/70">{'{'}</span>
                {param.key}
                <span className="text-primary/70">{'}'}</span>
              </div>
              <VariableInput
                placeholder={t('kv.value')}
                value={param.value}
                onChange={(e) => updatePathParam(index, 'value', e.target.value)}
                className={cn('h-8 text-xs font-mono', !param.enabled && 'opacity-50')}
              />
              <Input
                placeholder={t('kv.description')}
                value={param.description || ''}
                onChange={(e) => updatePathParam(index, 'description', e.target.value)}
                className={cn('h-8 text-xs', !param.enabled && 'opacity-50')}
              />
            </div>
          ))}
        </div>
      )}

      {/* Query Parameters */}
      <div className="space-y-2">
        {hasPathParams && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t('params.queryParameters')}</span>
            {tab.params.filter((p) => p.key).length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {tab.params.filter((p) => p.key).length}
              </Badge>
            )}
          </div>
        )}
        <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-2 items-center text-xs font-medium text-muted-foreground px-1">
          <span className="w-9 text-center">{t('kv.on')}</span>
          <span>{t('kv.key')}</span>
          <span>{t('kv.value')}</span>
          <span>{t('kv.description')}</span>
          <span className="w-8"></span>
        </div>

        {tab.params.map((param, index) => (
          <div
            key={index}
            className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-2 items-center"
          >
            <div className="w-9 flex justify-center">
              <KVToggle enabled={param.enabled} onChange={(v) => updateParam(index, 'enabled', v)} />
            </div>
            <VariableInput
              placeholder={t('kv.key')}
              value={param.key}
              onChange={(e) => updateParam(index, 'key', e.target.value)}
              className={cn('h-8 text-xs font-mono', !param.enabled && 'opacity-50')}
            />
            <VariableInput
              placeholder={t('kv.value')}
              value={param.value}
              onChange={(e) => updateParam(index, 'value', e.target.value)}
              className={cn('h-8 text-xs font-mono', !param.enabled && 'opacity-50')}
            />
            <Input
              placeholder={t('kv.description')}
              value={param.description || ''}
              onChange={(e) => updateParam(index, 'description', e.target.value)}
              className={cn('h-8 text-xs', !param.enabled && 'opacity-50')}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => removeParam(index)}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        ))}

        <Button variant="outline" size="sm" onClick={addParam} className="w-full mt-2">
          <Plus className="h-3.5 w-3.5 mr-1" />
          {t('params.addParameter')}
        </Button>
      </div>
    </div>
  );
}
