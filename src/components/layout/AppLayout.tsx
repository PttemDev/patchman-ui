import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { RequestPanel } from '@/components/request/RequestPanel';
import { Toaster } from '@/components/ui/toaster';
import { GlobalConfirm } from '@/components/ui/confirm';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { useSidebarStore } from '@/stores/sidebarStore';
import { useAppStartupNotices } from '@/hooks/useAppStartupNotices';
import { ImpersonationBanner } from '@/components/admin/ImpersonationBanner';

export function AppLayout() {
  const { t } = useTranslation('layout');
  useAppStartupNotices();
  const sidebarCollapsed = useSidebarStore((s) => s.collapsed);
  // 350px is the empirical minimum where the collections/history rows
  // stop overlapping their action buttons with comfortable breathing
  // room. Anything narrower clips icons. The resize handle, the inline
  // style cap below, and the localStorage hydrate all share this floor.
  const SIDEBAR_MIN_WIDTH = 350;
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('patchman_sidebar_width');
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= SIDEBAR_MIN_WIDTH) return val;
      }
    } catch { /* ignore */ }
    return 600;
  });
  const [sidebarVisible, setSidebarVisible] = useState(() => {
    try {
      const saved = localStorage.getItem('patchman_sidebar_visible');
      if (saved !== null) return saved !== 'false';
    } catch { /* ignore */ }
    return true;
  });
  const isDragging = useRef(false);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Listen for sidebar toggle events from command palette / keyboard shortcuts
  useEffect(() => {
    const handler = () => setSidebarVisible((v) => {
      const next = !v;
      try { localStorage.setItem('patchman_sidebar_visible', String(next)); } catch { /* ignore */ }
      return next;
    });
    window.addEventListener('patchman:toggle-sidebar', handler);
    return () => window.removeEventListener('patchman:toggle-sidebar', handler);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    setIsDraggingState(true);

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const containerWidth = containerRef.current.getBoundingClientRect().width;
      const maxWidth = Math.round(containerWidth * 0.6); // 60% of container
      const newWidth = Math.min(Math.max(ev.clientX, SIDEBAR_MIN_WIDTH), maxWidth);
      setSidebarWidth(newWidth);
      try { localStorage.setItem('patchman_sidebar_width', String(newWidth)); } catch { /* ignore */ }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      setIsDraggingState(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <ImpersonationBanner />
      <TopBar />
      <div ref={containerRef} className="flex flex-1 overflow-hidden relative">
        {sidebarVisible ? (
          <>
            <div
              style={sidebarCollapsed ? { width: 48, minWidth: 48 } : { width: sidebarWidth, minWidth: SIDEBAR_MIN_WIDTH }}
              className="shrink-0 overflow-hidden will-change-[width]"
            >
              <Sidebar />
            </div>
            <div
              className={`w-1 bg-border ${sidebarCollapsed ? '' : 'hover:bg-primary/40 cursor-col-resize'} shrink-0 transition-colors relative group`}
              onMouseDown={sidebarCollapsed ? undefined : handleMouseDown}
              onDoubleClick={() => { setSidebarVisible(false); try { localStorage.setItem('patchman_sidebar_visible', 'false'); } catch { /* ignore */ } }}
            >
              <TooltipProvider delayDuration={500}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => { setSidebarVisible(false); try { localStorage.setItem('patchman_sidebar_visible', 'false'); } catch { /* ignore */ } }}
                      className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-background border shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    >
                      <PanelLeftClose className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>{t('collapseSidebar')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </>
        ) : (
          <div className="w-10 shrink-0 border-r bg-muted/30 flex flex-col items-center pt-2">
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => { setSidebarVisible(true); try { localStorage.setItem('patchman_sidebar_visible', 'true'); } catch { /* ignore */ } }}
                  >
                    <PanelLeftOpen className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{t('expandSidebarShortcut')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        <main className="flex-1 overflow-hidden min-w-[400px] flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden">
            <RequestPanel />
          </div>
          <StatusBar />
        </main>
      </div>
      {isDraggingState && (
        <div className="fixed inset-0 z-50 cursor-col-resize" />
      )}
      <Toaster />
      <GlobalConfirm />
    </div>
  );
}
