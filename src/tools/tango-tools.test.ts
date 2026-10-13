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

// Budget endpoints (beta). Row shape modelled on a recorded
// /api/budget/accounts/ response: integer `id` primary key, flat fields.
function budgetAccount(over: Record<string, any> = {}) {
  return {
    id: 17647,
    federal_account_symbol: '080-0124',
    fiscal_year: 2024,
    data_through_period: 12,
    account_category: 'budgetary',
    agency_code: '080',
    agency_name: 'National Aeronautics and Space Administration',
    bureau_name: 'National Aeronautics and Space Administration',
    account_title: 'Exploration',
    bea_category: 'Discretionary',
    on_off_budget: 'On-budget',
    subfunction_code: '252',
    requested_ba: 7971000000,
    enacted_ba: 7666000000,
    apportioned: 7800000000,
    obligated_total: 7500000000,
    outlayed_total: 7200000000,
    contract_obligated: 6600000000,
    contract_share_of_obligated_capped: 0.88,
    assistance_obligated: 90000000,
    ba_growth_next_year_pct: 0.04,
    source_anomalies: [],
    ...over,
  };
}

test('budget accounts: filters map to Tango params and rows expose account_id', async () => {
  const nextUrl = 'https://tango.makegov.com/api/budget/accounts/?limit=10&page=2&fiscal_year=2024';
  const stub = stubTangoGet(() => ({ success: true, data: page([budgetAccount()], { count: 312, next: nextUrl }) }));
  try {
    const out: any = await tangoTools.callTool('search_tango_budget_accounts', {
      query: 'exploration',
      fiscal_year: 2024,
      agency_code: '080',
      account_title: 'explor',
      bureau_name: 'aeronautics',
      complete_years_only: true,
      min_contract_share: 0.5,
      min_obligated: 1000000,
      account_category: 'Budgetary',
      ordering: '-obligated_total',
    });
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].endpoint, '/budget/accounts/');
    assert.deepEqual(stub.calls[0].params, {
      limit: 10,
      search: 'exploration',
      fiscal_year: 2024,
      agency_code: '080',
      account_title__icontains: 'explor',
      bureau_name__icontains: 'aeronautics',
      account_category: 'budgetary',
      data_through_period: 12,
      contract_share_of_obligated_capped__gte: 0.5,
      obligated_total__gte: 1000000,
      ordering: '-obligated_total',
    });
    assert.equal(out.accounts.length, 1);
    assert.equal(out.accounts[0].account_id, 17647);
    assert.equal(out.accounts[0].id, undefined);
    assert.equal(out.accounts[0].federal_account_symbol, '080-0124');
    assert.equal(out.accounts[0].contract_share_of_obligated_capped, 0.88);
    assert.equal(out.total, 312);
    assert.match(out.count_unit, /account-years/);
    assert.equal(out.next_cursor, nextUrl);
    assert.equal(out.warnings, undefined);
  } finally {
    stub.restore();
  }
});

test('budget accounts: fiscal year range and limit cap', async () => {
  const stub = stubTangoGet(() => ({ success: true, data: page([]) }));
  try {
    await tangoTools.callTool('search_tango_budget_accounts', { fiscal_year_from: 2020, fiscal_year_to: 2024, limit: 500 });
    assert.deepEqual(stub.calls[0].params, { limit: 100, fiscal_year__gte: 2020, fiscal_year__lte: 2024 });
  } finally {
    stub.restore();
  }
});

test('budget accounts: invalid inputs are rejected before any upstream call', async () => {
  const stub = stubTangoGet(() => {
    throw new Error('upstream must not be called');
  });
  try {
    const fpds: any = await tangoTools.callTool('search_tango_budget_accounts', { agency_code: '7500' });
    assert.equal(fpds.error.code, 'bad_request');
    assert.match(fpds.error.message, /3-digit CGAC/);
    assert.match(fpds.error.message, /075=HHS/);

    const order: any = await tangoTools.callTool('search_tango_budget_accounts', { ordering: '-requested_ba' });
    assert.equal(order.error.code, 'bad_request');
    assert.match(order.error.message, /contract_share_of_obligated_capped/);

    const share: any = await tangoTools.callTool('search_tango_budget_accounts', { min_contract_share: 50 });
    assert.equal(share.error.code, 'bad_request');
    assert.match(share.error.message, /fraction between 0 and 1/);

    const category: any = await tangoTools.callTool('search_tango_budget_accounts', { account_category: 'mandatory' });
    assert.equal(category.error.code, 'bad_request');
    assert.match(category.error.message, /budgetary, credit_financing, request_only, proposed/);

    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('budget accounts: partial fiscal years and source anomalies are called out', async () => {
  const stub = stubTangoGet(() => ({
    success: true,
    data: page([
      budgetAccount({ id: 1, fiscal_year: 2026, data_through_period: 10 }),
      budgetAccount({ id: 2, source_anomalies: [{ code: 'contract_exceeds_obligations', action: 'capped' }] }),
      budgetAccount({ id: 3 }),
    ]),
  }));
  try {
    const out: any = await tangoTools.callTool('search_tango_budget_accounts', {});
    assert.equal(out.accounts.length, 3);
    assert.ok(out.warnings.some((w: string) => /1 row\(s\) are partial fiscal years/.test(w)));
    assert.ok(out.warnings.some((w: string) => /1 row\(s\) carry source_anomalies/.test(w)));
    // Warnings describe the rows; they do not distrust the upstream total.
    assert.equal(out.total, 3);
  } finally {
    stub.restore();
  }
});

test('budget accounts: cursor replays the next page and refuses cursors for other endpoints', async () => {
  const stub = stubTangoGet(() => ({ success: true, data: page([budgetAccount()]) }));
  try {
    await tangoTools.callTool('search_tango_budget_accounts', {
      cursor: 'https://tango.makegov.com/api/budget/accounts/?fiscal_year=2024&limit=10&page=2',
    });
    assert.equal(stub.calls[0].endpoint, '/budget/accounts/');
    assert.deepEqual(stub.calls[0].params, { fiscal_year: '2024', limit: '10', page: '2' });

    const wrong: any = await tangoTools.callTool('search_tango_budget_accounts', {
      cursor: 'https://tango.makegov.com/api/contracts/?page=2',
    });
    assert.equal(wrong.error.code, 'bad_request');
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('budget account detail: full shape by default, appendix and narratives on request', async () => {
  const stub = stubTangoGet(() => ({ success: true, data: budgetAccount({ appendix: { contractual_services: 1 } }) }));
  try {
    const out: any = await tangoTools.callTool('get_tango_budget_account', { account_id: 17647 });
    assert.equal(stub.calls[0].endpoint, '/budget/accounts/17647/');
    assert.deepEqual(stub.calls[0].params, { shape: '*' });
    assert.equal(out.account_id, 17647);
    assert.equal(out.id, undefined);
    assert.equal(out.account_title, 'Exploration');

    await tangoTools.callTool('get_tango_budget_account', {
      account_id: '17647',
      include_appendix: true,
      include_narratives: true,
    });
    assert.equal(stub.calls[1].endpoint, '/budget/accounts/17647/');
    assert.deepEqual(stub.calls[1].params, { shape: '*,appendix(*),narratives(*)' });
  } finally {
    stub.restore();
  }
});

test('budget account tools reject a federal account symbol or path text as account_id', async () => {
  const stub = stubTangoGet(() => {
    throw new Error('upstream must not be called');
  });
  try {
    for (const tool of ['get_tango_budget_account', 'get_tango_budget_account_recipients', 'get_tango_budget_account_quarters']) {
      const symbol: any = await tangoTools.callTool(tool, { account_id: '075-0512' });
      assert.equal(symbol.error.code, 'bad_request', tool);
      assert.match(symbol.error.message, /federal_account_symbol/);
      const traversal: any = await tangoTools.callTool(tool, { account_id: '1/../../contracts' });
      assert.equal(traversal.error.code, 'bad_request', tool);
    }
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('budget account recipients: drill-down endpoint, office filter, and account context', async () => {
  const nextUrl = 'https://tango.makegov.com/api/budget/accounts/17647/recipients/?limit=10&page=2';
  const recipient = {
    funding_organization_id: '6f1c2b8e-0000-4000-8000-000000000001',
    recipient_id: 'UEI000000001',
    recipient: { uei: 'UEI000000001', legal_business_name: 'ACME SPACE LLC', dba_name: null },
    contract_obligated: 1200000000,
    n_contracts: 3,
    contracts: [{ key: 'CONT_AWD_X', piid: 'X', naics: '336414', psc: 'AR11', obligated: 900000000, award_date: '2023-10-01' }],
  };
  const stub = stubTangoGet(() => ({
    success: true,
    data: { federal_account_symbol: '080-0124', fiscal_year: 2024, ...page([recipient], { count: 57, next: nextUrl }) },
  }));
  try {
    const out: any = await tangoTools.callTool('get_tango_budget_account_recipients', {
      account_id: 17647,
      funding_organization_id: '6f1c2b8e-0000-4000-8000-000000000001',
      limit: 10,
    });
    assert.equal(stub.calls[0].endpoint, '/budget/accounts/17647/recipients/');
    assert.deepEqual(stub.calls[0].params, { limit: 10, funding_organization_id: '6f1c2b8e-0000-4000-8000-000000000001' });
    assert.equal(out.account_id, 17647);
    assert.equal(out.federal_account_symbol, '080-0124');
    assert.equal(out.fiscal_year, 2024);
    assert.equal(out.recipients[0].recipient.legal_business_name, 'ACME SPACE LLC');
    assert.equal(out.recipients[0].contracts.length, 1);
    assert.equal(out.total, 57);
    assert.equal(out.next_cursor, nextUrl);

    // The next page of one account cannot be replayed against another.
    const other: any = await tangoTools.callTool('get_tango_budget_account_recipients', { account_id: 1, cursor: nextUrl });
    assert.equal(other.error.code, 'bad_request');
    await tangoTools.callTool('get_tango_budget_account_recipients', { account_id: 17647, cursor: nextUrl });
    assert.equal(stub.calls[1].endpoint, '/budget/accounts/17647/recipients/');
    assert.deepEqual(stub.calls[1].params, { limit: '10', page: '2' });
  } finally {
    stub.restore();
  }
});

test('budget account quarters: TAS filter, and an empty pre-FY2021 result is explained', async () => {
  const quarter = { tas: '080-2024-2024-0124', quarter: 1, period: 'quarterly', obligated_quarterly: 1, outlayed_quarterly: 1 };
  let rows: any[] = [quarter];
  const stub = stubTangoGet(() => ({ success: true, data: page(rows) }));
  try {
    const out: any = await tangoTools.callTool('get_tango_budget_account_quarters', { account_id: 17647, tas: '080-2024-2024-0124' });
    assert.equal(stub.calls[0].endpoint, '/budget/accounts/17647/quarters/');
    assert.deepEqual(stub.calls[0].params, { limit: 10, tas: '080-2024-2024-0124' });
    assert.equal(out.quarters.length, 1);
    assert.equal(out.warnings, undefined);

    rows = [];
    const empty: any = await tangoTools.callTool('get_tango_budget_account_quarters', { account_id: 99 });
    assert.equal(empty.quarters.length, 0);
    assert.ok(empty.warnings.some((w: string) => /FY2021/.test(w)));
  } finally {
    stub.restore();
  }
});

test('entity budget flows: normalized UEI path, fiscal year filter, malformed UEI rejected', async () => {
  const flow = { federal_account_symbol: '080-0124', account_title: 'Exploration', contract_obligated: 5, contracts: [] };
  const stub = stubTangoGet(() => ({ success: true, data: page([flow], { count: 4 }) }));
  try {
    const out: any = await tangoTools.callTool('get_tango_entity_budget_flows', { uei: ' uei000000001 ', fiscal_year: 2024 });
    assert.equal(stub.calls[0].endpoint, '/entities/UEI000000001/budget-flows/');
    assert.deepEqual(stub.calls[0].params, { limit: 10, fiscal_year: 2024 });
    assert.equal(out.uei, 'UEI000000001');
    assert.equal(out.flows[0].account_title, 'Exploration');
    assert.equal(out.total, 4);

    const bad: any = await tangoTools.callTool('get_tango_entity_budget_flows', { uei: 'UEI/../x' });
    assert.equal(bad.error.code, 'bad_request');
    assert.equal(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

test('budget tools surface upstream errors instead of empty results', async () => {
  const stub = stubTangoGet(() => ({ success: false, data: null, error: 'Tango API error (400): bad shape' }));
  try {
    const search: any = await tangoTools.callTool('search_tango_budget_accounts', {});
    assert.equal(search.error, 'Tango API error (400): bad shape');
    const detail: any = await tangoTools.callTool('get_tango_budget_account', { account_id: 1 });
    assert.equal(detail.error, 'Tango API error (400): bad shape');
    const flows: any = await tangoTools.callTool('get_tango_entity_budget_flows', { uei: 'UEI000000001' });
    assert.equal(flows.error, 'Tango API error (400): bad shape');
  } finally {
    stub.restore();
  }
});
