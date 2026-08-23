// Live smoke test: replays the exact probes that exposed the P0 bugs
// (docs/fix-plan.md) against the fixed tools. Requires live API keys —
// run manually before a release, never in CI:
//
//   TANGO_API_KEY=... HIGHERGOV_API_KEY=... npm run smoke

import { tangoTools } from '../src/tools/tango-tools.js';
import { highergovTools } from '../src/tools/highergov-tools.js';

let failures = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function smokeTango(): Promise<void> {
  console.log('\n== Tango (P0-1..P0-4)');

  // P0-1: exact set-aside. 8A and 8AN must be disjoint.
  const window = { date_from: '2025-08-01', date_to: '2025-09-30' };
  const eightA: any = await tangoTools.callTool('search_tango_contracts', { ...window, set_aside: '8A', limit: 100 });
  const eightAN: any = await tangoTools.callTool('search_tango_contracts', { ...window, set_aside: '8AN', limit: 100 });
  check('8A search returned without error', !eightA.error, JSON.stringify(eightA.error ?? ''));
  check('8AN search returned without error', !eightAN.error, JSON.stringify(eightAN.error ?? ''));
  if (!eightA.error && !eightAN.error) {
    const aIds = new Set((eightA.contracts ?? []).map((c: any) => c.contract_id));
    const overlap = (eightAN.contracts ?? []).filter((c: any) => aIds.has(c.contract_id));
    check('8A and 8AN pages are disjoint (exact matching)', overlap.length === 0, `${overlap.length} overlapping rows`);
    const loose = (eightA.warnings ?? []).some((w: string) => /LOOSE/.test(w));
    const rowsCarryCodes = (eightA.contracts ?? []).every((c: any) => c.set_aside_exact_code === '8A');
    check('8A rows all carry exact code 8A (or the tool declared LOOSE)', rowsCarryCodes || loose);
    check('set-aside-filtered total is not presented as trustworthy', eightA.total === null,
      `total=${eightA.total}`);
  }

  // P0-2: amount filter must visibly apply.
  const withMin: any = await tangoTools.callTool('search_tango_contracts', {
    ...window, set_aside: '8AN', award_amount_min: 1000000, limit: 100,
  });
  check('award_amount_min echoes in filters.client_side', withMin.filters?.client_side?.award_amount_min === 1000000
    || (withMin.contracts ?? []).every((c: any) => (c.award_amount ?? 1e12) >= 1000000));
  check('amount-filtered response nulls total with the unfiltered value preserved',
    withMin.total === null && typeof withMin.total_upstream_unfiltered !== 'undefined'
    || (withMin.filters?.client_side && Object.keys(withMin.filters.client_side).length === 0),
    JSON.stringify({ total: withMin.total }));

  // P0-3: cursor walk — three pages, no duplicates.
  let cursor: string | null = null;
  const seen = new Set<string>();
  let dupes = 0;
  for (let page = 0; page < 3; page++) {
    const res: any = await tangoTools.callTool('search_tango_contracts',
      cursor ? { cursor } : { ...window, set_aside: '8AN', limit: 100 });
    if (res.error) { check(`cursor page ${page + 1} fetch`, false, JSON.stringify(res.error)); break; }
    for (const c of res.contracts ?? []) {
      if (seen.has(c.contract_id)) dupes += 1;
      seen.add(c.contract_id);
    }
    cursor = res.next_cursor;
    if (!cursor) break;
  }
  check('cursor pagination enumerates >100 rows without duplicates', seen.size > 100 && dupes === 0,
    `${seen.size} unique rows, ${dupes} duplicates`);

  // Agency names must be rejected, codes must bind.
  const name: any = await tangoTools.callTool('search_tango_contracts', { agency: 'Army', limit: 1 });
  check('agency name is rejected with guidance', name.error?.code === 'bad_request');
  const code: any = await tangoTools.callTool('search_tango_contracts', { ...window, agency: '2100', set_aside: '8AN', limit: 5 });
  check('agency code binds (rows are Army)', !code.error
    && (code.contracts ?? []).every((c: any) => c.agency?.code === '2100'),
    JSON.stringify((code.contracts ?? []).map((c: any) => c.agency?.code)));
}

async function smokeHighergov(): Promise<void> {
  console.log('\n== HigherGov (P0-5/P0-6)');

  const res: any = await highergovTools.callTool('search_highergov_contracts', {
    agency: 'Department of Veterans Affairs',
    naics: ['541511'],
    limit: 10,
  });
  check('VA contract search returned without error', !res.error, JSON.stringify(res.error ?? ''));
  if (!res.error) {
    const rows = res.results ?? [];
    const drift = (res.warnings ?? []).some((w: string) => /OUT OF DATE/.test(w));
    check('records are populated (or the drift tripwire fired — mapping needs a fixture pass)',
      rows.every((r: any) => r.piid && r.title && r.agency) || drift,
      JSON.stringify(rows[0] ?? {}));
    check('no non-VA rows returned as VA (post-verified)',
      rows.every((r: any) => r.agency === 'va' || r.funding_agency === 'va')
      || (res.warnings ?? []).some((w: string) => /UNFILTERED by agency/.test(w)),
      JSON.stringify(rows.map((r: any) => r.agency)));
    check('large result sets expose next_cursor', res.next_cursor !== null || rows.length < 10,
      'next_cursor null on a full page');
  }
}

async function main(): Promise<void> {
  if (!process.env.TANGO_API_KEY && !process.env.HIGHERGOV_API_KEY) {
    console.error('Set TANGO_API_KEY and/or HIGHERGOV_API_KEY to run the smoke test.');
    process.exit(1);
  }
  if (process.env.TANGO_API_KEY) await smokeTango();
  if (process.env.HIGHERGOV_API_KEY) await smokeHighergov();
  console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
