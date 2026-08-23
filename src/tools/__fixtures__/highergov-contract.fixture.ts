// HigherGov /api-external/contract/ record fixtures.
//
// STATUS: SPEC-DERIVED, LIVE-CONFIRMED — field names and nesting follow the
// `Federal Contract` schema in the official OpenAPI spec
// (fixtures/raw/highergov-openapi.json, v1.2) and were confirmed against live
// captures on 2026-08-23 (fixtures/raw/highergov-contract-page.json): record
// keys, nesting, the meta/links envelope, and the set-aside value format all
// match. Values here are representative, not copied from a live record.

// A record shaped exactly the way the OpenAPI spec declares it.
export const documentedContractRecord = {
  award_id: '36C10B21D0042',
  parent_award_id: null,
  latest_transaction_key: '36C10B21D0042_P00007',
  last_modified_date: '2025-11-02',
  latest_action_date: '2025-10-15',
  latest_action_date_fiscal_year: 2026,
  awardee: {
    awardee_key: 123456,
    clean_name: 'EXAMPLE FEDERAL LLC',
    uei: 'ABCDEF123456',
    cage_code: '1ABC2',
    path: 'https://www.highergov.com/awardee/example-federal-llc-123456/',
  },
  awardee_parent: null,
  awarding_agency: {
    agency_key: 3600,
    agency_name: 'Department of Veterans Affairs',
    agency_abbreviation: 'VA',
    agency_type: 'Federal',
    path: 'https://www.highergov.com/agency/department-of-veterans-affairs-3600/',
  },
  funding_agency: {
    agency_key: 3600,
    agency_name: 'Department of Veterans Affairs',
    agency_abbreviation: 'VA',
    agency_type: 'Federal',
    path: 'https://www.highergov.com/agency/department-of-veterans-affairs-3600/',
  },
  vehicle: {
    vehicle_key: 42,
    vehicle_name: 'T4NG',
    vehicle_description: 'VA Transformation Twenty-One Total Technology Next Generation',
    path: 'https://www.highergov.com/vehicle/t4ng-42/',
  },
  federal_supply_schedule_award_id: null,
  parent_award_type: null,
  period_of_performance_start_date: '2021-06-01',
  period_of_performance_current_end_date: '2026-05-31',
  period_of_performance_potential_end_date: '2027-05-31',
  total_dollars_obligated: 3100000.0,
  current_total_value_of_award: 4250000.0,
  potential_total_value_of_award: 9500000.0,
  award_type: 'DELIVERY ORDER',
  award_description_original: 'T4NG TASK ORDER — HEALTH PORTFOLIO DEVSECOPS SUPPORT',
  alt_description: null,
  solicitation_identifier: '36C10B21Q0177',
  related_opportunity_title: 'Health Portfolio DevSecOps Support',
  psc_code: {
    psc_code: 'D307',
    psc_name: 'IT AND TELECOM- IT STRATEGY AND ARCHITECTURE',
    psc_description: 'IT AND TELECOM- IT STRATEGY AND ARCHITECTURE',
    active: true,
    path: 'https://www.highergov.com/psc/d307/',
  },
  naics_code: {
    naics_code: '541511',
    naics_description: 'Custom Computer Programming Services',
    active: true,
    path: 'https://www.highergov.com/naics/541511/',
  },
  primary_place_of_performance_zip: '20420',
  primary_place_of_performance_county_name: 'DISTRICT OF COLUMBIA',
  primary_place_of_performance_city_name: 'WASHINGTON',
  primary_place_of_performance_state_code: 'DC',
  primary_place_of_performance_state_name: 'DISTRICT OF COLUMBIA',
  primary_place_of_performance_country_name: 'UNITED STATES',
  type_of_agreement: null,
  type_of_contract_pricing_description: 'FIRM FIXED PRICE',
  national_interest_action: null,
  defense_program: null,
  other_statutory_authority: null,
  dod_claimant_program_code: null,
  subcontracting_plan: null,
  research: null,
  // Live format (2026-08-23): description with the FPDS code in trailing parens.
  type_of_set_aside: 'SDVOSB Sole Source (SDVOSBS)',
  number_of_offers_received: '1',
  extent_competed: 'NOT COMPETED UNDER SAP',
  solicitation_procedures: 'ONLY ONE SOURCE',
  evaluated_preference: null,
  clinger_cohen_act_planning: 'NO',
  fair_opportunity_limited_sources: null,
  other_than_full_and_open_competition: 'AUTHORIZED BY STATUTE',
  created_by: {
    contact_title: 'Contracting Officer',
    contact_name: 'Jordan Sample',
    contact_first_name: 'Jordan',
    contact_last_name: 'Sample',
    contact_email: 'jordan.sample@va.gov',
    contact_phone: '202-555-0100',
  },
  last_modified_by: null,
  approved_by: null,
  path: 'https://www.highergov.com/contract/36C10B21D0042/',
};

// A record whose field names the normalizer does not know — simulates the
// P0-5 failure mode (only naics_code / psc_code / path recognizable) so the
// drift tripwire can be tested.
export const alienContractRecord = {
  zz_award_number: '15F06724A0000364',
  zz_description: 'MYSTERY FIELDS',
  zz_recipient: 'SOMEONE ELSE LLC',
  naics_code: '541511',
  psc_code: 'DF01',
  path: 'https://www.highergov.com/contract/15F06724A0000364-15F06724F0002206/',
};

// Interior/DOJ records for the P0-6 agency post-verification test — these are
// what a VA-filtered query actually returned live on 2026-08-23.
export const interiorContractRecord = {
  ...documentedContractRecord,
  award_id: '140F0920P0015',
  awarding_agency: {
    agency_key: 1400,
    agency_name: 'Department of the Interior',
    agency_abbreviation: 'DOI',
    agency_type: 'Federal',
    path: 'https://www.highergov.com/agency/department-of-the-interior-1400/',
  },
  funding_agency: {
    agency_key: 1400,
    agency_name: 'Department of the Interior',
    agency_abbreviation: 'DOI',
    agency_type: 'Federal',
    path: 'https://www.highergov.com/agency/department-of-the-interior-1400/',
  },
  path: 'https://www.highergov.com/contract/140F0920P0015/',
};

export const dojContractRecord = {
  ...documentedContractRecord,
  award_id: '15BNAS25P00000029',
  awarding_agency: {
    agency_key: 1500,
    agency_name: 'Department of Justice',
    agency_abbreviation: 'DOJ',
    agency_type: 'Federal',
    path: 'https://www.highergov.com/agency/department-of-justice-1500/',
  },
  funding_agency: {
    agency_key: 1500,
    agency_name: 'Department of Justice',
    agency_abbreviation: 'DOJ',
    agency_type: 'Federal',
    path: 'https://www.highergov.com/agency/department-of-justice-1500/',
  },
  path: 'https://www.highergov.com/contract/15BNAS25P00000029/',
};

// The paginated envelope per the OpenAPI spec: results + meta.pagination
// {page, pages, count} + links {first, last, next, prev}.
export function contractPage(
  records: any[],
  opts: { next?: string | null; count?: number; page?: number; pages?: number } = {}
) {
  const page = opts.page ?? 1;
  const count = opts.count ?? records.length;
  // A last page has links.next = null and page === pages; keep the two
  // consistent by default so the cursor page-math fallback agrees with links.
  const pages = opts.pages ?? (opts.next ? page + 1 : page);
  return {
    results: records,
    meta: { pagination: { page, pages, count } },
    links: {
      first: 'https://www.highergov.com/api-external/contract/?page_number=1',
      last: `https://www.highergov.com/api-external/contract/?page_number=${pages}`,
      next: opts.next ?? null,
      prev: null,
    },
  };
}
