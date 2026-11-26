import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpiringMap } from './expiring-map.js';

test('entries expire at their deadline and stop being returned', () => {
  let now = 1_000;
  const map = new ExpiringMap<string>(10, () => now);
  map.set('a', 'one', 2_000);
  assert.equal(map.get('a'), 'one');
  assert.ok(map.has('a'));
  now = 2_000;
  assert.equal(map.get('a'), undefined);
  assert.equal(map.size, 0);
});

test('at the ceiling the oldest entry is evicted, never the newest', () => {
  const map = new ExpiringMap<number>(3, () => 0);
  for (const [i, key] of ['a', 'b', 'c', 'd', 'e'].entries()) map.set(key, i, 1_000);
  assert.equal(map.size, 3);
  assert.deepEqual(['a', 'b'].map(key => map.get(key)), [undefined, undefined]);
  assert.deepEqual(['c', 'd', 'e'].map(key => map.get(key)), [2, 3, 4]);
});

test('setting an existing key refreshes it instead of growing the map', () => {
  const map = new ExpiringMap<number>(2, () => 0);
  map.set('a', 1, 1_000);
  map.set('b', 2, 1_000);
  map.set('a', 3, 1_000); // a is now the newest, so b is evicted next
  map.set('c', 4, 1_000);
  assert.equal(map.get('a'), 3);
  assert.equal(map.get('b'), undefined);
  assert.equal(map.size, 2);
});

test('expired entries free room before anything live is evicted', () => {
  let now = 0;
  const map = new ExpiringMap<string>(2, () => now);
  map.set('old', 'x', 10);
  map.set('live', 'y', 1_000);
  now = 50;
  map.set('new', 'z', 1_000);
  assert.equal(map.get('live'), 'y');
  assert.equal(map.get('new'), 'z');
});

test('a ceiling below one entry is a configuration error', () => {
  assert.throws(() => new ExpiringMap(0, () => 0), /positive integer/);
});

test('at the ceiling an expired entry anywhere is evicted before a live one', () => {
  let now = 0;
  const map = new ExpiringMap<string>(3, () => now);
  map.set('long', 'a', 10_000); // oldest, long-lived
  map.set('short', 'b', 100); // expires behind it, so the front sweep cannot reach it
  map.set('long2', 'c', 10_000);
  now = 200;
  map.set('new', 'd', 10_000);
  assert.equal(map.get('long'), 'a', 'the live oldest entry survives');
  assert.equal(map.get('short'), undefined);
  assert.equal(map.size, 3);
});
