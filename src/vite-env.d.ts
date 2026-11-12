/// <reference types="vite/client" />

// Compile-time constant injected by vite.config.ts. Short git SHA of the
// build, attached to crash reports so we can map a Slack message back to
// the exact code that shipped.
declare const __BUILD_COMMIT__: string;
