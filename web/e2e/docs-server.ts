// Serves the built documentation site (site/dist) the way the hosted server does: through the
// real /docs handler (src/docs.ts), with its CSP, caching and 404 page. Used by
// playwright.config.ts for web/e2e/docs.spec.ts; a plain Node process, so Playwright's teardown
// stops it (Astro's own preview server detaches into its own process group and outlived runs).
//
//   pnpm exec tsx web/e2e/docs-server.ts   (port 4174)
import express from 'express';
import { fileURLToPath } from 'node:url';
import { DOCS_PATH, docsHandler } from '../../src/docs.js';

const root = fileURLToPath(new URL('../../site/dist', import.meta.url));
const handler = docsHandler(root);
if (!handler) throw new Error(`no built documentation site in ${root}: run pnpm --dir site build`);

const app = express();
app.use(DOCS_PATH, handler);
app.listen(4174, '127.0.0.1', () => process.stderr.write('docs server on http://127.0.0.1:4174/docs/\n'));
