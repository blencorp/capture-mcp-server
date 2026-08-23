import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../utils/api-client.js';
import {
  highergovTools,
  normalizeContractSummary,
  normalizeContractFull,
  contractMappingDriftWarning,
} from './highergov-tools.js';
import {
  documentedContractRecord,
  alienContractRecord,
  interiorContractRecord,
  dojContractRecord,
  contractPage,
} from './__fixtures__/highergov-contract.fixture.js';

process.env.HIGHERGOV_API_KEY = process.env.HIGHERGOV_API_KEY || 'test-key';

function stubHighergovGet(handler: (endpoint: string, params: Record<string, any>) => any) {
  const original = ApiClient.highergovGet;
  (ApiClient as any).highergovGet = async (endpoint: string, params: Record<string, any>) =>
    handler(endpoint, params);
  return () => {
    (ApiClient as any).highergovGet = original;
  };
}

test('normalizeContractSummary populates every declared field from a spec-shape record', () => {
  const row = normalizeContractSummary(documentedContractRecord);
  assert.equal(row.piid, '36C10B21D0042');
  // The spec exposes no surrogate key; award_id is the record ID.
  assert.equal(row.contract_id, '36C10B21D0042');
  assert.match(row.title, /T4NG TASK ORDER/);
  assert.equal(row.incumbent_name, 'EXAMPLE FEDERAL LLC');
  assert.equal(row.incumbent_uei, 'ABCDEF123456');
  assert.equal(row.agency, 'va');
  assert.equal(row.funding_agency, 'va');
  assert.deepEqual(row.naics, ['541511']);
  assert.deepEqual(row.psc, ['D307']);
  assert.equal(row.set_aside, 'sdvosbs');
  assert.deepEqual(row.set_aside_code, {
    code: 'SDVOSBS',
    description: 'Service-Disabled Veteran-Owned Small Business Sole Source (FAR 19.14)',
  });
  assert.equal(row.vehicle, 't4ng');
  assert.equal(row.value, 4250000);
  assert.match(String(row.pop_start), /^2021-06-01/);
  assert.match(String(row.pop_end), /^2026-05-31/);
  assert.match(String(row.pop_potential_end), /^2027-05-31/);
  assert.equal(row.source_url, 'https://www.highergov.com/contract/36C10B21D0042/');
});

test('normalizeContractSummary derives piid/contract_id from source_url as a last resort', () => {
  const row = normalizeContractSummary(alienContractRecord);
  assert.equal(row.piid, '15F06724A0000364-15F06724F0002206');
  assert.equal(row.contract_id, '15F06724A0000364-15F06724F0002206');
});

test('normalizeContractFull maps obligations, competition details, and contacts', () => {
  const row = normalizeContractFull(documentedContractRecord);
  assert.equal(row.obligated_value, 3100000);
  assert.equal(row.potential_value, 9500000);
  assert.equal(row.award_type, 'DELIVERY ORDER');
  assert.equal(row.solicitation_id, '36C10B21Q0177');
  assert.equal(row.pricing_type, 'FIRM FIXED PRICE');
  assert.equal(row.extent_competed, 'NOT COMPETED UNDER SAP');
  assert.equal(row.number_of_offers_received, '1');
  assert.equal(row.place_of_performance.state, 'DC');
  assert.equal(row.contracting_contacts.length, 1);
  assert.equal(row.contracting_contacts[0].email, 'jordan.sample@va.gov');
  assert.equal(row.contracting_contacts[0].role, 'created_by');
});

test('drift tripwire fires when every record is hollow, and names the raw keys', () => {
  const rawList = [alienContractRecord];
  const mapped = rawList.map(r => normalizeContractSummary({ ...r, path: undefined }));
  const warning = contractMappingDriftWarning(mapped, rawList);
  assert.ok(warning, 'expected a drift warning');
  assert.match(warning!, /OUT OF DATE/);
  assert.match(warning!, /zz_award_number/);
});

test('drift tripwire stays quiet when records map', () => {
  const rawList = [documentedContractRecord];
  const mapped = rawList.map(normalizeContractSummary);
  assert.equal(contractMappingDriftWarning(mapped, rawList), null);
});

test('search_highergov_contracts filters non-matching agencies client-side and says so (P0-6)', async () => {
  const restore = stubHighergovGet(() => ({
    success: true,
    data: contractPage([documentedContractRecord, interiorContractRecord, dojContractRecord], { count: 3120 }),
  }));
  try {
    const out: any = await highergovTools.callTool('search_highergov_contracts', {
      agency: 'Department of Veterans Affairs',
      naics: ['541511'],
    });
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].agency, 'va');
    assert.equal(out.filters.client_side.agency, 'Department of Veterans Affairs');
    assert.ok(out.warnings.some((w: string) => /no agency-name filter/.test(w)));
    // The name never goes upstream — the spec has no such parameter.
    assert.equal(out.filters.upstream.agency_name, undefined);
    // Client-side filtering means the upstream total may not be presented as trustworthy.
    assert.equal(out.total, null);
    assert.equal(out.total_upstream_unfiltered, 3120);
  } finally {
    restore();
  }
});

test('search_highergov_contracts keeps total when the upstream results all match', async () => {
  const restore = stubHighergovGet(() => ({
    success: true,
    data: contractPage([documentedContractRecord], { count: 42 }),
  }));
  try {
    const out: any = await highergovTools.callTool('search_highergov_contracts', {
      agency: 'VA',
      naics: ['541511'],
    });
    assert.equal(out.results.length, 1);
    assert.equal(out.total, 42);
    assert.deepEqual(out.filters.client_side, {});
  } finally {
    restore();
  }
});

test('search_highergov_contracts warns instead of pretending when agency cannot be verified', async () => {
  const restore = stubHighergovGet(() => ({
    success: true,
    data: contractPage([alienContractRecord]),
  }));
  try {
    const out: any = await highergovTools.callTool('search_highergov_contracts', {
      agency: 'VA',
      naics: ['541511'],
    });
    assert.ok(out.warnings.some((w: string) => /UNFILTERED by agency/.test(w)));
    assert.ok(out.warnings.some((w: string) => /OUT OF DATE/.test(w)));
  } finally {
    restore();
  }
});

test('search_highergov_contracts applies set_aside and pop_end bounds client-side', async () => {
  const laterPop = {
    ...documentedContractRecord,
    award_id: 'X1',
    type_of_set_aside: '8AN',
    period_of_performance_current_end_date: '2030-01-01',
    path: 'https://www.highergov.com/contract/X1/',
  };
  const restore = stubHighergovGet(() => ({
    success: true,
    data: contractPage([documentedContractRecord, laterPop]),
  }));
  try {
    const out: any = await highergovTools.callTool('search_highergov_contracts', {
      naics: ['541511'],
      set_aside: ['sdvosbs'],
      pop_end_before: '2027-01-01',
    });
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].piid, '36C10B21D0042');
    assert.deepEqual(out.filters.client_side.set_aside, ['sdvosbs']);
  } finally {
    restore();
  }
});

test('search_highergov_contracts surfaces next_cursor from the next URL', async () => {
  const restore = stubHighergovGet(() => ({
    success: true,
    data: contractPage([documentedContractRecord], {
      next: 'https://www.highergov.com/api-external/contract/?naics_code=541511&page_number=2',
    }),
  }));
  try {
    const out: any = await highergovTools.callTool('search_highergov_contracts', { naics: ['541511'] });
    assert.equal(out.next_cursor, '2');
  } finally {
    restore();
  }
});

test('search_highergov_contracts rejects garbled date bounds as bad_request', async () => {
  const restore = stubHighergovGet(() => ({ success: true, data: contractPage([]) }));
  try {
    const out: any = await highergovTools.callTool('search_highergov_contracts', {
      naics: ['541511'],
      pop_end_before: 'not-a-date',
    });
    assert.equal(out.error.code, 'bad_request');
    assert.match(out.error.message, /pop_end_before/);
  } finally {
    restore();
  }
});

test('search_highergov_opportunities filters the set-aside bundle and drops closed notices', async () => {
  // Spec-shape Opportunity records: agency is AgencySimple, naics_code/psc_code
  // are nested single-key objects, envelope is meta.pagination + links.
  const oppPage = {
    results: [
      {
        opp_key: 'aaa111',
        source_id: 'FA0000-25-R-0001',
        title: '8(a) IT Services',
        agency: { agency_key: 3600, agency_name: 'Department of Veterans Affairs' },
        naics_code: { naics_code: '541512' },
        psc_code: { psc_code: 'D302' },
        opp_type: { description: 'Solicitation' },
        set_aside: '8(a) Sole Source',
        posted_date: '2026-08-20',
        due_date: '2099-09-15',
        path: 'https://www.highergov.com/opportunity/aaa111/',
      },
      {
        opp_key: 'bbb222',
        source_id: 'FA0000-25-R-0002',
        title: 'Unrestricted thing',
        agency: { agency_key: 1500, agency_name: 'Department of Justice' },
        naics_code: { naics_code: '541512' },
        psc_code: { psc_code: 'D302' },
        opp_type: { description: 'Solicitation' },
        set_aside: 'Full and Open',
        posted_date: '2026-08-21',
        due_date: '2099-09-01',
        path: 'https://www.highergov.com/opportunity/bbb222/',
      },
    ],
    meta: { pagination: { page: 1, pages: 1, count: 2 } },
    links: { first: '', last: '', next: null, prev: null },
  };
  const restore = stubHighergovGet((_endpoint, params) => {
    // Per the spec, /opportunity/ has no naics/psc params — they must not be sent.
    assert.equal(params.naics_code, undefined);
    assert.equal(params.psc_code, undefined);
    return { success: true, data: oppPage };
  });
  try {
    const out: any = await highergovTools.callTool('search_highergov_opportunities', {
      set_aside: ['8a'],
      naics: ['5415'],
    });
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].sam_notice_id, 'FA0000-25-R-0001');
    assert.deepEqual(out.filters.client_side.set_aside, ['8a']);
  } finally {
    restore();
  }
});

test('search_highergov_contracts sends agency_key upstream as awarding_agency_key', async () => {
  const restore = stubHighergovGet((_endpoint, params) => {
    assert.equal(params.awarding_agency_key, 3600);
    return { success: true, data: contractPage([documentedContractRecord]) };
  });
  try {
    const out: any = await highergovTools.callTool('search_highergov_contracts', { agency_key: 3600 });
    assert.equal(out.results.length, 1);
    assert.equal(out.filters.upstream.awarding_agency_key, 3600);
  } finally {
    restore();
  }
});

test('search_highergov_people binds email upstream and applies agency client-side', async () => {
  const peoplePage = {
    results: [
      {
        contact_name: 'Jordan Sample',
        contact_title: 'Contracting Officer',
        contact_email: 'jordan.sample@va.gov',
        contact_phone: '202-555-0100',
        contact_type: 'Contracting',
        agency: { agency_key: 3600, agency_name: 'Department of Veterans Affairs' },
        last_seen: '2026-08-01',
        path: 'https://www.highergov.com/people/jordan-sample/',
      },
      {
        contact_name: 'Alex Other',
        contact_title: 'Program Analyst',
        contact_email: 'alex.other@doj.gov',
        agency: { agency_key: 1500, agency_name: 'Department of Justice' },
        path: 'https://www.highergov.com/people/alex-other/',
      },
    ],
    meta: { pagination: { page: 1, pages: 1, count: 2 } },
    links: { first: '', last: '', next: null, prev: null },
  };
  const restore = stubHighergovGet((_endpoint, params) => {
    assert.equal(params.agency_name, undefined);
    return { success: true, data: peoplePage };
  });
  try {
    const out: any = await highergovTools.callTool('search_highergov_people', {
      agency: 'Department of Veterans Affairs',
      role_keywords: ['contracting'],
    });
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].person_id, 'jordan.sample@va.gov');
    assert.equal(out.results[0].email, 'jordan.sample@va.gov');
    assert.equal(out.results[0].agency, 'va');
    assert.equal(out.filters.client_side.agency, 'Department of Veterans Affairs');
  } finally {
    restore();
  }
});

test('get_highergov_person looks up by contact_email and rejects non-email ids', async () => {
  const restore = stubHighergovGet((_endpoint, params) => {
    assert.equal(params.contact_email, 'jordan.sample@va.gov');
    return {
      success: true,
      data: {
        results: [
          {
            contact_name: 'Jordan Sample',
            contact_email: 'jordan.sample@va.gov',
            contact_phone: '202-555-0100',
            agency: { agency_name: 'Department of Veterans Affairs' },
            path: 'https://www.highergov.com/people/jordan-sample/',
          },
        ],
      },
    };
  });
  try {
    const out: any = await highergovTools.callTool('get_highergov_person', { id: 'jordan.sample@va.gov' });
    assert.equal(out.phone, '202-555-0100');
    const bad: any = await highergovTools.callTool('get_highergov_person', { id: 'not-an-email' });
    assert.equal(bad.error.code, 'bad_request');
  } finally {
    restore();
  }
});

test('search_highergov_forecasts sends the documented last_modified_date param, not modified_since', async () => {
  const restore = stubHighergovGet((_endpoint, params) => {
    assert.equal(params.modified_since, undefined);
    assert.match(String(params.last_modified_date), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(params.search_id, 'SS1');
    return { success: true, data: { results: [], next: null } };
  });
  try {
    const out: any = await highergovTools.callTool('search_highergov_forecasts', {
      saved_search_id: 'SS1',
      since: '2026-08-20T12:34:56Z',
    });
    assert.equal(out.filters.upstream.last_modified_date, '2026-08-20');
  } finally {
    restore();
  }
});

test('search_highergov_opportunities requires at least one filter', async () => {
  const out: any = await highergovTools.callTool('search_highergov_opportunities', {});
  assert.equal(out.error.code, 'bad_request');
});

test('get_opportunity_documents merges notice attachments with the document index', async () => {
  const restore = stubHighergovGet((endpoint: string, params: Record<string, any>) => {
    if (endpoint === '/document/') {
      // The spec's only lookup param on /document/ is related_key.
      assert.equal(params.related_key, 'doc-test-opp-1');
      assert.equal(params.opp_key, undefined);
    }
    if (endpoint === '/opportunity/') {
      return {
        success: true,
        data: {
          results: [
            {
              opp_key: 'doc-test-opp-1',
              source_id: 'W912DY-25-R-0011',
              title: 'RFP with attachments',
              attachments: [{ name: 'RFP.pdf', url: 'https://sam.gov/docs/rfp.pdf' }],
            },
          ],
        },
      };
    }
    if (endpoint === '/document/') {
      // FileTracker records per the spec: file_name/file_type/file_size/download_url.
      return {
        success: true,
        data: {
          results: [
            { file_name: 'Amendment_0001.pdf', file_type: 'pdf', file_size: 12345, download_url: 'https://sam.gov/docs/amd1.pdf' },
            { file_name: 'RFP.pdf', file_type: 'pdf', download_url: 'https://sam.gov/docs/rfp.pdf' }, // duplicate URL — must dedup
          ],
        },
      };
    }
    return { success: false, error: 'API Error 404: {}' };
  });
  try {
    const out: any = await highergovTools.callTool('get_opportunity_documents', { id: 'doc-test-opp-1' });
    assert.equal(out.documents.length, 2);
    assert.deepEqual(
      out.documents.map((d: any) => d.url).sort(),
      ['https://sam.gov/docs/amd1.pdf', 'https://sam.gov/docs/rfp.pdf']
    );
  } finally {
    restore();
  }
});
