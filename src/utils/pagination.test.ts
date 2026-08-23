import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pageNumberFromCursor,
  highergovNextCursor,
  tangoNextCursor,
  parseTangoCursor,
} from './pagination.js';

test('pageNumberFromCursor extracts page_number from URLs and passes bare tokens', () => {
  assert.equal(pageNumberFromCursor('https://www.highergov.com/api-external/contract/?page_number=3'), '3');
  assert.equal(pageNumberFromCursor('2'), '2');
  assert.equal(pageNumberFromCursor(''), null);
  assert.equal(pageNumberFromCursor(null), null);
});

test('highergovNextCursor probes all known next-link locations', () => {
  assert.equal(highergovNextCursor({ next: 'https://x.test/?page_number=2' }), '2');
  assert.equal(highergovNextCursor({ links: { next: 'https://x.test/?page=5' } }), '5');
  assert.equal(highergovNextCursor({ pagination: { next: '4' } }), '4');
  assert.equal(highergovNextCursor({ meta: { next: 'https://x.test/?page_number=7' } }), '7');
});

test('highergovNextCursor falls back to page math and stops at the last page', () => {
  assert.equal(highergovNextCursor({ page_number: 1, total_pages: 3, results: [] }), '2');
  assert.equal(highergovNextCursor({ page_number: 3, total_pages: 3, results: [] }), null);
  assert.equal(highergovNextCursor({ results: [] }), null);
});

test('tango cursor round-trips through the next URL', () => {
  const next = 'https://tango.makegov.com/api/contracts/?limit=100&offset=100&set_aside=8AN';
  assert.equal(tangoNextCursor({ next }), next);
  const req = parseTangoCursor(next);
  assert.equal(req.endpoint, '/contracts/');
  assert.equal(req.params.offset, '100');
  assert.equal(req.params.set_aside, '8AN');
});

test('parseTangoCursor refuses non-Tango URLs and junk', () => {
  assert.throws(() => parseTangoCursor('https://evil.example/api/contracts/?x=1'), /Tango API/);
  assert.throws(() => parseTangoCursor('https://tango.makegov.com/other/path'), /Tango API/);
  assert.throws(() => parseTangoCursor('not a url'), /Invalid cursor/);
});

test('tangoNextCursor returns null when the upstream has no next page', () => {
  assert.equal(tangoNextCursor({ next: null }), null);
  assert.equal(tangoNextCursor({}), null);
});
