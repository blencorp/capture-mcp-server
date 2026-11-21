// Everything product-specific about this documentation site, in one place. The site is shared
// by BLEN's MCP servers: to reuse it, change this file and the pages in src/content/docs/.
// Read by astro.config.mjs, src/lib/install.ts and scripts/ (check-links, render-og,
// sync-reference).

export const productName = 'Capture MCP';
/** Where the hosted server serves this site (src/docs.ts serves it at `base`). */
export const site = 'https://capture.mcp.blencorp.com';
export const base = '/docs';
export const repo = 'https://github.com/blencorp/capture-mcp-server';
export const packageName = '@blen/capture-mcp-server';
/**
 * How people can run the server. `npm`: a published package that desktop clients start with npx
 * (the install buttons and pasted configs on the overview and connect pages). `mcpb`: a Claude
 * Desktop bundle attached to each GitHub release. A hosted-only server sets both to false: llms.txt
 * then omits the npm link, scripts/check-links.mjs skips the install checks, and its overview and
 * connect pages must not use the install helpers in src/lib/install.ts (they describe connecting
 * to the hosted URL only).
 */
export const distribution = { npm: false, mcpb: false };
/** The key a client config uses for this server (Cursor, VS Code, mcpServers). */
export const serverName = 'capture';
export const description =
  'Connect an AI assistant to SAM.gov, USAspending, Tango, and HigherGov federal procurement data with the Capture MCP server.';
/** The line under the name on the link-preview image, and its alt text. */
export const tagline = 'Ask your AI assistant about federal procurement.';
/** Environment variables a desktop install sets, with blank values (the server explains each). */
export const keyEnv = ['SAM_GOV_API_KEY', 'TANGO_API_KEY', 'HIGHERGOV_API_KEY'];
/** Example values shown in a pasted config. */
export const exampleKeyValues = {
  SAM_GOV_API_KEY: 'your-sam-gov-key',
  TANGO_API_KEY: 'your-tango-key',
  HIGHERGOV_API_KEY: 'your-highergov-key',
};
/** What llms.txt says about the product, above the page list. */
export const llmsDetails = [
  'Run it from source with your own SAM.gov, Tango, and HigherGov API keys, or connect an assistant to the hosted server and enter your keys when it asks. There are no accounts.',
  'It has 34 narrow tools over five sources: a static FPDS reference table, USAspending (no key), SAM.gov, Tango, and HigherGov. A tool works with the key for its own source.',
  'Each page below is also available on its own, as Markdown.',
].join('\n');

/**
 * Sidebar and page-title overrides by slug (see src/lib/pages.mjs). This server has narrow tools
 * and no code sandbox, so the recipe and SDK pages are named for what they hold. Each page's own
 * title is set in its frontmatter.
 */
export const pageLabels = {
  recipes: 'Example questions',
  'reference/sdk': 'Tool reference',
};
