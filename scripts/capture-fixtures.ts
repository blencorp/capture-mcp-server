// Capture raw upstream payloads as fixtures for field-mapping tests.
//
// Usage:  TANGO_API_KEY=... HIGHERGOV_API_KEY=... npm run capture-fixtures
//
// Requires live API keys, so it never runs in CI. Output lands in
// fixtures/raw/*.json. After a capture, compare the raw keys against the
// normalizers in src/tools/ (the mapping self-checks will also flag drift at
// runtime) and refresh the hand-maintained fixtures in src/tools/__fixtures__/
// with a representative record.
//
// Each capture also probes filter binding: for every filter we send, it checks
// whether the result set actually narrowed / matches, and prints a verdict.
// Record the verdicts in docs/upstream-api-notes.md.

import { mkdir, writeFile } from 'node:fs/promises';
import { ApiClient } from '../src/utils/api-client.js';

const OUT_DIR = new URL('../fixtures/raw/', import.meta.url).pathname;

async function save(name: string, data: unknown): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const path = `${OUT_DIR}${name}.json`;
  await writeFile(path, JSON.stringify(data, null, 2));
  console.log(`  saved ${path}`);
}

function topLevelKeys(payload: any): string[] {
  const first = payload?.results?.[0] ?? payload?.data?.[0] ?? payload;
  return first && typeof first === 'object' ? Object.keys(first) : [];
}

async function captureTango(apiKey: string): Promise<void> {
  console.log('== Tango /contracts/');
  const base = await ApiClient.tangoGet('/contracts/', { limit: 3 }, apiKey);
  if (!base.success) {
    console.error(`  FAILED: ${base.error}`);
    return;
  }
  await save('tango-contracts-page', base.data);
  console.log(`  record keys: ${topLevelKeys(base.data).join(', ')}`);
  console.log(`  pagination: next=${JSON.stringify((base.data as any).next ?? null)}`);

  // Filter-binding probes. Each prints whether the filter narrowed the total.
  const unfilteredTotal = (base.data as any).count ?? (base.data as any).total;
  const probes: Array<[string, Record<string, any>]> = [
    ['set_aside=8AN', { limit: 1, set_aside: '8AN' }],
    ['set_aside exact-match candidate', { limit: 1, set_aside__exact: '8AN' }],
    ['amount min candidate obligated_gte', { limit: 1, obligated_gte: 1000000 }],
    ['amount min candidate min_obligated', { limit: 1, min_obligated: 1000000 }],
    ['awarding_agency code', { limit: 1, awarding_agency: '3600' }],
  ];
  for (const [label, params] of probes) {
    const res = await ApiClient.tangoGet('/contracts/', params, apiKey);
    if (!res.success) {
      console.log(`  probe ${label}: ERROR ${res.error}`);
      continue;
    }
    const total = (res.data as any).count ?? (res.data as any).total;
    const verdict = total === unfilteredTotal ? 'DID NOT BIND (total unchanged)' : `bound? total=${total}`;
    console.log(`  probe ${label}: ${verdict}`);
  }
}

async function captureHighergov(apiKey: string): Promise<void> {
  console.log('== HigherGov /contract/');
  const base = await ApiClient.highergovGet('/contract/', { naics_code: '541511', page_size: 3 }, apiKey);
  if (!base.success) {
    console.error(`  FAILED: ${base.error}`);
    return;
  }
  await save('highergov-contract-page', base.data);
  console.log(`  record keys: ${topLevelKeys(base.data).join(', ')}`);
  console.log(`  payload top-level keys: ${Object.keys(base.data as any).join(', ')}`);

  // Agency-binding probe: does any agency filter param actually constrain?
  const agencyParams = ['agency_key', 'awarding_agency_key', 'awarding_agency', 'agency_name'];
  for (const param of agencyParams) {
    const res = await ApiClient.highergovGet(
      '/contract/',
      { [param]: 'department-of-veterans-affairs', page_size: 2 },
      apiKey
    );
    if (!res.success) {
      console.log(`  probe ${param}: ERROR ${res.error}`);
      continue;
    }
    const rows = (res.data as any).results ?? [];
    console.log(`  probe ${param}: ${rows.length} rows — inspect fixtures to confirm agency binding`);
    await save(`highergov-contract-agency-${param}`, res.data);
  }

  console.log('== HigherGov /opportunity/');
  const opp = await ApiClient.highergovGet('/opportunity/', { page_size: 2 }, apiKey);
  if (opp.success) {
    await save('highergov-opportunity-page', opp.data);
  } else {
    console.error(`  FAILED: ${opp.error}`);
  }

  console.log('== HigherGov /people/');
  const people = await ApiClient.highergovGet('/people/', { page_size: 2 }, apiKey);
  if (people.success) {
    await save('highergov-people-page', people.data);
  } else {
    console.error(`  FAILED: ${people.error}`);
  }
}

async function main(): Promise<void> {
  const tangoKey = process.env.TANGO_API_KEY;
  const highergovKey = process.env.HIGHERGOV_API_KEY;

  if (!tangoKey && !highergovKey) {
    console.error('Set TANGO_API_KEY and/or HIGHERGOV_API_KEY to capture fixtures.');
    process.exit(1);
  }
  if (tangoKey) await captureTango(tangoKey);
  if (highergovKey) await captureHighergov(highergovKey);
  console.log('Done. Update docs/upstream-api-notes.md with the probe verdicts.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
