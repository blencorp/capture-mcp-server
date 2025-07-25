import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ApiClient } from '../utils/api-client.js';

export const samTools = {
  async getTools(): Promise<Tool[]> {
    return [
      {
        name: "search_sam_entities",
        description: "Search for federal entities/businesses registered in SAM.gov by name, location, or business codes. Useful for finding companies that do business with the government.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              description: "SAM.gov API key (optional if SAM_GOV_API_KEY env var is set)"
            },
            query: {
              type: "string", 
              description: "Entity name to search (e.g., 'Boeing', 'Acme Corp')"
            },
            state: {
              type: "string",
              description: "State/province filter (e.g., 'VA', 'CA')"
            },
            naics: {
              type: "string",
              description: "NAICS industry code filter"
            },
            uei: {
              type: "string",
              description: "Unique Entity Identifier to search for specific entity"
            },
            limit: {
              type: "number",
              description: "Number of results to return (default: 10, max: 50)"
            }
          },
          required: []
        }
      },
      {
        name: "get_sam_opportunities", 
        description: "Fetch federal contract opportunities from SAM.gov by date range, keywords, or set-aside types. Perfect for finding new business opportunities.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              description: "SAM.gov API key (optional if SAM_GOV_API_KEY env var is set)"
            },
            posted_from: {
              type: "string",
              description: "Start date for opportunities (MM/dd/yyyy format, required)"
            },
            posted_to: {
              type: "string", 
              description: "End date for opportunities (MM/dd/yyyy format, required)"
            },
            keyword: {
              type: "string",
              description: "Keyword to search in opportunity titles/descriptions"
            },
            set_aside: {
              type: "string",
              description: "Set-aside type filter (e.g., 'WOSB', 'SDVOSB', 'SBA')"
            },
            state: {
              type: "string",
              description: "State filter for opportunity location"
            },
            limit: {
              type: "number",
              description: "Number of results (default: 10, max: 50)"
            }
          },
          required: ["posted_from", "posted_to"]
        }
      },
      {
        name: "get_sam_entity_details",
        description: "Get comprehensive details for a specific entity using their UEI. Returns registration info, business types, certifications, and contact details.",
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
            }
          },
          required: ["uei"]
        }
      },
      {
        name: "check_sam_exclusions",
        description: "Check if an entity is excluded from federal contracting. Critical for due diligence before doing business with government contractors.",
        inputSchema: {
          type: "object",
          properties: {
            api_key: {
              type: "string", 
              description: "SAM.gov API key (optional if SAM_GOV_API_KEY env var is set)"
            },
            uei: {
              type: "string",
              description: "Unique Entity Identifier to check"
            },
            entity_name: {
              type: "string",
              description: "Entity name to check for exclusions"
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
      case "search_sam_entities":
        return await this.searchEntities(sanitizedArgs);
      case "get_sam_opportunities":
        return await this.getOpportunities(sanitizedArgs);
      case "get_sam_entity_details":
        return await this.getEntityDetails(sanitizedArgs);
      case "check_sam_exclusions":
        return await this.checkExclusions(sanitizedArgs);
      default:
        throw new Error(`Unknown SAM tool: ${name}`);
    }
  },

  async searchEntities(args: any): Promise<any> {
    const { api_key, query, state, naics, uei, limit = 10 } = args;
    
    // Use environment variable if API key not provided in args
    const samApiKey = api_key || process.env.SAM_GOV_API_KEY;
    
    if (!samApiKey) {
      throw new Error("SAM.gov API key is required. Please provide it as a parameter or set SAM_GOV_API_KEY environment variable");
    }

    const params: any = {
      api_key: samApiKey,
      includeSections: 'entityRegistration,coreData',
      page: 1,
      size: Math.min(limit, 50)
    };

    if (uei) params.ueiSAM = uei;
    if (query) params.entityName = query;
    if (state) params.stateProvince = state;
    if (naics) params.naicsCode = naics;

    const response = await ApiClient.samGet('/entity-information/v4/entities', params);
    
    if (!response.success) {
      return { error: response.error };
    }

    // Filter response to essential fields for token efficiency
    const entities = response.data.entityData?.map((entity: any) => ({
      uei: entity.entityRegistration?.ueiSAM,
      name: entity.entityRegistration?.legalBusinessName,
      duns: entity.entityRegistration?.duns,
      address: {
        street: entity.entityRegistration?.physicalAddress?.addressLine1,
        city: entity.entityRegistration?.physicalAddress?.city,
        state: entity.entityRegistration?.physicalAddress?.stateOrProvinceCode,
        zipCode: entity.entityRegistration?.physicalAddress?.zipCode,
        country: entity.entityRegistration?.physicalAddress?.countryCode
      },
      businessTypes: entity.entityRegistration?.businessTypes?.businessTypeList?.map((bt: any) => bt.businessTypeCode),
      registrationStatus: entity.entityRegistration?.registrationStatus,
      activationDate: entity.entityRegistration?.activationDate,
      expirationDate: entity.entityRegistration?.expirationDate
    })) || [];

    return {
      total: response.data.totalRecords || 0,
      entities,
      page: 1,
      limit
    };
  },

  async getOpportunities(args: any): Promise<any> {
    const { api_key, posted_from, posted_to, keyword, set_aside, state, limit = 10 } = args;
    
    // Use environment variable if API key not provided in args
    const samApiKey = api_key || process.env.SAM_GOV_API_KEY;
    
    if (!samApiKey) {
      throw new Error("SAM.gov API key is required. Please provide it as a parameter or set SAM_GOV_API_KEY environment variable");
    }
    
    if (!posted_from || !posted_to) {
      throw new Error("Both posted_from and posted_to dates are required");
    }

    const params: any = {
      api_key: samApiKey,
      postedFrom: posted_from,
      postedTo: posted_to,
      limit: Math.min(limit, 50),
      offset: 0
    };

    if (keyword) params.title = keyword;
    if (set_aside) params.typeOfSetAside = set_aside;
    if (state) params.state = state;

    const response = await ApiClient.samGet('/opportunities/v2/search', params);
    
    if (!response.success) {
      return { error: response.error };
    }

    // Filter to essential opportunity fields
    const opportunities = response.data.opportunitiesData?.map((opp: any) => ({
      id: opp.noticeId,
      title: opp.title,
      solicitationNumber: opp.solicitationNumber,
      department: opp.department,
      subTier: opp.subTier,
      office: opp.office,
      postedDate: opp.postedDate,
      type: opp.type,
      baseType: opp.baseType,
      setAside: opp.typeOfSetAsideDescription,
      responseDeadLine: opp.responseDeadLine,
      naicsCode: opp.naicsCode,
      classificationCode: opp.classificationCode,
      active: opp.active,
      links: {
        self: opp.uiLink
      }
    })) || [];

    return {
      total: response.data.totalRecords || 0,
      opportunities,
      dateRange: { from: posted_from, to: posted_to },
      limit
    };
  },

  async getEntityDetails(args: any): Promise<any> {
    const { api_key, uei } = args;
    
    // Use environment variable if API key not provided in args
    const samApiKey = api_key || process.env.SAM_GOV_API_KEY;
    
    if (!samApiKey) {
      throw new Error("SAM.gov API key is required. Please provide it as a parameter or set SAM_GOV_API_KEY environment variable");
    }
    
    if (!uei) {
      throw new Error("UEI is required");
    }

    const params = {
      api_key: samApiKey,
      ueiSAM: uei,
      includeSections: 'entityRegistration,coreData,assertions,pointsOfContact'
    };

    const response = await ApiClient.samGet('/entity-information/v4/entities', params);
    
    if (!response.success) {
      return { error: response.error };
    }

    const entityData = response.data.entityData?.[0];
    if (!entityData) {
      return { error: "Entity not found" };
    }

    // Return comprehensive but filtered entity details
    return {
      uei: entityData.entityRegistration?.ueiSAM,
      registration: {
        legalBusinessName: entityData.entityRegistration?.legalBusinessName,
        duns: entityData.entityRegistration?.duns,
        registrationStatus: entityData.entityRegistration?.registrationStatus,
        registrationDate: entityData.entityRegistration?.registrationDate,
        activationDate: entityData.entityRegistration?.activationDate,
        expirationDate: entityData.entityRegistration?.expirationDate,
        lastUpdateDate: entityData.entityRegistration?.lastUpdateDate
      },
      coreData: {
        entityStructure: entityData.coreData?.entityInformation?.entityStructureCode,
        businessTypes: entityData.entityRegistration?.businessTypes?.businessTypeList?.map((bt: any) => ({
          code: bt.businessTypeCode,
          description: bt.businessTypeDesc
        })),
        primaryNaics: entityData.coreData?.naicsInformation?.primaryNaics
      },
      address: {
        physical: entityData.entityRegistration?.physicalAddress,
        mailing: entityData.entityRegistration?.mailingAddress
      },
      pointsOfContact: entityData.pointsOfContact?.map((poc: any) => ({
        type: poc.contactType,
        firstName: poc.firstName,
        lastName: poc.lastName,
        title: poc.title,
        email: poc.email,
        phone: poc.phone
      }))
    };
  },

  async checkExclusions(args: any): Promise<any> {
    const { api_key, uei, entity_name } = args;
    
    // Use environment variable if API key not provided in args
    const samApiKey = api_key || process.env.SAM_GOV_API_KEY;
    
    if (!samApiKey) {
      throw new Error("SAM.gov API key is required. Please provide it as a parameter or set SAM_GOV_API_KEY environment variable");
    }

    const params: any = {
      api_key: samApiKey,
      page: 1,
      size: 10
    };

    if (uei) params.ueiSAM = uei;
    if (entity_name) params.entityName = entity_name;

    const response = await ApiClient.samGet('/entity-information/v4/exclusions', params);
    
    if (!response.success) {
      return { error: response.error };
    }

    const exclusions = response.data.exclusionDetails?.map((excl: any) => ({
      uei: excl.ueiSAM,
      name: excl.entityName,
      exclusionType: excl.exclusionType,
      classification: excl.classification,
      exclusionProgram: excl.exclusionProgram,
      excludingAgency: excl.excludingAgency,
      ctCode: excl.ctCode,
      activationDate: excl.activationDate,
      terminationDate: excl.terminationDate,
      recordStatus: excl.recordStatus
    })) || [];

    return {
      total: response.data.totalRecords || 0,
      excluded: exclusions.length > 0,
      exclusions,
      searchCriteria: { uei, entity_name }
    };
  }
};