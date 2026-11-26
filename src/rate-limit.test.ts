import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestBudget } from './rate-limit.js';

test('a client may burst, then is held to the sustained rate', () => {
  let now = 0;
  const budget = new RequestBudget(2, 3, () => now);
  assert.deepEqual([1, 2, 3].map(() => budget.spend('a')), [0, 0, 0]);
  assert.equal(budget.spend('a'), 1, 'the fourth request waits for a token to refill');
  now = 500; // 2 per second: one token every half second
  assert.equal(budget.spend('a'), 0);
  assert.equal(budget.spend('a'), 1);
});

test('clients are counted separately', () => {
  const budget = new RequestBudget(1, 1, () => 0);
  assert.equal(budget.spend('a'), 0);
  assert.equal(budget.spend('a'), 1);
  assert.equal(budget.spend('b'), 0);
});

test('a refused request reports how long to wait', () => {
  let now = 0;
  const budget = new RequestBudget(0.5, 1, () => now);
  assert.equal(budget.spend('a'), 0);
  assert.equal(budget.spend('a'), 2);
  now = 2_000;
  assert.equal(budget.spend('a'), 0);
});

test('a rate or burst that cannot work is refused at construction', () => {
  assert.throws(() => new RequestBudget(0, 5), /positive rate/);
  assert.throws(() => new RequestBudget(5, 0), /burst of at least 1/);
  assert.throws(() => new RequestBudget(Number.NaN, 5), /positive rate/);
});
