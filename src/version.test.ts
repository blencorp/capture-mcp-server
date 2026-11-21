import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SERVER_VERSION } from './version.js';

test('SERVER_VERSION matches package.json', () => {
  // Compiled to dist/version.test.js; the build copies package.json into dist/.
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  assert.equal(SERVER_VERSION, pkg.version);
});
