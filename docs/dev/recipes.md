# Recipes (frontend)

## Add a user-facing string

1. Pick the feature's namespace in `src/i18n/locales/en/` (or add a new `<ns>.json` file in all four
   locale folders).
2. Add the key to `en`, `tr`, `es` and `zh` in the same change.
3. Use it with `const { t } = useTranslation('<ns>')`, then `t('key')`. Reference another namespace as
   `t('common:retry')`.
4. Run `npm run check:i18n`.

## Add an API call

1. Add a method to the feature's object in `src/services/api.ts`. A call that can go to the local or
   the remote backend takes `scope?: DBScope` and passes `dbCfg(scope, { params, timeout })`.
2. The interceptor unwraps `{"data": …}`, so `res.data` is the payload.
3. Add its types to `src/types/index.ts`. Mark fields the backend may leave out as optional, and
   read lists with `?? []`.
4. Show errors through the backend's `error` text: `e.response?.data?.error || t('…failed')`.

## Add a store

- One zustand store per feature in `src/stores/<feature>Store.ts`.
- Keep request logic in the store or the component and keep stores free of JSX.
- For connection stores:
  - Merge rows from all scopes, de-duplicated by id.
  - Fan out create, update and delete over `availableDBScopes()`.
  - Expose `fetchConnections`.
- Per-viewer UI preferences (a chosen tab or unit) can go in `localStorage` with a `patchman_` key.
  Wrap every access in try/catch.

## Add a panel or tab that loads lazily

```ts
const MyPanel = lazyWithReload(() => import('./MyPanel'));
```

Wrap it in `<Suspense>` like the neighbouring panels. Never use bare `React.lazy`.

## Add a connection tool (frontend side)

The backend side is in [patchman-api `docs/dev/recipes.md`](https://github.com/PttemDev/patchman-api/blob/master/docs/dev/recipes.md). Mirror an existing tool (Kafka, S3, RabbitMQ):

- API object in `services/api.ts` (list, create, update, delete, test, grants), each taking a scope.
- Store with dual-write and a frontend-generated id.
- Sidebar section, connection dialog and share dialog: use `shareScopeFor`, show names with
  `useGrantLabels`.
- The tab component, lazy-loaded.
- i18n in four locales.

## Add an observability provider (frontend side)

- Add it to `src/components/observability/providers.ts` (auth kinds, scope label, help text) and give
  it a glyph in `ProviderGlyph`.
- The service map, table and service detail (`components/servicemap/`) need no changes. They read
  `node.refs` and the backend's `ServiceDetail` shape. Only `hasServiceDetail(node)` decides whether
  the detail button shows.
