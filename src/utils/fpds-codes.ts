// FPDS reference code tables.
//
// This table exists because agents (and humans) repeatedly invert code meanings —
// most famously 8A (8(a) Competed) vs 8AN (8(a) Sole Source). Every tool that
// accepts or returns one of these codes must resolve it here so the description
// travels with the code. Source: FPDS Data Dictionary / USASpending field
// documentation. If a code is missing, add it here rather than special-casing.

export interface ReferenceCode {
  code: string;
  description: string;
  note?: string;
}

const SET_ASIDE_CODES: ReferenceCode[] = [
  { code: 'NONE', description: 'No Set Aside Used' },
  { code: 'SBA', description: 'Total Small Business Set-Aside (FAR 19.5)' },
  { code: 'SBP', description: 'Partial Small Business Set-Aside (FAR 19.5)' },
  { code: '8A', description: '8(a) Competed (FAR 19.8)', note: 'Competitive 8(a). For sole source use 8AN.' },
  { code: '8AN', description: '8(a) Sole Source (FAR 19.8)' },
  { code: 'HZC', description: 'HUBZone Set-Aside (FAR 19.13)' },
  { code: 'HZS', description: 'HUBZone Sole Source (FAR 19.13)' },
  { code: 'SDVOSBC', description: 'Service-Disabled Veteran-Owned Small Business Set-Aside (FAR 19.14)' },
  { code: 'SDVOSBS', description: 'Service-Disabled Veteran-Owned Small Business Sole Source (FAR 19.14)' },
  { code: 'WOSB', description: 'Women-Owned Small Business Program Set-Aside (FAR 19.15)' },
  { code: 'WOSBSS', description: 'Women-Owned Small Business Program Sole Source (FAR 19.15)' },
  { code: 'EDWOSB', description: 'Economically Disadvantaged WOSB Program Set-Aside (FAR 19.15)' },
  { code: 'EDWOSBSS', description: 'Economically Disadvantaged WOSB Program Sole Source (FAR 19.15)' },
  { code: 'LAS', description: 'Local Area Set-Aside (FAR 26.2)' },
  { code: 'IEE', description: 'Indian Economic Enterprise Set-Aside (DIAR 1480)' },
  { code: 'ISBEE', description: 'Indian Small Business Economic Enterprise Set-Aside (DIAR 1480)' },
  { code: 'BI', description: 'Buy Indian (25 U.S.C. 47)' },
  { code: 'ESB', description: 'Emerging Small Business Set-Aside (historic, FAR 19.10)' },
  { code: 'VSA', description: 'Veteran-Owned Small Business Set-Aside (VA only, 38 U.S.C. 8127)' },
  { code: 'VSS', description: 'Veteran-Owned Small Business Sole Source (VA only, 38 U.S.C. 8127)' },
];

const EXTENT_COMPETED_CODES: ReferenceCode[] = [
  { code: 'A', description: 'Full and Open Competition' },
  { code: 'B', description: 'Not Available for Competition' },
  { code: 'C', description: 'Not Competed' },
  { code: 'D', description: 'Full and Open Competition after Exclusion of Sources' },
  { code: 'E', description: 'Follow On to Competed Action' },
  { code: 'F', description: 'Competed under SAP (Simplified Acquisition Procedures)' },
  { code: 'G', description: 'Not Competed under SAP' },
  { code: 'CDO', description: 'Competitive Delivery Order' },
  { code: 'NDO', description: 'Non-Competitive Delivery Order' },
];

const AWARD_TYPE_CODES: ReferenceCode[] = [
  { code: 'A', description: 'BPA Call' },
  { code: 'B', description: 'Purchase Order' },
  { code: 'C', description: 'Delivery Order' },
  { code: 'D', description: 'Definitive Contract' },
  { code: 'IDV_A', description: 'Government-Wide Acquisition Contract (GWAC)' },
  { code: 'IDV_B', description: 'Indefinite Delivery Contract (IDC)' },
  { code: 'IDV_B_A', description: 'IDC — Requirements' },
  { code: 'IDV_B_B', description: 'IDC — Indefinite Delivery / Indefinite Quantity (IDIQ)' },
  { code: 'IDV_B_C', description: 'IDC — Indefinite Delivery / Definite Quantity' },
  { code: 'IDV_C', description: 'Federal Supply Schedule (FSS)' },
  { code: 'IDV_D', description: 'Basic Ordering Agreement (BOA)' },
  { code: 'IDV_E', description: 'Blanket Purchase Agreement (BPA)' },
];

const SOLICITATION_PROCEDURE_CODES: ReferenceCode[] = [
  { code: 'NP', description: 'Negotiated Proposal/Quote' },
  { code: 'SB', description: 'Sealed Bid' },
  { code: 'TP', description: 'Two Step' },
  { code: 'SP1', description: 'Simplified Acquisition' },
  { code: 'AS', description: 'Alternative Sources' },
  { code: 'MAFO', description: 'Subject to Multiple Award Fair Opportunity' },
  { code: 'SSS', description: 'Only One Source (Solicited)' },
];

// "Other Than Full and Open Competition" authorities.
const COMPETITION_CODES: ReferenceCode[] = [
  { code: 'ONE', description: 'Only One Source — Other (FAR 6.302-1)' },
  { code: 'FOC', description: 'Follow-On Contract (FAR 6.302-1)' },
  { code: 'UNQ', description: 'Unique Source (FAR 6.302-1)' },
  { code: 'UR', description: 'Unsolicited Research Proposal (FAR 6.302-1)' },
  { code: 'PDR', description: 'Patent or Data Rights (FAR 6.302-1)' },
  { code: 'UT', description: 'Utilities (FAR 6.302-1)' },
  { code: 'STD', description: 'Standardization (FAR 6.302-1)' },
  { code: 'URG', description: 'Urgency (FAR 6.302-2)' },
  { code: 'MG', description: 'Mobilization, Essential R&D Capability (FAR 6.302-3)' },
  { code: 'IA', description: 'International Agreement (FAR 6.302-4)' },
  { code: 'OTH', description: 'Authorized or Required by Statute (FAR 6.302-5)' },
  { code: 'RES', description: 'Authorized Resale (FAR 6.302-5)' },
  { code: 'NS', description: 'National Security (FAR 6.302-6)' },
  { code: 'PI', description: 'Public Interest (FAR 6.302-7)' },
  { code: 'MES', description: 'SAP Non-Competition (FAR 13)' },
  { code: 'BND', description: 'Brand Name Description (FAR 13.106)' },
  { code: 'MPT', description: 'Less Than or Equal to the Micro-Purchase Threshold' },
];

const DOMAINS: Record<string, ReferenceCode[]> = {
  set_aside: SET_ASIDE_CODES,
  extent_competed: EXTENT_COMPETED_CODES,
  award_type: AWARD_TYPE_CODES,
  solicitation_procedure: SOLICITATION_PROCEDURE_CODES,
  competition: COMPETITION_CODES,
};

export const REFERENCE_DOMAINS = Object.keys(DOMAINS);

export function listReferenceCodes(domain: string): ReferenceCode[] | null {
  return DOMAINS[domain] ?? null;
}

export function lookupReferenceCode(domain: string, code: string): ReferenceCode | null {
  const table = DOMAINS[domain];
  if (!table) return null;
  const needle = code.trim().toUpperCase();
  return table.find(entry => entry.code === needle) ?? null;
}

export function isKnownSetAsideCode(code: string): boolean {
  return lookupReferenceCode('set_aside', code) !== null;
}

// {code, description} pair for responses. Unknown codes are passed through with
// a null description rather than dropped — the caller decides whether to warn.
export function describeSetAside(code: string): { code: string; description: string | null } {
  const hit = lookupReferenceCode('set_aside', code);
  return { code: code.trim().toUpperCase(), description: hit ? hit.description : null };
}

// Validates user-supplied set-aside codes. Returns the normalized (uppercased)
// codes, or throws with the full list of valid codes so the caller's error is
// self-correcting.
export function validateSetAsideCodes(codes: string[]): string[] {
  const normalized = codes.map(c => String(c).trim().toUpperCase()).filter(Boolean);
  const unknown = normalized.filter(c => !isKnownSetAsideCode(c));
  if (unknown.length > 0) {
    const valid = SET_ASIDE_CODES.map(c => `${c.code} (${c.description})`).join('; ');
    throw new Error(
      `Unknown set-aside code(s): ${unknown.join(', ')}. Valid FPDS codes: ${valid}`
    );
  }
  return normalized;
}
