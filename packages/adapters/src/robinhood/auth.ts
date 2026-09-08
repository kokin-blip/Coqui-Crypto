import { createPrivateKey, sign } from 'node:crypto';

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const API_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{7,255}$/u;
const PATH = /^\/api\/v[12]\/crypto\/(?:trading|marketdata)\/[A-Za-z0-9_/?=&.,:{}%+-]*$/u;

export interface RobinhoodCryptoCredentials {
  readonly apiKey: string;
  readonly privateKeyBase64: string;
}

export type RobinhoodCredentialParseResult =
  | { readonly ok: true; readonly credentials: RobinhoodCryptoCredentials }
  | { readonly ok: false; readonly code: 'invalid_json' | 'invalid_api_key' | 'invalid_private_key' };

function decodeSeed(value: string): Buffer | null {
  const normalized = value.trim().replace(/-/gu, '+').replace(/_/gu, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized) || normalized.length % 4 === 1) return null;
  const decoded = Buffer.from(normalized, 'base64');
  if (![32, 64].includes(decoded.length) ||
      decoded.toString('base64').replace(/=+$/u, '') !== normalized.replace(/=+$/u, '')) return null;
  return decoded.subarray(0, 32);
}

export function parseRobinhoodCryptoCredentialsJson(contents: string): RobinhoodCredentialParseResult {
  let value: unknown;
  try { value = JSON.parse(contents); } catch { return { ok: false, code: 'invalid_json' }; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, code: 'invalid_json' };
  const record = value as Record<string, unknown>;
  const apiKey = record['apiKey'] ?? record['api_key'];
  const privateKey = record['privateKeyBase64'] ?? record['private_key_base64'] ?? record['privateKey'];
  if (typeof apiKey !== 'string' || !API_KEY.test(apiKey.trim())) return { ok: false, code: 'invalid_api_key' };
  if (typeof privateKey !== 'string' || decodeSeed(privateKey) === null) return { ok: false, code: 'invalid_private_key' };
  return { ok: true, credentials: Object.freeze({ apiKey: apiKey.trim(), privateKeyBase64: privateKey.trim() }) };
}

export function serializeRobinhoodCryptoCredentials(credentials: RobinhoodCryptoCredentials): string {
  if (!API_KEY.test(credentials.apiKey) || decodeSeed(credentials.privateKeyBase64) === null) {
    throw new TypeError('Invalid Robinhood Crypto credentials.');
  }
  return JSON.stringify(credentials);
}

export function parseStoredRobinhoodCryptoCredentials(value: string): RobinhoodCryptoCredentials | null {
  const parsed = parseRobinhoodCryptoCredentialsJson(value);
  return parsed.ok ? parsed.credentials : null;
}

/** Sign the exact official message: api key + Unix timestamp + path + method + body. */
export function robinhoodCryptoSignature(
  credentials: RobinhoodCryptoCredentials,
  timestampSeconds: number,
  path: string,
  method = 'GET',
  body = '',
): string {
  const seed = decodeSeed(credentials.privateKeyBase64);
  if (seed === null || !API_KEY.test(credentials.apiKey) || !Number.isSafeInteger(timestampSeconds) ||
      timestampSeconds < 0 || !PATH.test(path) || !['GET', 'POST'].includes(method)) {
    throw new TypeError('Invalid Robinhood Crypto signing input.');
  }
  const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  return sign(null, Buffer.from(`${credentials.apiKey}${timestampSeconds}${path}${method}${body}`, 'utf8'), key).toString('base64');
}

export function robinhoodCryptoHeaders(
  credentials: RobinhoodCryptoCredentials,
  timestampSeconds: number,
  path: string,
): Readonly<Record<string, string>> {
  return Object.freeze({
    'content-type': 'application/json; charset=utf-8',
    'x-api-key': credentials.apiKey,
    'x-timestamp': String(timestampSeconds),
    'x-signature': robinhoodCryptoSignature(credentials, timestampSeconds, path),
  });
}
