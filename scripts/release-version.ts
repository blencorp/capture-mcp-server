// Release version helper for .github/workflows/release.yml.
//
//   pnpm release-version              # print current/next/bump as key=value
//   pnpm release-version --write 1.2.0   # write that version into the manifests
//
// The key=value output includes `resume_tag`, non-empty when HEAD is already contained in the
// latest tag (a re-run after the release was pushed).
//
// Decision logic lives in src/utils/version-bump.ts (unit tested); this script
// only supplies git history and file I/O.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { nextVersion, type BumpLevel } from '../src/utils/version-bump.js';

const TAG_PREFIX = 'v';
// Files that carry a user-visible version and must not drift from package.json.
const MANIFESTS = ['manifest.json'];
// Source files whose version literal sits on a line marked `x-release-version`.
const MARKER_FILES = ['src/version.ts'];

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function latestReleaseTag(): string | null {
  try {
    // Sort by version, not commit date, so an out-of-order tag can't win.
    const tags = git(['tag', '--list', `${TAG_PREFIX}*`, '--sort=-v:refname']);
    const newest = tags.split('\n').map(t => t.trim()).filter(Boolean)[0];
    return newest ?? null;
  } catch {
    return null;
  }
}

/**
 * The tag that already contains HEAD, when the last release was cut from this commit or a later
 * one. A re-run of a release whose atomic push succeeded checks out its original event commit,
 * which is now behind the new tag: deriving a bump from it would diverge from the released main.
 */
function releasedTagContainingHead(tag: string | null): string | null {
  if (!tag) return null;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', tag], { stdio: 'ignore' });
    return tag;
  } catch {
    return null;
  }
}

function commitsSince(tag: string | null): string[] {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  try {
    // NUL-separate so multi-line bodies (BREAKING CHANGE footers) survive.
    const log = git(['log', range, '--no-merges', '--format=%B%x00']);
    return log.split('\0').map(m => m.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeManifestVersion(path: string, version: string): boolean {
  if (!existsSync(path)) return false;
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  if (typeof parsed.version !== 'string' || parsed.version === version) return false;
  // Rewrite the single field in place to preserve key order and formatting.
  const updated = raw.replace(
    /("version"\s*:\s*")[^"]*(")/,
    (_match, open: string, close: string) => `${open}${version}${close}`
  );
  writeFileSync(path, updated);
  return true;
}

function writeMarkerVersion(path: string, version: string): boolean {
  const raw = readFileSync(path, 'utf8');
  if (!raw.includes('x-release-version')) {
    throw new Error(`${path} has no line marked x-release-version; the released version would drift from package.json`);
  }
  const updated = raw
    .split('\n')
    .map(line => (line.includes('x-release-version') ? line.replace(/(['"])\d+\.\d+\.\d+\1/, `'${version}'`) : line))
    .join('\n');
  if (updated === raw) return false;
  writeFileSync(path, updated);
  return true;
}

function main(): void {
  const args = process.argv.slice(2);
  const writeIndex = args.indexOf('--write');

  if (writeIndex !== -1) {
    const version = args[writeIndex + 1];
    if (!version) {
      console.error('--write requires a version argument');
      process.exit(1);
    }
    for (const manifest of MANIFESTS) {
      if (writeManifestVersion(manifest, version)) {
        console.log(`updated ${manifest} -> ${version}`);
      }
    }
    for (const file of MARKER_FILES) {
      if (writeMarkerVersion(file, version)) {
        console.log(`updated ${file} -> ${version}`);
      }
    }
    return;
  }

  const overrideArg = (args.find(a => a.startsWith('--bump='))?.split('=')[1] ?? 'auto') as
    | BumpLevel
    | 'auto';
  if (!['auto', 'major', 'minor', 'patch'].includes(overrideArg)) {
    console.error(`Invalid --bump=${overrideArg} (expected auto, major, minor, or patch)`);
    process.exit(1);
  }

  const tag = latestReleaseTag();
  // The tag is the source of truth once one exists; package.json seeds the first release.
  const current = tag ? tag.slice(TAG_PREFIX.length) : readJson('package.json').version;
  const messages = commitsSince(tag);

  const result = nextVersion({
    current,
    messages,
    override: overrideArg,
    hasExistingRelease: Boolean(tag),
  });

  // key=value lines: the workflow appends these straight to $GITHUB_OUTPUT.
  console.log(`current=${result.current}`);
  console.log(`next=${result.next}`);
  console.log(`tag=${TAG_PREFIX}${result.next}`);
  console.log(`bump=${result.bump}`);
  console.log(`seeded=${result.seeded}`);
  console.log(`previous_tag=${tag ?? ''}`);
  console.log(`commit_count=${messages.length}`);
  // Set when HEAD is already released: the workflow then resumes from this tag instead of bumping.
  console.log(`resume_tag=${releasedTagContainingHead(tag) ?? ''}`);
}

main();
