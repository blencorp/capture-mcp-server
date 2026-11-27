import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The real helper (scripts/release-version.ts) against real git history, in the states a release
// re-run can find: before the atomic push, and after it (the event commit is behind the new tag).
const script = new URL('../scripts/release-version.ts', import.meta.url).pathname;
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
  };
  const decide = () => {
    const out = execFileSync(tsx, [script, '--bump=auto'], { cwd: dir, encoding: 'utf8' });
    return Object.fromEntries(out.trim().split('\n').map(l => l.split('=') as [string, string]));
  };
  return { git, commit, decide };
}

test('before the push: a new commit after the last tag is released, not resumed', () => {
  const r = repo();
  r.commit('feat: first');
  r.git('tag', '-a', 'v1.0.0', '-m', 'r');
  r.commit('fix: second');
  assert.deepEqual({ next: r.decide().next, resume: r.decide().resume_tag }, { next: '1.0.1', resume: '' });
});

test('after the push: the event commit is behind the new tag, so a re-run resumes it and bumps nothing', () => {
  const r = repo();
  r.commit('feat: first');
  r.git('tag', '-a', 'v1.0.0', '-m', 'r');
  r.commit('fix: second'); // the event commit
  const event = r.git('rev-parse', 'HEAD');
  r.commit('chore(release): v1.0.1'); // the commit the atomic push added
  r.git('tag', '-a', 'v1.0.1', '-m', 'r');
  r.git('checkout', '-q', '--detach', event); // a re-run checks out the original event commit
  assert.equal(r.decide().resume_tag, 'v1.0.1');
});

test('a commit that carries the latest tag itself is already released', () => {
  const r = repo();
  r.commit('feat: first');
  r.git('tag', '-a', 'v1.0.0', '-m', 'r');
  assert.equal(r.decide().resume_tag, 'v1.0.0');
});
