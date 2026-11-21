import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { Plugin } from 'vite';

const MARKER = `${sep}node_modules${sep}`;

/** The package directory of a module id inside node_modules, keyed by package name. */
function packageOf(id: string): [string, string] | undefined {
  const i = id.lastIndexOf(MARKER);
  if (i < 0) return undefined;
  const rest = id.slice(i + MARKER.length).split(sep);
  const name = rest[0]!.startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]!;
  return [name, id.slice(0, i + MARKER.length) + name.split('/').join(sep)];
}

/**
 * The directory of package `name` as Node resolves it from `from`: the nearest
 * node_modules/<name> up the tree. Reading its package.json directly works even for packages
 * whose `exports` do not expose it.
 */
function packageDir(from: string, name: string): string {
  for (let dir = dirname(from); ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', ...name.split('/'));
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) throw new Error(`third-party-notices: cannot find ${name} from ${from}`);
  }
}

/**
 * Vite plugin: records every npm package whose code ends up in the portal and writes their
 * license texts to THIRD_PARTY_NOTICES.txt next to the assets, so redistributing the bundle
 * (npm, Docker, MCPB) carries the notices the licenses require.
 *
 * JavaScript comes from the module graph. Stylesheets are read too: Tailwind's Vite plugin
 * resolves `@import 'tailwindcss'` and `@import 'tw-animate-css'` itself, outside that graph, yet
 * both packages' CSS is in the built stylesheet.
 */
export function thirdPartyNotices({ stylesheets = [] as string[], fileName = 'THIRD_PARTY_NOTICES.txt' } = {}): Plugin {
  return {
    name: 'third-party-notices',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const roots = new Map<string, string>();
      const ids = new Set<string>(this.getModuleIds());
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') for (const id of Object.keys(chunk.modules)) ids.add(id);
      }
      for (const id of ids) {
        const found = packageOf(id);
        if (found) roots.set(...found);
      }
      for (const stylesheet of stylesheets) {
        for (const [, spec] of readFileSync(stylesheet, 'utf8').matchAll(/@import\s+['"]([^'"./][^'"]*)['"]/g)) {
          const name = spec!.startsWith('@') ? spec!.split('/').slice(0, 2).join('/') : spec!.split('/')[0]!;
          roots.set(name, packageDir(stylesheet, name));
        }
      }
      const out: string[] = ['Third-party software included in the web portal bundle.', ''];
      for (const [name, dir] of [...roots].sort(([a], [b]) => a.localeCompare(b))) {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: string; license?: string };
        const file = existsSync(dir) ? readdirSync(dir).find(f => /^(licen[cs]e|copying|notice)(\.|$)/i.test(f)) : undefined;
        out.push('='.repeat(78), `${name}@${pkg.version ?? '?'} — ${pkg.license ?? 'see package'}`, '='.repeat(78));
        out.push(file ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${pkg.license ?? 'UNKNOWN'} (no license file shipped by the package)`, '');
      }
      this.emitFile({ type: 'asset', fileName, source: out.join('\n') });
    },
  };
}
