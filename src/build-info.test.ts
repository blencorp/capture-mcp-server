import test from 'node:test';
import assert from 'node:assert/strict';

import { readBuildInfo } from './build-info.js';
import { SERVER_VERSION } from './version.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';

test('readBuildInfo reports the package version and the commit Railway built', () => {
  assert.deepEqual(readBuildInfo({ RAILWAY_GIT_COMMIT_SHA: SHA }), { version: SERVER_VERSION, commit: SHA });
});

test('readBuildInfo reports a null commit when the platform gives none (local, docker run, MCPB)', () => {
  assert.deepEqual(readBuildInfo({}), { version: SERVER_VERSION, commit: null });
  assert.deepEqual(readBuildInfo({ RAILWAY_GIT_COMMIT_SHA: '' }), { version: SERVER_VERSION, commit: null });
});

test('readBuildInfo normalises case and whitespace, and never reports a value that is not a full SHA', () => {
  assert.equal(readBuildInfo({ RAILWAY_GIT_COMMIT_SHA: ` ${SHA.toUpperCase()}\n` }).commit, SHA);
  for (const bad of ['abc123', 'main', `${SHA}0`, `${SHA.slice(0, 39)}g`]) {
    assert.equal(readBuildInfo({ RAILWAY_GIT_COMMIT_SHA: bad }).commit, null, bad);
  }
});
