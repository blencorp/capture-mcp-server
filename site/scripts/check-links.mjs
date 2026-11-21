#!/usr/bin/env node
// Runs after `astro build`. The connect buttons are deep links that no browser test can click,
// so this decodes them from the built pages and checks each one against what its client reads.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { distribution, keyEnv, repo, serverName } from '../product.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(here, '..', path), 'utf8');

// Install buttons and pasted configs exist only for a server published to npm (product.mjs).
if (distribution.npm) {
  const pkg = JSON.parse(read('../package.json'));
  const bundleFile = distribution.mcpb ? /mcpb pack \S+ (\S+\.mcpb)/.exec(pkg.scripts['mcpb:pack'])?.[1] : undefined;
  if (distribution.mcpb) assert.ok(bundleFile, 'package.json mcpb:pack must name the bundle file');

  const server = {
    command: 'npx',
    args: ['-y', pkg.name],
    env: Object.fromEntries(keyEnv.map((name) => [name, ''])),
  };

  const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replaceAll('&amp;', '&'));
  const only = (links, start, page) => {
    const found = [...new Set(links.filter((href) => href.startsWith(start)))];
    assert.equal(found.length, 1, `${page}: expected one distinct ${start} link, found ${found.length}`);
    return found[0];
  };

  const connect = read('dist/connect/index.html');
  for (const page of ['dist/index.html', 'dist/connect/index.html']) {
    const links = hrefs(read(page));

    // Cursor: the name is a parameter, and config is the server object alone, base64-encoded.
    const cursor = new URL(only(links, 'cursor://', page));
    assert.equal(cursor.href.split('?')[0], 'cursor://anysphere.cursor-deeplink/mcp/install', page);
    assert.equal(cursor.searchParams.get('name'), serverName, page);
    assert.deepEqual(JSON.parse(atob(cursor.searchParams.get('config'))), server, page);

    // VS Code: one URL-encoded JSON object with the name inside it.
    const vscode = only(links, 'vscode:', page);
    assert.ok(vscode.startsWith('vscode:mcp/install?'), page);
    assert.deepEqual(JSON.parse(decodeURIComponent(vscode.slice('vscode:mcp/install?'.length))), {
      name: serverName,
      ...server,
    });

    // Claude Desktop: the file name must be the one the release workflow attaches.
    if (distribution.mcpb) {
      const bundle = only(links, `${repo}/releases/`, page);
      assert.equal(bundle, `${repo}/releases/latest/download/${bundleFile}`, page);
    }

    // The home page sends the other clients to sections of the connect page.
    for (const href of links.filter((link) => link.includes('/connect/#'))) {
      const id = href.split('#')[1];
      assert.ok(connect.includes(`id="${id}"`), `${page}: no section "${id}" on the connect page`);
    }
  }

  if (distribution.mcpb) assert.ok(
    read('../.github/workflows/release.yml').includes(bundleFile),
    `release.yml must attach ${bundleFile}: the Claude Desktop button downloads it from the latest release`,
  );
}

// Every page has a Markdown copy where the page actions and the footer link to it.
const { pages, markdownPath } = await import('../src/lib/pages.mjs');
for (const { label, slug } of pages) {
  const copy = read(`dist${markdownPath(slug)}`);
  assert.ok(/^# \S/m.test(copy), `${label}: Markdown copy has no title`);
  const html = read(slug === 'index' ? 'dist/index.html' : `dist/${slug}/index.html`);
  assert.ok(html.includes(`href="/docs${markdownPath(slug)}"`), `${label}: page does not link to its Markdown copy`);
}

console.log('connect links and Markdown copies: ok');
