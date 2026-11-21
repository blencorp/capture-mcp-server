import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SERVER_VERSION } from './version.js';

test('SERVER_VERSION matches package.json', () => {
  // Tests run from source (tsx), so package.json is one level above src/.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(SERVER_VERSION, pkg.version);
});
