import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash } from 'node:crypto';
import { get } from 'node:http';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { docsHandler } from './docs.js';

// The docs are served from the same origin as the landing page, so their CSP allows inline
// scripts only by hash.
test('serves the built site with hashed inline scripts, caching, and no escape from its root', async () => {
  assert.equal(docsHandler(mkdtempSync(join(tmpdir(), 'docs-empty-'))), undefined);

  const parent = mkdtempSync(join(tmpdir(), 'docs-site-'));
  const root = join(parent, 'site');
  mkdirSync(root);
  const inline = "document.documentElement.dataset.theme='dark'";
  writeFileSync(join(root, 'index.html'), `<html><script>${inline}</script><script src="/docs/_astro/a.js"></script></html>`);
  writeFileSync(join(root, '404.html'), '<html>Not found</html>');
  mkdirSync(join(root, '_astro'));
  writeFileSync(join(root, '_astro', 'a.js'), 'console.log(1)');
  writeFileSync(join(parent, 'outside.txt'), 'secret');

  const handler = docsHandler(root)!;
  const server = express().use('/docs', handler).listen(0);
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const page = await fetch(`${base}/docs/`);
    assert.equal(page.status, 200);
    const csp = page.headers.get('content-security-policy')!;
    assert.ok(csp.includes(`'sha256-${createHash('sha256').update(inline).digest('base64')}'`));
    assert.ok(csp.includes("frame-ancestors 'none'"));
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
    assert.equal(page.headers.get('cache-control'), 'public, max-age=300');

    const asset = await fetch(`${base}/docs/_astro/a.js`);
    assert.ok(asset.headers.get('cache-control')!.includes('immutable'));
    await asset.arrayBuffer();

    // fetch() normalizes dot segments before sending, so traversal needs a raw request line.
    const raw = (path: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        get({ host: '127.0.0.1', port, path }, res => {
          let body = '';
          res.on('data', chunk => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        }).on('error', reject);
      });
    for (const path of ['/docs/missing/', '/docs/../outside.txt', '/docs/%2e%2e/outside.txt', '/docs/..%2foutside.txt']) {
      const response = await raw(path);
      assert.equal(response.status, 404, path);
      assert.ok(!response.body.includes('secret'), path);
    }
    assert.equal((await fetch(`${base}/docs/`, { method: 'POST' })).status, 404);
  } finally {
    server.close();
  }
});

test('reports a file it cannot read as a server error, not a 404', { skip: process.getuid?.() === 0 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-locked-'));
  writeFileSync(join(root, 'index.html'), '<html></html>');
  writeFileSync(join(root, '404.html'), '<html>Not found</html>');
  const locked = join(root, 'locked.html');
  writeFileSync(locked, '<html></html>');
  // The handler reads every page once at startup (for the CSP hashes); lock the file after that.
  const app = express().use('/docs', docsHandler(root)!);
  chmodSync(locked, 0o000);
  app.use(((_err, _req, res, _next) => {
    res.status(500).end('error');
  }) as express.ErrorRequestHandler);
  const server = app.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/docs/locked.html`);
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(await res.text(), 'error');
  } finally {
    chmodSync(locked, 0o600);
    server.close();
  }
});
