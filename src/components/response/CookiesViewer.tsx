import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Save, Shield, ShieldOff, Cookie as CookieIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getRepo } from '@/data';
import { emitCookiesChanged, COOKIES_CHANGED_EVENT } from '@/lib/cookieJar';
import { useCookieConfigStore } from '@/stores/cookieConfigStore';
import type { CookieItem, ResponseCookie, ResponseData } from '@/types';

interface Props {
  response: ResponseData;
}

function cookieKey(domain: string, name: string, path: string): string {
  return `${domain.toLowerCase()}|${name}|${path || '/'}`;
}

function formatExpiry(expiresAt: string | undefined, t: (key: string) => string): string {
  if (!expiresAt) return t('response:cookies.session');
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return expiresAt;
  if (d.getTime() < Date.now()) return t('response:cookies.expired');
  return d.toLocaleString();
}

export function CookiesViewer({ response }: Props) {
  const { t } = useTranslation(['response', 'common']);
  const cookies: ResponseCookie[] = response.responseCookies ?? [];
  const autoSave = useCookieConfigStore((s) => s.autoSave);
  const setAutoSave = useCookieConfigStore((s) => s.setAutoSave);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  const refreshJar = useCallback(async () => {
    try {
      const jar: CookieItem[] = await getRepo().cookies.list();
      const keys = new Set<string>();
      for (const c of jar) keys.add(cookieKey(c.domain, c.name, c.path));
      setSavedKeys(keys);
    } catch {
      setSavedKeys(new Set());
    }
  }, []);

  useEffect(() => {
    refreshJar();
    const handler = () => refreshJar();
    window.addEventListener(COOKIES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(COOKIES_CHANGED_EVENT, handler);
  }, [refreshJar]);

  const saveOne = useCallback(async (c: ResponseCookie) => {
    const key = cookieKey(c.domain, c.name, c.path);
    setSavingKey(key);
    try {
      await getRepo().cookies.set({
        domain: c.domain,
        name: c.name,
        value: c.value,
        path: c.path || '/',
        secure: c.secure,
        httpOnly: c.httpOnly,
        expiresAt: c.expiresAt,
      });
      setSavedKeys((prev) => new Set(prev).add(key));
      emitCookiesChanged();
    } catch {
      // Surface by leaving the key unmarked — the button goes back to "Save"
    } finally {
      setSavingKey(null);
    }
  }, []);

  const unsaved = useMemo(
    () => cookies.filter((c) => !savedKeys.has(cookieKey(c.domain, c.name, c.path))),
    [cookies, savedKeys],
  );

  const saveAll = useCallback(async () => {
    setSavingAll(true);
    try {
      for (const c of unsaved) {
        await getRepo().cookies.set({
          domain: c.domain,
          name: c.name,
          value: c.value,
          path: c.path || '/',
          secure: c.secure,
          httpOnly: c.httpOnly,
          expiresAt: c.expiresAt,
        });
      }
      emitCookiesChanged();
      await refreshJar();
    } finally {
      setSavingAll(false);
    }
  }, [unsaved, refreshJar]);

  if (cookies.length === 0) {
    return (
      <div className="border rounded-md min-h-[200px] flex flex-col items-center justify-center p-6 text-center">
        <CookieIcon className="h-8 w-8 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">{t('response:cookies.emptyTitle')}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {t('response:cookies.emptyHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="border rounded-md">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <CookieIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">
            {cookies.length === 1
              ? t('response:cookies.countOne', { count: cookies.length })
              : t('response:cookies.countOther', { count: cookies.length })}
          </span>
          {unsaved.length > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5">
              {t('response:cookies.newCount', { count: unsaved.length })}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                  <Switch checked={autoSave} onCheckedChange={setAutoSave} />
                  {t('response:cookies.autoSave')}
                </label>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs max-w-[240px]">
                  {t('response:cookies.autoSaveTooltip')}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {unsaved.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={saveAll} disabled={savingAll}>
              {savingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1" />
              )}
              {t('response:cookies.saveAll')}
            </Button>
          )}
        </div>
      </div>
      <div className="divide-y">
        {cookies.map((c, idx) => {
          const key = cookieKey(c.domain, c.name, c.path);
          const isSaved = savedKeys.has(key);
          const isSaving = savingKey === key;
          return (
            <div key={idx} className="px-3 py-2 flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                {c.secure ? (
                  <Shield className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <ShieldOff className="h-3.5 w-3.5 text-muted-foreground/50" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium">{c.name}</span>
                  {c.httpOnly && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0">httpOnly</Badge>
                  )}
                  {c.sameSite && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      SameSite={c.sameSite}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground break-all">
                  {c.value || <span className="italic">{t('response:cookies.empty')}</span>}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span>{c.domain}</span>
                  <span>&middot; {c.path || '/'}</span>
                  <span>&middot; {formatExpiry(c.expiresAt, t)}</span>
                </div>
              </div>
              <div className="shrink-0">
                {isSaved ? (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled>
                    <Check className="h-3.5 w-3.5 mr-1 text-green-500" />
                    {t('response:cookies.saved')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => saveOne(c)}
                    disabled={isSaving}
                  >
                    {isSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Save className="h-3.5 w-3.5 mr-1" />
                    )}
                    {t('common:save')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
