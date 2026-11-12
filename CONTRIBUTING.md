# Contributing to PatchMan UI

Thanks for helping out. Bug reports, fixes, new connection types and translations are all welcome.

## Setup

PatchMan needs the backend from [patchman-api](https://github.com/PttemDev/patchman-api). Clone both repositories next to each other and follow the **Quick start** in the [README](README.md).

```bash
npm ci
npm run dev        # http://localhost:3000, proxies /api to localhost:8085
```

## Before you open a pull request

```bash
npm run build          # tsc -b && vite build
npm run check:i18n     # every UI string must exist in en / tr / es / zh
npm run lint
```

- Every user-facing string goes through `react-i18next` (`t()`), with translations in all four locales. `npm run check:i18n` fails otherwise.
- `npm install` enables the repository's pre-commit hook (`.githooks/pre-commit`), which runs the i18n check.
- Keep changes focused. One pull request per fix or feature makes review faster.
- Use demo data in screenshots and examples. Never commit secrets, tokens or internal hostnames.

## Pull request flow

1. Fork the repository and create a branch from `master`.
2. Make your change and run the checks above.
3. Open a pull request that explains what changed and why. Link the issue if there is one.

## Reporting bugs and security issues

Open an issue for bugs and feature requests. Please report security problems privately, as described in [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
