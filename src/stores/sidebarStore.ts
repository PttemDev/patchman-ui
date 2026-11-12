import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type SidebarTab = 'collections' | 'database' | 'kafka' | 'storage' | 'redis' | 'elasticsearch' | 'kubernetes' | 'git' | 'ai' | 'devtools' | 'excalidraw' | 'notes' | 'dashboards' | 'history' | 'qa' | 'qa-planning' | 'mock' | 'websocket' | 'cookies' | 'audit' | 'environments';

interface SidebarState {
  activeTab: SidebarTab;
  collapsed: boolean;
  // Sidebar item ids the user chose to hide (empty = everything visible). The
  // rail AND-s this with the platform gating in Sidebar.tsx. Stored as plain
  // strings so it round-trips even if the tab registry changes.
  hiddenTabs: string[];
  setActiveTab: (tab: SidebarTab) => void;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  setTabHidden: (tab: string, hidden: boolean) => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      activeTab: 'collections',
      collapsed: false,
      hiddenTabs: [],
      setActiveTab: (tab: SidebarTab) => set({ activeTab: tab, collapsed: false }),
      setCollapsed: (collapsed: boolean) => set({ collapsed }),
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
      setTabHidden: (tab: string, hidden: boolean) =>
        set((s) => ({
          hiddenTabs: hidden
            ? Array.from(new Set([...s.hiddenTabs, tab]))
            : s.hiddenTabs.filter((t) => t !== tab),
        })),
    }),
    {
      name: 'patchman-sidebar-store',
    }
  )
);
