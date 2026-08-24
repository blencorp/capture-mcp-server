import { createClient } from 'redis';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/server';

export type StoredAuthorizationParams = {
  redirectUri: string;
  codeChallenge: string;
  scopes?: string[];
  state?: string;
  resource?: string;
};

export type PendingAuthorizationRecord = {
  client: OAuthClientInformationFull;
  params: StoredAuthorizationParams;
  expiresAtMs: number;
};

export type AuthorizationCodeRecord = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
  state?: string;
  keys: Partial<Record<'sam' | 'tango' | 'highergov', string>>;
  expiresAtMs: number;
};

/**
 * State required by the OAuth authorization server. MCP requests are
 * stateless, but a multi-request OAuth code flow must survive instance changes
 * and rolling deploys.
 */
export interface OAuthStateStore {
  getClient(clientId: string): Promise<OAuthClientInformationFull | undefined>;
  putClient(client: OAuthClientInformationFull): Promise<void>;
  putPendingAuthorization(id: string, record: PendingAuthorizationRecord, ttlMs: number): Promise<void>;
  takePendingAuthorization(id: string): Promise<PendingAuthorizationRecord | undefined>;
  getAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | undefined>;
  putAuthorizationCode(code: string, record: AuthorizationCodeRecord, ttlMs: number): Promise<void>;
  takeAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | undefined>;
  isTokenRevoked(tokenId: string): Promise<boolean>;
  revokeToken(tokenId: string, ttlMs: number): Promise<void>;
  close?(): Promise<void>;
}

type Expiring<T> = { value: T; expiresAtMs: number };

/** Local/test implementation. Production OAuth intentionally refuses this. */
export class InMemoryOAuthStateStore implements OAuthStateStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();
  private readonly pending = new Map<string, Expiring<PendingAuthorizationRecord>>();
  private readonly codes = new Map<string, Expiring<AuthorizationCodeRecord>>();
  private readonly revoked = new Map<string, number>();

  constructor(
    initialClients: OAuthClientInformationFull[] = [],
    private readonly now: () => number = () => Date.now(),
  ) {
    for (const client of initialClients) {
      this.clients.set(client.client_id, structuredClone(client));
    }
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return clone(this.clients.get(clientId));
  }

  async putClient(client: OAuthClientInformationFull): Promise<void> {
    this.clients.set(client.client_id, structuredClone(client));
  }

  async putPendingAuthorization(id: string, record: PendingAuthorizationRecord, ttlMs: number): Promise<void> {
    this.pending.set(id, { value: structuredClone(record), expiresAtMs: this.now() + ttlMs });
  }

  async takePendingAuthorization(id: string): Promise<PendingAuthorizationRecord | undefined> {
    return this.take(this.pending, id);
  }

  async getAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | undefined> {
    return this.get(this.codes, code);
  }

  async putAuthorizationCode(code: string, record: AuthorizationCodeRecord, ttlMs: number): Promise<void> {
    this.codes.set(code, { value: structuredClone(record), expiresAtMs: this.now() + ttlMs });
  }

  async takeAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | undefined> {
    return this.take(this.codes, code);
  }

  async isTokenRevoked(tokenId: string): Promise<boolean> {
    const expiresAt = this.revoked.get(tokenId);
    if (expiresAt === undefined) return false;
    if (expiresAt <= this.now()) {
      this.revoked.delete(tokenId);
      return false;
    }
    return true;
  }

  async revokeToken(tokenId: string, ttlMs: number): Promise<void> {
    if (ttlMs > 0) this.revoked.set(tokenId, this.now() + ttlMs);
  }

  private async get<T>(map: Map<string, Expiring<T>>, key: string): Promise<T | undefined> {
    const entry = map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs <= this.now()) {
      map.delete(key);
      return undefined;
    }
    return structuredClone(entry.value);
  }

  private async take<T>(map: Map<string, Expiring<T>>, key: string): Promise<T | undefined> {
    const entry = map.get(key);
    map.delete(key);
    if (!entry || entry.expiresAtMs <= this.now()) return undefined;
    return structuredClone(entry.value);
  }
}

type RedisClient = {
  readonly isOpen: boolean;
  on(event: 'error', listener: (error: Error) => void): unknown;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  getDel(key: string): Promise<string | null>;
  exists(key: string): Promise<number>;
  set(key: string, value: string, options?: { PX: number }): Promise<unknown>;
};

export class RedisOAuthStateStore implements OAuthStateStore {
  private constructor(
    private readonly client: RedisClient,
    private readonly prefix: string,
  ) {}

  static async connect(url: string, prefix = 'capture-mcp:oauth'): Promise<RedisOAuthStateStore> {
    const client = createClient({ url }) as unknown as RedisClient;
    client.on('error', error => console.error('OAuth Redis error:', error));
    await client.connect();
    return new RedisOAuthStateStore(client, prefix.replace(/:+$/, ''));
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.getJson<OAuthClientInformationFull>(this.key('client', clientId));
  }

  async putClient(client: OAuthClientInformationFull): Promise<void> {
    await this.client.set(this.key('client', client.client_id), JSON.stringify(client));
  }

  async putPendingAuthorization(id: string, record: PendingAuthorizationRecord, ttlMs: number): Promise<void> {
    await this.setExpiring(this.key('pending', id), record, ttlMs);
  }

  async takePendingAuthorization(id: string): Promise<PendingAuthorizationRecord | undefined> {
    return this.takeJson<PendingAuthorizationRecord>(this.key('pending', id));
  }

  async getAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | undefined> {
    return this.getJson<AuthorizationCodeRecord>(this.key('code', code));
  }

  async putAuthorizationCode(code: string, record: AuthorizationCodeRecord, ttlMs: number): Promise<void> {
    await this.setExpiring(this.key('code', code), record, ttlMs);
  }

  async takeAuthorizationCode(code: string): Promise<AuthorizationCodeRecord | undefined> {
    return this.takeJson<AuthorizationCodeRecord>(this.key('code', code));
  }

  async isTokenRevoked(tokenId: string): Promise<boolean> {
    return (await this.client.exists(this.key('revoked', tokenId))) > 0;
  }

  async revokeToken(tokenId: string, ttlMs: number): Promise<void> {
    if (ttlMs > 0) {
      await this.client.set(this.key('revoked', tokenId), '1', { PX: ttlMs });
    }
  }

  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }

  private key(kind: string, id: string): string {
    return `${this.prefix}:${kind}:${id}`;
  }

  private async setExpiring(key: string, value: unknown, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) throw new Error('OAuth state TTL must be positive');
    await this.client.set(key, JSON.stringify(value), { PX: ttlMs });
  }

  private async getJson<T>(key: string): Promise<T | undefined> {
    return parseJson<T>(await this.client.get(key));
  }

  private async takeJson<T>(key: string): Promise<T | undefined> {
    return parseJson<T>(await this.client.getDel(key));
  }
}

export async function createOAuthStateStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OAuthStateStore> {
  const redisUrl = env.OAUTH_REDIS_URL || env.REDIS_URL;
  if (redisUrl) {
    return RedisOAuthStateStore.connect(redisUrl, env.OAUTH_REDIS_PREFIX || undefined);
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'OAUTH_REDIS_URL (or REDIS_URL) is required for production OAuth so registrations and authorization flows survive restarts',
    );
  }

  return new InMemoryOAuthStateStore();
}

function parseJson<T>(raw: string | null): T | undefined {
  return raw === null ? undefined : JSON.parse(raw) as T;
}

function clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
