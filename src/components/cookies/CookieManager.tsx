import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cookie,
  Plus,
  Trash2,
  Search,
  Shield,
  ShieldOff,
  X,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { getRepo } from '@/data';
import { COOKIES_CHANGED_EVENT } from '@/lib/cookieJar';
import type { CookieItem } from '@/types';

export function CookieManager() {
  const { t } = useTranslation('cookies');
  const [cookies, setCookies] = useState<CookieItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());

  // Add cookie form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [formDomain, setFormDomain] = useState('');
  const [formName, setFormName] = useState('');
  const [formValue, setFormValue] = useState('');
  const [formPath, setFormPath] = useState('/');
  const [formSecure, setFormSecure] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Clear all confirmation
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const fetchCookies = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const items = await getRepo().cookies.list();
      setCookies(items);
    } catch {
      setError(t('errors.load'));
    } finally {
      setIsLoading(false);
    }
    // t is intentionally omitted: including it makes this load-shaped callback
    // re-run on language switch, refetching and wiping the error state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchCookies();
  }, [fetchCookies]);

  useEffect(() => {
    const handler = () => fetchCookies();
    window.addEventListener(COOKIES_CHANGED_EVENT, handler);
    return () => window.removeEventListener(COOKIES_CHANGED_EVENT, handler);
  }, [fetchCookies]);

  // Group cookies by domain
  const groupedCookies = useMemo(() => {
    const filtered = cookies.filter((cookie) => {
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      return (
        cookie.domain.toLowerCase().includes(query) ||
        cookie.name.toLowerCase().includes(query) ||
        cookie.value.toLowerCase().includes(query)
      );
    });

    const groups: Record<string, CookieItem[]> = {};
    filtered.forEach((cookie) => {
      const domain = cookie.domain || t('noDomain');
      if (!groups[domain]) {
        groups[domain] = [];
      }
      groups[domain].push(cookie);
    });

    // Sort domains alphabetically
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [cookies, searchQuery, t]);

  const totalDomains = groupedCookies.length;
  const totalFilteredCookies = groupedCookies.reduce((sum, [, items]) => sum + items.length, 0);

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  };

  const handleAddCookie = async () => {
    if (!formDomain.trim() || !formName.trim()) return;

    setIsSaving(true);
    try {
      await getRepo().cookies.set({
        domain: formDomain.trim(),
        name: formName.trim(),
        value: formValue,
        path: formPath.trim() || '/',
        secure: formSecure,
      });
      resetForm();
      setShowAddForm(false);
      await fetchCookies();
    } catch {
      setError(t('errors.add'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCookie = async (id: string) => {
    try {
      await getRepo().cookies.remove(id);
      setCookies((prev) => prev.filter((c) => c.id !== id));
    } catch {
      setError(t('errors.delete'));
    }
  };

  const handleDeleteDomain = async (domain: string) => {
    try {
      await getRepo().cookies.clear(domain);
      setCookies((prev) => prev.filter((c) => c.domain !== domain));
      setExpandedDomains((prev) => {
        if (!prev.has(domain)) return prev;
        const next = new Set(prev);
        next.delete(domain);
        return next;
      });
    } catch {
      setError(t('errors.deleteDomain'));
    }
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      await getRepo().cookies.clear();
      setCookies([]);
      setShowClearConfirm(false);
      setExpandedDomains(new Set());
    } catch {
      setError(t('errors.clear'));
    } finally {
      setIsClearing(false);
    }
  };

  const resetForm = () => {
    setFormDomain('');
    setFormName('');
    setFormValue('');
    setFormPath('/');
    setFormSecure(false);
  };

  const formatExpiry = (expiresAt?: string) => {
    if (!expiresAt) return t('expiry.session');
    try {
      const date = new Date(expiresAt);
      const now = new Date();
      if (date < now) return t('expiry.expired');
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      });
    } catch {
      return expiresAt;
    }
  };

  const truncateValue = (value: string, maxLen = 30) => {
    if (value.length <= maxLen) return value;
    return value.slice(0, maxLen) + '...';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 space-y-2 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{t('title')}</h3>
            {cookies.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5">
                {cookies.length}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                resetForm();
                setShowAddForm(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            {cookies.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:text-destructive"
                onClick={() => setShowClearConfirm(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('filterPlaceholder')}
            className="h-7 text-xs pl-7 pr-7"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
            >
              <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-3 mt-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 flex items-center justify-between">
          <p className="text-xs text-destructive">{error}</p>
          <button onClick={() => setError(null)} className="cursor-pointer">
            <X className="h-3 w-3 text-destructive" />
          </button>
        </div>
      )}

      {/* Cookie list */}
      <ScrollArea className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
          </div>
        ) : cookies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Cookie className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">{t('empty.title')}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('empty.hint')}
            </p>
          </div>
        ) : groupedCookies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <Search className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">{t('noMatch.title')}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {t('noMatch.hint')}
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {/* Summary line */}
            <div className="px-2 py-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {t('summary', {
                  domains: t(totalDomains === 1 ? 'domainCountOne' : 'domainCountOther', { n: totalDomains }),
                  cookies: t(totalFilteredCookies === 1 ? 'cookieCountOne' : 'cookieCountOther', { n: totalFilteredCookies }),
                })}
              </span>
            </div>

            {groupedCookies.map(([domain, domainCookies]) => (
              <div key={domain}>
                {/* Domain header */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleDomain(domain)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleDomain(domain);
                    }
                  }}
                  className={cn(
                    'group/domain w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-left cursor-pointer select-none'
                  )}
                >
                  {expandedDomains.has(domain) ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-xs font-medium truncate flex-1">{domain}</span>
                  <Badge variant="secondary" className="text-[10px] px-1 shrink-0">
                    {domainCookies.length}
                  </Badge>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteDomain(domain);
                    }}
                    title={t('deleteDomainTitle', { domain })}
                    className="p-1 rounded hover:bg-muted cursor-pointer shrink-0"
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>

                {/* Cookies under this domain */}
                {expandedDomains.has(domain) && (
                  <div className="ml-4 space-y-0.5 mb-1">
                    {domainCookies.map((cookie) => (
                      <div
                        key={cookie.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors group"
                      >
                        {/* Secure indicator */}
                        <div className="shrink-0">
                          {cookie.secure ? (
                            <Shield className="h-3 w-3 text-green-500" />
                          ) : (
                            <ShieldOff className="h-3 w-3 text-muted-foreground/50" />
                          )}
                        </div>

                        {/* Cookie details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium truncate">
                              {cookie.name}
                            </span>
                            {cookie.httpOnly && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                                httpOnly
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground font-mono truncate">
                              {truncateValue(cookie.value)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground">
                              {cookie.path}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              &middot; {formatExpiry(cookie.expiresAt)}
                            </span>
                          </div>
                        </div>

                        {/* Delete button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCookie(cookie.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted transition-opacity cursor-pointer shrink-0"
                        >
                          <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Add Cookie Dialog */}
      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cookie className="h-4 w-4" />
              {t('add.title')}
            </DialogTitle>
            <DialogDescription>
              {t('add.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cookie-domain" className="text-xs">
                {t('add.domain')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cookie-domain"
                value={formDomain}
                onChange={(e) => setFormDomain(e.target.value)}
                placeholder="example.com"
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cookie-name" className="text-xs">
                {t('add.name')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cookie-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="session_id"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cookie-value" className="text-xs">
                {t('add.value')}
              </Label>
              <Input
                id="cookie-value"
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                placeholder="abc123..."
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cookie-path" className="text-xs">
                  {t('add.path')}
                </Label>
                <Input
                  id="cookie-path"
                  value={formPath}
                  onChange={(e) => setFormPath(e.target.value)}
                  placeholder="/"
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('add.secure')}</Label>
                <div className="flex items-center gap-2 h-8">
                  <Switch
                    checked={formSecure}
                    onCheckedChange={setFormSecure}
                  />
                  <span className="text-xs text-muted-foreground">
                    {formSecure ? t('add.secureHttpsOnly') : t('add.secureAny')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                resetForm();
                setShowAddForm(false);
              }}
            >
              {t('common:cancel')}
            </Button>
            <Button
              size="sm"
              onClick={handleAddCookie}
              disabled={!formDomain.trim() || !formName.trim() || isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {t('add.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear All Confirmation Dialog */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t('clear.title')}
            </DialogTitle>
            <DialogDescription>
              {t(cookies.length === 1 ? 'clear.confirmOne' : 'clear.confirmOther', { n: cookies.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowClearConfirm(false)}
              disabled={isClearing}
            >
              {t('common:cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClearAll}
              disabled={isClearing}
            >
              {isClearing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              {t('clear.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
