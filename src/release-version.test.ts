import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The real helpers (scripts/resume-tag.mjs, scripts/release-version.ts) against real git history,
// in the states a release re-run can find: before the atomic push, after it, and after a later release.
const resumeTag = new URL('../scripts/resume-tag.mjs', import.meta.url).pathname;
const releaseVersion = new URL('../scripts/release-version.ts', import.meta.url).pathname;
const tsx = new URL('../node_modules/.bin/tsx', import.meta.url).pathname;

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'release-version-'));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'package.json'), '{"version":"1.0.0"}\n');
  const commit = (message: string) => {
    writeFileSync(join(dir, 'f'), message);
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const release = (version: string) => {
    commit(`chore(release): v${version}`);
    git('tag', '-a', `v${version}`, '-m', 'r');
  };
  const resume = (sha: string) => {
    git('checkout', '-q', '--detach', sha); // a re-run checks out its original event commit
    return execFileSync(process.execPath, [resumeTag], { cwd: dir, encoding: 'utf8' }).trim();
  };
  const next = () =>
    /^next=(.*)$/m.exec(execFileSync(tsx, [releaseVersion, '--bump=auto'], { cwd: dir, encoding: 'utf8' }))?.[1];
  return { git, commit, release, resume, next };
}

test('before the push: a new commit after the last tag is released, not resumed', () => {
  const r = repo();
  r.commit('feat: first');
  r.git('tag', '-a', 'v1.0.0', '-m', 'r');
  const event = r.commit('fix: second');
  assert.equal(r.resume(event), '');
  assert.equal(r.next(), '1.0.1');
});

test('after the push: the event commit is behind the new tag, so a re-run resumes it', () => {
  const r = repo();
  r.commit('feat: first');
  r.git('tag', '-a', 'v1.0.0', '-m', 'r');
  const a = r.commit('fix: a');
  r.release('1.0.1');
  assert.equal(r.resume(a), 'v1.0.1');
});

test('after a later release: retrying A resumes v1.0.1, not the newer v1.1.0', () => {
  const r = repo();
  r.commit('feat: first');
  r.git('tag', '-a', 'v1.0.0', '-m', 'r');
  const a = r.commit('fix: a');
  r.release('1.0.1');
  r.commit('feat: b');
  r.release('1.1.0');
  assert.equal(r.resume(a), 'v1.0.1');
});

test('a commit that carries the latest tag itself is already released', () => {
  const r = repo();
  const only = r.commit('feat: first');
  r.git('tag', '-a', 'v1.0.0', '-m', 'r');
  assert.equal(r.resume(only), 'v1.0.0');
});
