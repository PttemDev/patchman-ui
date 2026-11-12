import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  Plus,
  Send,
  Save,
  Code,
  FolderOpen,
  Clock,
  ClipboardCheck,
  Server,
  Globe,
  Sun,
  Moon,
  Upload,
  FileJson,
  FileText,
  Play,
  PanelLeft,
  Command,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useRequestStore } from '@/stores/requestStore';
import { useThemeStore } from '@/stores/themeStore';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { useSidebarStore } from '@/stores/sidebarStore';
import { cn } from '@/lib/utils';

interface CommandItem {
  id: string;
  name: string;
  category: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
  keywords?: string;
}

const categoryOrder = ['Request', 'Navigation', 'Environment', 'Tools', 'View'];

const categoryColors: Record<string, string> = {
  Request: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  Navigation: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  Environment: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  Tools: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  View: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export function CommandPalette() {
  const { t } = useTranslation('app');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { addTab, tabs, activeTabId, removeTab, sendRequest } = useRequestStore();
  const { theme, toggle: toggleTheme } = useThemeStore();
  const { environments, activateEnvironment } = useEnvironmentStore();
  const { setActiveTab: setSidebarTab } = useSidebarStore();

  const close = useCallback(() => {
    setOpen(false);
    setSearch('');
    setSelectedIndex(0);
  }, []);

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      // Request
      {
        id: 'new-tab',
        name: t('commands.newTab'),
        category: 'Request',
        icon: <Plus className="h-4 w-4" />,
        shortcut: '\u2318N',
        keywords: 'create add tab request',
        action: () => { addTab(); close(); },
      },
      {
        id: 'send-request',
        name: t('commands.sendRequest'),
        category: 'Request',
        icon: <Send className="h-4 w-4" />,
        shortcut: '\u2318\u21A9',
        keywords: 'execute run fire',
        action: () => { if (activeTabId) sendRequest(activeTabId); close(); },
      },
      {
        id: 'save-collection',
        name: t('commands.saveToCollection'),
        category: 'Request',
        icon: <Save className="h-4 w-4" />,
        shortcut: '\u2318S',
        keywords: 'save store collection',
        action: () => {
          close();
          // Dispatch custom event for SaveToCollectionDialog
          window.dispatchEvent(new CustomEvent('patchman:save-to-collection'));
        },
      },
      {
        id: 'generate-code',
        name: t('commands.generateCode'),
        category: 'Request',
        icon: <Code className="h-4 w-4" />,
        keywords: 'snippet curl python javascript',
        action: () => {
          close();
          window.dispatchEvent(new CustomEvent('patchman:open-codegen'));
        },
      },
      {
        id: 'close-tab',
        name: t('commands.closeTab'),
        category: 'Request',
        icon: <Plus className="h-4 w-4 rotate-45" />,
        shortcut: '\u2318W',
        keywords: 'close remove tab',
        action: () => { if (activeTabId) removeTab(activeTabId); close(); },
      },

      // Navigation
      {
        id: 'go-collections',
        name: t('commands.goCollections'),
        category: 'Navigation',
        icon: <FolderOpen className="h-4 w-4" />,
        keywords: 'sidebar panel collections folder',
        action: () => { setSidebarTab('collections'); close(); },
      },
      {
        id: 'go-history',
        name: t('commands.goHistory'),
        category: 'Navigation',
        icon: <Clock className="h-4 w-4" />,
        keywords: 'sidebar panel history past',
        action: () => { setSidebarTab('history'); close(); },
      },
      {
        id: 'go-qa',
        name: t('commands.goQa'),
        category: 'Navigation',
        icon: <ClipboardCheck className="h-4 w-4" />,
        keywords: 'sidebar panel qa testing',
        action: () => { setSidebarTab('qa'); close(); },
      },
      {
        id: 'go-mock',
        name: t('commands.goMock'),
        category: 'Navigation',
        icon: <Server className="h-4 w-4" />,
        keywords: 'sidebar panel mock server',
        action: () => { setSidebarTab('mock'); close(); },
      },

      // Navigation: switch tabs by index
      ...tabs.slice(0, 9).map((tab, i) => ({
        id: `switch-tab-${i}`,
        name: t('commands.switchToTab', { name: tab.name || tab.url || t('commands.newRequest') }),
        category: 'Navigation',
        icon: <span className="h-4 w-4 flex items-center justify-center text-xs font-bold">{i + 1}</span>,
        shortcut: `\u2325${i + 1}`,
        keywords: `tab ${i + 1} switch ${tab.method} ${tab.name} ${tab.url}`,
        action: () => { useRequestStore.getState().setActiveTab(tab.id); close(); },
      })),

      // Environment
      ...environments.map((env) => ({
        id: `env-${env.id}`,
        name: t('commands.switchToEnv', { name: env.name }),
        category: 'Environment',
        icon: <Globe className="h-4 w-4" />,
        keywords: `environment env ${env.name}`,
        action: () => { activateEnvironment(env.id); close(); },
      })),
      {
        id: 'env-none',
        name: t('commands.clearEnv'),
        category: 'Environment',
        icon: <Globe className="h-4 w-4" />,
        keywords: 'environment none clear remove',
        action: () => { activateEnvironment(null); close(); },
      },
      {
        id: 'env-manage',
        name: t('commands.manageEnv'),
        category: 'Environment',
        icon: <Globe className="h-4 w-4" />,
        shortcut: '\u2318E',
        keywords: 'environment create edit manage variables',
        action: () => {
          close();
          window.dispatchEvent(new CustomEvent('patchman:open-env-manager'));
        },
      },

      // Tools
      {
        id: 'collection-runner',
        name: t('commands.collectionRunner'),
        category: 'Tools',
        icon: <Play className="h-4 w-4" />,
        keywords: 'run collection batch execute',
        action: () => {
          close();
          window.dispatchEvent(new CustomEvent('patchman:open-collection-runner'));
        },
      },
      {
        id: 'import-swagger',
        name: t('commands.importSwagger'),
        category: 'Tools',
        icon: <Upload className="h-4 w-4" />,
        keywords: 'import swagger openapi spec',
        action: () => {
          close();
          window.dispatchEvent(new CustomEvent('patchman:open-import-swagger'));
        },
      },
      {
        id: 'import-collection',
        name: t('commands.importCollection'),
        category: 'Tools',
        icon: <FileJson className="h-4 w-4" />,
        keywords: 'import collection json file',
        action: () => {
          close();
          window.dispatchEvent(new CustomEvent('patchman:open-import-collection'));
        },
      },
      {
        id: 'import-postman',
        name: t('commands.importPostman'),
        category: 'Tools',
        icon: <FileText className="h-4 w-4" />,
        keywords: 'import postman migrate',
        action: () => {
          close();
          window.dispatchEvent(new CustomEvent('patchman:open-import-swagger'));
        },
      },

      // View
      {
        id: 'toggle-theme',
        name: theme === 'light' ? t('commands.switchToDark') : t('commands.switchToLight'),
        category: 'View',
        icon: theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />,
        keywords: 'theme dark light mode appearance',
        action: () => { toggleTheme(); close(); },
      },
      {
        id: 'toggle-sidebar',
        name: t('commands.toggleSidebar'),
        category: 'View',
        icon: <PanelLeft className="h-4 w-4" />,
        shortcut: '\u2318B',
        keywords: 'sidebar toggle show hide panel',
        action: () => {
          close();
          window.dispatchEvent(new CustomEvent('patchman:toggle-sidebar'));
        },
      },
    ];

    return items;
  }, [addTab, activeTabId, sendRequest, removeTab, environments, activateEnvironment, theme, toggleTheme, setSidebarTab, tabs, close, t]);

  // Filter commands by search term
  const filteredCommands = useMemo(() => {
    if (!search.trim()) return commands;
    const terms = search.toLowerCase().split(/\s+/);
    return commands.filter((cmd) => {
      const haystack = `${cmd.name} ${cmd.category} ${cmd.keywords || ''}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [commands, search]);

  // Group filtered commands by category
  const groupedCommands = useMemo(() => {
    const groups: { category: string; items: CommandItem[] }[] = [];
    const map = new Map<string, CommandItem[]>();

    for (const cmd of filteredCommands) {
      const existing = map.get(cmd.category);
      if (existing) {
        existing.push(cmd);
      } else {
        map.set(cmd.category, [cmd]);
      }
    }

    for (const cat of categoryOrder) {
      const items = map.get(cat);
      if (items && items.length > 0) {
        groups.push({ category: cat, items });
      }
    }

    return groups;
  }, [filteredCommands]);

  // Flat list for keyboard navigation
  const flatList = useMemo(() => groupedCommands.flatMap((g) => g.items), [groupedCommands]);

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= flatList.length) {
      setSelectedIndex(Math.max(0, flatList.length - 1));
    }
  }, [flatList.length, selectedIndex]);

  // Register Cmd+K / Ctrl+K global listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setSearch('');
      setSelectedIndex(0);
      // Slight delay to ensure dialog is rendered
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % Math.max(1, flatList.length));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + flatList.length) % Math.max(1, flatList.length));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatList[selectedIndex]) {
            flatList[selectedIndex].action();
          }
          break;
        case 'Escape':
          e.preventDefault();
          close();
          break;
      }
    },
    [flatList, selectedIndex, close]
  );

  let runningIndex = 0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) close(); else setOpen(true); }}>
      <DialogContent
        // Hide the shadcn DialogContent's built-in absolute close (X) — it
        // overlaps our own ESC badge at the top-right of the search input. ESC
        // + the footer "esc Close" already cover closing.
        className="p-0 gap-0 max-w-[560px] overflow-hidden border-border/50 shadow-2xl [&>button.absolute]:hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">{t('commandPalette.title')}</DialogTitle>

        {/* Search input */}
        <div className="flex items-center gap-3 px-4 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={t('commandPalette.placeholder')}
            className="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Commands list */}
        <div
          ref={listRef}
          className="max-h-[min(400px,60vh)] overflow-y-auto overflow-x-hidden py-2 overscroll-contain"
        >
          {groupedCommands.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">{t('commandPalette.empty')}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">{t('commandPalette.emptyHint')}</p>
            </div>
          ) : (
            groupedCommands.map((group) => {
              const groupItems = group.items.map((item) => {
                const itemIndex = runningIndex++;
                return (
                  <button
                    key={item.id}
                    data-index={itemIndex}
                    onClick={() => item.action()}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors duration-75 cursor-pointer outline-none',
                      selectedIndex === itemIndex
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground/80 hover:bg-accent/50'
                    )}
                  >
                    {/* Icon */}
                    <span className={cn(
                      'flex items-center justify-center h-7 w-7 rounded-md shrink-0',
                      selectedIndex === itemIndex
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    )}>
                      {item.icon}
                    </span>

                    {/* Name */}
                    <span className="flex-1 text-left truncate">{item.name}</span>

                    {/* Category badge */}
                    <span className={cn(
                      'text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 hidden sm:inline-block',
                      categoryColors[item.category] || 'bg-muted text-muted-foreground'
                    )}>
                      {t(`commandCategories.${item.category}`)}
                    </span>

                    {/* Shortcut */}
                    {item.shortcut && (
                      <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground shrink-0">
                        {item.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              });

              return (
                <div key={group.category}>
                  <div className="px-4 py-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                      {t(`commandCategories.${group.category}`)}
                    </span>
                  </div>
                  {groupItems}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between gap-4 px-4 py-2 border-t bg-muted/30 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center h-4 min-w-[16px] rounded border bg-muted px-1 font-mono text-[10px]">&uarr;</kbd>
              <kbd className="inline-flex items-center justify-center h-4 min-w-[16px] rounded border bg-muted px-1 font-mono text-[10px]">&darr;</kbd>
              <span className="ml-0.5">{t('commandPalette.navigate')}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center h-4 min-w-[16px] rounded border bg-muted px-1 font-mono text-[10px]">&crarr;</kbd>
              <span className="ml-0.5">{t('commandPalette.select')}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center h-4 rounded border bg-muted px-1 font-mono text-[10px]">esc</kbd>
              <span className="ml-0.5">{t('common:close')}</span>
            </span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground/60">
            <Command className="h-3 w-3" />
            <span>{t('commandPalette.toggleHint')}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
