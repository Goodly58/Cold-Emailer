/**
 * Encryption for OAuth tokens at rest (register: "Restricted Gmail scopes are a
 * commercialisation time-bomb" — encrypt tokens at rest, minimize the audit
 * surface).
 *
 * AES-256-GCM with a key from `TOKEN_ENCRYPTION_KEY`. In development, with no
 * key set, we derive a stable key from the database path and say so loudly
 * once — the alternative is either refusing to boot (which the founder will
 * work around) or silently storing refresh tokens in plaintext (which is
 * worse).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

let warned = false;

function key(): Buffer {
  const configured = process.env.TOKEN_ENCRYPTION_KEY;
  if (configured) {
    // Accept either 32 raw bytes hex-encoded, or any passphrase.
    if (/^[0-9a-fA-F]{64}$/.test(configured)) return Buffer.from(configured, 'hex');
    return createHash('sha256').update(configured).digest();
  }

  if (process.env.NODE_ENV === 'production') {
    throw new CryptoError(
      'TOKEN_ENCRYPTION_KEY is not set. Generate one with ' +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"` ' +
        'and set it before connecting a real mailbox.'
    );
  }

  if (!warned) {
    warned = true;
    console.warn(
      '[crypto] TOKEN_ENCRYPTION_KEY is not set — using a development-only key. ' +
        'Tokens stored now cannot be read after you set a real key.'
    );
  }
  return createHash('sha256').update(`dev-key:${process.env.DB_PATH ?? 'default'}`).digest();
}

/** iv:ciphertext:tag, all base64. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const enciphered = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, enciphered, cipher.getAuthTag()].map((b) => b.toString('base64')).join(':');
}

export function decrypt(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) throw new CryptoError('stored value is not in the expected format');
  const [iv, enciphered, tag] = parts.map((p) => Buffer.from(p, 'base64'));
  try {
    const decipher = createDecipheriv(ALGORITHM, key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enciphered), decipher.final()]).toString('utf8');
  } catch {
    throw new CryptoError(
      'could not decrypt the stored token — the encryption key has changed since it was saved'
    );
  }
}

/**
 * Stable hash of an email address, for the suppression table. Honouring a
 * removal request must not require keeping the address it came from.
 */
export function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
