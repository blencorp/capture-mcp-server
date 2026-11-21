import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, type Plugin, type ResolvedConfig } from 'vite';

/** What the entry module exports: the page for a URL path, as markup plus its tab title. */
type Render = (path: string) => { html: string; title: string };

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Vite plugin: after the client build, renders chosen routes with React's server renderer and
 * writes each to `<outDir>/<file>` as the built index.html with the markup inside `#root` and the
 * tab title set. The pages read without JavaScript (crawlers, link checkers, curl, directory
 * reviewers); with it, `hydrateRoot` takes over the same markup (see main.tsx).
 *
 * This is Vite's documented SSG recipe: the entry is built with `build.ssr` by the same config
 * (so aliases, `?raw` imports and hashed asset URLs resolve exactly as in the client bundle), then
 * imported and called. The SSR output goes to a scratch directory beside `outDir` (so Node finds
 * the project's node_modules) and is removed afterwards, so only the HTML files are added.
 *
 * `entry` exports `render(path)`; `routes` maps each output file to the URL path it renders.
 * Nothing is inline: the page CSP stays `script-src 'self'`.
 */
export function prerender({ entry, routes }: { entry: string; routes: Record<string, string> }): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'prerender',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      if (config.build.ssr) return; // the nested build below
      const outDir = resolve(config.root, config.build.outDir);
      const scratch = mkdtempSync(join(resolve(outDir, '..'), '.prerender-'));
      try {
        await build({
          configFile: config.configFile,
          logLevel: 'warn',
          build: {
            ssr: resolve(config.root, entry),
            outDir: scratch,
            emptyOutDir: true,
            ssrEmitAssets: false,
            rollupOptions: { output: { entryFileNames: 'entry.mjs' } },
          },
        });
        const { render } = (await import(pathToFileURL(join(scratch, 'entry.mjs')).href)) as { render: Render };
        const template = await readFile(join(outDir, 'index.html'), 'utf8');
        for (const [file, path] of Object.entries(routes)) {
          const { html, title } = render(path);
          if (!/<h1[\s>]/.test(html) || !html.includes('<main')) throw new Error(`prerender: ${path} rendered no h1 and main`);
          const page = template
            .replace('<div id="root"></div>', () => `<div id="root">${html}</div>`)
            .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
          if (page === template) throw new Error(`prerender: index.html has no empty #root for ${path}`);
          await writeFile(join(outDir, file), page);
        }
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    },
  };
}
