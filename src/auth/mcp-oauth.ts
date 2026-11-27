import { createHash, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type {
  AuthInfo,
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/server';
import { DEFAULT_CLIENT_SCOPE, SealedClientsStore } from './client-registrations.js';
import { ExpiringMap } from './expiring-map.js';
import { KeyRing } from './key-ring.js';
import { invalidGrant, invalidRequest, invalidScope, invalidToken } from './oauth-errors.js';
import type { AuthorizationParams, OAuthServerProvider } from './oauth-server.js';

export { DEFAULT_CLIENT_SCOPE };

const TOKEN_PREFIX = 'capmcp.v1';
const TOKEN_AAD = Buffer.from('capture-mcp-oauth-v1');

const SECONDS_PER_DAY = 60 * 60 * 24;
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const MAX_ACCESS_TOKEN_TTL_SECONDS = SECONDS_PER_DAY;
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 90 * SECONDS_PER_DAY;
const MAX_REFRESH_TOKEN_TTL_SECONDS = 90 * SECONDS_PER_DAY;
const DEFAULT_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

// Ceilings on the state an instance holds in memory for anonymous callers (client registrations
// are not among it: they live in the client id). At a ceiling the
// oldest entry is evicted (see ExpiringMap).
const MAX_PENDING_AUTHORIZATIONS = 10_000;
const MAX_AUTHORIZATION_CODES = 10_000;
const MAX_REVOKED_TOKENS = 10_000;

/** The scopes this server grants. `/mcp` requires `DEFAULT_CLIENT_SCOPE`. */
export const SUPPORTED_SCOPES: readonly string[] = [DEFAULT_CLIENT_SCOPE];

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
};

type AuthorizationCodeRecord = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
  state?: string;
  keys: ProviderKeys;
};

type TokenGrant = Pick<AuthorizationCodeRecord, 'clientId' | 'scopes' | 'resource' | 'keys'>;

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

export type McpOAuthProviderOptions = {
  baseUrl: URL;
  /** Seals new tokens, and opens tokens sealed with it. */
  tokenSecret: string;
  /**
   * Retired secrets that still open tokens (never seal them). Rotating `tokenSecret` while the old
   * one is listed here keeps existing tokens working until they expire; dropping it from the list
   * revokes every token it sealed.
   */
  previousTokenSecrets?: string[];
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  authorizationTtlMs?: number;
  now?: () => number;
};

export class McpOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: SealedClientsStore;

  private readonly baseUrl: URL;
  private readonly keyRing: KeyRing;
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenTtlSeconds: number;
  private readonly authorizationTtlMs: number;
  private readonly now: () => number;
  private readonly pendingAuthorizations: ExpiringMap<PendingAuthorization>;
  private readonly authorizationCodes: ExpiringMap<AuthorizationCodeRecord>;
  /** Revoked token ids, kept until the token would have expired anyway. In memory, per instance. */
  private readonly revokedAccessTokenIds: ExpiringMap<true>;
  /** Refresh tokens outlive access tokens by months, so they are kept apart: a flood of short-lived revocations cannot evict one. */
  private readonly revokedRefreshTokenIds: ExpiringMap<true>;

  constructor(options: McpOAuthProviderOptions) {
    if (!options.tokenSecret.trim()) {
      throw new Error('OAUTH_TOKEN_SECRET is required when MCP_REQUIRE_OAUTH=true');
    }

    this.baseUrl = options.baseUrl;
    this.keyRing = new KeyRing(options.tokenSecret, options.previousTokenSecrets);
    this.accessTokenTtlSeconds = boundedTtl(
      'accessTokenTtlSeconds', options.accessTokenTtlSeconds, DEFAULT_ACCESS_TOKEN_TTL_SECONDS, MAX_ACCESS_TOKEN_TTL_SECONDS);
    this.refreshTokenTtlSeconds = boundedTtl(
      'refreshTokenTtlSeconds', options.refreshTokenTtlSeconds, DEFAULT_REFRESH_TOKEN_TTL_SECONDS, MAX_REFRESH_TOKEN_TTL_SECONDS);
    this.authorizationTtlMs = options.authorizationTtlMs ?? DEFAULT_AUTHORIZATION_TTL_MS;
    this.now = options.now ?? (() => Date.now());
    this.pendingAuthorizations = new ExpiringMap(MAX_PENDING_AUTHORIZATIONS, this.now);
    this.authorizationCodes = new ExpiringMap(MAX_AUTHORIZATION_CODES, this.now);
    this.revokedAccessTokenIds = new ExpiringMap(MAX_REVOKED_TOKENS, this.now);
    this.revokedRefreshTokenIds = new ExpiringMap(MAX_REVOKED_TOKENS, this.now);
    this.clientsStore = new SealedClientsStore(this.keyRing, this.now);
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw invalidRequest('Unregistered redirect_uri');
    }

    const scopes = grantedScopes(params.scopes);
    const unsupported = scopes.find(scope => !SUPPORTED_SCOPES.includes(scope));
    if (unsupported) {
      throw invalidScope(`Unsupported scope ${unsupported}`);
    }

    const requestId = randomUUID();
    this.pendingAuthorizations.set(
      requestId,
      { client, params: { ...params, scopes } },
      this.now() + this.authorizationTtlMs,
    );

    const credentialUrl = new URL('/oauth/authorize', this.baseUrl);
    credentialUrl.searchParams.set('request_id', requestId);
    res.redirect(302, credentialUrl.href);
  }

  async completeAuthorization(requestId: string, rawKeys: ProviderKeys): Promise<string> {
    const pending = this.pendingAuthorizations.get(requestId);
    if (!pending) {
      throw invalidRequest('Authorization request expired or was not found');
    }

    const keys = normalizeProviderKeys(rawKeys);
    if (Object.keys(keys).length === 0) {
      throw invalidRequest('Provide at least one provider API key');
    }

    this.pendingAuthorizations.delete(requestId);
    const code = randomUUID();
    this.authorizationCodes.set(
      code,
      {
        clientId: pending.client.client_id,
        redirectUri: pending.params.redirectUri,
        codeChallenge: pending.params.codeChallenge,
        scopes: grantedScopes(pending.params.scopes),
        resource: pending.params.resource?.href,
        state: pending.params.state,
        keys,
      },
      this.now() + this.authorizationTtlMs,
    );

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
    const codeRecord = this.authorizationCodes.get(authorizationCode);
    if (!codeRecord || codeRecord.clientId !== client.client_id) {
      throw invalidGrant('Invalid authorization code');
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
    const codeRecord = this.authorizationCodes.get(authorizationCode);
    if (!codeRecord) {
      throw invalidGrant('Invalid authorization code');
    }

    if (codeRecord.clientId !== client.client_id) {
      throw invalidGrant('Authorization code was issued to a different client');
    }
    if (redirectUri !== undefined && redirectUri !== codeRecord.redirectUri) {
      throw invalidGrant('redirect_uri does not match the authorization request');
    }
    if (resource !== undefined && codeRecord.resource !== undefined && resource.href !== codeRecord.resource) {
      throw invalidGrant('resource does not match the authorization request');
    }

    this.authorizationCodes.delete(authorizationCode);
    return this.issueTokens(codeRecord, this.refreshExpiry(client, this.nowSeconds() + this.refreshTokenTtlSeconds));
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const payload = this.verifySealedToken(refreshToken, 'refresh');
    if (payload.clientId !== client.client_id) {
      throw invalidGrant('Refresh token was issued to a different client');
    }
    if (resource !== undefined && payload.resource !== undefined && resource.href !== payload.resource) {
      throw invalidGrant('resource does not match the refresh token');
    }

    // Tokens issued before scopes were enforced may carry none; they were granted the default one.
    const grantedByToken = grantedScopes(payload.scopes);
    const requestedScopes = scopes?.length ? scopes : grantedByToken;
    const unauthorizedScope = requestedScopes.find(scope => !grantedByToken.includes(scope));
    if (unauthorizedScope) {
      throw invalidGrant(`Refresh token was not granted scope ${unauthorizedScope}`);
    }

    // The new refresh token keeps the original expiry: refreshing renews the access token, never
    // the grant, so a chain of refreshed tokens still ends when the first refresh token would have.
    return this.issueTokens({ ...payload, scopes: requestedScopes }, this.refreshExpiry(client, payload.exp));
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const payload = this.verifySealedToken(token, 'access');
    return {
      token,
      clientId: payload.clientId,
      scopes: grantedScopes(payload.scopes),
      expiresAt: payload.exp,
      resource: payload.resource ? new URL(payload.resource) : undefined,
      extra: {
        providerKeys: payload.keys,
      },
    };
  }

  /**
   * Best-effort: the token id is remembered in this instance's memory until the token would have
   * expired, so a restart, another instance, or a full revocation list forgets it. Rotating the
   * token secret is the revocation that always holds.
   */
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    try {
      const payload = this.unsealToken(request.token);
      // RFC 7009: only the client a token was issued to may revoke it.
      if (payload.clientId === client.client_id) {
        this.revokedIds(payload.kind).set(payload.jti, true, payload.exp * 1000);
      }
    } catch {
      // RFC 7009 treats unknown tokens as successfully revoked.
    }
  }

  private revokedIds(kind: TokenKind): ExpiringMap<true> {
    return kind === 'access' ? this.revokedAccessTokenIds : this.revokedRefreshTokenIds;
  }

  private nowSeconds(): number {
    return Math.floor(this.now() / 1000);
  }

  /**
   * The refresh token's expiry, clamped to the client registration's: a token never outlives its
   * client, or a valid token would fail refresh with invalid_client. The registration is read
   * again here, at issuance, because it can expire between the client authenticating and the
   * tokens being issued; one that can no longer be validated gets no tokens.
   */
  private refreshExpiry(client: OAuthClientInformationFull, refreshExp: number): number {
    const clientExp = this.clientsStore.expiresAt(client.client_id);
    if (clientExp === undefined) {
      throw invalidGrant('Client registration is no longer valid');
    }
    return Math.min(refreshExp, clientExp);
  }

  /** An access token that lives at most the access TTL, and a refresh token that ends at `refreshExp`. */
  private issueTokens(grant: TokenGrant, refreshExp: number): OAuthTokens {
    const issuedAt = this.nowSeconds();
    const accessExp = Math.min(issuedAt + this.accessTokenTtlSeconds, refreshExp);
    const sealFor = (kind: TokenKind, exp: number) =>
      this.sealToken({
        version: 1,
        kind,
        jti: randomUUID(),
        clientId: grant.clientId,
        scopes: grant.scopes,
        keys: grant.keys,
        resource: grant.resource,
        iat: issuedAt,
        exp,
      });

    return {
      access_token: sealFor('access', accessExp),
      token_type: 'bearer',
      expires_in: accessExp - issuedAt,
      refresh_token: sealFor('refresh', refreshExp),
      scope: grant.scopes.join(' '),
    };
  }

  private verifySealedToken(token: string, expectedKind: TokenKind): SealedTokenPayload {
    let payload: SealedTokenPayload;
    try {
      payload = this.unsealToken(token);
    } catch {
      throw invalidToken(`Invalid ${expectedKind} token`);
    }

    if (payload.kind !== expectedKind) {
      throw invalidToken(`Invalid ${expectedKind} token`);
    }
    if (this.revokedIds(payload.kind).has(payload.jti)) {
      throw invalidToken('Token has been revoked');
    }
    // An access token also lives at most the current access TTL from when it was issued, so
    // tokens minted under a longer TTL stop being accepted once the TTL is shortened.
    const exp = expectedKind === 'access' ? Math.min(payload.exp, payload.iat + this.accessTokenTtlSeconds) : payload.exp;
    if (exp < this.nowSeconds()) {
      throw invalidToken('Token has expired');
    }

    return { ...payload, exp };
  }

  private sealToken(payload: SealedTokenPayload): string {
    return this.keyRing.seal(TOKEN_PREFIX, TOKEN_AAD, JSON.stringify(payload));
  }

  private unsealToken(token: string): SealedTokenPayload {
    const payload = JSON.parse(this.keyRing.open(TOKEN_PREFIX, TOKEN_AAD, token).plaintext) as unknown;
    if (!isSealedTokenPayload(payload)) {
      throw new Error('Invalid token payload');
    }
    return payload;
  }
}

function boundedTtl(name: string, value: number | undefined, fallback: number, max: number): number {
  const ttl = value ?? fallback;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > max) {
    throw new Error(`${name} must be a whole number of seconds from 1 to ${max}`);
  }
  return ttl;
}

/** The scopes a request is granted: those it asked for, or the default scope when it asked for none. */
function grantedScopes(requested: string[] | undefined): string[] {
  return requested?.length ? requested : [DEFAULT_CLIENT_SCOPE];
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

export function getOAuthPublicBaseUrl(port: number, env: NodeJS.ProcessEnv = process.env): URL {
  const configured = env.MCP_PUBLIC_BASE_URL || env.PUBLIC_URL;
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

const AUTHORIZATION_STYLE = `
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
`;

const AUTHORIZATION_SCRIPT = `
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
`;

const cspHash = (source: string) => `'sha256-${createHash('sha256').update(source).digest('base64')}'`;

/**
 * The policy for the credential page: nothing loads except its own inline style and script,
 * named by hash (both are fixed text), and no page may frame it. `form-action` is left out on
 * purpose: Chrome applies it to the redirect after the form posts, and that redirect goes to the
 * client's own callback, which is not a fixed origin.
 */
export const AUTHORIZATION_PAGE_CSP = [
  "default-src 'none'",
  `style-src ${cspHash(AUTHORIZATION_STYLE)}`,
  `script-src ${cspHash(AUTHORIZATION_SCRIPT)}`,
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

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
  <style>${AUTHORIZATION_STYLE}</style>
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
    <script>${AUTHORIZATION_SCRIPT}</script>
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
