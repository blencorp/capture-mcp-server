import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ApiClient } from '../utils/api-client.js';

export const tangoTools = {
  async getTools(): Promise<Tool[]> {
    return [
      {
        name: "search_tango_contracts",
        description: "Search federal contracts through Tango's unified API. Provides comprehensive contract data consolidated from FPDS with enhanced filtering and search capabilities.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              description: "Tango API key (optional if TANGO_API_KEY env var is set)"
            },
            query: {
              type: "string",
              description: "Search query for contract description or title"
            },
            vendor_name: {
              type: "string",
              description: "Vendor/contractor name filter"
            },
            vendor_uei: {
              type: "string",
              description: "Vendor Unique Entity Identifier (UEI)"
            },
            agency: {
              type: "string",
              description: "Awarding agency name or code"
            },
            naics_code: {
              type: "string",
              description: "NAICS industry classification code"
            },
            psc_code: {
              type: "string",
              description: "Product/Service Code (PSC)"
            },
            award_amount_min: {
              type: "number",
              description: "Minimum contract award amount"
            },
            award_amount_max: {
              type: "number",
              description: "Maximum contract award amount"
            },
            date_from: {
              type: "string",
              description: "Start date for contract awards (YYYY-MM-DD format)"
            },
            date_to: {
              type: "string",
              description: "End date for contract awards (YYYY-MM-DD format)"
            },
            set_aside: {
              type: "string",
              description: "Set-aside type (e.g., 'SBA', 'WOSB', 'SDVOSB', '8A')"
            },
            limit: {
              type: "number",
              description: "Number of results to return (default: 10, max: 100)"
            }
          },
          required: []
        }
      },
      {
        name: "search_tango_grants",
        description: "Search federal grants and financial assistance awards through Tango's unified API. Access grant data consolidated from USASpending with advanced filtering.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              description: "Tango API key (optional if TANGO_API_KEY env var is set)"
            },
            query: {
              type: "string",
              description: "Search query for grant description or title"
            },
            recipient_name: {
              type: "string",
              description: "Grant recipient organization name"
            },
            recipient_uei: {
              type: "string",
              description: "Recipient Unique Entity Identifier (UEI)"
            },
            agency: {
              type: "string",
              description: "Awarding agency name or code"
            },
            cfda_number: {
              type: "string",
              description: "Catalog of Federal Domestic Assistance (CFDA) number"
            },
            award_amount_min: {
              type: "number",
              description: "Minimum grant award amount"
            },
            award_amount_max: {
              type: "number",
              description: "Maximum grant award amount"
            },
            date_from: {
              type: "string",
              description: "Start date for grant awards (YYYY-MM-DD format)"
            },
            date_to: {
              type: "string",
              description: "End date for grant awards (YYYY-MM-DD format)"
            },
            limit: {
              type: "number",
              description: "Number of results to return (default: 10, max: 100)"
            }
          },
          required: []
        }
      },
      {
        name: "get_tango_vendor_profile",
        description: "Get comprehensive vendor/entity profile from Tango's consolidated database. Provides unified view of entity data from SAM.gov with contract history.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              description: "Tango API key (optional if TANGO_API_KEY env var is set)"
            },
            uei: {
              type: "string",
              description: "Unique Entity Identifier (UEI) - required"
            },
            include_contracts: {
              type: "boolean",
              description: "Include recent contract history (default: false)"
            },
            include_grants: {
              type: "boolean",
              description: "Include recent grant history (default: false)"
            }
          },
          required: ["uei"]
        }
      },
      {
        name: "search_tango_opportunities",
        description: "Search federal contract opportunities through Tango's unified API. Enhanced opportunity search with forecasts and solicitation notices.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              description: "Tango API key (optional if TANGO_API_KEY env var is set)"
            },
            query: {
              type: "string",
              description: "Search query for opportunity title or description"
            },
            agency: {
              type: "string",
              description: "Agency name or code"
            },
            naics_code: {
              type: "string",
              description: "NAICS industry classification code"
            },
            set_aside: {
              type: "string",
              description: "Set-aside type filter"
            },
            posted_from: {
              type: "string",
              description: "Start date for opportunities (YYYY-MM-DD format)"
            },
            posted_to: {
              type: "string",
              description: "End date for opportunities (YYYY-MM-DD format)"
            },
            response_deadline_from: {
              type: "string",
              description: "Minimum response deadline (YYYY-MM-DD format)"
            },
            status: {
              type: "string",
              description: "Opportunity status (e.g., 'active', 'closed', 'forecasted')"
            },
            limit: {
              type: "number",
              description: "Number of results to return (default: 10, max: 100)"
            }
          },
          required: []
        }
      },
      {
        name: "search_tango_protests",
        description: "Search GAO bid protest records through Tango. Filter by agency, protester, outcome (Sustained/Denied/Dismissed/Withdrawn), case type, and date ranges. Useful for pre-bid risk scoring and identifying repeat protesters.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            query: { type: "string", description: "Full-text search across title, protester, agency, solicitation, and case number" },
            agency: { type: "string", description: "Agency identifier (name, abbreviation, CGAC/FPDS code). Use '|' for multi-value OR." },
            protester: { type: "string", description: "Protester / petitioner name (vector search)" },
            outcome: { type: "string", description: "Protest outcome: 'Sustained', 'Denied', 'Dismissed', or 'Withdrawn'" },
            source_system: { type: "string", description: "Source system filter (e.g., 'gao', 'cofc')" },
            case_type: { type: "string", description: "Case type substring (e.g., 'Bid Protest', 'Cost Claim')" },
            case_number: { type: "string", description: "Exact base case number (e.g., 'b-423274')" },
            solicitation_number: { type: "string", description: "Exact solicitation number" },
            filed_date_from: { type: "string", description: "Filed on or after (YYYY-MM-DD)" },
            filed_date_to: { type: "string", description: "Filed on or before (YYYY-MM-DD)" },
            decision_date_from: { type: "string", description: "Decision on or after (YYYY-MM-DD)" },
            decision_date_to: { type: "string", description: "Decision on or before (YYYY-MM-DD)" },
            limit: { type: "number", description: "Number of results to return (default: 10, max: 100)" }
          },
          required: []
        }
      },
      {
        name: "get_tango_protest",
        description: "Get the full record for a single bid protest, including digest text and any linked solicitations/contracts. Pass the protest ID or case number returned by search_tango_protests.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            protest_id: { type: "string", description: "Protest ID or base case number (e.g., 'b-423274')" }
          },
          required: ["protest_id"]
        }
      },
      {
        name: "search_tango_idvs",
        description: "Search federal Indefinite Delivery Vehicles (IDIQs, BPAs, FSS) through Tango. Returns vehicle-level contracts that issue task/delivery orders. Same filter shape as search_tango_contracts, plus idv_type and last_date_to_order (expiry).",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            query: { type: "string", description: "Search query (description, title, PIID)" },
            vendor_name: { type: "string", description: "Vendor / contractor name (recipient)" },
            vendor_uei: { type: "string", description: "Vendor UEI" },
            piid: { type: "string", description: "Exact PIID" },
            agency: { type: "string", description: "Awarding agency name or code" },
            funding_agency: { type: "string", description: "Funding agency name or code" },
            naics_code: { type: "string", description: "NAICS code" },
            psc_code: { type: "string", description: "Product/Service Code (PSC)" },
            set_aside: { type: "string", description: "Set-aside code(s); use '|' for OR" },
            idv_type: { type: "string", description: "IDV type code (e.g., 'IDC', 'GWAC', 'BPA', 'BOA', 'FSS')" },
            award_date_from: { type: "string", description: "Award date on or after (YYYY-MM-DD)" },
            award_date_to: { type: "string", description: "Award date on or before (YYYY-MM-DD)" },
            expiring_from: { type: "string", description: "Last date to order on or after (YYYY-MM-DD) — find IDVs still accepting orders" },
            expiring_to: { type: "string", description: "Last date to order on or before (YYYY-MM-DD) — find IDVs about to close to orders" },
            limit: { type: "number", description: "Number of results to return (default: 10, max: 100)" }
          },
          required: []
        }
      },
      {
        name: "get_tango_idv_children",
        description: "Get the awards issued under a single IDV (its child IDVs, task/delivery orders, and transactions). Use this after search_tango_idvs to drill into a specific vehicle's ordering activity.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            idv_key: { type: "string", description: "Tango IDV key (from the `key` field of a search_tango_idvs result) — required" },
            include_child_idvs: { type: "boolean", description: "Include child IDVs (sub-IDIQs under this parent). Default: true" },
            include_task_orders: { type: "boolean", description: "Include task/delivery order awards issued against this IDV. Default: true" },
            include_transactions: { type: "boolean", description: "Include obligation transactions (lower-level, may be large). Default: false" },
            limit_per_section: { type: "number", description: "Max rows per section (default: 20, max: 100)" }
          },
          required: ["idv_key"]
        }
      },
      {
        name: "search_tango_vehicles",
        description: "Search the federal contract-vehicle catalog (BPAs, GWACs, GSA MAS Schedules, agency-wide IDIQs) through Tango. Vehicles aggregate the holders, scope, and obligations of a procurement instrument. Distinct from /idvs/ which lists raw IDV awards.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            query: { type: "string", description: "Search query (vehicle name, program acronym, description)" },
            vehicle_type: { type: "string", description: "Vehicle (IDV) type code; use '|' for OR (e.g., 'GWAC|BPA')" },
            type_of_idc: { type: "string", description: "Type of IDC code; use '|' for OR" },
            contract_type: { type: "string", description: "Contract type code; use '|' for OR" },
            set_aside: { type: "string", description: "Set-aside code(s); use '|' for OR" },
            naics_code: { type: "string", description: "NAICS code (exact)" },
            psc_code: { type: "string", description: "PSC / Product Service Code" },
            program_acronym: { type: "string", description: "Program acronym (e.g., 'SEWP', 'OASIS', 'CIO-SP3')" },
            who_can_use: { type: "string", description: "Who-can-use code (e.g., 'gov-wide', agency-restricted)" },
            agency: { type: "string", description: "Awarding agency / department / sub-agency" },
            organization_id: { type: "string", description: "Awarding organization UUID (exact)" },
            total_obligated_min: { type: "number", description: "Minimum total obligated across the vehicle (USD)" },
            total_obligated_max: { type: "number", description: "Maximum total obligated across the vehicle (USD)" },
            limit: { type: "number", description: "Number of results to return (default: 10, max: 100)" }
          },
          required: []
        }
      },
      {
        name: "search_tango_otas",
        description: "Search federal Other Transaction Authority (OTA) awards through Tango. OTAs are flexible R&D / prototype agreements outside the FAR. Note: OTAs have no NAICS or set-aside fields by design.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            query: { type: "string", description: "Search query (description, title, PIID)" },
            vendor_name: { type: "string", description: "Vendor / recipient name" },
            vendor_uei: { type: "string", description: "Vendor UEI" },
            piid: { type: "string", description: "Exact PIID" },
            agency: { type: "string", description: "Awarding agency name or code" },
            funding_agency: { type: "string", description: "Funding agency name or code" },
            award_date_from: { type: "string", description: "Award date on or after (YYYY-MM-DD)" },
            award_date_to: { type: "string", description: "Award date on or before (YYYY-MM-DD)" },
            fiscal_year: { type: "number", description: "Fiscal year of award" },
            limit: { type: "number", description: "Number of results to return (default: 10, max: 100)" }
          },
          required: []
        }
      },
      {
        name: "get_tango_entity_metrics",
        description: "Get a time-series of obligations for a single entity (by UEI), bucketed by month/quarter/year over a lookback window. Use this after get_tango_vendor_profile to see spending trends, not just totals.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: { type: "string", description: "Tango API key (optional if TANGO_API_KEY env var is set)" },
            uei: { type: "string", description: "Unique Entity Identifier (UEI) — required" },
            months: { type: "number", description: "Lookback window in months (e.g., 12, 36, 60). Default: 36" },
            period_grouping: { type: "string", description: "Bucket size: 'month', 'quarter', or 'year'. Default: 'quarter'" },
            group_by: { type: "string", description: "Optional secondary slice: 'agency' or 'department'" }
          },
          required: ["uei"]
        }
      },
      {
        name: "get_tango_spending_summary",
        description: "Get spending summaries and analytics from Tango's unified platform. Aggregate spending data by various dimensions (agency, vendor, category, time).",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              description: "Tango API key (optional if TANGO_API_KEY env var is set)"
            },
            agency: {
              type: "string",
              description: "Agency name or code for spending summary"
            },
            vendor_uei: {
              type: "string",
              description: "Vendor UEI for spending summary"
            },
            fiscal_year: {
              type: "number",
              description: "Fiscal year for summary (e.g., 2024)"
            },
            group_by: {
              type: "string",
              description: "Group spending by dimension: 'agency', 'vendor', 'naics', 'psc', 'month'"
            },
            award_type: {
              type: "string",
              description: "Filter by award type: 'contracts', 'grants', 'all' (default: 'all')"
            }
          },
          required: []
        }
      }
    ];
  },

  async callTool(name: string, args: any): Promise<any> {
    const sanitizedArgs = ApiClient.sanitizeInput(args);

    switch(name) {
      case "search_tango_contracts":
        return await this.searchContracts(sanitizedArgs);
      case "search_tango_grants":
        return await this.searchGrants(sanitizedArgs);
      case "get_tango_vendor_profile":
        return await this.getVendorProfile(sanitizedArgs);
      case "search_tango_opportunities":
        return await this.searchOpportunities(sanitizedArgs);
      case "get_tango_spending_summary":
        return await this.getSpendingSummary(sanitizedArgs);
      case "search_tango_protests":
        return await this.searchProtests(sanitizedArgs);
      case "get_tango_protest":
        return await this.getProtest(sanitizedArgs);
      case "search_tango_idvs":
        return await this.searchIdvs(sanitizedArgs);
      case "get_tango_idv_children":
        return await this.getIdvChildren(sanitizedArgs);
      case "search_tango_vehicles":
        return await this.searchVehicles(sanitizedArgs);
      case "search_tango_otas":
        return await this.searchOtas(sanitizedArgs);
      case "get_tango_entity_metrics":
        return await this.getEntityMetrics(sanitizedArgs);
      default:
        throw new Error(`Unknown Tango tool: ${name}`);
    }
  },

  requireKey(api_key: any): string {
    const key = api_key || process.env.TANGO_API_KEY;
    if (!key) {
      throw new Error("Tango API key is required. Please provide it as a parameter or set TANGO_API_KEY environment variable");
    }
    return key;
  },

  async searchContracts(args: any): Promise<any> {
    const {
      api_key,
      query,
      vendor_name,
      vendor_uei,
      agency,
      naics_code,
      psc_code,
      award_amount_min,
      award_amount_max,
      date_from,
      date_to,
      set_aside,
      limit = 10
    } = args;

    const tangoApiKey = api_key || process.env.TANGO_API_KEY;

    if (!tangoApiKey) {
      throw new Error("Tango API key is required. Please provide it as a parameter or set TANGO_API_KEY environment variable");
    }

    const params: Record<string, any> = {
      limit: Math.min(limit, 100)
    };

    if (query) params.search = query;
    if (vendor_name) params.recipient = vendor_name;
    if (vendor_uei) params.uei = vendor_uei;
    if (agency) params.awarding_agency = agency;
    if (naics_code) params.naics = naics_code;
    if (psc_code) params.psc = psc_code;
    if (date_from) params.award_date_gte = date_from;
    if (date_to) params.award_date_lte = date_to;
    if (set_aside) params.set_aside = set_aside;

    const response = await ApiClient.tangoGet('/contracts/', params, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    let rawContracts: any[] = response.data.results || [];

    if (award_amount_min !== undefined || award_amount_max !== undefined) {
      rawContracts = rawContracts.filter((contract: any) => {
        const amount = Number(contract.obligated ?? contract.total_contract_value ?? contract.base_and_exercised_options_value ?? 0);
        if (typeof award_amount_min === 'number' && amount < award_amount_min) {
          return false;
        }
        if (typeof award_amount_max === 'number' && amount > award_amount_max) {
          return false;
        }
        return true;
      });
    }

    if (vendor_name) {
      const needle = vendor_name.toLowerCase();
      rawContracts = rawContracts.filter((contract: any) => {
        const recipient = contract.recipient?.display_name || contract.recipient_name || contract.vendor_name;
        return typeof recipient === 'string' ? recipient.toLowerCase().includes(needle) : true;
      });
    }

    // Filter response to essential contract fields
    const contracts = rawContracts.map((contract: any) => ({
      contract_id: contract.key || contract.piid || contract.contract_id,
      title: contract.description || contract.title,
      vendor: {
        name: contract.recipient?.display_name || contract.vendor_name,
        uei: contract.recipient?.uei || contract.vendor_uei,
        duns: contract.vendor_duns
      },
      agency: {
        name: contract.awarding_office?.agency_name || contract.agency_name,
        code: contract.awarding_office?.agency_code || contract.agency_code,
        office: contract.awarding_office?.office_name || contract.office_name
      },
      award_amount: contract.obligated ?? contract.total_contract_value ?? contract.base_and_exercised_options_value ?? contract.award_amount,
      award_date: contract.award_date || contract.date_signed,
      naics_code: contract.naics_code,
      naics_description: contract.naics_description,
      psc_code: contract.psc_code,
      psc_description: contract.psc_description,
      set_aside: contract.set_aside?.code || contract.type_of_set_aside,
      place_of_performance: {
        city: contract.place_of_performance?.city_name || contract.pop_city,
        state: contract.place_of_performance?.state_name || contract.pop_state_code,
        country: contract.place_of_performance?.country_name || contract.pop_country_code
      },
      status: contract.contract_status || contract.status
    }));

    return {
      total: response.data.total || response.data.count || 0,
      contracts,
      filters: params,
      limit
    };
  },

  async searchGrants(args: any): Promise<any> {
    const {
      api_key,
      query,
      recipient_name,
      recipient_uei,
      agency,
      cfda_number,
      award_amount_min,
      award_amount_max,
      date_from,
      date_to,
      limit = 10
    } = args;

    const tangoApiKey = api_key || process.env.TANGO_API_KEY;

    if (!tangoApiKey) {
      throw new Error("Tango API key is required. Please provide it as a parameter or set TANGO_API_KEY environment variable");
    }

    const params: Record<string, any> = {
      limit: Math.min(limit, 100)
    };

    if (query) params.search = query;
    if (agency) params.agency = agency;
    if (cfda_number) params.cfda_number = cfda_number;
    if (date_from) params.posted_date_after = date_from;
    if (date_to) params.posted_date_before = date_to;

    const response = await ApiClient.tangoGet('/grants/', params, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    let rawGrants: any[] = response.data.results || [];

    if (recipient_name) {
      const nameNeedle = recipient_name.toLowerCase();
      rawGrants = rawGrants.filter((grant: any) => {
        const nameValue = grant.recipient?.name || grant.recipient_name;
        return typeof nameValue === 'string' ? nameValue.toLowerCase().includes(nameNeedle) : true;
      });
    }

    if (recipient_uei) {
      rawGrants = rawGrants.filter((grant: any) => {
        const ueiValue = grant.recipient?.uei || grant.recipient_uei;
        return typeof ueiValue === 'string' ? ueiValue === recipient_uei : true;
      });
    }

    if (award_amount_min !== undefined || award_amount_max !== undefined) {
      rawGrants = rawGrants.filter((grant: any) => {
        const amount = Number(grant.award_amount ?? grant.total_funding_amount ?? 0);
        if (typeof award_amount_min === 'number' && amount < award_amount_min) {
          return false;
        }
        if (typeof award_amount_max === 'number' && amount > award_amount_max) {
          return false;
        }
        return true;
      });
    }

    // Filter response to essential grant fields
    const grants = rawGrants.map((grant: any) => ({
      grant_id: grant.fain || grant.grant_id,
      title: grant.description || grant.title || grant.project_title,
      recipient: {
        name: grant.recipient?.name || grant.recipient_name,
        uei: grant.recipient?.uei || grant.recipient_uei,
        duns: grant.recipient?.duns || grant.recipient_duns,
        type: grant.recipient?.type || grant.recipient_type
      },
      agency: {
        name: grant.agency_name,
        code: grant.agency_code,
        office: grant.office_name
      },
      award_amount: grant.award_amount || grant.total_funding_amount,
      award_date: grant.award_date || grant.date_signed,
      cfda: {
        number: grant.cfda_number,
        title: grant.cfda_title
      },
      place_of_performance: {
        city: grant.pop_city,
        state: grant.pop_state_code,
        country: grant.pop_country_code
      },
      status: grant.grant_status || grant.status,
      period_of_performance: {
        start: grant.period_start_date,
        end: grant.period_end_date
      }
    })) || [];

    return {
      total: response.data.total || response.data.count || 0,
      grants,
      filters: params,
      limit
    };
  },

  async getVendorProfile(args: any): Promise<any> {
    const { api_key, uei, include_contracts = false, include_grants = false } = args;

    const tangoApiKey = api_key || process.env.TANGO_API_KEY;

    if (!tangoApiKey) {
      throw new Error("Tango API key is required. Please provide it as a parameter or set TANGO_API_KEY environment variable");
    }

    if (!uei) {
      throw new Error("UEI is required");
    }

    const response = await ApiClient.tangoGet(`/entities/${uei}/`, {}, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    const vendor = response.data;
    let recentContracts: any[] | undefined;
    let recentGrants: any[] | undefined;

    if (include_contracts) {
      const contractsResponse = await ApiClient.tangoGet(
        `/entities/${uei}/contracts/`,
        { limit: 5, ordering: '-award_date' },
        tangoApiKey
      );

      if (contractsResponse.success) {
        recentContracts = (contractsResponse.data.results || []).map((contract: any) => ({
          contract_id: contract.key || contract.piid,
          title: contract.description || contract.title,
          award_date: contract.award_date,
          obligated: contract.obligated ?? contract.total_contract_value ?? contract.base_and_exercised_options_value ?? 0,
          agency: contract.awarding_office?.agency_name || contract.agency_name
        }));
      }
    }

    if (include_grants) {
      const subawardsResponse = await ApiClient.tangoGet(
        `/entities/${uei}/subawards/`,
        { limit: 5, ordering: '-fiscal_year' },
        tangoApiKey
      );

      if (subawardsResponse.success) {
        recentGrants = (subawardsResponse.data.results || []).map((subaward: any) => ({
          subaward_id: subaward.fsrs_subaward_id || subaward.key,
          description: subaward.description,
          amount: subaward.amount || subaward.total_funding_amount,
          fiscal_year: subaward.fiscal_year,
          prime_recipient: subaward.prime_recipient?.display_name || subaward.prime_recipient?.name,
          awarding_agency: subaward.awarding_agency?.name
        }));
      }
    }

    // Return comprehensive vendor profile
    return {
      uei: vendor.uei,
      legal_business_name: vendor.legal_business_name || vendor.name,
      duns: vendor.duns,
      cage_code: vendor.cage_code,
      registration: {
        status: vendor.registration_status,
        activation_date: vendor.activation_date,
        expiration_date: vendor.expiration_date
      },
      business_types: vendor.business_types || vendor.business_type_list,
      address: {
        physical: vendor.physical_address,
        mailing: vendor.mailing_address
      },
      contacts: vendor.points_of_contact || vendor.contacts,
      naics_codes: vendor.naics_codes,
      psc_codes: vendor.psc_codes,
      certifications: vendor.certifications,
      performance_summary: {
        total_contracts: vendor.total_contracts || 0,
        total_contract_value: vendor.total_contract_value || 0,
        total_grants: vendor.total_grants || 0,
        total_grant_value: vendor.total_grant_value || 0
      },
      recent_contracts: recentContracts,
      recent_grants: recentGrants
    };
  },

  async searchOpportunities(args: any): Promise<any> {
    const {
      api_key,
      query,
      agency,
      naics_code,
      set_aside,
      posted_from,
      posted_to,
      response_deadline_from,
      status,
      limit = 10
    } = args;

    const tangoApiKey = api_key || process.env.TANGO_API_KEY;

    if (!tangoApiKey) {
      throw new Error("Tango API key is required. Please provide it as a parameter or set TANGO_API_KEY environment variable");
    }

    const params: Record<string, any> = {
      limit: Math.min(limit, 100)
    };

    if (query) params.search = query;
    if (agency) params.agency = agency;
    if (naics_code) params.naics = naics_code;
    if (set_aside) params.set_aside = set_aside;
    if (posted_from) {
      params.posted_date_after = posted_from;
      params.first_notice_date_after = posted_from;
    }
    if (posted_to) {
      params.posted_date_before = posted_to;
      params.first_notice_date_before = posted_to;
    }
    if (response_deadline_from) params.response_deadline_after = response_deadline_from;
    if (status) {
      const normalizedStatus = String(status).toLowerCase();
      if (normalizedStatus === 'active') {
        params.active = true;
      } else if (['inactive', 'closed'].includes(normalizedStatus)) {
        params.active = false;
      } else if (normalizedStatus === 'forecasted') {
        params.notice_type = 'f';
      }
    }

    const response = await ApiClient.tangoGet('/opportunities/', params, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    // Filter to essential opportunity fields
    const opportunities = (response.data.results || []).map((opp: any) => ({
      opportunity_id: opp.opportunity_id || opp.notice_id,
      solicitation_number: opp.solicitation_number,
      title: opp.title,
      type: opp.meta?.notice_type?.type || opp.opportunity_type || opp.type,
      status: typeof opp.active === 'boolean' ? (opp.active ? 'active' : 'inactive') : opp.status,
      agency: {
        name: opp.office?.agency_name || opp.agency_name,
        code: opp.office?.agency_code || opp.agency_code,
        office: opp.office?.office_name || opp.office_name
      },
      posted_date: opp.posted_date || opp.first_notice_date || opp.date_posted,
      response_deadline: opp.response_deadline || opp.due_date,
      naics_code: opp.naics_code,
      set_aside: opp.set_aside?.code || opp.set_aside_type || opp.set_aside,
      place_of_performance: {
        city: opp.place_of_performance?.city || opp.pop_city,
        state: opp.place_of_performance?.state || opp.pop_state,
        zip: opp.place_of_performance?.zip || opp.pop_zip,
        country: opp.place_of_performance?.country || opp.pop_country
      },
      description: (opp.summary || opp.description || '').substring(0, 500),
      link: opp.sam_url || opp.url || opp.link
    })) || [];

    return {
      total: response.data.total || response.data.count || 0,
      opportunities,
      filters: params,
      limit
    };
  },

  async getSpendingSummary(args: any): Promise<any> {
    const {
      api_key,
      agency,
      vendor_uei,
      fiscal_year,
      group_by = 'agency',
      award_type = 'all'
    } = args;

    const tangoApiKey = api_key || process.env.TANGO_API_KEY;

    if (!tangoApiKey) {
      throw new Error("Tango API key is required. Please provide it as a parameter or set TANGO_API_KEY environment variable");
    }

    const params: Record<string, any> = {
      limit: 100
    };

    if (agency) params.awarding_agency = agency;
    if (vendor_uei) params.uei = vendor_uei;
    if (fiscal_year) params.fiscal_year = fiscal_year;
    if (award_type && award_type !== 'all') params.award_type = award_type;

    const response = await ApiClient.tangoGet('/contracts/', params, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    const contracts: any[] = response.data.results || [];

    const normalized = contracts.map((contract: any) => {
      const obligated = Number(contract.obligated ?? contract.total_contract_value ?? contract.base_and_exercised_options_value ?? 0);
      const awardDate = contract.award_date || contract.date_signed;
      const awardingAgencyName = contract.awarding_office?.agency_name || contract.agency_name;
      const awardingAgencyCode = contract.awarding_office?.agency_code || contract.agency_code;
      const recipientName = contract.recipient?.display_name || contract.vendor_name;
      const recipientUei = contract.recipient?.uei || contract.vendor_uei;
      const naics = contract.naics_code || contract.naics;
      const psc = contract.psc_code || contract.psc;

      return {
        key: contract.key || contract.piid || contract.contract_id,
        obligated: Number.isFinite(obligated) ? obligated : 0,
        awardDate,
        awardingAgencyName,
        awardingAgencyCode,
        recipientName,
        recipientUei,
        naics,
        psc
      };
    });

    const totalObligated = normalized.reduce((sum, contract) => sum + (contract.obligated || 0), 0);

    const groups = new Map<string, { key: string; label: string; totalObligated: number; contractCount: number }>();

    const upsertGroup = (key: string, label: string, amount: number) => {
      if (!groups.has(key)) {
        groups.set(key, { key, label, totalObligated: 0, contractCount: 0 });
      }
      const group = groups.get(key)!;
      group.totalObligated += amount;
      group.contractCount += 1;
    };

    const safeLabel = (value: string | undefined, fallback: string) => value?.trim() || fallback;

    const formatMonth = (input?: string) => {
      if (!input) return 'Unknown';
      const dt = new Date(input);
      if (Number.isNaN(dt.getTime())) return 'Unknown';
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
    };

    switch (group_by) {
      case 'agency':
        normalized.forEach(contract => {
          const code = safeLabel(contract.awardingAgencyCode, 'UNK');
          const name = safeLabel(contract.awardingAgencyName, 'Unknown agency');
          const key = `${code}`;
          const label = code && code !== 'UNK' ? `${name} (${code})` : name;
          upsertGroup(key, label, contract.obligated);
        });
        break;
      case 'vendor':
        normalized.forEach(contract => {
          const ueiValue = safeLabel(contract.recipientUei, 'UNKNOWN');
          const name = safeLabel(contract.recipientName, 'Unknown recipient');
          const key = ueiValue || name;
          const label = ueiValue && ueiValue !== 'UNKNOWN' ? `${name} (${ueiValue})` : name;
          upsertGroup(key, label, contract.obligated);
        });
        break;
      case 'naics':
        normalized.forEach(contract => {
          const code = safeLabel(contract.naics, 'Unspecified NAICS');
          upsertGroup(code, code, contract.obligated);
        });
        break;
      case 'psc':
        normalized.forEach(contract => {
          const code = safeLabel(contract.psc, 'Unspecified PSC');
          upsertGroup(code, code, contract.obligated);
        });
        break;
      case 'month':
        normalized.forEach(contract => {
          const monthKey = formatMonth(contract.awardDate);
          upsertGroup(monthKey, monthKey, contract.obligated);
        });
        break;
      default:
        upsertGroup('overall', 'Overall total', totalObligated);
        break;
    }

    const breakdown = Array.from(groups.values())
      .sort((a, b) => b.totalObligated - a.totalObligated)
      .map((entry, index) => ({
        rank: index + 1,
        key: entry.key,
        label: entry.label,
        total_obligated: Number(entry.totalObligated.toFixed(2)),
        contract_count: entry.contractCount
      }));

    return {
      total_contracts: normalized.length,
      total_obligated: Number(totalObligated.toFixed(2)),
      breakdown,
      group_by,
      award_type,
      fiscal_year,
      filters: {
        awarding_agency: agency,
        vendor_uei
      },
      page_info: {
        limit: params.limit,
        total_available: response.data.count ?? null,
        next_cursor: response.data.next ?? null
      }
    };
  },

  async searchProtests(args: any): Promise<any> {
    const {
      api_key, query, agency, protester, outcome, source_system, case_type,
      case_number, solicitation_number, filed_date_from, filed_date_to,
      decision_date_from, decision_date_to, limit = 10
    } = args;

    const tangoApiKey = this.requireKey(api_key);

    const params: Record<string, any> = { limit: Math.min(limit, 100) };
    if (query) params.search = query;
    if (agency) params.agency = agency;
    if (protester) params.protester = protester;
    if (outcome) params.outcome = outcome;
    if (source_system) params.source_system = source_system;
    if (case_type) params.case_type = case_type;
    if (case_number) params.case_number = case_number;
    if (solicitation_number) params.solicitation_number = solicitation_number;
    if (filed_date_from) params.filed_date_after = filed_date_from;
    if (filed_date_to) params.filed_date_before = filed_date_to;
    if (decision_date_from) params.decision_date_after = decision_date_from;
    if (decision_date_to) params.decision_date_before = decision_date_to;

    const response = await ApiClient.tangoGet('/protests/', params, tangoApiKey);
    if (!response.success) return { error: response.error };

    const protests = (response.data.results || []).map((p: any) => ({
      protest_id: p.id || p.base_case_number || p.case_number,
      case_number: p.case_number || p.base_case_number,
      title: p.title || p.case_title,
      protester: p.protester,
      agency: p.agency,
      outcome: p.outcome,
      source_system: p.source_system,
      case_type: p.case_type,
      solicitation_number: p.solicitation_number,
      filed_date: p.filed_date,
      decision_date: p.decision_date,
      url: p.url || p.source_url
    }));

    return {
      total: response.data.total || response.data.count || 0,
      protests,
      filters: params,
      limit
    };
  },

  async getProtest(args: any): Promise<any> {
    const { api_key, protest_id } = args;
    const tangoApiKey = this.requireKey(api_key);
    if (!protest_id) throw new Error("protest_id is required");

    const response = await ApiClient.tangoGet(`/protests/${protest_id}/`, {}, tangoApiKey);
    if (!response.success) return { error: response.error };
    return response.data;
  },

  async searchIdvs(args: any): Promise<any> {
    const {
      api_key, query, vendor_name, vendor_uei, piid, agency, funding_agency,
      naics_code, psc_code, set_aside, idv_type,
      award_date_from, award_date_to, expiring_from, expiring_to, limit = 10
    } = args;

    const tangoApiKey = this.requireKey(api_key);

    const params: Record<string, any> = { limit: Math.min(limit, 100) };
    if (query) params.search = query;
    if (vendor_name) params.recipient = vendor_name;
    if (vendor_uei) params.uei = vendor_uei;
    if (piid) params.piid = piid;
    if (agency) params.awarding_agency = agency;
    if (funding_agency) params.funding_agency = funding_agency;
    if (naics_code) params.naics = naics_code;
    if (psc_code) params.psc = psc_code;
    if (set_aside) params.set_aside = set_aside;
    if (idv_type) params.idv_type = idv_type;
    if (award_date_from) params.award_date_gte = award_date_from;
    if (award_date_to) params.award_date_lte = award_date_to;
    if (expiring_from) params.last_date_to_order_gte = expiring_from;
    if (expiring_to) params.last_date_to_order_lte = expiring_to;

    const response = await ApiClient.tangoGet('/idvs/', params, tangoApiKey);
    if (!response.success) return { error: response.error };

    const idvs = (response.data.results || []).map((idv: any) => ({
      idv_key: idv.key || idv.piid,
      piid: idv.piid,
      title: idv.description || idv.title,
      vendor: {
        name: idv.recipient?.display_name || idv.vendor_name,
        uei: idv.recipient?.uei || idv.vendor_uei
      },
      agency: {
        name: idv.awarding_office?.agency_name || idv.agency_name,
        code: idv.awarding_office?.agency_code || idv.agency_code,
        office: idv.awarding_office?.office_name || idv.office_name
      },
      idv_type: idv.idv_type,
      award_date: idv.award_date || idv.date_signed,
      last_date_to_order: idv.last_date_to_order,
      naics_code: idv.naics_code,
      psc_code: idv.psc_code,
      set_aside: idv.set_aside?.code || idv.type_of_set_aside,
      total_obligated: idv.obligated ?? idv.total_contract_value
    }));

    return {
      total: response.data.total || response.data.count || 0,
      idvs,
      filters: params,
      limit
    };
  },

  async getIdvChildren(args: any): Promise<any> {
    const {
      api_key, idv_key,
      include_child_idvs = true, include_task_orders = true, include_transactions = false,
      limit_per_section = 20
    } = args;

    const tangoApiKey = this.requireKey(api_key);
    if (!idv_key) throw new Error("idv_key is required");

    const perSection = Math.min(limit_per_section, 100);
    const result: any = { idv_key };

    if (include_child_idvs) {
      const r = await ApiClient.tangoGet(`/idvs/${idv_key}/idvs/`, { limit: perSection }, tangoApiKey);
      if (r.success) {
        result.child_idvs = (r.data.results || []).map((c: any) => ({
          idv_key: c.key || c.piid,
          piid: c.piid,
          title: c.description || c.title,
          vendor_name: c.recipient?.display_name || c.vendor_name,
          award_date: c.award_date,
          last_date_to_order: c.last_date_to_order,
          obligated: c.obligated ?? c.total_contract_value
        }));
        result.child_idvs_total = r.data.count ?? null;
      } else {
        result.child_idvs_error = r.error;
      }
    }

    if (include_task_orders) {
      const r = await ApiClient.tangoGet(`/idvs/${idv_key}/awards/`, { limit: perSection, ordering: '-award_date' }, tangoApiKey);
      if (r.success) {
        result.task_orders = (r.data.results || []).map((c: any) => ({
          award_key: c.key || c.piid,
          piid: c.piid,
          title: c.description || c.title,
          vendor_name: c.recipient?.display_name || c.vendor_name,
          award_date: c.award_date,
          obligated: c.obligated ?? c.total_contract_value,
          agency: c.awarding_office?.agency_name || c.agency_name
        }));
        result.task_orders_total = r.data.count ?? null;
      } else {
        result.task_orders_error = r.error;
      }
    }

    if (include_transactions) {
      const r = await ApiClient.tangoGet(`/idvs/${idv_key}/transactions/`, { limit: perSection, ordering: '-action_date' }, tangoApiKey);
      if (r.success) {
        result.transactions = (r.data.results || []).map((t: any) => ({
          action_date: t.action_date,
          obligated_change: t.federal_action_obligation ?? t.obligated_amount ?? t.amount,
          modification_number: t.modification_number,
          description: t.transaction_description || t.description
        }));
        result.transactions_total = r.data.count ?? null;
      } else {
        result.transactions_error = r.error;
      }
    }

    return result;
  },

  async searchVehicles(args: any): Promise<any> {
    const {
      api_key, query, vehicle_type, type_of_idc, contract_type, set_aside,
      naics_code, psc_code, program_acronym, who_can_use, agency, organization_id,
      total_obligated_min, total_obligated_max, limit = 10
    } = args;

    const tangoApiKey = this.requireKey(api_key);

    const params: Record<string, any> = { limit: Math.min(limit, 100) };
    if (query) params.search = query;
    if (vehicle_type) params.vehicle_type = vehicle_type;
    if (type_of_idc) params.type_of_idc = type_of_idc;
    if (contract_type) params.contract_type = contract_type;
    if (set_aside) params.set_aside = set_aside;
    if (naics_code) params.naics_code = naics_code;
    if (psc_code) params.psc_code = psc_code;
    if (program_acronym) params.program_acronym = program_acronym;
    if (who_can_use) params.who_can_use = who_can_use;
    if (agency) params.agency = agency;
    if (organization_id) params.organization_id = organization_id;
    if (typeof total_obligated_min === 'number') params.total_obligated_min = total_obligated_min;
    if (typeof total_obligated_max === 'number') params.total_obligated_max = total_obligated_max;

    const response = await ApiClient.tangoGet('/vehicles/', params, tangoApiKey);
    if (!response.success) return { error: response.error };

    const vehicles = (response.data.results || []).map((v: any) => ({
      vehicle_uuid: v.uuid || v.id,
      name: v.name || v.title || v.description,
      program_acronym: v.program_acronym,
      vehicle_type: v.vehicle_type,
      type_of_idc: v.type_of_idc,
      contract_type: v.contract_type,
      set_aside: v.set_aside,
      who_can_use: v.who_can_use,
      naics_code: v.naics_code,
      psc_code: v.psc_code,
      awarding_agency: v.awarding_agency_name || v.agency_name,
      total_obligated: v.total_obligated,
      awardee_count: v.awardee_count,
      latest_award_date: v.latest_award_date
    }));

    return {
      total: response.data.total || response.data.count || 0,
      vehicles,
      filters: params,
      limit
    };
  },

  async searchOtas(args: any): Promise<any> {
    const {
      api_key, query, vendor_name, vendor_uei, piid, agency, funding_agency,
      award_date_from, award_date_to, fiscal_year, limit = 10
    } = args;

    const tangoApiKey = this.requireKey(api_key);

    const params: Record<string, any> = { limit: Math.min(limit, 100) };
    if (query) params.search = query;
    if (vendor_name) params.recipient = vendor_name;
    if (vendor_uei) params.uei = vendor_uei;
    if (piid) params.piid = piid;
    if (agency) params.awarding_agency = agency;
    if (funding_agency) params.funding_agency = funding_agency;
    if (award_date_from) params.award_date_gte = award_date_from;
    if (award_date_to) params.award_date_lte = award_date_to;
    if (fiscal_year) params.fiscal_year = fiscal_year;

    const response = await ApiClient.tangoGet('/otas/', params, tangoApiKey);
    if (!response.success) return { error: response.error };

    const otas = (response.data.results || []).map((o: any) => ({
      ota_key: o.key || o.piid,
      piid: o.piid,
      title: o.description || o.title,
      vendor: {
        name: o.recipient?.display_name || o.vendor_name,
        uei: o.recipient?.uei || o.vendor_uei
      },
      agency: {
        name: o.awarding_office?.agency_name || o.agency_name,
        code: o.awarding_office?.agency_code || o.agency_code,
        office: o.awarding_office?.office_name || o.office_name
      },
      award_date: o.award_date || o.date_signed,
      fiscal_year: o.fiscal_year,
      total_obligated: o.obligated ?? o.total_contract_value
    }));

    return {
      total: response.data.total || response.data.count || 0,
      otas,
      filters: params,
      limit
    };
  },

  async getEntityMetrics(args: any): Promise<any> {
    const { api_key, uei, months = 36, period_grouping = 'quarter', group_by } = args;

    const tangoApiKey = this.requireKey(api_key);
    if (!uei) throw new Error("uei is required");

    const validGrouping = ['month', 'quarter', 'year'];
    if (!validGrouping.includes(period_grouping)) {
      throw new Error(`period_grouping must be one of: ${validGrouping.join(', ')}`);
    }

    const params: Record<string, any> = {};
    if (group_by) params.group_by = group_by;

    const response = await ApiClient.tangoGet(
      `/entities/${uei}/metrics/${months}/${period_grouping}/`,
      params,
      tangoApiKey
    );
    if (!response.success) return { error: response.error };

    return {
      uei,
      months,
      period_grouping,
      group_by: group_by || null,
      metrics: response.data
    };
  }
};
