import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCommitBump, detectBump, applyBump, parseVersion, nextVersion } from './version-bump.js';

test('conventional prefixes map to the right level', () => {
  assert.equal(detectCommitBump('feat: add aggregate_contracts'), 'minor');
  assert.equal(detectCommitBump('feat(highergov): opportunity search'), 'minor');
  assert.equal(detectCommitBump('fix: exact set-aside matching'), 'patch');
  assert.equal(detectCommitBump('fix(tango): honor amount bounds'), 'patch');
  assert.equal(detectCommitBump('chore: bump deps'), 'patch');
  assert.equal(detectCommitBump('docs: update upstream notes'), 'patch');
});

test('breaking changes are detected from both the ! marker and the footer', () => {
  assert.equal(detectCommitBump('feat!: drop the legacy cursor shape'), 'major');
  assert.equal(detectCommitBump('refactor(api)!: rename set_aside'), 'major');
  assert.equal(
    detectCommitBump('feat: new envelope\n\nBREAKING CHANGE: filters moved under filters.upstream'),
    'major'
  );
  assert.equal(detectCommitBump('feat: new envelope\n\nBREAKING-CHANGE: same thing hyphenated'), 'major');
});

test('non-conventional messages imply nothing on their own', () => {
  assert.equal(detectCommitBump('Add shared envelope infra'), null);
  assert.equal(detectCommitBump('Merge pull request #7 from blencorp/branch'), null);
  assert.equal(detectCommitBump(''), null);
  // A colon alone is not a conventional header without the space+type shape.
  assert.equal(detectCommitBump('WIP:stuff'), null);
});

test('detectBump takes the highest level and defaults to patch', () => {
  assert.equal(detectBump(['fix: a', 'feat: b', 'chore: c']), 'minor');
  assert.equal(detectBump(['feat: a', 'fix!: b']), 'major');
  assert.equal(detectBump(['Add a thing', 'Fix another thing']), 'patch', 'a merge always releases');
  assert.equal(detectBump([]), 'patch');
});

test('applyBump resets lower components', () => {
  assert.equal(applyBump('1.4.7', 'patch'), '1.4.8');
  assert.equal(applyBump('1.4.7', 'minor'), '1.5.0');
  assert.equal(applyBump('1.4.7', 'major'), '2.0.0');
});

test('parseVersion tolerates a v prefix and suffixes, rejects junk', () => {
  assert.deepEqual(parseVersion('v2.3.4'), { major: 2, minor: 3, patch: 4 });
  assert.deepEqual(parseVersion('2.3.4-rc.1'), { major: 2, minor: 3, patch: 4 });
  assert.throws(() => parseVersion('1.2'), /Unparseable version/);
  assert.throws(() => parseVersion('latest'), /Unparseable version/);
});

test('the first release seeds at the current version instead of bumping past it', () => {
  const result = nextVersion({
    current: '1.0.0',
    messages: ['feat: anything'],
    hasExistingRelease: false,
  });
  assert.deepEqual(result, { current: '1.0.0', next: '1.0.0', bump: 'patch', seeded: true });
});

test('subsequent releases bump from the current version', () => {
  assert.equal(
    nextVersion({ current: '1.0.0', messages: ['feat: x'], hasExistingRelease: true }).next,
    '1.1.0'
  );
  assert.equal(
    nextVersion({ current: '1.2.3', messages: ['Some untagged work'], hasExistingRelease: true }).next,
    '1.2.4'
  );
});

test('an explicit override wins over commit detection', () => {
  const result = nextVersion({
    current: '1.0.0',
    messages: ['fix: tiny'],
    override: 'major',
    hasExistingRelease: true,
  });
  assert.equal(result.next, '2.0.0');
  assert.equal(result.bump, 'major');
});
