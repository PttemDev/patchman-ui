# PatchMan frontend and desktop: developer guide

Read this before you change the frontend, the desktop shell or a release, whether you are a person or
an AI agent. It lists what the code relies on but does not enforce, so a careless change breaks it
quietly.

PatchMan is two repositories that ship together:

| Repo | What | Guide |
|---|---|---|
| `patchman-api` | Go API: gin + gorm, PostgreSQL (server) or SQLite (embedded), MCP server | [`docs/dev/`](https://github.com/PttemDev/patchman-api/blob/master/docs/dev/README.md) |
| `patchman-ui` (this one) | React + TypeScript web app, Tauri desktop shell, release pipeline | `docs/dev/` |

## Contents

- [architecture.md](architecture.md): app structure, the two backends, the desktop shell.
- [rules.md](rules.md): invariants. Breaking one ships a bug. **Read it first.**
- [recipes.md](recipes.md): add a string, an API call, a store, a lazy panel, a connection tool.
- [testing.md](testing.md): what to run before you say "done", and how to click-test locally.
- [release.md](release.md): version bump, changelog, signed builds, tags and GitHub Releases.

## The six rules people break most

1. **Every user-facing string goes through `t()`, in all 4 locales** (en, tr, es, zh). The pre-commit
   hook blocks a commit whose locales are out of sync.
2. **Typecheck with `npx tsc -p tsconfig.app.json --noEmit`.** Plain `tsc --noEmit -p .` checks
   nothing.
3. **Connections are dual-written**: create, update and delete fan out to every reachable backend,
   with a frontend-generated id.
4. **Every `React.lazy` uses `lazyWithReload`**, or a deploy breaks tabs that are already open.
5. **Never point the Tauri `beforeBuildCommand` at plain `npm run build`.** Old DMGs would be embedded
   in the binary.
6. **Every release bumps the version in all 5 files and adds a changelog entry**
   ([release.md](release.md)).
