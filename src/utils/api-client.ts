import axios, { AxiosResponse, AxiosError } from 'axios';

export interface ApiResponse<T = any> {
  data: T;
  success: boolean;
  error?: string;
}

type ApiFamily = 'sam' | 'usaspending' | 'tango';

export class ApiClient {
  private static readonly SAM_BASE_URL = 'https://api.sam.gov';
  private static readonly USASPENDING_BASE_URL = 'https://api.usaspending.gov/api/v2';
  private static readonly TANGO_BASE_URL = 'https://tango.makegov.com/api';

  // Rate limiting: queue-based guard so concurrent requests respect per-API pacing
  private static readonly RATE_LIMIT_MS: Record<ApiFamily, number> = {
    sam: 100, // Conservative delay for SAM.gov
    usaspending: 3600, // ~3.6 seconds between calls (~1000/hour) for USASpending
    tango: 100, // Conservative delay for Tango API
  };

  private static readonly rateLimitQueues: Record<ApiFamily, Promise<void>> = {
    sam: Promise.resolve(),
    usaspending: Promise.resolve(),
    tango: Promise.resolve(),
  };

  private static readonly lastCallTimestamp: Record<ApiFamily, number> = {
    sam: 0,
    usaspending: 0,
    tango: 0,
  };

  private static async enforceRateLimit(apiType: ApiFamily): Promise<void> {
    const run = async () => {
      const now = Date.now();
      const elapsed = now - this.lastCallTimestamp[apiType];
      const delayMs = this.RATE_LIMIT_MS[apiType];
      const waitTime = elapsed >= delayMs ? 0 : delayMs - elapsed;

      if (waitTime > 0) {
        await this.sleep(waitTime);
      }

      this.lastCallTimestamp[apiType] = Date.now();
    };

    // Chain executions to preserve ordering across concurrent invocations
    this.rateLimitQueues[apiType] = this.rateLimitQueues[apiType].then(run, run);
    await this.rateLimitQueues[apiType];
  }

  static async samGet<T = any>(
    endpoint: string, 
    params: Record<string, any> = {}
  ): Promise<ApiResponse<T>> {
    await this.enforceRateLimit('sam');
    
    try {
      const response: AxiosResponse<T> = await axios.get(
        `${this.SAM_BASE_URL}${endpoint}`,
        {
          params,
          timeout: 30000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Capture-MCP/1.0.0'
          }
        }
      );

      return {
        data: response.data,
        success: true
      };
    } catch (error) {
      return this.handleError(error as AxiosError);
    }
  }

  static async usaspendingPost<T = any>(
    endpoint: string,
    data: any = {}
  ): Promise<ApiResponse<T>> {
    await this.enforceRateLimit('usaspending');
    
    try {
      const response: AxiosResponse<T> = await axios.post(
        `${this.USASPENDING_BASE_URL}${endpoint}`,
        data,
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Capture-MCP/1.0.0'
          }
        }
      );

      return {
        data: response.data,
        success: true
      };
    } catch (error) {
      return this.handleError(error as AxiosError);
    }
  }

  static async usaspendingGet<T = any>(
    endpoint: string,
    params: Record<string, any> = {}
  ): Promise<ApiResponse<T>> {
    await this.enforceRateLimit('usaspending');

    try {
      const response: AxiosResponse<T> = await axios.get(
        `${this.USASPENDING_BASE_URL}${endpoint}`,
        {
          params,
          timeout: 30000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Capture-MCP/1.0.0'
          }
        }
      );

      return {
        data: response.data,
        success: true
      };
    } catch (error) {
      return this.handleError(error as AxiosError);
    }
  }

  static async tangoGet<T = any>(
    endpoint: string,
    params: Record<string, any> = {},
    apiKey: string
  ): Promise<ApiResponse<T>> {
    await this.enforceRateLimit('tango');

    try {
      const response: AxiosResponse<T> = await axios.get(
        `${this.TANGO_BASE_URL}${endpoint}`,
        {
          params,
          timeout: 30000,
          headers: {
            'Accept': 'application/json',
            'X-API-Key': apiKey,
            'User-Agent': 'Capture-MCP/1.0.0'
          }
        }
      );

      return {
        data: response.data,
        success: true
      };
    } catch (error) {
      return this.handleError(error as AxiosError);
    }
  }

  static async tangoPost<T = any>(
    endpoint: string,
    data: any = {},
    apiKey: string
  ): Promise<ApiResponse<T>> {
    await this.enforceRateLimit('tango');

    try {
      const response: AxiosResponse<T> = await axios.post(
        `${this.TANGO_BASE_URL}${endpoint}`,
        data,
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-API-Key': apiKey,
            'User-Agent': 'Capture-MCP/1.0.0'
          }
        }
      );

      return {
        data: response.data,
        success: true
      };
    } catch (error) {
      return this.handleError(error as AxiosError);
    }
  }

  private static handleError(error: AxiosError): ApiResponse {
    if (error.response) {
      // API returned an error response
      const status = error.response.status;
      const message = error.response.data || error.message;
      
      return {
        data: null,
        success: false,
        error: `API Error ${status}: ${JSON.stringify(message)}`
      };
    } else if (error.request) {
      // Request was made but no response received
      return {
        data: null,
        success: false,
        error: 'Network error: No response received from API'
      };
    } else {
      // Error in request configuration
      return {
        data: null,
        success: false,
        error: `Request error: ${error.message}`
      };
    }
  }

  // Utility method to validate and sanitize inputs
  static sanitizeInput(input: any): any {
    if (typeof input === 'string') {
      // Strip control characters while preserving meaningful punctuation
      return input.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    }
    
    if (Array.isArray(input)) {
      return input.map(item => this.sanitizeInput(item));
    }
    
    if (typeof input === 'object' && input !== null) {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(input)) {
        sanitized[key] = this.sanitizeInput(value);
      }
      return sanitized;
    }
    
    return input;
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
