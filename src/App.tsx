import { useEffect, Component, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { liveSync } from '@/lib/liveSync';
import { useErrorReportStore } from '@/stores/errorReportStore';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/components/auth/LoginPage';
import { RegisterPage } from '@/components/auth/RegisterPage';
import { GitLabOAuthCallback } from '@/components/auth/GitLabOAuthCallback';
import { SSOCallbackPage } from '@/components/auth/SSOCallbackPage';
import { JoinByTokenPage } from '@/components/collections/JoinByTokenPage';
import { JoinEnvironmentByTokenPage } from '@/components/environment/JoinEnvironmentByTokenPage';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
// No-account whiteboard viewer — lazy so Excalidraw stays out of the main chunk.
const PublicWhiteboardPage = lazyWithReload(() => import('@/components/excalidraw/PublicWhiteboardPage'));
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { CommandPalette } from '@/components/common/CommandPalette';
import { PasteHistoryOverlay } from '@/components/paste/PasteHistoryOverlay';
import { DbStatusBanner } from '@/components/common/DbStatusBanner';
import { ErrorReportDialog } from '@/components/common/ErrorReportDialog';
import { SyncPreviewDialog } from '@/components/sync/SyncPreviewDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { usePasteCapture } from '@/hooks/usePasteCapture';
import { useGitLabDeepLink } from '@/hooks/useGitLabDeepLink';
import { useRemoteConnectDeepLink } from '@/hooks/useRemoteConnectDeepLink';
import { useTrayEvents } from '@/hooks/useTrayEvents';
import { isDesktop } from '@/lib/platform';
import { RemoteConnectGate, useBackendGate } from '@/components/RemoteConnectGate';
import { RemoteNoticeBanner } from '@/components/RemoteNoticeBanner';
import { runBackendGuard } from '@/lib/backendGuard';
import { useUpdateChecker } from '@/hooks/useUpdateChecker';
import { initDetachHost } from '@/lib/detach/DetachController';

// React render-time errors. The boundary still has to render *something* in
// place of the broken subtree (you can't unmount the boundary itself), but
// instead of a full-screen wall of red text we render a faint backdrop with
// a "Reload app" escape hatch and surface the error through the same modal
// that catches event-handler / async errors.
// Hook-using fallback rendered by the class ErrorBoundary below (a class can't
// call useTranslation itself). Kept minimal so a render crash can't recurse.
function RenderErrorFallback({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation('app');
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-md px-6">
        <p className="text-sm text-muted-foreground">
          <Trans t={t} i18nKey="renderError.body" components={{ mono: <span className="font-mono" /> }} />
        </p>
        <div className="flex items-center justify-center gap-2 mt-4">
          <Button variant="outline" onClick={onReset}>{t('renderError.tryAgain')}</Button>
          <Button onClick={() => window.location.reload()}>{t('renderError.reload')}</Button>
        </div>
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    useErrorReportStore.getState().report({
      source: 'render',
      message: error.message,
      stack: error.stack,
      location: typeof window !== 'undefined' ? window.location.pathname : undefined,
    });
  }
  reset = () => {
    this.setState({ error: null });
  };
  render() {
    if (this.state.error) {
      return (
        <>
          <RenderErrorFallback onReset={this.reset} />
          <ErrorReportDialog />
        </>
      );
    }
    return this.props.children;
  }
}

// Catch errors that escape React entirely:
//   - throw inside a click handler (React swallows it after re-rendering)
//   - rejected promise with no .catch (e.g. fetch().then(...) chain)
// Mounted at the App root via useEffect so the listeners are attached before
// any tab / dialog can crash.
// Monaco fires these during editor/model teardown races — most notably the
// DiffEditor's "TextModel got disposed before DiffEditorWidget model got reset"
// when the JSON Diff tool unmounts (e.g. switching Dev Tools tabs). They're
// harmless but escape as uncaught errors, so keep them out of the crash dialog.
function isBenignEditorError(message: string): boolean {
  return (
    message.includes('TextModel got disposed') ||
    message.includes('DiffEditorWidget model got reset') ||
    message.includes('Model is disposed') ||
    // A Monaco worker proxy couldn't resolve an optional language-service
    // method (e.g. monaco-yaml's document-link "findLinks" — a monaco-editor
    // 0.55 ↔ monaco-yaml 5.5 interop quirk). The editor stays fully usable —
    // only that one optional feature no-ops — so it must not raise the crash
    // dialog.
    message.includes('Missing requestHandler or method') ||
    message === 'Canceled' ||
    message.startsWith('Canceled:')
  );
}

function GlobalErrorListeners() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const err = event.error as Error | undefined;
      const message = err?.message || event.message || 'Unknown error';
      // Opaque cross-origin errors: the browser strips them to the literal
      // "Script error." with no Error object, filename, or stack (a
      // third-party script, the webview itself, or a worker without CORS).
      // They carry zero actionable information, so surfacing a crash dialog
      // for them is pure noise — drop them. Same for the benign, self-
      // recovering ResizeObserver loop notices some browsers emit.
      const opaque = !err && (message === 'Script error.' || message === '' || !event.filename);
      if (opaque || message.startsWith('ResizeObserver loop') || isBenignEditorError(message)) {
        return;
      }
      useErrorReportStore.getState().report({
        source: 'event-handler',
        message,
        // Fall back to filename:line:col when there's no JS stack, so what
        // does get through stays actionable.
        stack: err?.stack || (event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined),
        location: window.location.pathname,
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : (() => {
                try { return JSON.stringify(reason); } catch { return String(reason); }
              })();
      // Benign cancellations are not app faults, so don't surface a crash
      // dialog: Monaco throws a "Canceled" CancellationError when an editor or
      // model is disposed mid-async (e.g. a tab/response unmounts while it's
      // still loading), and aborted in-flight requests reject with AbortError.
      const rname =
        reason && typeof reason === 'object' && 'name' in reason
          ? String((reason as { name?: unknown }).name ?? '')
          : '';
      if (
        rname === 'Canceled' ||
        rname === 'CancellationError' ||
        rname === 'AbortError' ||
        isBenignEditorError(message)
      ) {
        return;
      }
      useErrorReportStore.getState().report({
        source: 'unhandled-rejection',
        message,
        stack: reason instanceof Error ? reason.stack : undefined,
        location: window.location.pathname,
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();
  const { t } = useTranslation('common');

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t('common:loading')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function App() {
  const { loadUser } = useAuthStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useKeyboardShortcuts();
  usePasteCapture();
  useGitLabDeepLink();
  useRemoteConnectDeepLink();
  useTrayEvents();
  useUpdateChecker();

  // Desktop backend gate: no reachable backend yet (open-source build, no baked
  // URL, no remote chosen) → 'setup'; the active backend is incompatible with
  // no compatible fallback → 'incompatible'. Either blocks the app until resolved.
  const gate = useBackendGate();

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // Once per launch: check the active backend's version/compatibility, discover
  // its tenant config (GitLab host, email domain), and — if it became
  // incompatible — promote a compatible remote or raise the connect gate.
  // Keeps last values when offline (VPN drop).
  useEffect(() => {
    void runBackendGuard();
  }, []);

  // Main-window detach host: reclaims tabs on window close/crash and restores
  // "Detached ↗" placeholders after a reload. Idempotent + no-op in a
  // standalone (detached) window. Runs once per main-window session.
  useEffect(() => {
    initDetachHost();
  }, []);

  // Packaged desktop only: suppress the webview's native right-click menu on
  // EMPTY areas (where only "Inspect Element" / Reload would show) for a native
  // feel — but KEEP it where Copy/Paste/Cut are useful: over an input, textarea,
  // contenteditable or Monaco editor, or when there's a text selection. The
  // app's own menus (DB result table, tab right-click) run their handlers first
  // and are unaffected. Left OFF in `tauri dev` (PROD false) so devtools stay.
  useEffect(() => {
    if (!isDesktop() || !import.meta.env.PROD) return;
    const block = (e: MouseEvent) => {
      const t = e.target as Element | null;
      const editable = !!t?.closest(
        'input, textarea, [contenteditable=""], [contenteditable="true"], .monaco-editor',
      );
      const hasSelection = !!window.getSelection()?.toString().trim();
      if (editable || hasSelection) return; // keep the native copy/paste menu
      e.preventDefault();
    };
    document.addEventListener('contextmenu', block);
    return () => document.removeEventListener('contextmenu', block);
  }, []);

  // Realtime WS lifecycle. Mounted on the App root so it attaches once
  // per session. Subscribes to authStore so a login/logout (or local↔
  // synced flip) re-runs the connect/disconnect decision. Local-mode
  // sessions skip the connection entirely — there's no shared BE to
  // sync with and the user is the only person on their data.
  //
  // Anything the WS layer throws is intentionally swallowed here. Live
  // sync is a nice-to-have on top of the regular REST API — if the
  // socket can't open (no route in this deployment, ingress strips
  // Upgrade, etc.) the app keeps working and the user just falls back
  // to the manual refresh button.
  useEffect(() => {
    const evaluate = () => {
      try {
        const s = useAuthStore.getState();
        if (s.isAuthenticated && s.mode === 'synced' && s.token) {
          liveSync.connect();
        } else {
          liveSync.disconnect();
        }
      } catch (e) {
        console.warn('[liveSync] connect/disconnect threw, ignoring', e);
      }
    };
    evaluate();
    const unsub = useAuthStore.subscribe(evaluate);
    return () => {
      unsub();
      try { liveSync.disconnect(); } catch { /* ignore */ }
    };
  }, []);

  return (
    <ErrorBoundary>
      <GlobalErrorListeners />
      <ErrorReportDialog />
      <TooltipProvider>
        {/* Desktop-only invisible drag strip for screens without the app's
            own titlebar (login / register / OAuth callbacks / connect gate) —
            the OS window has no chrome there, so give the user an empty band
            at the very top to drag the window by. Skipped once the authed
            TopBar is present (it owns the drag region) so this never overlays
            its right-side controls. No-op in the browser build. */}
        {isDesktop() && (!isAuthenticated || gate.show) && (
          <div data-tauri-drag-region aria-hidden className="fixed top-0 inset-x-0 h-8 z-50" />
        )}
        {gate.show ? (
          <RemoteConnectGate reason={gate.reason} />
        ) : (
        <>
        <RemoteNoticeBanner />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          {/* OAuth callback for GitLab integration. Public — runs no auth check
              because the user is mid-redirect; it only stashes code+state for
              the originating tab and closes. */}
          <Route path="/auth/gitlab/callback" element={<GitLabOAuthCallback />} />
          {/* Shareable collection join URL. The page itself bounces to
              /login when not authenticated and resumes via ?next=. */}
          <Route path="/join/:token" element={<JoinByTokenPage />} />
          {/* Shareable environment join URL — same login-bounce
              pattern, but POSTs to the env collab endpoint and routes
              the user to the env manager on success. */}
          <Route path="/join/env/:token" element={<JoinEnvironmentByTokenPage />} />
          {/* No-account whiteboard share link — fully public, resolves the
              token itself and renders read-only or (editor link) read-write. */}
          <Route
            path="/wb/:token"
            element={
              <Suspense fallback={<div className="h-screen flex items-center justify-center text-sm text-muted-foreground">…</div>}>
                <PublicWhiteboardPage />
              </Suspense>
            }
          />
          {/* SSO sign-in callback — public route that finalises the
              OAuth round-trip and stores the JWT. */}
          <Route path="/auth/sso/callback" element={<SSOCallbackPage />} />
          {/* Admin dashboard. ProtectedRoute checks auth; the dashboard
              itself checks user.role === 'admin' and renders an
              "access denied" message otherwise so a non-admin can't
              guess the URL into the panel. */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          />
        </Routes>
        <CommandPalette />
        <PasteHistoryOverlay />
        <SyncPreviewDialog />
        <DbStatusBanner />
        </>
        )}
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
