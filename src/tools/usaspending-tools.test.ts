import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../utils/api-client.js';
import { usaspendingTools } from './usaspending-tools.js';
import { referenceTools } from './reference-tools.js';

function stubUsaspending(handlers: {
  post?: (endpoint: string, body: any) => any;
  get?: (endpoint: string, params?: any) => any;
}) {
  const originals = { post: ApiClient.usaspendingPost, get: ApiClient.usaspendingGet };
  const calls: Array<{ kind: string; endpoint: string; payload: any }> = [];
  if (handlers.post) {
    (ApiClient as any).usaspendingPost = async (endpoint: string, body: any) => {
      calls.push({ kind: 'post', endpoint, payload: body });
      return handlers.post!(endpoint, body);
    };
  }
  if (handlers.get) {
    (ApiClient as any).usaspendingGet = async (endpoint: string, params?: any) => {
      calls.push({ kind: 'get', endpoint, payload: params });
      return handlers.get!(endpoint, params);
    };
  }
  return {
    calls,
    restore() {
      (ApiClient as any).usaspendingPost = originals.post;
      (ApiClient as any).usaspendingGet = originals.get;
    },
  };
}

test('lookup_reference_code resolves a code, lists a domain, rejects unknowns', async () => {
  const hit: any = await referenceTools.callTool('lookup_reference_code', { domain: 'set_aside', code: '8an' });
  assert.equal(hit.code, '8AN');
  assert.match(hit.description, /Sole Source/);

  const listed: any = await referenceTools.callTool('lookup_reference_code', { domain: 'extent_competed' });
  assert.ok(listed.codes.length >= 7);

  const badDomain: any = await referenceTools.callTool('lookup_reference_code', { domain: 'colors' });
  assert.equal(badDomain.error.code, 'bad_request');

  const badCode: any = await referenceTools.callTool('lookup_reference_code', { domain: 'set_aside', code: 'XX' });
  assert.equal(badCode.error.code, 'not_found');
  assert.match(badCode.error.message, /8AN/);
});

test('get_award_detail returns the competition block with described codes', async () => {
  const stub = stubUsaspending({
    get: () => ({
      success: true,
      data: {
        generated_unique_award_id: 'CONT_AWD_36C10B21D0042_3600_-NONE-_-NONE-',
        piid: '36C10B21D0042',
        category: 'contract',
        type: 'D',
        type_description: 'DEFINITIVE CONTRACT',
        description: 'DEVSECOPS',
        total_obligation: 3100000,
        awarding_agency: {
          toptier_agency: { name: 'Department of Veterans Affairs', code: '036' },
          subtier_agency: { name: 'Veterans Health Administration' },
        },
        recipient: { recipient_name: 'EXAMPLE FEDERAL LLC', uei: 'ABCDEF123456' },
        period_of_performance: { start_date: '2021-06-01', end_date: '2026-05-31' },
        latest_transaction_contract_data: {
          type_set_aside: '8AN',
          type_set_aside_description: 'FPDS SAYS SOLE SOURCE',
          extent_competed: 'C',
          number_of_offers_received: '1',
          solicitation_procedures: 'SSS',
          other_than_full_and_open: 'ONE',
          naics: '541511',
          naics_description: 'CUSTOM COMPUTER PROGRAMMING',
          product_or_service_code: 'D307',
        },
      },
    }),
  });
  try {
    const out: any = await usaspendingTools.callTool('get_award_detail', {
      award_id: 'CONT_AWD_36C10B21D0042_3600_-NONE-_-NONE-',
    });
    assert.equal(out.competition.type_set_aside.code, '8AN');
    assert.match(out.competition.type_set_aside.description, /Sole Source/);
    assert.equal(out.competition.type_set_aside.upstream_description, 'FPDS SAYS SOLE SOURCE');
    assert.equal(out.competition.extent_competed.code, 'C');
    assert.match(out.competition.extent_competed.description, /Not Competed/);
    assert.equal(out.competition.number_of_offers_received, '1');
    assert.match(out.competition.solicitation_procedures.description, /Only One Source/);
  } finally {
    stub.restore();
  }
});

test('get_award_detail resolves a bare PIID through award search first', async () => {
  const stub = stubUsaspending({
    post: () => ({
      success: true,
      data: { results: [{ 'Award ID': '36C10B21D0042', generated_internal_id: 'CONT_AWD_36C10B21D0042_3600_-NONE-_-NONE-' }] },
    }),
    get: (endpoint: string) => {
      assert.match(endpoint, /CONT_AWD_36C10B21D0042/);
      return { success: true, data: { piid: '36C10B21D0042', latest_transaction_contract_data: {} } };
    },
  });
  try {
    const out: any = await usaspendingTools.callTool('get_award_detail', { award_id: '36C10B21D0042' });
    assert.equal(out.piid, '36C10B21D0042');
    assert.equal(stub.calls[0].kind, 'post');
    assert.deepEqual(stub.calls[0].payload.filters.award_ids, ['36C10B21D0042']);
  } finally {
    stub.restore();
  }
});

test('aggregate_contracts group_by=set_aside metric=count runs one labeled query per code', async () => {
  const perCode: Record<string, number> = { '8AN': 617, SDVOSBS: 231 };
  const stub = stubUsaspending({
    post: (endpoint: string, body: any) => {
      assert.equal(endpoint, '/search/spending_by_award_count/');
      const code = body.filters.set_aside_type_codes[0];
      assert.deepEqual(body.filters.time_period, [
        { start_date: '2025-08-01', end_date: '2025-09-30', date_type: 'action_date' },
      ]);
      return { success: true, data: { results: { contracts: perCode[code], idvs: 0 } } };
    },
  });
  try {
    const out: any = await usaspendingTools.callTool('aggregate_contracts', {
      group_by: 'set_aside',
      metric: 'count',
      date_from: '2025-08-01',
      date_to: '2025-09-30',
      set_aside: ['8AN', 'SDVOSBS'],
    });
    assert.equal(out.groups.length, 2);
    assert.equal(out.groups[0].code, '8AN');
    assert.equal(out.groups[0].value, 617);
    assert.match(out.groups[0].description, /Sole Source/);
    assert.match(out.count_unit, /prime awards/);
    assert.match(out.date_field, /action_date/);
  } finally {
    stub.restore();
  }
});

test('aggregate_contracts group_by=awarding_agency uses spending_by_category', async () => {
  const stub = stubUsaspending({
    post: (endpoint: string, body: any) => {
      assert.equal(endpoint, '/search/spending_by_category/awarding_agency/');
      assert.deepEqual(body.filters.set_aside_type_codes, ['8AN']);
      return {
        success: true,
        data: {
          results: [
            { name: 'Department of the Army', code: '2100', amount: 123456.78 },
            { name: 'General Services Administration', code: '4732', amount: 55555.55 },
          ],
        },
      };
    },
  });
  try {
    const out: any = await usaspendingTools.callTool('aggregate_contracts', {
      group_by: 'awarding_agency',
      date_from: '2025-08-01',
      date_to: '2025-09-30',
      set_aside: '8AN',
    });
    assert.equal(out.groups.length, 2);
    assert.equal(out.groups[0].label, 'Department of the Army');
    assert.match(out.count_unit, /obligated dollars/);
  } finally {
    stub.restore();
  }
});

test('aggregate_contracts rejects unsupported combos and bad inputs loudly', async () => {
  const cases: Array<[any, RegExp]> = [
    [{ group_by: 'color', date_from: 'x', date_to: 'y' }, /group_by must be one of/],
    [{ group_by: 'naics', metric: 'count', date_from: 'x', date_to: 'y' }, /only supported with group_by 'set_aside'/],
    [{ group_by: 'naics', date_from: '2025-01-01', date_to: '2025-02-01', date_type: 'whenever' }, /date_type/],
    [{ group_by: 'set_aside', date_from: '2025-01-01', date_to: '2025-02-01' }, /requires the set_aside codes/],
    [{ group_by: 'naics', date_from: '2025-01-01', date_to: '2025-02-01', set_aside: ['NOPE'] }, /Valid FPDS codes/],
    [{ group_by: 'naics', date_from: '2025-01-01', date_to: '2025-02-01', sub_agency: 'X' }, /requires agency/],
  ];
  for (const [args, pattern] of cases) {
    const out: any = await usaspendingTools.callTool('aggregate_contracts', args);
    assert.equal(out.error?.code, 'bad_request', JSON.stringify(args));
    assert.match(out.error.message, pattern);
  }
});
