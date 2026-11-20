# Testing and verification (frontend)

## Before you say "done"

```bash
cd patchman-ui
npx tsc -p tsconfig.app.json --noEmit   # the real typecheck; plain `tsc --noEmit -p .` checks nothing
npx eslint <changed files>              # no new errors
npm run check:i18n                      # en/tr/es/zh in sync (the commit hook runs it too)
```

For a change the user will see, click through it in a browser (below). Report what you actually ran
and what you only reasoned about.

## Click-test against a throwaway backend

1. Start a scratch backend on `:8085`, as described in [patchman-api `docs/dev/testing.md`](https://github.com/PttemDev/patchman-api/blob/master/docs/dev/testing.md). **Never** start it
   from the patchman-api repo root.
2. Start Vite. Its dev server proxies `/api` and `/mock` to `http://localhost:8085`
   (`vite.config.ts`):

   ```bash
   cd patchman-ui && npx vite --port 3100 --strictPort
   ```

   Port 3000 is the default, but another tool may already be using it. Whatever port you pick, add
   the origin to the backend's `ALLOWED_REDIRECT_ORIGINS` and `REALTIME_ALLOWED_ORIGINS`.
3. Register a user in the UI, or with `POST /api/auth/register`, and test the change.

### Gotchas

- **Something already holds the port** (a backend left from an earlier run, another session's Vite).
  You then test old code or a different backend. Check with `lsof -ti :8085 -ti :3100`.
- **A production build calls the backend in `VITE_API_URL`.** If your `.env` or `.env.production`
  sets it, empty it for local builds: `env VITE_API_URL= npx vite build --outDir <scratch>`.
- **Test against fake upstreams.** Integrations (New Relic, GitLab, …) can be tested against small
  fake servers. They must be concurrent (Python `ThreadingHTTPServer`), because panels query in
  parallel.
- **Test the failure path too.** For "works without the VPN / with the backend down", point the
  connection at a dead port, then bring the fake up and check that the UI recovers without a reload.

## Desktop-only behaviour

`tauri dev` is slow and needs signing setup, so test in the web app whenever the behaviour isn't
desktop-specific. For the desktop shell itself:

- `npm run tauri:dev` builds the sidecar and starts the shell. Its `devUrl` must match the Vite port.
- After any change in `src-tauri/`, run `cargo check` inside `src-tauri`.
- The release script runs `scripts/check-sidecar-boot.sh`, which checks that the sidecar starts and
  binds its port even when nothing reads its stdout.
