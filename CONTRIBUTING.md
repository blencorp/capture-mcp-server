# Contributing

Thanks for considering a contribution. This project is small enough that
process is mostly conversational — open an issue describing what you want
to do before sending anything non-trivial, and we'll figure it out together.

## Ground rules

- The server's whole reason for existing is to be a safe place to run untrusted
  JavaScript against the public USPTO APIs. **Anything that weakens the sandbox is
  out of scope.** That includes adding `fetch`, `import`, filesystem, env,
  or subprocess access to the sandbox surface.
- New SDK methods are welcome but must be paired with field/endpoint entries
  in the corpus so `search_api` and `describe_schema` can surface them. Each
  source owns its own file — `schema/{odp,tsdr}.json` — so add a hand-written
  endpoint entry (signature, description, example) to the file for the source
  you're touching, with an example that runs against the live API, then run
  `node scripts/gen-sdk-reference.mjs` (a test fails if `docs/sdk-reference.md` is
  stale). Don't hand-edit the generated `<binding>.fields.*` entries; regenerate them:
  `pnpm build`, then `USPTO_API_KEY=... node scripts/capture-samples.mjs <dir>` and
  `node scripts/gen-fields.mjs --source live=<dir> --source patent-dev=<dir>` (see
  `scripts/field-samples.json`). Never commit captured responses: they are public
  records that contain names and addresses.
  Explicitly register each callable method in the source factory's `methods`
  table as well. RPC dispatch only invokes registered methods; never expose a
  generic HTTP client, cache, or other host implementation detail there.
- File downloads (PDFs, bulk files, `search/download` CSV) stay out of the SDK;
  return URLs instead.
- Respect USPTO's limits: one request in flight per API key, and at least 5 s after
  a `429`. Don't raise the default per-key concurrency or shorten the 429 pause.
- USPTO keys are personal ("Do not share it with others"). Don't add any path where
  one person's key serves other people.
- Authenticated HTTP serving runs user code only in a separate process (the Deno
  runner); don't add an in-process fallback there.
- Public API shape (the three tools, the `odp.*` / `tsdr.*` globals) is the
  contract; breaking changes need a major version bump and a migration note.

## Development

```bash
pnpm install
pnpm test                       # vitest, ~15 s; no keys or network needed
pnpm typecheck                  # tsc --noEmit (src, test, web, web/e2e)
pnpm lint                       # eslint: correctness and security rules, type-aware in src/
pnpm test:web                   # Playwright + axe: portal and docs accessibility (builds both first)
pnpm kit:check                  # the shared portal kit matches web/portal-kit.json
pnpm dev                        # tsx src/bin.ts (stdio)
pnpm dev --http --insecure      # local HTTP, no auth, bound to 127.0.0.1
pnpm build                      # tsc + Vite (dist/web) + chmod
USPTO_LIVE=1 pnpm test:live     # opt-in: every corpus example against the real USPTO APIs
```

Node 24 or 26 and pnpm 12 (pinned in `package.json`) are required. `pnpm test:web` needs
Chromium once: `pnpm exec playwright install chromium`; with `TEST_DATABASE_URL` set it also
runs the signed-in journey against a real server (needs Deno). TypeScript 7 runs side by side with the TS 6 API that
tooling (typescript-eslint) needs — see the TS 7 notes in `CLAUDE.md`.

Account-mode tests (`test/accounts.spec.ts`) need Deno and a disposable
PostgreSQL in `TEST_DATABASE_URL`; see [docs/accounts.md](docs/accounts.md#verification-and-rollout)
for a one-line Docker setup. Set `USPTO_REQUIRE_RUNNERS=1` (as CI does) to make
missing runners or a missing database fail instead of skip. Live checks need your
own `USPTO_API_KEY` / `USPTO_TSDR_API_KEY` (keep them in a gitignored `.env`; the
live suite is read-only, sequential and small, and never runs in PR CI). Never
commit keys.

The portal (`web/`) targets WCAG 2.2 AA and Section 508; see
[docs/accessibility.md](docs/accessibility.md) for what is tested automatically and the manual
checks. Its layout, landing page and UI primitives (`web/src/components/kit`, `components/ui`,
`index.css`) are a kit shared byte for byte with BLEN's other MCP servers: product text goes in
`web/src/brand.tsx`, and after changing a kit file run `pnpm kit:update` and copy the files and
`web/portal-kit.json` to the other servers.

The documentation site is in `site/` (Astro Starlight). The Docker image builds it and the
hosted server serves it at `/docs` (`src/accounts/docs.ts`), so it deploys with the server;
the CI Docker job builds it on every pull request. It is its own pnpm root with its own
lockfile, so the server's install and audit never see its packages:

```bash
cd site
pnpm install
pnpm dev      # local preview
pnpm build    # builds, validates the internal links, and checks the connect buttons
pnpm og       # renders public/og.png, the picture shown with a shared link
```

Everything product-specific about the site is in `site/product.mjs`.
Its SDK reference page is `docs/sdk-reference.md`, copied in at build time, and its
recipes are the files in `examples/`. Edit those sources, not the site.

The HTTP integration test (`test/http-integration.spec.ts`) exercises a real
`http.Server` against the v2 SDK's `createMcpHandler`/`toNodeHandler` over `fetch`,
covering both the stateless `2026-07-28` leg and the legacy `initialize` fallback,
including sandbox → SDK → mocked upstream. That's the canonical end-to-end check;
please keep it green and add to it for new HTTP-visible behavior.

`test/official-client.spec.ts` drives the same server with the real
`@modelcontextprotocol/client` SDK, which builds the `_meta` envelope and routing
headers itself — keep it passing whenever you touch the transport, since hand-built
requests cannot catch a protocol misunderstanding shared by both sides.

## Sandbox runners

- `isolated-vm` 7 ships prebuilt binaries for Node 24 and 26 (macOS arm64, Linux
  x64/arm64 glibc and musl, Windows x64); `pnpm install` needs no compiler.
- The Deno runner starts `deno run --no-prompt` (no permissions) on a fixed
  supervisor script and runs the user code in a Worker with its ambient globals
  removed; the host owns the deadline and kills the process group. Install Deno to
  test that path: <https://docs.deno.com/runtime/getting_started/installation/>.
- `pickSandbox('auto')` prefers `isolate`, then `deno`, for single-user use. For
  authenticated HTTP serving it allows only `deno` (and refuses `--sandbox isolate`).
  With no runner, `execute` returns `SandboxUnavailable`.
- Sandbox changes need positive AND negative tests for both runners
  (`test/sandbox.spec.ts` runs its contract with `describe.each`). For lifecycle
  fixes, check that the new test fails without the fix.

## What needs work

- Live TSDR captures for the trademark field dictionary (needs a TSDR key).
- Distributed per-key admission for multi-replica deployments (today: one replica).
- A small Cloudflare Workers deploy target sharing the core logic (today the
  HTTP transport is Node-only).
- Trademark (TTAB) decisions and proceedings, once USPTO publishes a public API spec.

## Releasing

Releases are **continuous** (`.github/workflows/release.yml`): every push to
`main` that can change what users install is released — there is no Release PR
and no batching.

1. Land changes on `main` **via pull request** (never a direct push) using
   [Conventional Commits](https://www.conventionalcommits.org/)
   (`feat:`, `fix:`, `docs:`, `ci:`, …; add `!` or a `BREAKING CHANGE:` footer
   for majors; CI enforces the format). The commits since the last tag decide
   whether there is a release at all, then the next SemVer version:
   - **No release** when every commit is `build`, `chore`, `ci`, `docs`, `style`
     or `test`, none of them touches a shipped path, and `package.json` changed in
     no shipped field. The workflow reports `released=false` and nothing is
     tagged or published; those commits ship with the next release and appear in
     its CHANGELOG section. This is what Dependabot's dev-tooling (`build(deps-dev)`),
     `site/` and Docker base-image (`build(deps)`) and Actions (`ci(deps)`) PRs are.
   - **Release** for anything else: `feat`, `fix`, `perf`, `revert`, `refactor`
     (it rewrites shipped code, so it releases even without a behavior change),
     a breaking change of any type, or a non-conventional subject. Then breaking →
     major, `feat` → minor, everything else → patch.
   - **Shipped paths** release whatever the commit type: `src/`, `web/`, `legal/`
     (bundled into the portal), `schema/`, `tsconfig.json`, `tsconfig.build.json`,
     `LICENSE`, `NOTICE`, `.pnpmfile.cjs` and `scripts/mcpb-prepare.mjs` (the
     Claude Desktop bundle). So does a change to a `package.json` field other than
     `version`, `devDependencies` and `packageManager`, including any script except
     the dev-only ones (`dev`, `dev:web`, `test`, `test:watch`, `test:live`, `lint`,
     `typecheck`): `build`, `build:web` and `prepack` decide `dist/`. A runtime
     dependency bumped under a `build(deps)` subject therefore still releases
     (Dependabot uses `fix(deps)` for those).
   - **The bundle's production dependencies.** The MCPB bundle installs
     `pnpm-lock.yaml` with the `overrides:` in `pnpm-workspace.yaml`, so
     `release.mjs` compares the lockfile's production tree at the last tag with HEAD
     (`pnpm ls --prod --lockfile-only`, from git, no install). A changed package there
     releases, e.g. a transitive security fix landed as a lockfile-only or
     `overrides:`-only commit. Dev-tooling lockfile churn does not. The lists and
     checks live in `scripts/release-lib.mjs` (`NO_RELEASE_TYPES`, `SHIPPED_PATHS`,
     `DEV_ONLY_SCRIPTS`, `changedManifestFields`, `productionPackages`).
   - **Not shipped, by decision:** `README.md`, `SECURITY.md` and the docs (the npm
     page's README refreshes with the next release); `deploy/` (the Docker image is
     built from the repository by the deployment, never by `release.yml`); `site/`,
     `test/`, `.github/`.
   - A dev-tooling bump can still change the build output (TypeScript, Vite, or a
     library bundled into the portal such as React). To ship one right away, run
     the release workflow from `main` (**Actions → release → Run workflow**) with
     **force** checked: it releases the pending commits as a patch.
2. On push, the `gates` job runs the complete CI workflow on that commit (audit,
   typecheck, lint, build, tests on Node 24 and 26 with Postgres and both sandbox
   runners, the npm-package/MCPB smoke test and the Docker smoke test). Then the
   `cut` job (`contents: write`, dependencies installed with `--ignore-scripts`)
   runs `scripts/release.mjs`, which computes the version, stamps `package.json`
   and the `x-release-version` marker lines in `src/server/mcpServer.ts` and
   `src/sdk/bindings.ts`, and prepends the CHANGELOG section (logic in
   `scripts/release-lib.mjs`, covered by `test/release.spec.ts`); it builds, packs
   the tarball, pushes a `chore(release): vX.Y.Z` commit with the annotated tag,
   and creates the GitHub Release with the tarball and the Claude Desktop bundle
   (`uspto-mcp-server.mcpb`, which the documentation site's download button links to) attached. `main` requires PRs,
   so the release commit is pushed as the org's release GitHub App, the ruleset's
   only bypass actor (contents: write on this repository only). Its key is the
   `RELEASE_APP_PRIVATE_KEY` secret and its client ID the `RELEASE_APP_CLIENT_ID`
   variable, both in the `release` environment (deployable from `main` only); the
   job mints a short-lived token just before the push and uses it only there.
   App-token pushes trigger workflows, so the release commit's own run skips
   on its `chore(release):` subject, and `release.mjs` ignores such commits (and
   the files they touch): no release loop. A run with nothing to release still
   runs the gates and builds, but stops before tagging and publishing.
3. The `publish` job — holding only `id-token: write`, in the `npm` environment
   (deployments allowed from `main` only) — downloads that exact tarball and
   publishes it with `npm publish --provenance`. It never checks out the
   repository or installs dependencies. No manual step: a merge to `main` that
   passes the gates is on npm a few minutes later.
4. **Recovery**: `gh workflow run release.yml --ref main -f republish=true`
   re-runs the gates and publishes the *current* version to npm (no bump,
   no tag) — for when a publish failed after a tag already existed.

Publishing is **tokenless** via [npm Trusted
Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC): the npm
package settings register this repo's `release.yml` (and the `npm` environment) as
a trusted publisher (allowed to `npm publish`), so no npm token or secret exists
anywhere and nothing but this workflow on `main` can publish; the job's
`id-token: write` permission is what authenticates, and provenance is attached
(`--provenance`). Workflow actions are pinned to commit SHAs; Dependabot
(`.github/dependabot.yml`) proposes updates for npm packages (server and `site/`),
actions and the Docker base images. Patched versions of vulnerable transitive dev dependencies are
pinned with `overrides:` in `pnpm-workspace.yaml`; remove an entry once its parent
ships the fix. An advisory with no patched release is listed under
`auditConfig.ignoreGhsas` there (and in `site/pnpm-workspace.yaml`), for dev tooling only,
with a row in `test/audit-exceptions.spec.ts`, which fails if such a package becomes a
production dependency. The daily `security` workflow flags an exception once its advisory
is withdrawn or gets a fix; then remove it.
The `files` field in `package.json` ships only `dist/`, `schema/`,
`README.md`, `LICENSE`, `NOTICE`, `CHANGELOG.md`, and `SECURITY.md`.

Breaking changes additionally need a migration note in `docs/`.

**First release.** This package starts at `0.1.0`. With no tags in the repository,
`scripts/release.mjs` releases the version `package.json` already declares, using
its hand-written `CHANGELOG.md` section (no bump, no release commit), and tags it.
npm only offers trusted-publisher settings for a package that exists, so the very
first version was staged once by a maintainer from the GitHub Release tarball
(`npm stage publish <tgz> --access public`, then approved with 2FA); after that,
the trusted publisher (environment `npm`) took over.

## Reporting security issues

See [SECURITY.md](./SECURITY.md). **Do not** open a public issue for
sandbox-escape reports.
