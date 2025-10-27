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
      default:
        throw new Error(`Unknown Tango tool: ${name}`);
    }
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

    const params: any = {
      limit: Math.min(limit, 100),
      offset: 0
    };

    if (query) params.q = query;
    if (vendor_name) params.vendor_name = vendor_name;
    if (vendor_uei) params.vendor_uei = vendor_uei;
    if (agency) params.agency = agency;
    if (naics_code) params.naics_code = naics_code;
    if (psc_code) params.psc_code = psc_code;
    if (award_amount_min) params.award_amount_min = award_amount_min;
    if (award_amount_max) params.award_amount_max = award_amount_max;
    if (date_from) params.date_from = date_from;
    if (date_to) params.date_to = date_to;
    if (set_aside) params.set_aside = set_aside;

    const response = await ApiClient.tangoGet('/contracts/search', params, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    // Filter response to essential contract fields
    const contracts = response.data.results?.map((contract: any) => ({
      contract_id: contract.piid || contract.contract_id,
      title: contract.description || contract.title,
      vendor: {
        name: contract.vendor_name,
        uei: contract.vendor_uei,
        duns: contract.vendor_duns
      },
      agency: {
        name: contract.agency_name,
        code: contract.agency_code,
        office: contract.office_name
      },
      award_amount: contract.award_amount || contract.total_dollars_obligated,
      award_date: contract.award_date || contract.date_signed,
      naics_code: contract.naics_code,
      naics_description: contract.naics_description,
      psc_code: contract.psc_code,
      psc_description: contract.psc_description,
      set_aside: contract.type_of_set_aside,
      place_of_performance: {
        city: contract.pop_city,
        state: contract.pop_state_code,
        country: contract.pop_country_code
      },
      status: contract.contract_status || contract.status
    })) || [];

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

    const params: any = {
      limit: Math.min(limit, 100),
      offset: 0
    };

    if (query) params.q = query;
    if (recipient_name) params.recipient_name = recipient_name;
    if (recipient_uei) params.recipient_uei = recipient_uei;
    if (agency) params.agency = agency;
    if (cfda_number) params.cfda_number = cfda_number;
    if (award_amount_min) params.award_amount_min = award_amount_min;
    if (award_amount_max) params.award_amount_max = award_amount_max;
    if (date_from) params.date_from = date_from;
    if (date_to) params.date_to = date_to;

    const response = await ApiClient.tangoGet('/grants/search', params, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    // Filter response to essential grant fields
    const grants = response.data.results?.map((grant: any) => ({
      grant_id: grant.fain || grant.grant_id,
      title: grant.description || grant.title || grant.project_title,
      recipient: {
        name: grant.recipient_name,
        uei: grant.recipient_uei,
        duns: grant.recipient_duns,
        type: grant.recipient_type
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

    const params: any = {
      uei,
      include_contracts: include_contracts ? 'true' : 'false',
      include_grants: include_grants ? 'true' : 'false'
    };

    const response = await ApiClient.tangoGet(`/vendors/${uei}`, params, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    const vendor = response.data;

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
      recent_contracts: include_contracts ? vendor.recent_contracts : undefined,
      recent_grants: include_grants ? vendor.recent_grants : undefined
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

    const params: any = {
      limit: Math.min(limit, 100),
      offset: 0
    };

    if (query) params.q = query;
    if (agency) params.agency = agency;
    if (naics_code) params.naics_code = naics_code;
    if (set_aside) params.set_aside = set_aside;
    if (posted_from) params.posted_from = posted_from;
    if (posted_to) params.posted_to = posted_to;
    if (response_deadline_from) params.response_deadline_from = response_deadline_from;
    if (status) params.status = status;

    const response = await ApiClient.tangoGet('/opportunities/search', params, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    // Filter to essential opportunity fields
    const opportunities = response.data.results?.map((opp: any) => ({
      opportunity_id: opp.notice_id || opp.opportunity_id,
      solicitation_number: opp.solicitation_number,
      title: opp.title,
      type: opp.opportunity_type || opp.type,
      status: opp.status,
      agency: {
        name: opp.agency_name,
        code: opp.agency_code,
        office: opp.office_name
      },
      posted_date: opp.posted_date || opp.date_posted,
      response_deadline: opp.response_deadline || opp.due_date,
      naics_code: opp.naics_code,
      set_aside: opp.set_aside_type || opp.set_aside,
      place_of_performance: {
        city: opp.pop_city,
        state: opp.pop_state,
        zip: opp.pop_zip
      },
      description: opp.description?.substring(0, 500), // Truncate for token efficiency
      link: opp.url || opp.link
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

    const params: any = {
      group_by,
      award_type
    };

    if (agency) params.agency = agency;
    if (vendor_uei) params.vendor_uei = vendor_uei;
    if (fiscal_year) params.fiscal_year = fiscal_year;

    const response = await ApiClient.tangoGet('/spending/summary', params, tangoApiKey);

    if (!response.success) {
      return { error: response.error };
    }

    return {
      summary: response.data.summary || response.data,
      fiscal_year: fiscal_year,
      award_type,
      group_by,
      filters: { agency, vendor_uei }
    };
  }
};
