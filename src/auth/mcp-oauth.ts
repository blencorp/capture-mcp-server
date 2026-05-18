import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';

const TOKEN_PREFIX = 'capmcp.v1';
const TOKEN_AAD = Buffer.from('capture-mcp-oauth-v1');
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90;
const DEFAULT_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

export const PROVIDER_IDS = ['sam', 'tango', 'highergov'] as const;
export type ProviderId = typeof PROVIDER_IDS[number];
export type ProviderKeys = Partial<Record<ProviderId, string>>;

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  sam: 'SAM.gov',
  tango: 'Tango',
  highergov: 'HigherGov',
};

type TokenKind = 'access' | 'refresh';

type PendingAuthorization = {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  expiresAtMs: number;
};

type AuthorizationCodeRecord = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
  state?: string;
  keys: ProviderKeys;
  expiresAtMs: number;
};

type SealedTokenPayload = {
  version: 1;
  kind: TokenKind;
  jti: string;
  clientId: string;
  scopes: string[];
  keys: ProviderKeys;
  resource?: string;
  iat: number;
  exp: number;
};

type ClientRegistrationInput =
  Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'> &
  Partial<Pick<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>>;

export class InMemoryOAuthClientsStore implements OAuthRegisteredClientsStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();

  constructor(initialClients: OAuthClientInformationFull[] = []) {
    for (const client of initialClients) {
      this.clients.set(client.client_id, client);
    }
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(client: ClientRegistrationInput): OAuthClientInformationFull {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fullClient = {
      ...client,
      client_id: client.client_id ?? randomUUID(),
      client_id_issued_at: client.client_id_issued_at ?? nowSeconds,
    } as OAuthClientInformationFull;

    this.clients.set(fullClient.client_id, fullClient);
    return fullClient;
  }
}

export type McpOAuthProviderOptions = {
  baseUrl: URL;
  tokenSecret: string;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  authorizationTtlMs?: number;
  now?: () => number;
};

export class McpOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;

  private readonly baseUrl: URL;
  private readonly encryptionKey: Buffer;
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenTtlSeconds: number;
  private readonly authorizationTtlMs: number;
  private readonly now: () => number;
  private readonly pendingAuthorizations = new Map<string, PendingAuthorization>();
  private readonly authorizationCodes = new Map<string, AuthorizationCodeRecord>();
  private readonly revokedTokenIds = new Set<string>();

  constructor(options: McpOAuthProviderOptions) {
    if (!options.tokenSecret.trim()) {
      throw new Error('OAUTH_TOKEN_SECRET is required when MCP_REQUIRE_OAUTH=true');
    }

    this.baseUrl = options.baseUrl;
    this.encryptionKey = createHash('sha256').update(options.tokenSecret).digest();
    this.accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
    this.refreshTokenTtlSeconds = options.refreshTokenTtlSeconds ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS;
    this.authorizationTtlMs = options.authorizationTtlMs ?? DEFAULT_AUTHORIZATION_TTL_MS;
    this.now = options.now ?? (() => Date.now());
    this.clientsStore = new InMemoryOAuthClientsStore();
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError('Unregistered redirect_uri');
    }

    this.cleanupExpired();
    const requestId = randomUUID();
    this.pendingAuthorizations.set(requestId, {
      client,
      params,
      expiresAtMs: this.now() + this.authorizationTtlMs,
    });

    const credentialUrl = new URL('/oauth/authorize', this.baseUrl);
    credentialUrl.searchParams.set('request_id', requestId);
    res.redirect(302, credentialUrl.href);
  }

  async completeAuthorization(requestId: string, rawKeys: ProviderKeys): Promise<string> {
    this.cleanupExpired();
    const pending = this.pendingAuthorizations.get(requestId);
    if (!pending) {
      throw new InvalidRequestError('Authorization request expired or was not found');
    }

    const keys = normalizeProviderKeys(rawKeys);
    if (Object.keys(keys).length === 0) {
      throw new InvalidRequestError('Provide at least one provider API key');
    }

    this.pendingAuthorizations.delete(requestId);
    const code = randomUUID();
    this.authorizationCodes.set(code, {
      clientId: pending.client.client_id,
      redirectUri: pending.params.redirectUri,
      codeChallenge: pending.params.codeChallenge,
      scopes: pending.params.scopes ?? [],
      resource: pending.params.resource?.href,
      state: pending.params.state,
      keys,
      expiresAtMs: this.now() + this.authorizationTtlMs,
    });

    const targetUrl = new URL(pending.params.redirectUri);
    targetUrl.searchParams.set('code', code);
    if (pending.params.state !== undefined) {
      targetUrl.searchParams.set('state', pending.params.state);
    }

    return targetUrl.href;
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    this.cleanupExpired();
    const codeRecord = this.authorizationCodes.get(authorizationCode);
    if (!codeRecord || codeRecord.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid authorization code');
    }

    return codeRecord.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    this.cleanupExpired();
    const codeRecord = this.authorizationCodes.get(authorizationCode);
    if (!codeRecord) {
      throw new InvalidGrantError('Invalid authorization code');
    }

    if (codeRecord.clientId !== client.client_id) {
      throw new InvalidGrantError('Authorization code was issued to a different client');
    }
    if (redirectUri !== undefined && redirectUri !== codeRecord.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request');
    }
    if (resource !== undefined && codeRecord.resource !== undefined && resource.href !== codeRecord.resource) {
      throw new InvalidGrantError('resource does not match the authorization request');
    }

    this.authorizationCodes.delete(authorizationCode);
    const accessToken = this.issueToken('access', codeRecord);
    const refreshToken = this.issueToken('refresh', codeRecord);

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: this.accessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: codeRecord.scopes.join(' '),
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const payload = this.verifySealedToken(refreshToken, 'refresh');
    if (payload.clientId !== client.client_id) {
      throw new InvalidGrantError('Refresh token was issued to a different client');
    }
    if (resource !== undefined && payload.resource !== undefined && resource.href !== payload.resource) {
      throw new InvalidGrantError('resource does not match the refresh token');
    }

    const requestedScopes = scopes ?? payload.scopes;
    const unauthorizedScope = requestedScopes.find(scope => !payload.scopes.includes(scope));
    if (unauthorizedScope) {
      throw new InvalidGrantError(`Refresh token was not granted scope ${unauthorizedScope}`);
    }

    const tokenRecord: AuthorizationCodeRecord = {
      clientId: payload.clientId,
      redirectUri: '',
      codeChallenge: '',
      scopes: requestedScopes,
      resource: payload.resource,
      keys: payload.keys,
      expiresAtMs: this.now() + this.authorizationTtlMs,
    };

    return {
      access_token: this.issueToken('access', tokenRecord),
      token_type: 'bearer',
      expires_in: this.accessTokenTtlSeconds,
      refresh_token: this.issueToken('refresh', tokenRecord),
      scope: requestedScopes.join(' '),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const payload = this.verifySealedToken(token, 'access');
    return {
      token,
      clientId: payload.clientId,
      scopes: payload.scopes,
      expiresAt: payload.exp,
      resource: payload.resource ? new URL(payload.resource) : undefined,
      extra: {
        providerKeys: payload.keys,
      },
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    try {
      const payload = this.unsealToken(request.token);
      this.revokedTokenIds.add(payload.jti);
    } catch {
      // RFC 7009 treats unknown tokens as successfully revoked.
    }
  }

  private issueToken(
    kind: TokenKind,
    codeRecord: Pick<AuthorizationCodeRecord, 'clientId' | 'scopes' | 'resource' | 'keys'>
  ): string {
    const issuedAt = Math.floor(this.now() / 1000);
    const ttl = kind === 'access' ? this.accessTokenTtlSeconds : this.refreshTokenTtlSeconds;
    return this.sealToken({
      version: 1,
      kind,
      jti: randomUUID(),
      clientId: codeRecord.clientId,
      scopes: codeRecord.scopes,
      keys: codeRecord.keys,
      resource: codeRecord.resource,
      iat: issuedAt,
      exp: issuedAt + ttl,
    });
  }

  private verifySealedToken(token: string, expectedKind: TokenKind): SealedTokenPayload {
    let payload: SealedTokenPayload;
    try {
      payload = this.unsealToken(token);
    } catch {
      throw new InvalidTokenError(`Invalid ${expectedKind} token`);
    }

    if (payload.kind !== expectedKind) {
      throw new InvalidTokenError(`Invalid ${expectedKind} token`);
    }
    if (this.revokedTokenIds.has(payload.jti)) {
      throw new InvalidTokenError('Token has been revoked');
    }
    if (payload.exp < Math.floor(this.now() / 1000)) {
      throw new InvalidTokenError('Token has expired');
    }

    return payload;
  }

  private sealToken(payload: SealedTokenPayload): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(TOKEN_AAD);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      TOKEN_PREFIX,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  private unsealToken(token: string): SealedTokenPayload {
    const [prefix, version, encodedIv, encodedCiphertext, encodedTag] = token.split('.');
    if (`${prefix}.${version}` !== TOKEN_PREFIX || !encodedIv || !encodedCiphertext || !encodedTag) {
      throw new Error('Malformed token');
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(encodedIv, 'base64url')
    );
    decipher.setAAD(TOKEN_AAD);
    decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plaintext) as unknown;

    if (!isSealedTokenPayload(payload)) {
      throw new Error('Invalid token payload');
    }

    return payload;
  }

  private cleanupExpired(): void {
    const now = this.now();
    for (const [requestId, pending] of this.pendingAuthorizations.entries()) {
      if (pending.expiresAtMs < now) {
        this.pendingAuthorizations.delete(requestId);
      }
    }
    for (const [code, record] of this.authorizationCodes.entries()) {
      if (record.expiresAtMs < now) {
        this.authorizationCodes.delete(code);
      }
    }
  }
}

function normalizeProviderKeys(rawKeys: ProviderKeys): ProviderKeys {
  const normalized: ProviderKeys = {};
  for (const id of PROVIDER_IDS) {
    const value = rawKeys[id];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        normalized[id] = trimmed;
      }
    }
  }
  return normalized;
}

export function getProviderKeysFromAuth(authInfo: AuthInfo | undefined): ProviderKeys {
  const candidate = authInfo?.extra?.providerKeys;
  if (!candidate || typeof candidate !== 'object') {
    return {};
  }
  const source = candidate as Record<string, unknown>;
  const out: ProviderKeys = {};
  for (const id of PROVIDER_IDS) {
    const value = source[id];
    if (typeof value === 'string' && value.trim()) {
      out[id] = value;
    }
  }
  return out;
}

export function getOAuthPublicBaseUrl(port: number): URL {
  const configured = process.env.MCP_PUBLIC_BASE_URL || process.env.PUBLIC_URL;
  if (configured) {
    const url = new URL(configured);
    url.hash = '';
    url.search = '';
    if (url.pathname.endsWith('/mcp')) {
      url.pathname = url.pathname.slice(0, -'/mcp'.length) || '/';
    }
    if (!url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}/`;
    }
    return url;
  }

  return new URL(`http://localhost:${port}`);
}

export type FormFieldErrors = Partial<Record<ProviderId, string>>;

export function renderAuthorizationPage(
  requestId: string,
  options: { error?: string; fieldErrors?: FormFieldErrors; checked?: Partial<Record<ProviderId, boolean>> } = {}
): string {
  const { error, fieldErrors = {}, checked = {} } = options;
  const escapedRequestId = escapeHtml(requestId);
  const errorMarkup = error
    ? `<div class="error" role="alert">${escapeHtml(error)}</div>`
    : '';

  const providerRows = PROVIDER_IDS.map(id => {
    const label = PROVIDER_LABELS[id];
    const isChecked = checked[id] ?? false;
    const fieldError = fieldErrors[id];
    return `
      <div class="provider${isChecked ? ' provider--active' : ''}" data-provider="${id}">
        <label class="provider__toggle">
          <input type="checkbox" name="enabled[]" value="${id}" data-toggle="${id}"${isChecked ? ' checked' : ''}>
          <span>${label}</span>
        </label>
        <div class="provider__field" data-field="${id}"${isChecked ? '' : ' hidden'}>
          <label for="${id}_api_key">${label} API key</label>
          <input id="${id}_api_key" name="${id}_api_key" type="password" spellcheck="false" autocomplete="off">
          ${fieldError ? `<div class="field-error">${escapeHtml(fieldError)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize GovCon Capture</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f6f7f9;
      color: #111827;
    }
    main {
      width: min(92vw, 480px);
      background: #ffffff;
      border: 1px solid #d7dce3;
      border-radius: 8px;
      padding: 28px;
      box-shadow: 0 18px 40px rgba(17, 24, 39, 0.08);
    }
    h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.2; }
    p { margin: 0 0 20px; color: #4b5563; line-height: 1.5; }
    .provider {
      border: 1px solid #e2e6ec;
      border-radius: 6px;
      padding: 12px 14px;
      margin-bottom: 12px;
      transition: border-color 120ms ease, background-color 120ms ease;
    }
    .provider--active { border-color: #0f766e; background: #f0fdfa; }
    .provider__toggle { display: flex; align-items: center; gap: 10px; font-weight: 650; cursor: pointer; }
    .provider__toggle input { width: 18px; height: 18px; }
    .provider__field { margin-top: 12px; }
    .provider__field[hidden] { display: none; }
    .provider__field label { display: block; margin-bottom: 6px; font-size: 14px; color: #4b5563; }
    .provider__field input {
      box-sizing: border-box;
      width: 100%;
      min-height: 40px;
      border: 1px solid #b7c0ce;
      border-radius: 6px;
      padding: 8px 12px;
      font: inherit;
      background: #ffffff;
      color: #111827;
    }
    button {
      width: 100%;
      min-height: 44px;
      margin-top: 8px;
      border: 0;
      border-radius: 6px;
      background: #0f766e;
      color: #ffffff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button:disabled { background: #94a3b8; cursor: not-allowed; }
    .error, .field-error {
      padding: 10px 12px;
      border-radius: 6px;
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
      font-size: 14px;
    }
    .error { margin-bottom: 16px; }
    .field-error { margin-top: 8px; }
    @media (prefers-color-scheme: dark) {
      body { background: #111827; color: #f9fafb; }
      main { background: #1f2937; border-color: #374151; }
      p { color: #cbd5e1; }
      .provider { border-color: #374151; }
      .provider--active { background: #022c22; border-color: #0f766e; }
      .provider__field label { color: #cbd5e1; }
      .provider__field input { background: #111827; color: #f9fafb; border-color: #4b5563; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Authorize GovCon Capture</h1>
    <p>Select the providers you have API keys for. Each enabled provider unlocks its tools in Claude.</p>
    ${errorMarkup}
    <form method="post" action="/oauth/authorize" autocomplete="off" id="auth-form">
      <input type="hidden" name="request_id" value="${escapedRequestId}">
      ${providerRows}
      <button type="submit" id="submit-btn">Authorize</button>
    </form>
    <script>
      (function () {
        var form = document.getElementById('auth-form');
        var submitBtn = document.getElementById('submit-btn');

        function update(provider) {
          var checkbox = form.querySelector('input[data-toggle="' + provider + '"]');
          var fieldWrap = form.querySelector('[data-field="' + provider + '"]');
          var input = fieldWrap.querySelector('input[type="password"]');
          var card = form.querySelector('.provider[data-provider="' + provider + '"]');
          if (checkbox.checked) {
            fieldWrap.hidden = false;
            card.classList.add('provider--active');
            input.required = true;
          } else {
            fieldWrap.hidden = true;
            card.classList.remove('provider--active');
            input.required = false;
            input.value = '';
          }
          refreshSubmit();
        }

        function refreshSubmit() {
          var anyChecked = !!form.querySelector('input[name="enabled[]"]:checked');
          submitBtn.disabled = !anyChecked;
        }

        ${JSON.stringify(PROVIDER_IDS)}.forEach(function (id) {
          var checkbox = form.querySelector('input[data-toggle="' + id + '"]');
          checkbox.addEventListener('change', function () { update(id); });
          update(id);
        });
      })();
    </script>
  </main>
</body>
</html>`;
}

function isSealedTokenPayload(value: unknown): value is SealedTokenPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const payload = value as Partial<SealedTokenPayload>;
  if (
    payload.version !== 1 ||
    (payload.kind !== 'access' && payload.kind !== 'refresh') ||
    typeof payload.jti !== 'string' ||
    typeof payload.clientId !== 'string' ||
    !Array.isArray(payload.scopes) ||
    !payload.scopes.every(scope => typeof scope === 'string') ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number' ||
    (payload.resource !== undefined && typeof payload.resource !== 'string')
  ) {
    return false;
  }
  if (!payload.keys || typeof payload.keys !== 'object') {
    return false;
  }
  for (const id of PROVIDER_IDS) {
    const value = (payload.keys as Record<string, unknown>)[id];
    if (value !== undefined && typeof value !== 'string') {
      return false;
    }
  }
  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
