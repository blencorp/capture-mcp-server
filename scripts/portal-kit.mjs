#!/usr/bin/env node
// The portal kit: files every BLEN MCP server's portal shares byte for byte (tokens, UI
// primitives, page layout, landing page). Product content lives in web/src/brand.tsx and the
// per-product pages, never in these files. web/portal-kit.json records the source repository
// and commit the kit was copied from, and each file's SHA-256.
//
//   node scripts/portal-kit.mjs            check the files against the manifest (exit 1 on drift)
//   node scripts/portal-kit.mjs --update   rewrite the hashes (in the repository that owns the kit)
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MANIFEST = 'web/portal-kit.json';
const DIRS = ['web/src/components/kit', 'web/src/components/ui'];
const FILES = ['web/src/index.css', 'web/src/lib/utils.ts', 'web/src/assets/blen-logo.png'];

/** Every kit file, as repository-relative POSIX paths, sorted. */
export function kitFiles(root = '.') {
  const fromDirs = DIRS.flatMap((dir) =>
    readdirSync(join(root, dir), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => `${dir}/${e.name}`),
  );
  return [...fromDirs, ...FILES].sort();
}

export function hashes(root = '.') {
  return Object.fromEntries(
    kitFiles(root).map((file) => [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')]),
  );
}

/** Differences between the files on disk and the manifest, as readable lines. */
export function drift(root = '.') {
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
  const actual = hashes(root);
  const problems = [];
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (!(file in actual)) problems.push(`${file}: missing`);
    else if (actual[file] !== hash) problems.push(`${file}: changed`);
  }
  for (const file of Object.keys(actual)) if (!(file in manifest.files)) problems.push(`${file}: not in the manifest`);
  return problems;
}

if (resolve(process.argv[1] ?? '') === import.meta.filename) {
  if (process.argv.includes('--update')) {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    manifest.files = hashes();
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`${MANIFEST}: ${Object.keys(manifest.files).length} files`);
  } else {
    const problems = drift();
    if (problems.length) {
      console.error(`The portal kit differs from ${MANIFEST}:\n  ${problems.join('\n  ')}`);
      console.error('Change kit files in uspto-mcp-server, then copy them here with the new manifest.');
      process.exit(1);
    }
    console.log('portal kit: matches the manifest');
  }
}
