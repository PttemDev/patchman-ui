import { create } from 'zustand';
import { reportCrash, type ReportSource } from '@/lib/errorReporter';

/**
 * Source of the error so the modal can adjust copy ("a render crash" vs
 * "an unexpected error in an action") and so the report tells the support
 * channel what category of bug this is.
 */
export type ErrorSource =
  | 'render'              // caught by React ErrorBoundary in App.tsx
  | 'event-handler'       // window.onerror — sync error during a click/keydown/etc.
  | 'unhandled-rejection' // window.onunhandledrejection — promise without .catch
  | 'manual';             // a component called report() directly

// Translate the local ErrorSource (kept stable for UI copy + history) to
// the wire-level source the BE → Slack pipeline expects.
function toReportSource(s: ErrorSource): ReportSource {
  switch (s) {
    case 'render': return 'boundary';
    case 'event-handler': return 'window';
    case 'unhandled-rejection': return 'rejection';
    case 'manual': return 'manual';
  }
}

export interface ErrorReport {
  id: string;
  source: ErrorSource;
  message: string;
  stack?: string;
  // Where in the app the user was when it broke. Filled in by the listener
  // when location/route info is available.
  location?: string;
  occurredAt: string;
  // Stable signature so we de-dupe a render error that fires repeatedly
  // (React tries the failing tree multiple times in dev). Without this, the
  // store thrashes between "show new error" and "user already saw this".
  signature: string;
}

interface ErrorReportState {
  current: ErrorReport | null;
  // Most recent N errors we've seen this session — kept for the "see prior
  // errors" use case if we want a debug surface later. Capped to avoid
  // memory creep on a flaky page that throws on every render.
  history: ErrorReport[];
  report: (
    input: {
      source: ErrorSource;
      message: string;
      stack?: string;
      location?: string;
    },
  ) => void;
  dismiss: () => void;
}

const HISTORY_CAP = 20;

function signatureOf(message: string, stack: string | undefined): string {
  // Use the message + the first stack frame (which is the throw site). Two
  // errors with the same message but different origins should still surface
  // separately, but the same error firing twice in a row should de-dupe.
  const firstFrame = (stack || '').split('\n').find((line) => line.trim().length > 0) || '';
  return `${message}::${firstFrame}`.slice(0, 256);
}

export const useErrorReportStore = create<ErrorReportState>((set, get) => ({
  current: null,
  history: [],
  report: ({ source, message, stack, location }) => {
    const signature = signatureOf(message, stack);
    const now = new Date().toISOString();
    const existing = get().current;
    // De-dupe: if the modal is already showing this exact error, don't replace
    // it — the user is mid-read and we'd flicker the dialog.
    if (existing && existing.signature === signature) return;

    const entry: ErrorReport = {
      id: crypto.randomUUID(),
      source,
      message,
      stack,
      location,
      occurredAt: now,
      signature,
    };
    set((state) => ({
      current: entry,
      history: [entry, ...state.history].slice(0, HISTORY_CAP),
    }));

    // Fire-and-forget Slack forward. The BE checks the per-source toggle
    // before posting; a disabled source returns 204 silently. Errors are
    // swallowed inside reportCrash so they don't loop back into the
    // listeners that called us.
    reportCrash({
      source: toReportSource(source),
      message,
      stack,
      route: location,
    });
  },
  dismiss: () => set({ current: null }),
}));
