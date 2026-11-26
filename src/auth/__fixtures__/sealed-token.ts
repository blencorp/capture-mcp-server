import { createCipheriv, createHash, randomBytes } from 'node:crypto';

export type TokenOverrides = {
  /** The AAD the token is sealed under; the server's is `capture-mcp-oauth-v1`. */
  aad?: string;
  ivBytes?: number;
  /** Bytes of the GCM tag to keep (16 is a full tag). */
  tagBytes?: number;
};

export const PAYLOAD = {
  version: 1,
  kind: 'access',
  jti: '00000000-0000-4000-8000-000000000002',
  clientId: 'crafted-client',
  scopes: ['mcp:tools'],
  keys: { sam: 'crafted-sam-key' },
  iat: 1_700_000_000,
  exp: 4_102_444_800,
};

/** Seals `payload` the way the server does, with knobs to build malformed tokens for tests. */
export function sealToken(secret: string, payload: object = PAYLOAD, overrides: TokenOverrides = {}): string {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(overrides.ivBytes ?? 12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(overrides.aad ?? 'capture-mcp-oauth-v1'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag().subarray(0, overrides.tagBytes ?? 16);
  return ['capmcp.v1', iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.');
}
