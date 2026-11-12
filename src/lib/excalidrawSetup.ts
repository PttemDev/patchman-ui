// Serve Excalidraw's fonts from our own /excalidraw-assets/ (copied into
// public/ from @excalidraw/excalidraw) instead of the default CDN, so the
// hand-drawn fonts render offline in the packaged desktop app — same offline
// story as monacoSetup. Must run before the (lazy) Excalidraw chunk builds any
// font URL. The CJK "Xiaolai" family is intentionally not bundled (12 MB); CJK
// hand-drawn text falls back to a system font offline. Excalidraw's own UI stays
// English (we pass no langCode), so its locale files are never fetched.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

if (typeof window !== 'undefined') {
  window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
}

export {};
