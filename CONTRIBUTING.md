# Contributing

Thanks for considering a contribution. This project is small enough that process is mostly
conversational: open an issue describing what you want to do before sending anything non-trivial,
and we'll figure it out together.

## Ground rules

- The server is a **read-only** window onto public procurement APIs (SAM.gov, USAspending, Tango and
  HigherGov). Anything that lets a caller choose the upstream URL, method or headers, or that writes
  to a source, needs an explicit design discussion first.
- **No shared keys.** Provider keys are personal. Don't add any path where one person's key serves
  other people, where the server's own environment keys serve a remote caller, or where a key
  reaches a tool result or a log. Hosted HTTP must keep requiring a verified bearer token on `/mcp`.
- **Never commit or push directly to `main`.** Every change lands through a branch and a pull
  request.
- The tools and their input and output shapes are the contract. A breaking change needs a `!`
  commit or a `BREAKING CHANGE:` footer, which makes the release a major version, and a note in the
  CHANGELOG.
- Add regression tests for authentication, protocol or upstream-behaviour changes, and never weaken a
  failing test to get a green build.
- Keep pull requests focused. Include the problem, the resulting behaviour, meaningful test evidence
  and any unverified integration. A passing mocked suite is not evidence that a provider works live:
  say what you did not check against the real API.
- Do not commit API keys, `.env` files, raw provider responses that hold personal data, or
  production fixtures. Fixtures with federal contacts must use synthetic names and emails.
- The repository is licensed under Apache-2.0 and contributions are provided under that license.
  Preserve third-party attribution (`NOTICE`).

## Development

Node.js 24.11 or later (or 26) and pnpm 12 (pinned by `packageManager` in `package.json`) are
required.

```bash
pnpm install --frozen-lockfile
pnpm typecheck       # tsc --noEmit: src, scripts, web and web/e2e
pnpm lint            # eslint: correctness and security rules, type-aware promise rules in src/
pnpm test            # builds, then tsx --test over src/**/*.test.ts; no keys or network needed
pnpm build           # tsc (dist/) and the Vite build of the landing page (dist/web)
pnpm test:web        # builds the pages and the docs site, then Playwright + axe in Chromium
pnpm kit:check       # the shared portal kit matches web/portal-kit.json
pnpm docs:reference  # regenerate docs/sdk-reference.md (a test fails if it is stale)
pnpm dev             # tsx src/server.ts (stdio); MCP_TRANSPORT=http for HTTP
```

`pnpm test:web` needs Chromium once (`pnpm exec playwright install chromium`) and the documentation
site's own install (`pnpm --dir site install --frozen-lockfile`). To check real provider responses,
use your own keys with `pnpm capture-fixtures` (keep keys in a git-ignored `.env`; it spends a little
of each key's quota, and you must replace any federal contact it captures with synthetic values).

TypeScript 7 runs side by side with the TypeScript 6 API that tooling (typescript-eslint) needs; see
the toolchain notes in `CLAUDE.md` before touching those aliases.

The HTTP tests (`src/http-app.test.ts`, `src/web-pages.test.ts`) exercise the real Express app and
are the canonical end-to-end check: add to them for new HTTP-visible behaviour.

The landing page (`web/`) targets WCAG 2.2 AA and Section 508; see
[docs/accessibility.md](./docs/accessibility.md) for what is tested automatically. Its layout and UI
primitives (`web/src/components/kit`, `components/ui`, `index.css`) are a **kit shared byte for
byte** with BLEN's other MCP servers: product text goes in `web/src/brand.tsx`, and a change to a kit
file is made in the reference server (`uspto-mcp-server`) first and then copied here with
`web/portal-kit.json`.

The documentation site is in `site/` (Astro Starlight). The Docker image builds it and the hosted
server serves it at `/docs` (`src/docs.ts`). It is its own pnpm root with its own lockfile:

```bash
pnpm --dir site install --frozen-lockfile
pnpm --dir site dev       # local preview
pnpm --dir site build     # builds, validates the internal links, and checks the Markdown copies
```

Everything product-specific about the site is in `site/product.mjs` and its pages in
`site/src/content/docs/`. Its Tool reference page is `docs/sdk-reference.md`, generated from the tool
definitions (`pnpm docs:reference`), and its example questions are the files in `examples/`, which
`src/docs-examples.test.ts` checks against each tool's input schema. Edit those sources, not the
generated site. Every claim on the pages (limits, key rules, error shapes) is a fact about `src/`:
change both together, and update `legal/` when authentication or storage changes.

## Releasing

Releases are cut by `.github/workflows/release.yml` on a push to `main`, after the same gates as CI
(`scripts/release-version.ts` picks the version from the commit types). Use
[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `ci:`, ...;
add `!` or a `BREAKING CHANGE:` footer for a major), and never edit versions or tags by hand.
Update `CHANGELOG.md` in the pull request. Actions are pinned to commit SHAs, and Dependabot proposes
updates for npm packages (the server and `site/`), Actions and the Docker base image. Patched
versions of vulnerable transitive dependencies are pinned with `overrides:` in
`pnpm-workspace.yaml`; remove an entry once its parent ships the fix.

## Reporting security issues

See [SECURITY.md](./SECURITY.md). **Do not** open a public issue for authentication or key-exposure
reports.
