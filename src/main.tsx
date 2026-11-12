// Initialize i18n (react-i18next) FIRST — before any other module runs, so the
// fresh-install language detection reads localStorage while it's still the
// on-disk state (a returning user's keys are already present; a genuine first
// run sees it empty). See src/i18n/index.ts.
import './i18n'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Monaco setup + custom languages now load lazily with the first editor (via
// the CodeEditor wrapper → monacoBootstrap), so the ~10MB Monaco library stays
// out of the eager entry bundle instead of loading on every page (incl. login).
// Point Excalidraw at self-hosted fonts (public/excalidraw-assets) so whiteboards
// render their hand-drawn fonts offline. Side-effect; must precede any Excalidraw load.
import './lib/excalidrawSetup'
import App from './App'
import { StandaloneTab } from './components/request/StandaloneTab'
import './index.css'
// Side-effect import: registers the workspace → collections subscription so
// switching workspaces always triggers a collection refetch, independent of
// which components are mounted.
import './stores/storeWiring'
// Disable browser autocorrect / auto-capitalize / spellcheck on every text
// field (raw ones too — the URL bar, body editors, search boxes) so WKWebView
// stops "helpfully" capitalizing URLs/JSON/tokens as users type.
import { installTextFieldDefaults } from './lib/textFieldDefaults'
// Horizontal trackpad swipe scrolls long single-line fields (WebKit doesn't).
import { installInputWheelScroll } from './lib/inputWheelScroll'

installTextFieldDefaults()
installInputWheelScroll()

// Detach-tab boot mode: when the document was opened with `?detached=<tabId>`
// (a torn-off tab window), render that ONE tab full-window instead of the
// full <App/>. Still inside BrowserRouter + the same global providers, and
// gated by the shared-storage auth session (see StandaloneTab). The
// side-effect imports above (storeWiring, textFieldDefaults) still run so store
// wiring behaves identically; Monaco loads lazily on first editor as elsewhere.
const detachedTabId = new URLSearchParams(window.location.search).get('detached')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {detachedTabId ? <StandaloneTab tabId={detachedTabId} /> : <App />}
    </BrowserRouter>
  </React.StrictMode>,
)
