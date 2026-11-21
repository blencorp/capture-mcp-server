## What

<!-- One paragraph: the change and its motivation. Link issues. -->

## How

<!-- Implementation notes for a reviewer. Highlight non-obvious decisions. -->

## Test plan

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] If the landing page (`web/`) or docs site (`site/`) changed: `pnpm test:web` passes, and the manual checks in `docs/accessibility.md` were repeated for the changed pages
- [ ] If a portal kit file changed: `pnpm kit:update`, and a follow-up to copy the kit to the other servers
- [ ] If a tool or its arguments changed: ran `pnpm docs:reference`, and updated or added an example in `examples/`
- [ ] If HTTP-visible: added or updated a case in `src/http-app.test.ts` or `src/web-pages.test.ts`
- [ ] No API keys, `.env` files, or captured provider responses in the diff

## Risk

<!-- Security/perf/back-compat impact. "None" is a valid answer when honest. -->
