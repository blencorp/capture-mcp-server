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
        period_of_performance: {
          start_date: '2021-06-01',
          end_date: '2026-05-31',
          potential_end_date: '2031-05-31',
        },
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
    assert.equal(out.competition.other_than_full_and_open_competition, 'ONE');
    assert.match(out.competition.other_than_full_and_open_competition_description, /Only One Source/);
    assert.equal(out.period_of_performance.current_end_date, '2026-05-31');
    assert.equal(out.period_of_performance.potential_end_date, '2031-05-31');
    assert.equal(out.period_of_performance.ultimate_end_date, '2031-05-31');
  } finally {
    stub.restore();
  }
});

test('get_award_detail rejects assistance IDs before calling the FPDS detail path', async () => {
  const stub = stubUsaspending({
    get: () => {
      throw new Error('assistance IDs must not reach the procurement detail endpoint');
    },
    post: () => {
      throw new Error('assistance IDs must not be resolved as bare PIIDs');
    },
  });
  try {
    const out: any = await usaspendingTools.callTool('get_award_detail', {
      award_id: 'ASST_NON_AIDOAAA1700017_072',
    });
    assert.equal(out.error.code, 'bad_request');
    assert.match(out.error.message, /procurement awards only/);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('get_award_detail resolves a bare PIID through award search first', async () => {
  const stub = stubUsaspending({
    post: (_endpoint: string, body: any) =>
      body.filters.award_type_codes[0] === 'A'
        ? {
            success: true,
            data: {
              results: [
                {
                  'Award ID': '36C10B21D0042',
                  generated_internal_id: 'CONT_AWD_36C10B21D0042_3600_-NONE-_-NONE-',
                },
              ],
              page_metadata: { hasNext: false },
            },
          }
        : { success: true, data: { results: [], page_metadata: { hasNext: false } } },
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
    assert.deepEqual(stub.calls[0].payload.filters.award_type_codes, ['A', 'B', 'C', 'D']);
    assert.deepEqual(stub.calls[1].payload.filters.award_type_codes, [
      'IDV_A',
      'IDV_B',
      'IDV_B_A',
      'IDV_B_B',
      'IDV_B_C',
      'IDV_C',
      'IDV_D',
      'IDV_E',
    ]);
    assert.equal(stub.calls.filter((call) => call.kind === 'post').length, 2);
    assert.equal(stub.calls[2].kind, 'get');
  } finally {
    stub.restore();
  }
});

test('get_award_detail retries bare PIID resolution with only IDV award types', async () => {
  let searches = 0;
  const stub = stubUsaspending({
    post: () => {
      searches += 1;
      return searches === 1
        ? {
            success: true,
            data: {
              results: [
                {
                  'Award ID': '47QRCA24DV006A',
                  generated_internal_id: 'CONT_AWD_47QRCA24DV006A_4732_-NONE-_-NONE-',
                },
              ],
            },
          }
        : {
            success: true,
            data: {
              results: [
                {
                  'Award ID': '47QRCA24DV006',
                  generated_internal_id: 'CONT_IDV_47QRCA24DV006_4732',
                },
              ],
            },
          };
    },
    get: () => ({
      success: true,
      data: { piid: '47QRCA24DV006', latest_transaction_contract_data: {} },
    }),
  });
  try {
    const out: any = await usaspendingTools.callTool('get_award_detail', { award_id: '47QRCA24DV006' });
    assert.equal(out.piid, '47QRCA24DV006');
    assert.deepEqual(stub.calls[0].payload.filters.award_type_codes, ['A', 'B', 'C', 'D']);
    assert.deepEqual(stub.calls[1].payload.filters.award_type_codes, [
      'IDV_A',
      'IDV_B',
      'IDV_B_A',
      'IDV_B_B',
      'IDV_B_C',
      'IDV_C',
      'IDV_D',
      'IDV_E',
    ]);
    assert.equal(stub.calls[2].kind, 'get');
  } finally {
    stub.restore();
  }
});

test('get_award_detail fails closed when the same PIID exists in contract and IDV groups', async () => {
  const stub = stubUsaspending({
    post: (_endpoint: string, body: any) => ({
      success: true,
      data: {
        results: [
          {
            'Award ID': 'SHARED0001',
            generated_internal_id:
              body.filters.award_type_codes[0] === 'A'
                ? 'CONT_AWD_SHARED0001_9700_-NONE-_-NONE-'
                : 'CONT_IDV_SHARED0001_9700',
          },
        ],
        page_metadata: { hasNext: false },
      },
    }),
    get: () => {
      throw new Error('detail lookup must not run for an ambiguous PIID');
    },
  });
  try {
    const out: any = await usaspendingTools.callTool('get_award_detail', { award_id: 'SHARED0001' });
    assert.equal(out.error.code, 'ambiguous_award_id');
    assert.deepEqual(
      out.error.candidates.map((candidate: any) => candidate.award_type_group),
      ['contracts', 'idvs']
    );
    assert.equal(stub.calls.some((call) => call.kind === 'get'), false);
  } finally {
    stub.restore();
  }
});

test('get_award_detail fails closed when pagination reveals an ambiguous bare PIID', async () => {
  const stub = stubUsaspending({
    post: (_endpoint: string, body: any) => ({
      success: true,
      data:
        body.page === 1
          ? {
              results: [
                {
                  'Award ID': '0001',
                  generated_internal_id: 'CONT_AWD_0001_9700_PARENT_A_9700',
                  'Awarding Agency': 'Department of Defense',
                },
              ],
              page_metadata: { hasNext: true },
            }
          : {
              results: [
                {
                  'Award ID': '0001',
                  generated_internal_id: 'CONT_AWD_0001_7500_PARENT_B_7500',
                  'Awarding Agency': 'Department of Health and Human Services',
                },
              ],
              page_metadata: { hasNext: false },
            },
    }),
    get: () => {
      throw new Error('detail lookup must not run for an ambiguous PIID');
    },
  });
  try {
    const out: any = await usaspendingTools.callTool('get_award_detail', { award_id: '0001' });
    assert.equal(out.error.code, 'ambiguous_award_id');
    assert.equal(out.error.candidates.length, 2);
    assert.deepEqual(
      out.error.candidates.map((candidate: any) => candidate.generated_unique_award_id),
      ['CONT_AWD_0001_9700_PARENT_A_9700', 'CONT_AWD_0001_7500_PARENT_B_7500']
    );
    assert.deepEqual(
      stub.calls.filter((call) => call.kind === 'post').map((call) => call.payload.page),
      [1, 2]
    );
    assert.equal(out.error.candidate_count_at_least, 2);
    assert.equal(out.error.candidates_truncated, true);
    assert.equal(stub.calls.some((call) => call.kind === 'get'), false);
  } finally {
    stub.restore();
  }
});

test('search_usaspending_awards_by_recipient exposes the generated award ID', async () => {
  const stub = stubUsaspending({
    post: (_endpoint: string, body: any) => {
      assert.ok(body.fields.includes('generated_internal_id'));
      assert.deepEqual(body.filters.award_type_codes, ['A', 'B', 'C', 'D']);
      assert.deepEqual(body.filters.time_period, [
        { start_date: '2025-10-01', end_date: '2026-09-30', date_type: 'action_date' },
      ]);
      return {
        success: true,
        data: {
          results:
            body.page === 1
              ? [
                  {
                    'Award ID': '36C10B26F0223',
                    generated_internal_id: 'CONT_AWD_36C10B26F0223_3600_47QRCA24DV006_4732',
                    'Recipient Name': 'IRONARCH TECHNOLOGY LLC',
                    'Award Amount': 606072.42,
                  },
                ]
              : [],
          page_metadata: { page: body.page, hasNext: body.page === 1 },
        },
      };
    },
  });
  try {
    const out: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: 'IRONARCH TECHNOLOGY',
      fiscal_year: 2026,
    });
    assert.equal(
      out.awards[0].generated_unique_award_id,
      'CONT_AWD_36C10B26F0223_3600_47QRCA24DV006_4732'
    );
    assert.equal(out.total, null);
    assert.equal(out.total_results, null);
    assert.equal(out.next_cursor, '2');
    assert.equal(out.search_summary.total_amount, null);
    assert.equal(out.search_summary.page_amount, 606072.42);
    assert.deepEqual(out.search_summary.award_types, ['A', 'B', 'C', 'D']);
    assert.equal(out.search_summary.award_type_group, 'contracts');
    assert.equal(out.search_summary.get_award_detail_compatible, true);
    assert.match(out.warnings[0], /does not provide a trustworthy population total/);

    const next: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: 'IRONARCH TECHNOLOGY',
      fiscal_year: 2026,
      cursor: out.next_cursor,
    });
    assert.equal(stub.calls[1].payload.page, 2);
    assert.equal(next.next_cursor, null);
  } finally {
    stub.restore();
  }
});

test('search_usaspending_awards_by_recipient rejects mixed and unknown award-type groups locally', async () => {
  const stub = stubUsaspending({
    post: () => {
      throw new Error('upstream must not be called for invalid award type groups');
    },
  });
  try {
    const mixed: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: 'EXAMPLE',
      award_types: ['A', 'IDV_A'],
    });
    assert.equal(mixed.error.code, 'bad_request');
    assert.match(mixed.error.message, /exactly one USASpending group/);

    const unknown: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: 'EXAMPLE',
      award_types: ['NOPE'],
    });
    assert.equal(unknown.error.code, 'bad_request');
    assert.match(unknown.error.message, /Unknown USASpending award type/);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('search_usaspending_awards_by_recipient marks assistance IDs as incompatible with FPDS detail', async () => {
  const stub = stubUsaspending({
    post: () => ({
      success: true,
      data: {
        results: [
          {
            'Award ID': 'AIDOAAA1700017',
            generated_internal_id: 'ASST_NON_AIDOAAA1700017_072',
          },
        ],
        page_metadata: { hasNext: false },
      },
    }),
  });
  try {
    const out: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: 'JOHNS HOPKINS',
      award_types: ['02', '03', '04', '05'],
    });
    assert.equal(out.search_summary.award_type_group, 'grants');
    assert.equal(out.search_summary.get_award_detail_compatible, false);
  } finally {
    stub.restore();
  }
});

test('search_usaspending_awards_by_recipient preserves zero bounds and rejects malformed inputs', async () => {
  const stub = stubUsaspending({
    post: (_endpoint: string, body: any) => {
      assert.deepEqual(body.filters.award_amounts, [{ lower_bound: 0, upper_bound: 0 }]);
      assert.equal(body.filters.recipient_search_text[0], 'EXAMPLE');
      assert.equal(body.limit, 1);
      return { success: true, data: { results: [], page_metadata: { hasNext: false } } };
    },
  });
  try {
    const out: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: '  EXAMPLE  ',
      min_amount: 0,
      max_amount: 0,
      limit: 0,
    });
    assert.equal(out.error, undefined);
    assert.equal(out.recipient_name, 'EXAMPLE');

    const badCursor: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: 'EXAMPLE',
      cursor: 'not-a-page',
    });
    assert.equal(badCursor.error.code, 'bad_request');

    const badRange: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: 'EXAMPLE',
      min_amount: 10,
      max_amount: 5,
    });
    assert.equal(badRange.error.code, 'bad_request');

    const badYear: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: 'EXAMPLE',
      fiscal_year: 2026.5,
    });
    assert.equal(badYear.error.code, 'bad_request');

    const missingRecipient: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {});
    assert.equal(missingRecipient.error.code, 'bad_request');

    const blankRecipient: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: '   ',
    });
    assert.equal(blankRecipient.error.code, 'bad_request');

    const badLimit: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: 'EXAMPLE',
      limit: 'not-a-number',
    });
    assert.equal(badLimit.error.code, 'bad_request');

    const badAmount: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: 'EXAMPLE',
      min_amount: 'not-a-number',
    });
    assert.equal(badAmount.error.code, 'bad_request');

    const nonArrayTypes: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: 'EXAMPLE',
      award_types: 'A',
    });
    assert.equal(nonArrayTypes.error.code, 'bad_request');

    const emptyTypes: any = await usaspendingTools.callTool('search_usaspending_awards_by_recipient', {
      recipient_name: 'EXAMPLE',
      award_types: [],
    });
    assert.equal(emptyTypes.error.code, 'bad_request');
    assert.equal(stub.calls.length, 1);
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
