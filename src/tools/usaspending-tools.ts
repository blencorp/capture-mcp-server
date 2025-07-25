import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ApiClient } from '../utils/api-client.js';

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
              description: "Fiscal year to search (e.g., 2024)"
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
              description: "Award type codes to filter (e.g., ['10'] for contracts)"
            },
            limit: {
              type: "number",
              description: "Number of results (default: 10, max: 100)"
            }
          },
          required: ["recipient_name"]
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
      default:
        throw new Error(`Unknown USASpending tool: ${name}`);
    }
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
      limit = 10 
    } = args;
    
    if (!recipient_name) {
      throw new Error("Recipient name is required");
    }

    // Build the search request for USASpending API
    const searchRequest: any = {
      filters: {
        recipient_search_text: [recipient_name]
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
        "Description"
      ],
      sort: "Award Amount",
      order: "desc",
      limit: Math.min(limit, 100)
    };

    // Add time period filter if fiscal year specified
    if (fiscal_year) {
      searchRequest.filters.time_period = [{
        start_date: `${fiscal_year - 1}-10-01`, // FY starts Oct 1
        end_date: `${fiscal_year}-09-30`        // FY ends Sep 30
      }];
    }

    // Add award amount filters
    if (min_amount || max_amount) {
      searchRequest.filters.award_amounts = [{
        lower_bound: min_amount || 0,
        upper_bound: max_amount || 999999999999
      }];
    }

    // Add award type filters
    if (award_types && Array.isArray(award_types)) {
      searchRequest.filters.award_type_codes = award_types;
    }

    const response = await ApiClient.usaspendingPost('/search/spending_by_award/', searchRequest);
    
    if (!response.success) {
      return { error: response.error };
    }

    const awards = response.data.results?.map((award: any) => ({
      id: award["Award ID"],
      recipient: award["Recipient Name"],
      amount: award["Award Amount"],
      awarding_agency: award["Awarding Agency"],
      awarding_sub_agency: award["Awarding Sub Agency"],
      award_type: award["Award Type"],
      start_date: award["Start Date"],
      end_date: award["End Date"],
      description: award["Description"]
    })) || [];

    return {
      recipient_name,
      fiscal_year,
      total_results: response.data.page_metadata?.total || 0,
      awards,
      search_summary: {
        total_amount: awards.reduce((sum: number, award: any) => sum + (award.amount || 0), 0),
        award_count: awards.length,
        amount_range: { min: min_amount, max: max_amount },
        award_types: award_types
      }
    };
  }
};