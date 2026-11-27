import test from 'node:test';
import assert from 'node:assert/strict';
import { get, type Server as HttpServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { createHttpApp, type HttpAuth } from './http-app.js';

// The landing page, the policy pages and /docs are public and static; none of them may change how
// /mcp or the OAuth endpoints answer.
const OAUTH: HttpAuth = { mode: 'oauth', publicBaseUrl: new URL('http://127.0.0.1:1/'), tokenSecret: 'test-secret' };

function fixtureRoots() {
  const parent = mkdtempSync(join(tmpdir(), 'capture-web-'));
  const webRoot = join(parent, 'web');
  const docsRoot = join(parent, 'docs');
  mkdirSync(join(webRoot, 'assets'), { recursive: true });
  mkdirSync(docsRoot);
  writeFileSync(join(webRoot, 'index.html'), '<html><div id="root">landing</div></html>');
  writeFileSync(join(webRoot, 'privacy-policy.html'), '<html><div id="root">privacy text</div></html>');
  writeFileSync(join(webRoot, 'terms.html'), '<html><div id="root">terms text</div></html>');
  writeFileSync(join(webRoot, 'assets', 'a.js'), 'console.log(1)');
  writeFileSync(join(docsRoot, 'index.html'), '<html>docs home</html>');
  writeFileSync(join(docsRoot, '404.html'), '<html>docs missing</html>');
  return { webRoot, docsRoot };
}

async function listen(auth: HttpAuth) {
  const server: HttpServer = await new Promise(resolve => {
    const s = createHttpApp({ auth, env: {}, ...fixtureRoots() }).listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, port, close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

/** Node's fetch always sends sec-fetch-mode: cors, so a browser navigation needs node:http. */
const navigate = (port: number, path: string) =>
  new Promise<{ status: number; body: string; csp?: string }>((resolve, reject) => {
    get({ host: '127.0.0.1', port, path, headers: { 'sec-fetch-mode': 'navigate', accept: 'text/html' } }, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body, csp: res.headers['content-security-policy'] as string | undefined }),
      );
    }).on('error', reject);
  });

for (const auth of [OAUTH, { mode: 'insecure' } as HttpAuth]) {
  test(`${auth.mode} mode: serves the landing page, the policy pages and the docs`, async () => {
    const server = await listen(auth);
    try {
      const home = await fetch(`${server.url}/`);
      assert.equal(home.status, 200);
      assert.match(await home.text(), /landing/);
      assert.match(home.headers.get('content-security-policy')!, /script-src 'self'/);
      for (const [path, text] of [['/privacy-policy', 'privacy text'], ['/terms', 'terms text'], ['/terms/', 'terms text']]) {
        const page = await fetch(`${server.url}${path}`);
        assert.equal(page.status, 200, path);
        assert.ok((await page.text()).includes(text), path);
      }
      assert.equal((await fetch(`${server.url}/assets/a.js`)).status, 200);
      const docs = await fetch(`${server.url}/docs/`);
      assert.equal(docs.status, 200);
      assert.match(await docs.text(), /docs home/);
      const slashless = await fetch(`${server.url}/docs?x=1`, { redirect: 'manual' });
      assert.equal(slashless.status, 301);
      assert.equal(slashless.headers.get('location'), '/docs/?x=1');
      assert.equal((await fetch(`${server.url}/health`)).status, 200);
    } finally {
      await server.close();
    }
  });

  test(`${auth.mode} mode: a browser gets the not-found page and an API client gets plain text`, async () => {
    const server = await listen(auth);
    try {
      const page = await navigate(server.port, '/no-such-page');
      assert.equal(page.status, 404);
      assert.match(page.body, /landing/);
      assert.ok(page.csp);
      const api = await fetch(`${server.url}/no-such-page`);
      assert.equal(api.status, 404);
      assert.doesNotMatch(await api.text(), /landing/);
    } finally {
      await server.close();
    }
  });
}

test('oauth mode: /mcp still needs a bearer token and the OAuth metadata is still served', async () => {
  const server = await listen(OAUTH);
  try {
    const mcp = await fetch(`${server.url}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(mcp.status, 401);
    assert.equal((await fetch(`${server.url}/.well-known/oauth-authorization-server`)).status, 200);
    assert.equal((await fetch(`${server.url}/oauth/authorize`)).status, 400);
  } finally {
    await server.close();
  }
});

test('the default web root is the package\'s own, not the working directory\'s', async () => {
  // Needs `pnpm build` (the test script builds first). An installed package or `npx` starts the
  // server from whatever directory the user is in.
  const before = process.cwd();
  process.chdir(mkdtempSync(join(tmpdir(), 'capture-cwd-')));
  const server: HttpServer = await new Promise(resolve => {
    const s = createHttpApp({ auth: { mode: 'insecure' }, env: {} }).listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    for (const path of ['/', '/privacy-policy']) assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status, 200, path);
  } finally {
    process.chdir(before);
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
