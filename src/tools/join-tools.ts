import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ApiClient } from '../utils/api-client.js';

export const joinTools = {
  async getTools(): Promise<Tool[]> {
    return [
      {
        name: "get_entity_and_awards",
        description: "Join SAM.gov entity details with their USASpending.gov award history. Perfect for comprehensive analysis of a company's government business profile.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string", 
              description: "SAM.gov API key (optional if SAM_GOV_API_KEY env var is set)"
            },
            uei: {
              type: "string",
              description: "Unique Entity Identifier (required)"
            },
            fiscal_year: {
              type: "number",
              description: "Fiscal year for awards (default: current FY)"
            },
            award_limit: {
              type: "number",
              description: "Max number of awards to return (default: 10)"
            }
          },
          required: ["uei"]
        }
      },
      {
        name: "get_opportunity_spending_context",
        description: "Join SAM.gov opportunity details with spending context from similar NAICS codes. Helps assess market size and typical award amounts for similar work.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              description: "SAM.gov API key (optional if SAM_GOV_API_KEY env var is set)"
            },
            opportunity_id: {
              type: "string", 
              description: "SAM.gov opportunity/notice ID"
            },
            solicitation_number: {
              type: "string",
              description: "Solicitation number (alternative to opportunity_id)"
            },
            fiscal_year: {
              type: "number",
              description: "Fiscal year for spending context (default: 2024)"
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
      case "get_entity_and_awards":
        return await this.getEntityAndAwards(sanitizedArgs);
      case "get_opportunity_spending_context":
        return await this.getOpportunitySpendingContext(sanitizedArgs);
      default:
        throw new Error(`Unknown join tool: ${name}`);
    }
  },

  async getEntityAndAwards(args: any): Promise<any> {
    const { api_key, uei, fiscal_year = 2024, award_limit = 10 } = args;
    
    // Use environment variable if API key not provided in args
    const samApiKey = api_key || process.env.SAM_GOV_API_KEY;
    
    if (!samApiKey) {
      throw new Error("SAM.gov API key is required. Please provide it as a parameter or set SAM_GOV_API_KEY environment variable");
    }
    
    if (!uei) {
      throw new Error("UEI is required");
    }

    try {
      // Step 1: Get entity details from SAM.gov
      const samParams = {
        api_key: samApiKey,
        ueiSAM: uei,
        includeSections: 'entityRegistration,coreData'
      };

      const samResponse = await ApiClient.samGet('/entity-information/v4/entities', samParams);
      
      if (!samResponse.success) {
        return { error: `SAM.gov error: ${samResponse.error}` };
      }

      const entityData = samResponse.data.entityData?.[0];
      if (!entityData) {
        return { error: "Entity not found in SAM.gov" };
      }

      // Extract key entity info
      const entity = {
        uei: entityData.entityRegistration?.ueiSAM,
        name: entityData.entityRegistration?.legalBusinessName,
        duns: entityData.entityRegistration?.duns,
        registrationStatus: entityData.entityRegistration?.registrationStatus,
        businessTypes: entityData.entityRegistration?.businessTypes?.businessTypeList?.map((bt: any) => bt.businessTypeCode),
        primaryNaics: entityData.coreData?.naicsInformation?.primaryNaics,
        address: {
          street: entityData.entityRegistration?.physicalAddress?.addressLine1,
          city: entityData.entityRegistration?.physicalAddress?.city,
          state: entityData.entityRegistration?.physicalAddress?.stateOrProvinceCode,
          zipCode: entityData.entityRegistration?.physicalAddress?.zipCode
        }
      };

      // Step 2: Search USASpending for awards to this entity
      const usaspendingRequest = {
        filters: {
          recipient_search_text: [entity.name],
          time_period: [{
            start_date: `${fiscal_year - 1}-10-01`,
            end_date: `${fiscal_year}-09-30`
          }]
        },
        fields: [
          "Award ID",
          "Recipient Name",
          "Award Amount", 
          "Awarding Agency",
          "Award Type",
          "Start Date",
          "End Date",
          "Description"
        ],
        sort: "Award Amount",
        order: "desc",
        limit: award_limit
      };

      const usaspendingResponse = await ApiClient.usaspendingPost('/search/spending_by_award/', usaspendingRequest);
      
      let awards = [];
      let totalAmount = 0;
      let awardCount = 0;

      if (usaspendingResponse.success && usaspendingResponse.data.results) {
        awards = usaspendingResponse.data.results.map((award: any) => ({
          id: award["Award ID"],
          amount: award["Award Amount"],
          agency: award["Awarding Agency"],
          type: award["Award Type"],
          start_date: award["Start Date"],
          end_date: award["End Date"],
          description: award["Description"]
        }));

        totalAmount = awards.reduce((sum: number, award: any) => sum + (award.amount || 0), 0);
        awardCount = usaspendingResponse.data.page_metadata?.total || awards.length;
      }

      // Step 3: Return joined data
      return {
        entity,
        awards: {
          fiscal_year,
          total_amount: totalAmount,
          award_count: awardCount,
          awards_shown: awards.length,
          awards
        },
        data_sources: {
          sam_gov: "Entity registration and business details",
          usaspending_gov: "Federal award and spending history"
        },
        joined_on: "Entity legal business name (UEI used for SAM lookup)"
      };

    } catch (error) {
      return { 
        error: `Join operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        partial_data: null
      };
    }
  },

  async getOpportunitySpendingContext(args: any): Promise<any> {
    const { api_key, opportunity_id, solicitation_number, fiscal_year = 2024 } = args;
    
    // Use environment variable if API key not provided in args
    const samApiKey = api_key || process.env.SAM_GOV_API_KEY;
    
    if (!samApiKey) {
      throw new Error("SAM.gov API key is required. Please provide it as a parameter or set SAM_GOV_API_KEY environment variable");
    }
    
    if (!opportunity_id && !solicitation_number) {
      throw new Error("Either opportunity_id or solicitation_number is required");
    }

    try {
      // Step 1: Get opportunity details from SAM.gov
      // Note: This requires searching opportunities by ID, which may need date range
      // For now, we'll search recent opportunities to find the match
      const currentDate = new Date();
      const thirtyDaysAgo = new Date(currentDate.getTime() - (30 * 24 * 60 * 60 * 1000));
      
      const formatDate = (date: Date) => {
        return `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}/${date.getFullYear()}`;
      };

      const samParams: any = {
        api_key: samApiKey,
        postedFrom: formatDate(thirtyDaysAgo),
        postedTo: formatDate(currentDate),
        limit: 100
      };

      if (solicitation_number) {
        samParams.solnum = solicitation_number;
      }

      const samResponse = await ApiClient.samGet('/opportunities/v2/search', samParams);
      
      if (!samResponse.success) {
        return { error: `SAM.gov error: ${samResponse.error}` };
      }

      // Find the specific opportunity
      let opportunity = null;
      if (samResponse.data.opportunitiesData) {
        opportunity = samResponse.data.opportunitiesData.find((opp: any) => 
          (opportunity_id && opp.noticeId === opportunity_id) ||
          (solicitation_number && opp.solicitationNumber === solicitation_number)
        );
      }

      if (!opportunity) {
        return { 
          error: "Opportunity not found. It may be older than 30 days or the ID/solicitation number is incorrect.",
          suggestion: "Try using search_sam_opportunities with a broader date range first"
        };
      }

      // Extract opportunity details
      const oppDetails = {
        id: opportunity.noticeId,
        title: opportunity.title,
        solicitationNumber: opportunity.solicitationNumber,
        department: opportunity.department,
        office: opportunity.office,
        postedDate: opportunity.postedDate,
        responseDeadLine: opportunity.responseDeadLine,
        naicsCode: opportunity.naicsCode,
        setAside: opportunity.typeOfSetAsideDescription,
        type: opportunity.type
      };

      // Step 2: Get spending context for similar NAICS code
      let spendingContext = {
        naics_code: opportunity.naicsCode,
        similar_awards: [],
        average_award_amount: 0,
        total_spending: 0,
        award_count: 0
      };

      if (opportunity.naicsCode) {
        // Search for awards with similar NAICS codes in USASpending
        const usaspendingRequest = {
          filters: {
            naics_codes: [opportunity.naicsCode],
            time_period: [{
              start_date: `${fiscal_year - 1}-10-01`,
              end_date: `${fiscal_year}-09-30`
            }],
            award_type_codes: ["A", "B", "C", "D"] // Contract types typically
          },
          fields: [
            "Award ID",
            "Recipient Name",
            "Award Amount",
            "Awarding Agency",
            "Award Type"
          ],
          sort: "Award Amount", 
          order: "desc",
          limit: 20
        };

        const usaspendingResponse = await ApiClient.usaspendingPost('/search/spending_by_award/', usaspendingRequest);
        
        if (usaspendingResponse.success && usaspendingResponse.data.results) {
          const awards = usaspendingResponse.data.results;
          const amounts = awards.map((award: any) => award["Award Amount"] || 0).filter((amt: number) => amt > 0);
          
          spendingContext = {
            naics_code: opportunity.naicsCode,
            similar_awards: awards.slice(0, 10).map((award: any) => ({
              recipient: award["Recipient Name"],
              amount: award["Award Amount"],
              agency: award["Awarding Agency"],
              type: award["Award Type"]
            })),
            average_award_amount: amounts.length > 0 ? amounts.reduce((a: number, b: number) => a + b, 0) / amounts.length : 0,
            total_spending: amounts.reduce((a: number, b: number) => a + b, 0),
            award_count: usaspendingResponse.data.page_metadata?.total || awards.length
          };
        }
      }

      // Step 3: Return joined data
      return {
        opportunity: oppDetails,
        spending_context: spendingContext,
        market_analysis: {
          similar_work_volume: spendingContext.award_count,
          typical_award_range: spendingContext.average_award_amount > 0 ? {
            average: spendingContext.average_award_amount,
            suggestion: spendingContext.average_award_amount < 100000 ? "Small contract opportunity" :
                       spendingContext.average_award_amount < 1000000 ? "Medium contract opportunity" :
                       "Large contract opportunity"
          } : null
        },
        data_sources: {
          sam_gov: "Opportunity details and NAICS classification", 
          usaspending_gov: "Historical spending for similar work (same NAICS code)"
        },
        joined_on: `NAICS code ${opportunity.naicsCode}`,
        fiscal_year
      };

    } catch (error) {
      return { 
        error: `Join operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        partial_data: null
      };
    }
  }
};
