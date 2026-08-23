import test from 'node:test';
import assert from 'node:assert/strict';
import { listEnvelope } from './envelope.js';

test('clean upstream-only filtering keeps the total', () => {
  const out = listEnvelope({
    resourceKey: 'contracts',
    rows: [{ id: 1 }],
    upstreamTotal: 510,
    countUnit: 'awards (upstream-reported; unit unverified)',
    dateField: 'award_date',
    filters: { upstream: { awarding_agency: '2100' }, client_side: {} },
    nextCursor: null,
  });
  assert.equal(out.total, 510);
  assert.equal(out.contracts.length, 1);
  assert.equal(out.warnings, undefined);
});

test('any client-side filter nulls total and surfaces the unfiltered number with a warning', () => {
  // This is the P0-2 fix: an empty page can never again read as "no matches"
  // while total silently reports the unfiltered count.
  const out = listEnvelope({
    resourceKey: 'contracts',
    rows: [],
    upstreamTotal: 1331,
    countUnit: 'awards',
    filters: { upstream: { set_aside: '8AN' }, client_side: { award_amount_min: 1000000 } },
    nextCursor: 'https://tango.makegov.com/api/contracts/?offset=100',
  });
  assert.equal(out.total, null);
  assert.equal(out.total_upstream_unfiltered, 1331);
  assert.ok(out.warnings.some((w: string) => /client-side/i.test(w)));
  assert.deepEqual(out.filters.client_side, { award_amount_min: 1000000 });
});

test('distrusted upstream totals are renamed and warned, not returned as total', () => {
  const out = listEnvelope({
    resourceKey: 'contracts',
    rows: [{ id: 1 }],
    upstreamTotal: 1450,
    countUnit: 'awards',
    filters: { upstream: { set_aside: '8A' }, client_side: {} },
    nextCursor: null,
    distrustUpstreamTotal: 'Upstream set_aside matching is loose; total may include other codes.',
  });
  assert.equal(out.total, null);
  assert.equal(out.total_upstream_unverified, 1450);
  assert.ok(out.warnings.some((w: string) => /loose/.test(w)));
});
