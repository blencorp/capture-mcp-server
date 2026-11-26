import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

// AES-GCM envelope: a 96-bit IV and a full 128-bit tag. Node accepts GCM tags down to 4 bytes
// unless the length is fixed, which would let a truncated tag authenticate a forged value.
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Secrets accepted to open values besides the current one: enough for an overlap, few enough to keep opening cheap. */
export const MAX_PREVIOUS_SECRETS = 3;

/**
 * Seals and opens values (tokens, client ids) with AES-256-GCM under a ring of secrets: the
 * current secret seals, and the current and any previous secret open. A sealed value is
 * `<prefix>.<iv>.<ciphertext>.<tag>` in canonical base64url, and `aad` binds it to its purpose so
 * one kind of value can never be presented as another.
 */
export class KeyRing {
  /** The current secret's key first. */
  private readonly keys: Buffer[];

  constructor(secret: string, previousSecrets: string[] = []) {
    const previous = [...new Set(previousSecrets.map(value => value.trim()))].filter(value => value && value !== secret);
    if (previous.length > MAX_PREVIOUS_SECRETS) {
      throw new Error(`At most ${MAX_PREVIOUS_SECRETS} previous token secrets are accepted`);
    }
    this.keys = [secret, ...previous].map(value => createHash('sha256').update(value).digest());
  }

  /** The key that seals new values. */
  get currentKey(): Buffer {
    return this.keys[0]!;
  }

  seal(prefix: string, aad: Buffer, plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.currentKey, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [prefix, iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
  }

  /**
   * Opens a value sealed under any key in the ring. Returns the plaintext and the key that
   * authenticated it, so a caller can derive a secret from the same key (see `deriveSecret`).
   * Throws on a malformed envelope or when no key authenticates it.
   */
  open(prefix: string, aad: Buffer, value: string): { plaintext: string; key: Buffer } {
    const parts = value.split('.');
    if (parts.length !== prefix.split('.').length + 3 || !value.startsWith(`${prefix}.`)) {
      throw new Error('Malformed sealed value');
    }
    const [encodedIv, encodedCiphertext, encodedTag] = parts.slice(-3);
    const iv = decodeBase64Url(encodedIv);
    const ciphertext = decodeBase64Url(encodedCiphertext);
    const tag = decodeBase64Url(encodedTag);
    if (iv?.length !== IV_BYTES || tag?.length !== TAG_BYTES || !ciphertext?.length) {
      throw new Error('Malformed sealed value envelope');
    }

    for (const key of this.keys) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(aad);
        decipher.setAuthTag(tag);
        return { plaintext: Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'), key };
      } catch {
        // Not sealed with this key (or tampered with): try the next one.
      }
    }
    throw new Error('Sealed value could not be authenticated');
  }
}

/** A secret derived from `key` for one purpose and value, so it needs no storage and dies with the key. */
export function deriveSecret(key: Buffer, purpose: string, value: string): string {
  return createHmac('sha256', key).update(`${purpose}\n${value}`).digest('hex');
}

/** Decodes canonical base64url only, so one value has exactly one spelling. */
function decodeBase64Url(value: string | undefined): Buffer | undefined {
  if (!value) return undefined;
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : undefined;
}
