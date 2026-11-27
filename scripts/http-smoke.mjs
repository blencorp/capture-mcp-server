#!/usr/bin/env node
// Starts a built server in local HTTP mode from an unrelated directory (as `npx` or an installed
// bin does) and checks it serves its health check, landing page, policy page and a built asset.
//
//   node scripts/http-smoke.mjs <cwd> <command> [args...]
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const [cwd, command, ...args] = process.argv.slice(2);
if (!cwd || !command) {
  console.error('usage: http-smoke.mjs <cwd> <command> [args...]');
  process.exit(2);
}
const port = 20000 + Math.floor(Math.random() * 20000);
const child = spawn(command, args, {
  cwd: resolve(cwd),
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { PATH: `${resolve(process.execPath, '..')}:/usr/bin:/bin`, HOME: process.env.HOME ?? '/tmp', MCP_TRANSPORT: 'http', MCP_ALLOW_INSECURE_HTTP: 'true', PORT: String(port) },
});
const base = `http://127.0.0.1:${port}`;
const done = code => { child.kill(); process.exit(code); };
const fail = reason => { console.error(`http smoke: ${reason}`); done(1); };
child.on('exit', code => fail(`server exited early (${code})`));
const get = async path => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, text: await res.text() };
};

try {
  let health;
  for (let i = 0; i < 60 && !health; i++) {
    health = await fetch(`${base}/health`).catch(() => undefined);
    if (!health) await new Promise(r => setTimeout(r, 500));
  }
  if (!health?.ok) fail('/health did not answer');
  const home = await get('/');
  if (home.status !== 200) fail(`/ answered ${home.status}`);
  const privacy = await get('/privacy-policy');
  if (privacy.status !== 200) fail(`/privacy-policy answered ${privacy.status}`);
  const asset = /\/assets\/[^"']+\.(?:js|css)/.exec(home.text)?.[0];
  if (!asset) fail('the landing page references no built asset');
  const served = await get(asset);
  if (served.status !== 200) fail(`${asset} answered ${served.status}`);
  console.log(`http smoke: /health, /, /privacy-policy and ${asset} answered 200`);
  child.removeAllListeners('exit');
  done(0);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
