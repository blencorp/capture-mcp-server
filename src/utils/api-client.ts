import axios, { type AxiosResponse, type AxiosError } from 'axios';
import { requestSignal } from './request-signal.js';

export interface ApiResponse<T = any> {
  data: T;
  success: boolean;
  error?: string;
}

type ApiFamily = 'sam' | 'usaspending' | 'tango' | 'highergov';

export class ApiClient {
  private static readonly SAM_BASE_URL = 'https://api.sam.gov';
  private static readonly USASPENDING_BASE_URL = 'https://api.usaspending.gov/api/v2';
  private static readonly TANGO_BASE_URL = 'https://tango.makegov.com/api';
  private static readonly HIGHERGOV_BASE_URL = 'https://www.highergov.com/api-external';

  // Rate limiting: queue-based guard so concurrent requests respect per-API pacing
  private static readonly RATE_LIMIT_MS: Record<ApiFamily, number> = {
    sam: 100, // Conservative delay for SAM.gov
    usaspending: 3600, // ~3.6 seconds between calls (~1000/hour) for USASpending
    tango: 100, // Conservative delay for Tango API
    highergov: 200, // Conservative pacing for HigherGov; tune against documented plan ceiling
  };

  private static readonly rateLimitQueues: Record<ApiFamily, Promise<void>> = {
    sam: Promise.resolve(),
    usaspending: Promise.resolve(),
    tango: Promise.resolve(),
    highergov: Promise.resolve(),
  };

  private static readonly lastCallTimestamp: Record<ApiFamily, number> = {
    sam: 0,
    usaspending: 0,
    tango: 0,
    highergov: 0,
  };

  private static readonly CANCELLED: ApiResponse = { data: null, success: false, error: 'Request cancelled' };

  /**
   * Waits for this caller's turn in the source's pacing queue. Resolves false, at once, when the
   * request is cancelled first: a cancelled caller never sleeps, and does not move the last-dispatch
   * time, so pacing holds between calls actually sent and cancelled ones cost the others nothing.
   */
  private static enforceRateLimit(apiType: ApiFamily, signal: AbortSignal | undefined = requestSignal()): Promise<boolean> {
    const turn = this.rateLimitQueues[apiType].then(async () => {
      if (signal?.aborted) return false;
      const elapsed = Date.now() - this.lastCallTimestamp[apiType];
      const waitTime = Math.max(0, this.RATE_LIMIT_MS[apiType] - elapsed);
      if (waitTime > 0 && !(await this.sleep(waitTime, signal))) return false;
      this.lastCallTimestamp[apiType] = Date.now();
      return true;
    });
    // The queue moves on when this turn ends, however it ends.
    this.rateLimitQueues[apiType] = turn.then(() => undefined, () => undefined);
    if (!signal) return turn;
    // A caller still waiting behind others is released the moment it is cancelled; its queue entry
    // is skipped when its turn comes.
    return Promise.race([
      turn,
      new Promise<boolean>(resolve => {
        if (signal.aborted) resolve(false);
        else signal.addEventListener('abort', () => resolve(false), { once: true });
      }),
    ]);
  }

  static async samGet<T = any>(
    endpoint: string, 
    params: Record<string, any> = {}
  ): Promise<ApiResponse<T>> {
    if (!(await this.enforceRateLimit('sam'))) return this.CANCELLED;
    
    try {
      const response: AxiosResponse<T> = await axios.get(
        `${this.SAM_BASE_URL}${endpoint}`,
        {
          params,
          timeout: 30000,
          signal: requestSignal(),
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
      return this.handleError(error as AxiosError, [params.api_key]);
    }
  }

  static async usaspendingPost<T = any>(
    endpoint: string,
    data: any = {}
  ): Promise<ApiResponse<T>> {
    if (!(await this.enforceRateLimit('usaspending'))) return this.CANCELLED;
    
    try {
      const response: AxiosResponse<T> = await axios.post(
        `${this.USASPENDING_BASE_URL}${endpoint}`,
        data,
        {
          timeout: 30000,
          signal: requestSignal(),
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
    if (!(await this.enforceRateLimit('usaspending'))) return this.CANCELLED;

    try {
      const response: AxiosResponse<T> = await axios.get(
        `${this.USASPENDING_BASE_URL}${endpoint}`,
        {
          params,
          timeout: 30000,
          signal: requestSignal(),
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
    if (!(await this.enforceRateLimit('tango'))) return this.CANCELLED;

    try {
      const response: AxiosResponse<T> = await axios.get(
        `${this.TANGO_BASE_URL}${endpoint}`,
        {
          params,
          timeout: 30000,
          signal: requestSignal(),
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
      return this.handleError(error as AxiosError, [apiKey]);
    }
  }

  static async tangoPost<T = any>(
    endpoint: string,
    data: any = {},
    apiKey: string
  ): Promise<ApiResponse<T>> {
    if (!(await this.enforceRateLimit('tango'))) return this.CANCELLED;

    try {
      const response: AxiosResponse<T> = await axios.post(
        `${this.TANGO_BASE_URL}${endpoint}`,
        data,
        {
          timeout: 30000,
          signal: requestSignal(),
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
      return this.handleError(error as AxiosError, [apiKey]);
    }
  }

  static async highergovGet<T = any>(
    endpoint: string,
    params: Record<string, any> = {},
    apiKey: string
  ): Promise<ApiResponse<T>> {
    if (!(await this.enforceRateLimit('highergov'))) return this.CANCELLED;

    try {
      const response: AxiosResponse<T> = await axios.get(
        `${this.HIGHERGOV_BASE_URL}${endpoint}`,
        {
          // HigherGov's current public OAS requires api_key as a query parameter.
          params: { ...params, api_key: apiKey },
          timeout: 30000,
          signal: requestSignal(),
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Capture-MCP/1.0.0'
          }
        }
      );

      return { data: response.data, success: true };
    } catch (error) {
      return this.handleError(error as AxiosError, [apiKey]);
    }
  }

  /**
   * Upstream error text goes to the assistant, so it must never carry a provider key: a provider
   * may echo the caller's key in its error body or URL. Removes the keys used for this call and
   * any `api_key=` query value.
   */
  static redactSecrets(text: string, secrets: unknown[] = []): string {
    let out = text;
    for (const secret of secrets) {
      if (typeof secret !== 'string' || secret.length === 0) continue;
      for (const form of this.secretForms(secret)) out = out.split(form).join('[REDACTED]');
    }
    return out.replace(/(api[_-]?key=)[^&\s"'\\]+/gi, '$1[REDACTED]');
  }

  /** Every way a provider might echo a key: as written, JSON-escaped, and URL-encoded in either hex case. */
  private static secretForms(secret: string): Set<string> {
    const forms = new Set([secret, JSON.stringify(secret).slice(1, -1)]);
    const encoded = [
      encodeURIComponent(secret),
      encodeURI(secret),
      new URLSearchParams({ k: secret }).toString().slice(2), // form encoding: space as `+`
    ];
    for (const form of encoded) {
      forms.add(form);
      forms.add(form.replace(/%[0-9A-F]{2}/gi, (hex) => hex.toLowerCase()));
      forms.add(form.replace(/%[0-9A-F]{2}/gi, (hex) => hex.toUpperCase()));
    }
    return forms;
  }

  private static readonly MAX_ERROR_BODY = 500;

  private static handleError(error: AxiosError, secrets: unknown[] = []): ApiResponse {
    const redact = (text: string) => this.redactSecrets(text, secrets);
    if (axios.isCancel(error)) {
      // The MCP client cancelled the request that needed this call.
      return { data: null, success: false, error: 'Request cancelled' };
    }
    if (error.response) {
      // API returned an error response
      const status = error.response.status;
      const message = error.response.data || error.message;
      const body = redact(typeof message === 'string' ? message : JSON.stringify(message) ?? '');
      const bounded = body.length > this.MAX_ERROR_BODY ? `${body.slice(0, this.MAX_ERROR_BODY)}…` : body;

      return {
        data: null,
        success: false,
        error: `API Error ${status}: ${bounded}`
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
        error: redact(`Request error: ${error.message}`)
      };
    }
  }

  // Utility method to validate and sanitize inputs
  static sanitizeInput(input: any): any {
    if (typeof input === 'string') {
      // Strip control characters while preserving meaningful punctuation
      // eslint-disable-next-line no-control-regex -- the control characters are the point
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

  /** Sleeps `ms`; resolves false, early, if `signal` aborts first. */
  private static sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise(resolve => {
      const done = (completed: boolean) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(completed);
      };
      const onAbort = () => done(false);
      const timer = setTimeout(() => done(true), ms);
      if (signal?.aborted) return done(false);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
