#!/usr/bin/env node
// Stages dist/ as the Lambda code asset: the compiled server plus its production dependencies.
// Run after `pnpm build` (the build:lambda script does both). The asset needs its own
// package.json ("type": "module") and a production-only install from the same lockfile.
import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.pnpmfile.cjs']) {
  if (existsSync(join(root, file))) copyFileSync(join(root, file), join(dist, file));
}
const result = spawnSync('pnpm', ['install', '--prod', '--frozen-lockfile', '--ignore-scripts'], {
  cwd: dist,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
