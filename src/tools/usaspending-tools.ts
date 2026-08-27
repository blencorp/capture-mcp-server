import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ApiClient } from '../utils/api-client.js';
import { describeSetAside, validateSetAsideCodes, lookupReferenceCode } from '../utils/fpds-codes.js';
import { listEnvelope } from '../utils/envelope.js';
import { pageNumberFromCursor } from '../utils/pagination.js';

// Contract prime-award type codes (see lookup_reference_code domain award_type).
const CONTRACT_AWARD_TYPE_CODES = ['A', 'B', 'C', 'D'];
const IDV_AWARD_TYPE_CODES = ['IDV_A', 'IDV_B', 'IDV_B_A', 'IDV_B_B', 'IDV_B_C', 'IDV_C', 'IDV_D', 'IDV_E'];
const USASPENDING_AWARD_TYPE_GROUPS: Record<string, string[]> = {
  contracts: CONTRACT_AWARD_TYPE_CODES,
  idvs: IDV_AWARD_TYPE_CODES,
  loans: ['07', '08', 'F003', 'F004'],
  grants: ['02', '03', '04', '05', 'F001', 'F002'],
  other_financial_assistance: ['06', '10', 'F006', 'F007'],
  direct_payments: ['09', '11', '-1', 'F005', 'F008', 'F009', 'F010'],
};

// USASpending rejects spending_by_award requests that mix award-type groups.
const PIID_AWARD_TYPE_GROUPS = [
  { name: 'contracts', codes: CONTRACT_AWARD_TYPE_CODES },
  { name: 'idvs', codes: IDV_AWARD_TYPE_CODES },
];
const AWARD_RESOLUTION_PAGE_SIZE = 100;
const MAX_AWARD_RESOLUTION_PAGES = 3;
const MAX_AWARD_CANDIDATES = 10;

function validateAwardTypeGroup(input: unknown): { codes: string[]; group: string } {
  if (input !== undefined && !Array.isArray(input)) {
    throw new Error('award_types must be an array of USASpending award type codes');
  }
  if (Array.isArray(input) && input.length === 0) {
    throw new Error('award_types must contain at least one USASpending award type code');
  }
  const rawCodes = Array.isArray(input) ? input : CONTRACT_AWARD_TYPE_CODES;
  const codes = [...new Set(rawCodes.map((code) => String(code).trim().toUpperCase()).filter(Boolean))];
  const groupByCode = new Map<string, string>();
  for (const [group, groupCodes] of Object.entries(USASPENDING_AWARD_TYPE_GROUPS)) {
    for (const code of groupCodes) groupByCode.set(code, group);
  }

  const unknown = codes.filter((code) => !groupByCode.has(code));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown USASpending award type code(s): ${unknown.join(', ')}. Valid codes: ${[...groupByCode.keys()].join(', ')}`
    );
  }

  const groups = [...new Set(codes.map((code) => groupByCode.get(code)!))];
  if (groups.length !== 1) {
    throw new Error(
      `award_types must contain codes from exactly one USASpending group; received ${groups.join(', ')}. Search each group separately.`
    );
  }
  return { codes, group: groups[0] };
}

const GROUP_BY_CATEGORY: Record<string, string> = {
  awarding_agency: 'awarding_agency',
  awarding_subagency: 'awarding_subagency',
  recipient: 'recipient',
  naics: 'naics',
  psc: 'psc',
};

export const usaspendingTools = {
  async getTools(): Promise<Tool[]> {
    return [
      {
        name: "get_usaspending_awards",
        description: "Get federal awards data for a specific agency and fiscal year. Returns award counts, obligations, and top awards.",
        inputSchema: {
          type: "object",
          properties: {
            agency_code: {
              type: "string",
              description: "3-digit agency code (e.g., '075' for HHS, '097' for DOD)"
            },
            fiscal_year: {
              type: "number",
              description: "Fiscal year (e.g., 2024)"
            },
            limit: {
              type: "number", 
              description: "Number of top awards to return (default: 10)"
            }
          },
          required: ["agency_code"]
        }
      },
      {
        name: "get_usaspending_spending_by_category",
        description: "Get spending breakdown by award category (contracts, grants, loans, etc.) for an agency and fiscal year.",
        inputSchema: {
          type: "object",
          properties: {
            agency_code: {
              type: "string",
              description: "3-digit agency code (e.g., '075' for HHS)"
            },
            fiscal_year: {
              type: "number",
              description: "Fiscal year (e.g., 2024)"
            }
          },
          required: ["agency_code"]
        }
      },
      {
        name: "get_usaspending_budgetary_resources", 
        description: "Get budgetary resources and obligations for an agency in a fiscal year.",
        inputSchema: {
          type: "object",
          properties: {
            agency_code: {
              type: "string", 
              description: "3-digit agency code (e.g., '075' for HHS)"
            },
            fiscal_year: {
              type: "number",
              description: "Fiscal year (e.g., 2024)"
            }
          },
          required: ["agency_code"]
        }
      },
      {
        name: "search_usaspending_awards_by_recipient",
        description: "Search for federal awards by recipient name, with optional filters for time period and amount ranges. Great for investigating specific companies or organizations.",
        inputSchema: {
          type: "object",
          properties: {
            recipient_name: {
              type: "string",
              description: "Name of recipient to search (e.g., 'Boeing', 'Johns Hopkins')"
            },
            fiscal_year: {
              type: "number",
              description: "Fiscal year to search by award action date (e.g., 2024)"
            },
            min_amount: {
              type: "number",
              description: "Minimum award amount filter"
            },
            max_amount: {
              type: "number", 
              description: "Maximum award amount filter"
            },
            award_types: {
              type: "array",
              items: { type: "string" },
              description: "Award type codes from one USASpending group only (default ['A','B','C','D'] for contract prime awards). Search contracts, IDVs, grants, loans, and other assistance groups separately."
            },
            limit: {
              type: "number",
              description: "Number of results (default: 10, max: 100)"
            },
            cursor: {
              type: "string",
              description: "Page number from the prior response's next_cursor. Reuse the same filters and limit when paging."
            }
          },
          required: ["recipient_name"]
        }
      },
      {
        name: "get_award_detail",
        description:
          "Get the full FPDS record for a single procurement award from USASpending — the verification primitive: type_set_aside with description, extent_competed, number_of_offers_received, other_than_full_and_open competition authority, and current vs ultimate completion dates. Use it to confirm that a filtered search actually returned what it claimed before a number goes in a memo. Accepts a procurement generated award ID (CONT_AWD_... or CONT_IDV_...) or a bare PIID (resolved via award search first). Assistance IDs (ASST_...) are rejected because they do not carry FPDS competition fields.",
        inputSchema: {
          type: "object",
          properties: {
            award_id: {
              type: "string",
              description: "USASpending procurement generated_unique_award_id (e.g. 'CONT_AWD_36C10B26F0223_3600_47QRCA24DV006_4732') or a bare PIID (e.g. '36C10B26F0223')"
            }
          },
          required: ["award_id"]
        }
      },
      {
        name: "aggregate_contracts",
        description:
          "Aggregate federal contract awards from USASpending without pulling rows: group by awarding_agency, awarding_subagency, recipient, naics, psc, month, or set_aside, with metric 'obligations' (dollars) or 'count' (prime awards). This is the tool for questions like 'how many 8(a) sole source awards per agency in Aug-Sep 2025'. Counts state their unit and the date filter states its date_type. group_by=set_aside issues one upstream query per code (~4s each due to rate pacing); metric 'count' is supported for group_by set_aside only (USASpending exposes counts per filter, not per category).",
        inputSchema: {
          type: "object",
          properties: {
            group_by: {
              type: "string",
              description: "One of: awarding_agency, awarding_subagency, recipient, naics, psc, month, set_aside"
            },
            metric: {
              type: "string",
              description: "'obligations' (default; aggregated dollars) or 'count' (prime award count; only with group_by=set_aside)"
            },
            date_from: {
              type: "string",
              description: "Start date YYYY-MM-DD (required)"
            },
            date_to: {
              type: "string",
              description: "End date YYYY-MM-DD (required)"
            },
            date_type: {
              type: "string",
              description: "Which award date the window filters on: 'action_date' (default), 'date_signed', or 'new_awards_only'. Different choices produce materially different totals — the response echoes this as date_field."
            },
            agency: {
              type: "string",
              description: "Awarding toptier agency NAME as USASpending knows it (e.g. 'Department of Veterans Affairs')"
            },
            sub_agency: {
              type: "string",
              description: "Awarding subtier agency name (requires agency)"
            },
            naics: {
              type: "array",
              items: { type: "string" },
              description: "NAICS codes"
            },
            psc: {
              type: "array",
              items: { type: "string" },
              description: "PSC codes"
            },
            set_aside: {
              anyOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } }
              ],
              description: "FPDS set-aside code(s), validated (e.g. ['8AN','SDVOSBS']). Required when group_by=set_aside."
            },
            recipient_search: {
              type: "string",
              description: "Recipient name or UEI text filter"
            },
            award_type_codes: {
              type: "array",
              items: { type: "string" },
              description: "Award type codes (default ['A','B','C','D'] = contract prime awards; see lookup_reference_code domain award_type)"
            },
            limit: {
              type: "number",
              description: "Max groups to return for category group_bys (default 25, max 100)"
            }
          },
          required: ["group_by", "date_from", "date_to"]
        }
      }
    ];
  },

  async callTool(name: string, args: any): Promise<any> {
    const sanitizedArgs = ApiClient.sanitizeInput(args);
    
    switch(name) {
      case "get_usaspending_awards":
        return await this.getAgencyAwards(sanitizedArgs);
      case "get_usaspending_spending_by_category":
        return await this.getSpendingByCategory(sanitizedArgs);  
      case "get_usaspending_budgetary_resources":
        return await this.getBudgetaryResources(sanitizedArgs);
      case "search_usaspending_awards_by_recipient":
        return await this.searchAwardsByRecipient(sanitizedArgs);
      case "get_award_detail":
        return await this.getAwardDetail(sanitizedArgs);
      case "aggregate_contracts":
        return await this.aggregateContracts(sanitizedArgs);
      default:
        throw new Error(`Unknown USASpending tool: ${name}`);
    }
  },

  async getAwardDetail(args: any): Promise<any> {
    const awardIdInput = String(args.award_id ?? '').trim();
    if (!awardIdInput) {
      return { error: { code: 'bad_request', message: 'award_id is required' } };
    }
    if (/^ASST_/.test(awardIdInput)) {
      return {
        error: {
          code: 'bad_request',
          message:
            'get_award_detail supports procurement awards only (CONT_AWD_..., CONT_IDV_..., or a bare PIID). ASST_* assistance awards do not contain FPDS competition fields.',
        },
      };
    }

    // A bare PIID needs resolving to USASpending's generated award ID first.
    let generatedId = awardIdInput;
    if (!/^CONT_(AWD|IDV)_/.test(awardIdInput)) {
      const candidates: any[] = [];
      const candidateIds = new Set<string>();
      let resolutionIncomplete = false;
      let candidatesTruncated = false;

      for (const [groupIndex, awardTypeGroup] of PIID_AWARD_TYPE_GROUPS.entries()) {
        let page = 1;
        let hasNext = false;

        do {
          const search = await ApiClient.usaspendingPost('/search/spending_by_award/', {
            filters: {
              award_ids: [awardIdInput],
              award_type_codes: awardTypeGroup.codes,
            },
            fields: [
              'Award ID',
              'generated_internal_id',
              'Award Type',
              'Awarding Agency',
              'Recipient Name',
            ],
            limit: AWARD_RESOLUTION_PAGE_SIZE,
            page,
          });
          if (!search.success) {
            return { error: search.error };
          }

          // award_ids is a fuzzy full-text filter unless callers add quotes.
          // Keep only exact PIID matches and fail closed if the identifier is
          // not globally unique across contract and IDV award groups.
          for (const result of search.data.results ?? []) {
            if (
              result.generated_internal_id &&
              String(result['Award ID'] ?? '').toUpperCase() === awardIdInput.toUpperCase() &&
              !candidateIds.has(result.generated_internal_id)
            ) {
              candidateIds.add(result.generated_internal_id);
              if (candidates.length < MAX_AWARD_CANDIDATES) {
                candidates.push({
                  generated_unique_award_id: result.generated_internal_id,
                  piid: result['Award ID'],
                  award_type_group: awardTypeGroup.name,
                  award_type: result['Award Type'] ?? null,
                  awarding_agency: result['Awarding Agency'] ?? null,
                  recipient: result['Recipient Name'] ?? null,
                });
              } else {
                candidatesTruncated = true;
              }
            }
          }

          hasNext = Boolean(search.data.page_metadata?.hasNext);
          if (candidateIds.size > 1) {
            // We stop as soon as ambiguity is established. Mark the candidate
            // list as non-exhaustive when pages or award groups remain.
            if (hasNext || groupIndex < PIID_AWARD_TYPE_GROUPS.length - 1) candidatesTruncated = true;
            break;
          }

          page += 1;
        } while (hasNext && page <= MAX_AWARD_RESOLUTION_PAGES);

        if (candidateIds.size > 1) break;
        if (hasNext) {
          resolutionIncomplete = true;
          break;
        }
      }

      if (candidateIds.size > 1 || resolutionIncomplete) {
        return {
          error: {
            code: 'ambiguous_award_id',
            message: resolutionIncomplete
              ? `Could not establish a unique award for PIID "${awardIdInput}" within ${MAX_AWARD_RESOLUTION_PAGES * AWARD_RESOLUTION_PAGE_SIZE} search results. Pass a USASpending generated award ID from the candidates or recipient search.`
              : `PIID "${awardIdInput}" matches multiple awards. Pass one of the generated_unique_award_id candidate values instead.`,
            candidate_count_at_least: candidateIds.size,
            candidates_truncated: candidatesTruncated,
            candidates,
          },
        };
      }

      if (candidates.length === 0) {
        return {
          error: {
            code: 'not_found',
            message: `No procurement award found for PIID "${awardIdInput}". Pass a USASpending generated award ID (CONT_AWD_... or CONT_IDV_...) if you have one.`,
          },
        };
      }
      generatedId = candidates[0].generated_unique_award_id;
    }

    const response = await ApiClient.usaspendingGet(`/awards/${encodeURIComponent(generatedId)}/`);
    if (!response.success) {
      return { error: response.error };
    }

    const award = response.data;
    const contractData = award.latest_transaction_contract_data ?? {};
    const setAsideCode = contractData.type_set_aside ?? null;
    const otherThanFullAndOpenCode =
      contractData.other_than_full_and_open ?? contractData.other_than_full_and_open_competition ?? null;

    return {
      generated_unique_award_id: award.generated_unique_award_id ?? generatedId,
      piid: award.piid ?? award.fain ?? null,
      category: award.category ?? null,
      type: award.type ?? null,
      type_description: award.type_description ?? null,
      description: award.description ?? null,
      total_obligation: award.total_obligation ?? null,
      base_and_all_options: award.base_and_all_options ?? null,
      awarding_agency: {
        toptier: award.awarding_agency?.toptier_agency?.name ?? null,
        toptier_code: award.awarding_agency?.toptier_agency?.code ?? null,
        subtier: award.awarding_agency?.subtier_agency?.name ?? null,
      },
      recipient: {
        name: award.recipient?.recipient_name ?? null,
        uei: award.recipient?.uei ?? award.recipient?.recipient_uei ?? null,
      },
      period_of_performance: {
        start_date: award.period_of_performance?.start_date ?? null,
        end_date: award.period_of_performance?.end_date ?? null,
        current_end_date: award.period_of_performance?.end_date ?? null,
        potential_end_date: award.period_of_performance?.potential_end_date ?? null,
        ultimate_end_date: award.period_of_performance?.potential_end_date ?? null,
      },
      // The competition block — the fields that verify what a filter claimed.
      competition: {
        type_set_aside: setAsideCode
          ? { ...describeSetAside(String(setAsideCode)), upstream_description: contractData.type_set_aside_description ?? null }
          : null,
        extent_competed: contractData.extent_competed
          ? {
              code: contractData.extent_competed,
              description:
                lookupReferenceCode('extent_competed', String(contractData.extent_competed))?.description ??
                contractData.extent_competed_description ??
                null,
            }
          : null,
        number_of_offers_received: contractData.number_of_offers_received ?? null,
        solicitation_procedures: contractData.solicitation_procedures
          ? {
              code: contractData.solicitation_procedures,
              description:
                lookupReferenceCode('solicitation_procedure', String(contractData.solicitation_procedures))?.description ??
                contractData.solicitation_procedures_description ??
                null,
            }
          : null,
        other_than_full_and_open_competition: otherThanFullAndOpenCode,
        other_than_full_and_open_competition_description: otherThanFullAndOpenCode
          ? lookupReferenceCode('competition', String(otherThanFullAndOpenCode))?.description ??
            contractData.other_than_full_and_open_description ??
            null
          : null,
      },
      naics: {
        code: contractData.naics ?? null,
        description: contractData.naics_description ?? null,
      },
      psc: {
        code: contractData.product_or_service_code ?? null,
        description: contractData.product_or_service_description ?? contractData.product_or_service_co_desc ?? null,
      },
      source: 'USASpending /awards/ (FPDS latest transaction)',
    };
  },

  async aggregateContracts(args: any): Promise<any> {
    const {
      group_by,
      metric = 'obligations',
      date_from,
      date_to,
      date_type = 'action_date',
      agency,
      sub_agency,
      naics,
      psc,
      set_aside,
      recipient_search,
      award_type_codes,
      limit = 25,
    } = args;

    const bad = (message: string) => ({ error: { code: 'bad_request', message } });

    const validGroupBys = [...Object.keys(GROUP_BY_CATEGORY), 'month', 'set_aside'];
    if (!validGroupBys.includes(group_by)) {
      return bad(`group_by must be one of: ${validGroupBys.join(', ')}`);
    }
    if (!['obligations', 'count'].includes(metric)) {
      return bad("metric must be 'obligations' or 'count'");
    }
    if (metric === 'count' && group_by !== 'set_aside') {
      return bad(
        "metric 'count' is only supported with group_by 'set_aside' (USASpending exposes award counts per filter, not per category). Use metric 'obligations', or iterate filters yourself."
      );
    }
    if (!date_from || !date_to) {
      return bad('date_from and date_to are required');
    }
    if (!['action_date', 'date_signed', 'new_awards_only'].includes(date_type)) {
      return bad("date_type must be 'action_date', 'date_signed', or 'new_awards_only'");
    }
    if (sub_agency && !agency) {
      return bad('sub_agency requires agency');
    }

    let setAsideCodes: string[] = [];
    if (set_aside !== undefined && set_aside !== null && set_aside !== '') {
      try {
        setAsideCodes = validateSetAsideCodes((Array.isArray(set_aside) ? set_aside : [set_aside]).map(String));
      } catch (err) {
        return bad(err instanceof Error ? err.message : String(err));
      }
    }
    if (group_by === 'set_aside' && setAsideCodes.length === 0) {
      return bad("group_by 'set_aside' requires the set_aside codes to group over (USASpending has no native set-aside category)");
    }

    const typeCodes = Array.isArray(award_type_codes) && award_type_codes.length > 0
      ? award_type_codes.map(String)
      : CONTRACT_AWARD_TYPE_CODES;

    const buildFilters = (codes: string[] | null) => {
      const filters: any = {
        time_period: [{ start_date: date_from, end_date: date_to, date_type }],
        award_type_codes: typeCodes,
      };
      if (agency) {
        filters.agencies = [{ type: 'awarding', tier: 'toptier', name: agency }];
        if (sub_agency) {
          filters.agencies.push({ type: 'awarding', tier: 'subtier', name: sub_agency });
        }
      }
      if (Array.isArray(naics) && naics.length) filters.naics_codes = naics.map(String);
      if (Array.isArray(psc) && psc.length) filters.psc_codes = psc.map(String);
      if (recipient_search) filters.recipient_search_text = [String(recipient_search)];
      if (codes && codes.length) filters.set_aside_type_codes = codes;
      return filters;
    };

    const countUnit =
      metric === 'count'
        ? 'prime awards (USASpending spending_by_award_count; awards, not transactions)'
        : `obligated dollars (USASpending; transactions in window aggregated by ${date_type})`;
    const dateField = `${date_type} (explicit USASpending time_period date_type)`;
    const filtersEcho = {
      upstream: {
        time_period: { start_date: date_from, end_date: date_to, date_type },
        award_type_codes: typeCodes,
        ...(agency ? { agency } : {}),
        ...(sub_agency ? { sub_agency } : {}),
        ...(Array.isArray(naics) && naics.length ? { naics } : {}),
        ...(Array.isArray(psc) && psc.length ? { psc } : {}),
        ...(recipient_search ? { recipient_search } : {}),
        ...(setAsideCodes.length ? { set_aside: setAsideCodes } : {}),
      },
      client_side: {},
    };

    if (group_by === 'set_aside') {
      // One upstream query per code; each result is labeled with its FPDS description.
      const groups: any[] = [];
      for (const code of setAsideCodes) {
        const filters = buildFilters([code]);
        if (metric === 'count') {
          const res = await ApiClient.usaspendingPost('/search/spending_by_award_count/', { filters });
          if (!res.success) return { error: res.error };
          const counts = res.data.results ?? {};
          const total = Object.values(counts).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);
          groups.push({ ...describeSetAside(code), value: total, breakdown_by_award_type: counts });
        } else {
          const res = await ApiClient.usaspendingPost('/search/spending_over_time/', { group: 'month', filters });
          if (!res.success) return { error: res.error };
          const total = (res.data.results ?? []).reduce(
            (sum: number, bucket: any) => sum + (Number(bucket.aggregated_amount) || 0),
            0
          );
          groups.push({ ...describeSetAside(code), value: Number(total.toFixed(2)) });
        }
      }
      return {
        group_by,
        metric,
        groups: groups.sort((a, b) => b.value - a.value),
        count_unit: countUnit,
        date_field: dateField,
        filters: filtersEcho,
      };
    }

    if (group_by === 'month') {
      const res = await ApiClient.usaspendingPost('/search/spending_over_time/', {
        group: 'month',
        filters: buildFilters(setAsideCodes.length ? setAsideCodes : null),
      });
      if (!res.success) return { error: res.error };
      const groups = (res.data.results ?? []).map((bucket: any) => ({
        key: `${bucket.time_period?.fiscal_year ?? ''}-${String(bucket.time_period?.month ?? '').padStart(2, '0')}`,
        label: `FY${bucket.time_period?.fiscal_year ?? '?'} month ${bucket.time_period?.month ?? '?'}`,
        value: Number(bucket.aggregated_amount) || 0,
      }));
      return {
        group_by,
        metric,
        groups,
        count_unit: countUnit,
        date_field: dateField,
        filters: filtersEcho,
        warnings: ['spending_over_time months are fiscal-year months (month 1 = October).'],
      };
    }

    const category = GROUP_BY_CATEGORY[group_by];
    const res = await ApiClient.usaspendingPost(`/search/spending_by_category/${category}/`, {
      filters: buildFilters(setAsideCodes.length ? setAsideCodes : null),
      limit: Math.min(Math.max(Number(limit) || 25, 1), 100),
    });
    if (!res.success) return { error: res.error };
    const groups = (res.data.results ?? []).map((row: any) => ({
      key: String(row.code ?? row.id ?? row.name ?? ''),
      label: String(row.name ?? row.code ?? ''),
      value: Number(row.amount) || 0,
    }));
    return {
      group_by,
      metric,
      groups,
      count_unit: countUnit,
      date_field: dateField,
      filters: filtersEcho,
    };
  },

  async getAgencyAwards(args: any): Promise<any> {
    const { agency_code, fiscal_year = 2024, limit = 10 } = args;
    
    if (!agency_code) {
      throw new Error("Agency code is required");
    }

    const response = await ApiClient.usaspendingGet(`/agency/${agency_code}/awards/`, {
      fiscal_year,
      limit: Math.min(limit, 100)
    });
    
    if (!response.success) {
      return { error: response.error };
    }

    return {
      agency_code,
      fiscal_year,
      total_obligations: response.data.total_obligated_amount,
      total_awards: response.data.award_count,
      awards_summary: response.data.results?.slice(0, limit).map((award: any) => ({
        id: award.generated_unique_award_id,
        recipient: award.recipient_name,
        amount: award.obligated_amount,
        agency: award.awarding_agency_name,
        description: award.description,
        award_type: award.type_description,
        start_date: award.period_of_performance_start_date,
        end_date: award.period_of_performance_current_end_date
      }))
    };
  },

  async getSpendingByCategory(args: any): Promise<any> {
    const { agency_code, fiscal_year = 2024 } = args;
    
    if (!agency_code) {
      throw new Error("Agency code is required");
    }

    const response = await ApiClient.usaspendingGet(`/agency/${agency_code}/obligations_by_award_category/`, {
      fiscal_year
    });
    
    if (!response.success) {
      return { error: response.error };
    }

    return {
      agency_code,
      fiscal_year,
      total_obligations: response.data.total_obligated_amount,
      spending_by_category: response.data.results?.map((category: any) => ({
        category: category.category,
        category_name: category.category_name,
        obligated_amount: category.obligated_amount,
        percentage: category.percentage_of_total
      })) || []
    };
  },

  async getBudgetaryResources(args: any): Promise<any> {
    const { agency_code, fiscal_year = 2024 } = args;
    
    if (!agency_code) {
      throw new Error("Agency code is required");
    }

    const response = await ApiClient.usaspendingGet(`/agency/${agency_code}/budgetary_resources/`, {
      fiscal_year
    });
    
    if (!response.success) {
      return { error: response.error };
    }

    return {
      agency_code,
      fiscal_year,
      agency_name: response.data.agency_name,
      total_budgetary_resources: response.data.total_budgetary_resources,
      total_obligations: response.data.total_obligations,
      total_outlays: response.data.total_outlays,
      unobligated_balance: response.data.unobligated_balance,
      budget_authority: response.data.budget_authority
    };
  },

  async searchAwardsByRecipient(args: any): Promise<any> {
    const { 
      recipient_name, 
      fiscal_year, 
      min_amount, 
      max_amount, 
      award_types, 
      limit = 10,
      cursor,
    } = args;
    
    const recipientName = String(recipient_name ?? '').trim();
    if (!recipientName) {
      return { error: { code: 'bad_request', message: 'recipient_name is required' } };
    }

    let typeSelection: { codes: string[]; group: string };
    try {
      typeSelection = validateAwardTypeGroup(award_types);
    } catch (error) {
      return {
        error: {
          code: 'bad_request',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    const pageToken = pageNumberFromCursor(cursor);
    const page = pageToken === null ? 1 : Number(pageToken);
    if (!Number.isInteger(page) || page < 1) {
      return { error: { code: 'bad_request', message: 'cursor must be a positive page number from next_cursor' } };
    }
    const numericLimit = Number(limit);
    if (!Number.isFinite(numericLimit)) {
      return { error: { code: 'bad_request', message: 'limit must be a finite number' } };
    }
    const pageSize = Math.min(Math.max(Math.floor(numericLimit), 1), 100);

    const normalizedFiscalYear = fiscal_year === undefined ? undefined : Number(fiscal_year);
    if (
      normalizedFiscalYear !== undefined &&
      (!Number.isInteger(normalizedFiscalYear) || normalizedFiscalYear < 2001)
    ) {
      return { error: { code: 'bad_request', message: 'fiscal_year must be an integer greater than or equal to 2001' } };
    }

    const normalizedMinAmount = min_amount === undefined ? undefined : Number(min_amount);
    const normalizedMaxAmount = max_amount === undefined ? undefined : Number(max_amount);
    if (normalizedMinAmount !== undefined && !Number.isFinite(normalizedMinAmount)) {
      return { error: { code: 'bad_request', message: 'min_amount must be a finite number' } };
    }
    if (normalizedMaxAmount !== undefined && !Number.isFinite(normalizedMaxAmount)) {
      return { error: { code: 'bad_request', message: 'max_amount must be a finite number' } };
    }
    if (
      normalizedMinAmount !== undefined &&
      normalizedMaxAmount !== undefined &&
      normalizedMinAmount > normalizedMaxAmount
    ) {
      return { error: { code: 'bad_request', message: 'min_amount must be less than or equal to max_amount' } };
    }

    // Build the search request for USASpending API
    const searchRequest: any = {
      filters: {
        recipient_search_text: [recipientName],
        award_type_codes: typeSelection.codes,
      },
      fields: [
        "Award ID",
        "Recipient Name", 
        "Award Amount",
        "Awarding Agency",
        "Awarding Sub Agency",
        "Award Type",
        "Start Date",
        "End Date",
        "Description",
        "generated_internal_id"
      ],
      sort: "Award Amount",
      order: "desc",
      limit: pageSize,
      page,
    };

    // Add time period filter if fiscal year specified
    if (normalizedFiscalYear !== undefined) {
      searchRequest.filters.time_period = [{
        start_date: `${normalizedFiscalYear - 1}-10-01`, // FY starts Oct 1
        end_date: `${normalizedFiscalYear}-09-30`,       // FY ends Sep 30
        date_type: 'action_date',
      }];
    }

    // Add award amount filters
    if (min_amount !== undefined || max_amount !== undefined) {
      searchRequest.filters.award_amounts = [{
        lower_bound: normalizedMinAmount ?? 0,
        upper_bound: normalizedMaxAmount ?? 999999999999
      }];
    }

    const response = await ApiClient.usaspendingPost('/search/spending_by_award/', searchRequest);
    
    if (!response.success) {
      return { error: response.error };
    }

    const awards = response.data.results?.map((award: any) => ({
      id: award["Award ID"],
      generated_unique_award_id: award.generated_internal_id ?? null,
      recipient: award["Recipient Name"],
      amount: award["Award Amount"],
      awarding_agency: award["Awarding Agency"],
      awarding_sub_agency: award["Awarding Sub Agency"],
      award_type: award["Award Type"],
      start_date: award["Start Date"],
      end_date: award["End Date"],
      description: award["Description"]
    })) || [];

    const pageAmount = awards.reduce((sum: number, award: any) => sum + (Number(award.amount) || 0), 0);
    const hasNext = Boolean(response.data.page_metadata?.hasNext);
    const envelope = listEnvelope({
      resourceKey: 'awards',
      rows: awards,
      upstreamTotal: null,
      countUnit: 'prime awards on this USASpending result page',
      dateField: normalizedFiscalYear !== undefined ? 'action_date' : undefined,
      filters: { upstream: searchRequest.filters, client_side: {} },
      warnings: [
        'USASpending spending_by_award does not provide a trustworthy population total; total and total_results are null. Page through next_cursor to enumerate results.',
      ],
      nextCursor: hasNext ? String(page + 1) : null,
    });

    return {
      recipient_name: recipientName,
      fiscal_year: normalizedFiscalYear,
      total_results: null,
      ...envelope,
      search_summary: {
        total_amount: null,
        page_amount: pageAmount,
        award_count: awards.length,
        award_count_scope: 'returned page',
        amount_range: { min: normalizedMinAmount, max: normalizedMaxAmount },
        award_types: typeSelection.codes,
        award_type_group: typeSelection.group,
        get_award_detail_compatible: ['contracts', 'idvs'].includes(typeSelection.group),
      }
    };
  }
};
