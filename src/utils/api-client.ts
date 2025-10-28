import axios, { AxiosResponse, AxiosError } from 'axios';

export interface ApiResponse<T = any> {
  data: T;
  success: boolean;
  error?: string;
}

export class ApiClient {
  private static readonly SAM_BASE_URL = 'https://api.sam.gov';
  private static readonly USASPENDING_BASE_URL = 'https://api.usaspending.gov/api/v2';
  private static readonly TANGO_BASE_URL = 'https://api.tango.makegov.com/v1';

  // Rate limiting - simple delay mechanism
  private static lastSamCall = 0;
  private static lastUsaspendingCall = 0;
  private static lastTangoCall = 0;
  private static readonly SAM_DELAY_MS = 100; // Conservative delay for SAM.gov
  private static readonly USASPENDING_DELAY_MS = 3600; // ~3.6 seconds between calls (~1000/hour) for USASpending
  private static readonly TANGO_DELAY_MS = 100; // Conservative delay for Tango API

  private static async enforceRateLimit(apiType: 'sam' | 'usaspending' | 'tango'): Promise<void> {
    const now = Date.now();

    if (apiType === 'sam') {
      const timeSinceLastCall = now - this.lastSamCall;
      if (timeSinceLastCall < this.SAM_DELAY_MS) {
        await new Promise(resolve => setTimeout(resolve, this.SAM_DELAY_MS - timeSinceLastCall));
      }
      this.lastSamCall = Date.now();
    } else if (apiType === 'usaspending') {
      const timeSinceLastCall = now - this.lastUsaspendingCall;
      if (timeSinceLastCall < this.USASPENDING_DELAY_MS) {
        await new Promise(resolve => setTimeout(resolve, this.USASPENDING_DELAY_MS - timeSinceLastCall));
      }
      this.lastUsaspendingCall = Date.now();
    } else if (apiType === 'tango') {
      const timeSinceLastCall = now - this.lastTangoCall;
      if (timeSinceLastCall < this.TANGO_DELAY_MS) {
        await new Promise(resolve => setTimeout(resolve, this.TANGO_DELAY_MS - timeSinceLastCall));
      }
      this.lastTangoCall = Date.now();
    }
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
      // Remove potentially dangerous characters
      return input.replace(/[<>\"'&]/g, '').trim();
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
}
