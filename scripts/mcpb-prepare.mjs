#!/usr/bin/env node
// Stages an MCPB (MCP Bundle) directory for `mcpb pack mcpb-build capture-mcp-server.mcpb`.
// Run from the repo root, after `pnpm build`:  pnpm build && pnpm mcpb:prepare
//
// Everything is staged in mcpb-build/, which is its own pnpm workspace root, so installing the
// bundle's production dependencies never touches the repository's node_modules.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(process.cwd());
const out = resolve(root, 'mcpb-build');
if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });

cpSync(resolve(root, 'dist'), resolve(out, 'dist'), { recursive: true });
// manifest.json is committed and stamped by the release (src/manifest.test.ts keeps it in step
// with package.json).
for (const file of ['manifest.json', 'icon.png', 'package.json', 'README.md', 'LICENSE', 'NOTICE']) {
  cpSync(resolve(root, file), resolve(out, file));
}
// Reproducible: the bundle installs exactly the tested lockfile. The copied workspace file carries
// the settings the lockfile was resolved with and stops pnpm from walking up to the repo root.
for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) cpSync(resolve(root, file), resolve(out, file));

// The bundle carries its production node_modules: Claude Desktop runs it with a plain `node`, with
// no install step. Hoisted layout, because pnpm's default symlink store does not survive zipping.
// --ignore-scripts: no dependency lifecycle script runs in the release job that can push.
execFileSync('pnpm', ['install', '--prod', '--frozen-lockfile', '--ignore-scripts', '--config.node-linker=hoisted'], {
  cwd: out,
  stdio: 'inherit',
});

// Fail loudly here rather than at `mcpb pack` time.
execFileSync(process.execPath, [resolve(root, 'node_modules/@anthropic-ai/mcpb/dist/cli/cli.js'), 'validate', resolve(out, 'manifest.json')], {
  stdio: 'inherit',
});

console.log('mcpb-build/ prepared at', out);
console.log('next: pnpm mcpb:pack   (packs mcpb-build/ into capture-mcp-server.mcpb)');
