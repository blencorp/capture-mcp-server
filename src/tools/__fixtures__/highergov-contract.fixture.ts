// HigherGov /api-external/contract/ record fixtures.
//
// STATUS: SYNTHETIC — built from the documented FPDS/USAspending-style field
// names (docs/upstream-api-notes.md) plus what live responses proved
// (naics_code / psc_code / path are top-level; award_id is the lookup key).
// Replace with a captured record from `npm run capture-fixtures` at first
// opportunity; the tests only get stronger with real payloads.

// A record shaped the way the documentation and the working lookup params imply.
export const documentedContractRecord = {
  award_id: '36C10B21D0042',
  contract_award_unique_key: 'CONT_AWD_36C10B21D0042_3600',
  award_description: 'T4NG TASK ORDER — HEALTH PORTFOLIO DEVSECOPS SUPPORT',
  awardee: {
    awardee_key: 'abc123',
    clean_name: 'EXAMPLE FEDERAL LLC',
    uei: 'ABCDEF123456',
  },
  awarding_agency: {
    agency_key: '3600',
    agency_name: 'Department of Veterans Affairs',
    sub_agency_name: 'Veterans Health Administration',
  },
  naics_code: { naics_code: '541511', naics_description: 'Custom Computer Programming Services' },
  psc_code: { psc_code: 'D307', psc_description: 'IT AND TELECOM- IT STRATEGY AND ARCHITECTURE' },
  type_of_set_aside_code: 'SDVOSBS',
  type_of_set_aside: 'Service-Disabled Veteran-Owned Small Business Sole Source',
  current_total_value_of_award: '4250000.00',
  potential_total_value_of_award: '9500000.00',
  total_dollars_obligated: '3100000.00',
  period_of_performance_start_date: '2021-06-01',
  period_of_performance_current_end_date: '2026-05-31',
  period_of_performance_potential_end_date: '2027-05-31',
  contract_vehicle: 'T4NG',
  last_modified_date: '2025-11-02',
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
  contract_award_unique_key: 'CONT_AWD_140F0920P0015_1400',
  awarding_agency: { agency_key: '1400', agency_name: 'Department of the Interior' },
  path: 'https://www.highergov.com/contract/140F0920P0015/',
};

export const dojContractRecord = {
  ...documentedContractRecord,
  award_id: '15BNAS25P00000029',
  contract_award_unique_key: 'CONT_AWD_15BNAS25P00000029_1500',
  awarding_agency: { agency_key: '1500', agency_name: 'Department of Justice' },
  path: 'https://www.highergov.com/contract/15BNAS25P00000029/',
};

export function contractPage(records: any[], opts: { next?: string | null; count?: number } = {}) {
  return {
    count: opts.count ?? records.length,
    next: opts.next ?? null,
    previous: null,
    results: records,
  };
}
