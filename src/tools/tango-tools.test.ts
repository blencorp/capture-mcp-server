import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../utils/api-client.js';
import { tangoTools } from './tango-tools.js';

process.env.TANGO_API_KEY = process.env.TANGO_API_KEY || 'test-key';

function tangoContract(over: Record<string, any> = {}) {
  return {
    key: 'CONT_AWD_TEST_0001',
    description: 'DEVSECOPS SUPPORT SERVICES',
    recipient: { display_name: 'ACME FEDERAL LLC', uei: 'UEI000000001' },
    awarding_office: { agency_name: 'DEPT OF THE ARMY', agency_code: '2100', office_name: 'ACC' },
    obligated: 500000,
    award_date: '2025-09-30',
    naics_code: 541511,
    psc_code: 'D307',
    set_aside: { code: '8AN', description: '8(A) SOLE SOURCE' },
    place_of_performance: { city_name: 'AUSTIN', state_name: 'TEXAS', country_name: 'UNITED STATES' },
    contract_status: 'active',
    ...over,
  };
}

function page(results: any[], over: Record<string, any> = {}) {
  return { count: results.length, next: null, previous: null, results, ...over };
}

function stubTangoGet(handler: (endpoint: string, params: Record<string, any>) => any) {
  const original = ApiClient.tangoGet;
  const calls: Array<{ endpoint: string; params: Record<string, any> }> = [];
  (ApiClient as any).tangoGet = async (endpoint: string, params: Record<string, any>) => {
    calls.push({ endpoint, params });
    return handler(endpoint, params);
  };
  return {
    calls,
    restore() {
      (ApiClient as any).tangoGet = original;
    },
  };
}

test('P0-1: set_aside matches exactly against per-row FPDS codes and describes them', async () => {
  const stub = stubTangoGet(() => ({
    success: true,
    data: page(
      [
        tangoContract({ key: 'A', set_aside: { code: '8AN' } }),
        tangoContract({ key: 'B', set_aside: { code: '8A' } }),
        tangoContract({ key: 'C', type_of_set_aside_code: 'SDVOSBS', set_aside: undefined }),
      ],
      { count: 1450 }
    ),
  }));
  try {
    const out: any = await tangoTools.callTool('search_tango_contracts', { set_aside: '8A' });
    assert.equal(out.contracts.length, 1);
    assert.equal(out.contracts[0].contract_id, 'B');
    assert.deepEqual(out.contracts[0].set_aside, { code: '8A', description: '8(a) Competed (FAR 19.8)' });
    assert.deepEqual(out.filters.client_side.set_aside_exact, ['8A']);
    // Loose upstream total must not be presented as the exact count.
    assert.equal(out.total, null);
    assert.equal(out.total_upstream_unfiltered, 1450);
    // Single code is still sent upstream to narrow the page.
    assert.equal(stub.calls[0].params.set_aside, '8A');
  } finally {
    stub.restore();
  }
});

test('P0-1: set_aside accepts an array and rejects unknown codes with the valid list', async () => {
  const stub = stubTangoGet(() => ({
    success: true,
    data: page([
      tangoContract({ key: 'A', set_aside: { code: '8AN' } }),
      tangoContract({ key: 'B', set_aside: { code: 'HZS' } }),
      tangoContract({ key: 'C', set_aside: { code: 'SBA' } }),
    ]),
  }));
  try {
    const out: any = await tangoTools.callTool('search_tango_contracts', {
      set_aside: ['8AN', 'SDVOSBS', 'HZS'],
    });
    assert.deepEqual(out.contracts.map((c: any) => c.contract_id).sort(), ['A', 'B']);
    // Multi-code filters go upstream via Tango's documented OR syntax.
    assert.equal(stub.calls[0].params.set_aside, '8AN|SDVOSBS|HZS');

    const err: any = await tangoTools.callTool('search_tango_contracts', { set_aside: ['8ASS'] });
    assert.equal(err.error.code, 'bad_request');
    assert.match(err.error.message, /8ASS/);
    assert.match(err.error.message, /8AN \(8\(a\) Sole Source/);
  } finally {
    stub.restore();
  }
});

test('P0-1: when rows carry no readable code, results are declared LOOSE and the total distrusted', async () => {
  const stub = stubTangoGet(() => ({
    success: true,
    data: page(
      [tangoContract({ key: 'A', set_aside: undefined }), tangoContract({ key: 'B', set_aside: undefined })],
      { count: 1331 }
    ),
  }));
  try {
    const out: any = await tangoTools.callTool('search_tango_contracts', { set_aside: '8AN' });
    assert.equal(out.contracts.length, 2, 'must not filter blind');
    assert.ok(out.warnings.some((w: string) => /LOOSE matches/.test(w)));
    assert.equal(out.total, null);
    assert.equal(out.total_upstream_unverified, 1331);
  } finally {
    stub.restore();
  }
});

test('P0-2: amount bounds are enforced client-side, echoed, and never silently drop', async () => {
  const stub = stubTangoGet(() => ({
    success: true,
    data: page(
      [tangoContract({ key: 'SMALL', obligated: 59835 }), tangoContract({ key: 'BIG', obligated: 2500000 })],
      { count: 1331 }
    ),
  }));
  try {
    const out: any = await tangoTools.callTool('search_tango_contracts', {
      set_aside: '8AN',
      award_amount_min: 1000000,
    });
    assert.deepEqual(out.contracts.map((c: any) => c.contract_id), ['BIG']);
    // Sent upstream via the documented param AND verified client-side.
    assert.equal(stub.calls[0].params.obligated_gte, 1000000);
    assert.equal(out.filters.client_side.award_amount_min, 1000000);
    assert.ok(out.warnings.some((w: string) => /award_amount_min/.test(w)));
    // The P0-2 repro: empty-looking page can no longer masquerade as "no matches".
    assert.equal(out.total, null);
    assert.equal(out.total_upstream_unfiltered, 1331);
  } finally {
    stub.restore();
  }
});

test('P0-3: next_cursor round-trips and replays the exact next-page query', async () => {
  const nextUrl = 'https://tango.makegov.com/api/contracts/?limit=100&offset=100&set_aside=8AN';
  const stub = stubTangoGet(() => ({
    success: true,
    data: page([tangoContract()], { next: nextUrl }),
  }));
  try {
    const first: any = await tangoTools.callTool('search_tango_contracts', { set_aside: '8AN', limit: 100 });
    assert.equal(first.next_cursor, nextUrl);

    await tangoTools.callTool('search_tango_contracts', { cursor: nextUrl });
    assert.deepEqual(stub.calls[1].params, { limit: '100', offset: '100', set_aside: '8AN' });

    const wrong: any = await tangoTools.callTool('search_tango_grants', { cursor: nextUrl });
    assert.equal(wrong.error.code, 'bad_request');
    assert.match(wrong.error.message, /belongs to \/contracts\//);
  } finally {
    stub.restore();
  }
});

test('contract search requests the documented field shape and degrades gracefully if rejected', async () => {
  // First: shape is requested (it is what makes per-row set_aside readable).
  const stub1 = stubTangoGet((_e, params) => {
    assert.match(String(params.shape), /set_aside\(code,description\)/);
    return { success: true, data: page([tangoContract()]) };
  });
  try {
    const ok: any = await tangoTools.callTool('search_tango_contracts', { agency: '2100' });
    assert.equal(ok.contracts.length, 1);
  } finally {
    stub1.restore();
  }

  // Second: a 400 on the shaped request falls back to the default subset with a warning.
  let call = 0;
  const stub2 = stubTangoGet((_e, params) => {
    call += 1;
    if (params.shape) return { success: false, error: 'API Error 400: {"shape":"unknown field"}' };
    return { success: true, data: page([tangoContract()]) };
  });
  try {
    const out: any = await tangoTools.callTool('search_tango_contracts', { agency: '2100' });
    assert.equal(call, 2);
    assert.equal(out.contracts.length, 1);
    assert.ok(out.warnings.some((w: string) => /field-shape request/.test(w)));
  } finally {
    stub2.restore();
  }
});

test('agency accepts FPDS codes and rejects names with guidance (upstream hangs on names)', async () => {
  const stub = stubTangoGet(() => ({ success: true, data: page([tangoContract()]) }));
  try {
    const ok: any = await tangoTools.callTool('search_tango_contracts', { agency: '2100' });
    assert.equal(stub.calls[0].params.awarding_agency, '2100');
    assert.equal(ok.contracts.length, 1);

    const err: any = await tangoTools.callTool('search_tango_contracts', { agency: 'Army' });
    assert.equal(err.error.code, 'bad_request');
    assert.match(err.error.message, /FPDS agency code/);
    assert.match(err.error.message, /2100=Army/);
  } finally {
    stub.restore();
  }
});

test('clean queries keep the upstream total with its unit label', async () => {
  const stub = stubTangoGet(() => ({
    success: true,
    data: page([tangoContract()], { count: 510 }),
  }));
  try {
    const out: any = await tangoTools.callTool('search_tango_contracts', {
      agency: '2100',
      date_from: '2025-08-01',
      date_to: '2025-09-30',
    });
    assert.equal(out.total, 510);
    assert.match(out.count_unit, /unverified/);
    assert.match(out.date_field, /award_date/);
    assert.equal(out.warnings, undefined);
  } finally {
    stub.restore();
  }
});

test('grants: recipient and amount filters are client-side with honest echo', async () => {
  const stub = stubTangoGet(() => ({
    success: true,
    data: page([
      { fain: 'G1', recipient: { name: 'ACME LABS', uei: 'U1' }, award_amount: 50000 },
      { fain: 'G2', recipient: { name: 'OTHER ORG', uei: 'U2' }, award_amount: 250000 },
    ]),
  }));
  try {
    const out: any = await tangoTools.callTool('search_tango_grants', {
      recipient_uei: 'U2',
      award_amount_min: 100000,
    });
    assert.deepEqual(out.grants.map((g: any) => g.grant_id), ['G2']);
    assert.equal(out.filters.client_side.recipient_uei, 'U2');
    assert.equal(out.total, null);
  } finally {
    stub.restore();
  }
});

test('opportunities: envelope with cursor', async () => {
  const nextUrl = 'https://tango.makegov.com/api/opportunities/?limit=10&offset=10';
  const stub = stubTangoGet(() => ({
    success: true,
    data: page([{ opportunity_id: 'O1', title: 'Thing', active: true }], { next: nextUrl, count: 44 }),
  }));
  try {
    const out: any = await tangoTools.callTool('search_tango_opportunities', { query: 'devops' });
    assert.equal(out.opportunities.length, 1);
    assert.equal(out.total, 44);
    assert.equal(out.next_cursor, nextUrl);
  } finally {
    stub.restore();
  }
});

test('spending summary declares partial aggregation instead of posing as population totals', async () => {
  const stub = stubTangoGet(() => ({
    success: true,
    data: page(
      [tangoContract({ obligated: 100 }), tangoContract({ key: 'K2', obligated: 200 })],
      { count: 5000, next: 'https://tango.makegov.com/api/contracts/?limit=100&offset=100' }
    ),
  }));
  try {
    const out: any = await tangoTools.callTool('get_tango_spending_summary', { agency: '2100' });
    assert.equal(out.total_contracts, 2);
    assert.ok(out.warnings.some((w: string) => /PARTIAL AGGREGATION/.test(w)));
    assert.match(out.count_unit, /fetched page/);
  } finally {
    stub.restore();
  }
});
