import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { deriveSecret, type KeyRing } from './key-ring.js';

const CLIENT_PREFIX = 'capcli.v1';
const CLIENT_AAD = Buffer.from('capture-mcp-client-v1');
const CLIENT_SECRET_PURPOSE = 'capture-mcp-client-secret-v1';
/** A registration is valid for as long as the longest refresh token it could renew. */
const CLIENT_LIFETIME_SECONDS = 90 * 24 * 60 * 60;
/** The sealed client id travels in URLs and forms, so the registration it carries is kept small. */
const MAX_CLIENT_ID_LENGTH = 2048;

export const DEFAULT_CLIENT_SCOPE = 'mcp:tools';

type Registration = {
  v: 1;
  iat: number;
  exp: number;
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  scope: string;
};

type ClientRegistrationInput =
  Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'> &
  Partial<Pick<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>>;

/**
 * Dynamic client registrations that live in the client id itself, so nothing is stored: the
 * registration (redirect URIs, auth method, scope, issue and expiry times) is sealed into the
 * `client_id` under the token key ring, and any instance can validate it, including after a restart.
 * A confidential client's secret is derived from the client id under the key that opened it, so
 * it is never stored either. Rotating the secret without keeping the old one (see `KeyRing`)
 * invalidates every registration it sealed, with the tokens.
 *
 * Only what the server uses is kept; other metadata the client sent is dropped.
 */
export class SealedClientsStore implements OAuthRegisteredClientsStore {
  constructor(
    private readonly ring: KeyRing,
    private readonly now: () => number = () => Date.now(),
  ) {}

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    if (clientId.length > MAX_CLIENT_ID_LENGTH) return undefined;
    try {
      const { plaintext, key } = this.ring.open(CLIENT_PREFIX, CLIENT_AAD, clientId);
      const registration = JSON.parse(plaintext) as unknown;
      if (!isRegistration(registration) || registration.exp * 1000 <= this.now()) return undefined;
      return describe(registration, clientId, key);
    } catch {
      return undefined; // not a client id this server issued (or one it can no longer open)
    }
  }

  registerClient(client: ClientRegistrationInput): OAuthClientInformationFull {
    const issuedAt = Math.floor(this.now() / 1000);
    const registration: Registration = {
      v: 1,
      iat: issuedAt,
      exp: issuedAt + CLIENT_LIFETIME_SECONDS,
      redirect_uris: client.redirect_uris.map(String),
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      grant_types: client.grant_types,
      response_types: client.response_types,
      client_name: client.client_name,
      // Clients registering without a scope would later fail authorization when they request the
      // advertised mcp:tools scope.
      scope: client.scope?.trim() ? client.scope : DEFAULT_CLIENT_SCOPE,
    };
    const clientId = this.ring.seal(CLIENT_PREFIX, CLIENT_AAD, JSON.stringify(registration));
    if (clientId.length > MAX_CLIENT_ID_LENGTH) {
      throw new InvalidClientMetadataError('Client metadata is too large: use fewer or shorter redirect URIs and a shorter client name');
    }
    return describe(registration, clientId, this.ring.currentKey);
  }
}

function describe(registration: Registration, clientId: string, key: Buffer): OAuthClientInformationFull {
  const confidential = registration.token_endpoint_auth_method !== 'none';
  return {
    client_id: clientId,
    client_id_issued_at: registration.iat,
    ...(confidential
      ? { client_secret: deriveSecret(key, CLIENT_SECRET_PURPOSE, clientId), client_secret_expires_at: registration.exp }
      : {}),
    redirect_uris: registration.redirect_uris,
    token_endpoint_auth_method: registration.token_endpoint_auth_method,
    grant_types: registration.grant_types,
    response_types: registration.response_types,
    client_name: registration.client_name,
    scope: registration.scope,
  } as OAuthClientInformationFull;
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const isOptional = <T>(value: unknown, check: (value: unknown) => value is T): boolean => value === undefined || check(value);
const isString = (value: unknown): value is string => typeof value === 'string';

function isRegistration(value: unknown): value is Registration {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    r.v === 1 &&
    typeof r.iat === 'number' &&
    typeof r.exp === 'number' &&
    isStrings(r.redirect_uris) &&
    typeof r.scope === 'string' &&
    isOptional(r.token_endpoint_auth_method, isString) &&
    isOptional(r.grant_types, isStrings) &&
    isOptional(r.response_types, isStrings) &&
    isOptional(r.client_name, isString)
  );
}
