# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Use GitHub's private reporting instead: open the **Security** tab of this repository and choose **Report a vulnerability**. Include the affected version or commit, steps to reproduce, and the impact you observed.

We will acknowledge your report and keep you updated as we investigate and fix the issue.

## Known limitations

`npm audit` currently reports no critical or high severity advisories. A small number of moderate and low severity advisories remain in third-party dependencies where the fix requires a major upgrade or is not available yet:

- `react-router-dom` 6.x (open-redirect advisories fixed in 7.x)
- `katex` (low), pulled in by `mermaid`, and `@excalidraw/*` (low)
- `typescript-eslint` and `minimatch`, which are development-only tooling and are not part of the shipped bundle

Run `npm audit` for the current list.

## Deployment notes

- Configuration values prefixed with `VITE_` are embedded in the public JavaScript bundle. Never put secrets in them.
- Serve the UI over HTTPS and keep the backend API behind authentication.
- Desktop release signing keys (`src-tauri/.keys/`) and notarization credentials must never be committed.
