import {
  createPrivateKey,
  createSign,
  randomBytes,
  type KeyObject,
} from 'node:crypto';

import {
  createHttpClient,
  type HttpClientOptions,
  type HttpResult,
} from '../http/index.js';

export const COINBASE_API_HOST = 'api.coinbase.com';
export const COINBASE_TIME_URL =
  `https://${COINBASE_API_HOST}/api/v3/brokerage/time`;
export const MAX_COINBASE_KEY_FILE_BYTES = 64 * 1_024;

export interface CoinbaseCredentials {
  keyName: string;
  privateKey: string;
}

export type CoinbaseKeyAlgorithm = 'EdDSA' | 'ES256';
export type CoinbaseKeyFormat =
  | 'ed25519-raw-32'
  | 'ed25519-raw-64'
  | 'ed25519-pkcs8-pem'
  | 'ecdsa-sec1-pem'
  | 'ecdsa-pkcs8-pem';

export interface ParsedCoinbasePrivateKey {
  key: KeyObject;
  algorithm: CoinbaseKeyAlgorithm;
  format: CoinbaseKeyFormat;
  canonical: string;
}

export type CoinbaseCredentialValidation =
  | {
      ok: true;
      credentials: CoinbaseCredentials;
      algorithm: 'ES256';
      keyFormat: 'ecdsa-sec1-pem' | 'ecdsa-pkcs8-pem';
    }
  | {
      ok: false;
      code: 'invalid_key_name' | 'invalid_private_key' | 'unsupported_algorithm';
      error: string;
    };

export type CoinbaseKeyFileParseResult =
  | { ok: true; credentials: CoinbaseCredentials }
  | { ok: false; error: string };

export interface CoinbaseClockResult {
  offsetMs: number | null;
  httpStatus: number | null;
  traceId: string | null;
}

export interface CoinbaseReadHttpClient {
  getJson<T>(url: string, init?: RequestInit): Promise<HttpResult<T>>;
  destroy(): void;
}

export type CoinbaseReadHttpClientOptions = Omit<
  HttpClientOptions,
  'prepareAttempt'
> & {
  nowMs?: () => number;
  nonce?: () => string;
};

const ED25519_PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);

type PrivateKeyErrorKind =
  | 'invalid_base64'
  | 'unexpected_length'
  | 'malformed_pem'
  | 'unsupported_key_type'
  | 'unsupported_curve';

class PrivateKeyError extends Error {
  constructor(readonly kind: PrivateKeyErrorKind) {
    super(kind);
  }
}

function removeMatchingQuotes(value: string): string {
  const first = value.at(0);
  const last = value.at(-1);
  return value.length >= 2 && (first === '"' || first === "'") && last === first
    ? value.slice(1, -1).trim()
    : value;
}

function normalizeKeyName(input: string): string | null {
  const keyName = removeMatchingQuotes(input.trim());
  const hasControl = [...keyName].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (
    keyName.length === 0 ||
    keyName.length > 512 ||
    hasControl ||
    keyName.startsWith('{') ||
    keyName.startsWith('[') ||
    keyName.includes('-----BEGIN')
  ) return null;
  return keyName;
}

function normalizePrivateKey(input: string): string {
  const unquoted = removeMatchingQuotes(input.trim());
  return unquoted.includes('BEGIN') || unquoted.includes('END')
    ? unquoted.replace(/(?:\\r\\n|\\n)/g, '\n').replace(/\r\n/g, '\n').trim()
    : unquoted;
}

function decodeEd25519Secret(value: string): Buffer {
  const compact = value.replace(/\s/g, '');
  const standard = compact.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(standard) || standard.length % 4 === 1) {
    throw new PrivateKeyError('invalid_base64');
  }
  const decoded = Buffer.from(standard, 'base64');
  const supplied = standard.replace(/=+$/, '');
  if (decoded.toString('base64').replace(/=+$/, '') !== supplied) {
    throw new PrivateKeyError('invalid_base64');
  }
  if (decoded.length !== 32 && decoded.length !== 64) {
    throw new PrivateKeyError('unexpected_length');
  }
  return decoded;
}

function ed25519KeyFromSeed(seed: Buffer): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** Parse the key format without creating a throwaway signature. */
export function parseCoinbasePrivateKey(input: string): ParsedCoinbasePrivateKey {
  const canonical = normalizePrivateKey(input);
  if (canonical.length === 0) throw new PrivateKeyError('invalid_base64');

  if (canonical.includes('BEGIN') || canonical.includes('END')) {
    let key: KeyObject;
    try {
      key = createPrivateKey(canonical);
    } catch {
      throw new PrivateKeyError('malformed_pem');
    }
    if (key.asymmetricKeyType === 'ed25519') {
      if (!canonical.includes('BEGIN PRIVATE KEY')) {
        throw new PrivateKeyError('unsupported_key_type');
      }
      return { key, algorithm: 'EdDSA', format: 'ed25519-pkcs8-pem', canonical };
    }
    if (key.asymmetricKeyType !== 'ec') {
      throw new PrivateKeyError('unsupported_key_type');
    }
    const curve = key.asymmetricKeyDetails?.namedCurve;
    if (curve !== 'prime256v1' && curve !== 'P-256') {
      throw new PrivateKeyError('unsupported_curve');
    }
    return {
      key,
      algorithm: 'ES256',
      format: canonical.includes('BEGIN EC PRIVATE KEY')
        ? 'ecdsa-sec1-pem'
        : 'ecdsa-pkcs8-pem',
      canonical,
    };
  }

  const raw = decodeEd25519Secret(canonical);
  return {
    key: ed25519KeyFromSeed(raw.subarray(0, 32)),
    algorithm: 'EdDSA',
    format: raw.length === 32 ? 'ed25519-raw-32' : 'ed25519-raw-64',
    canonical: raw.toString('base64'),
  };
}

function privateKeyMessage(error: unknown): string {
  if (!(error instanceof PrivateKeyError)) {
    return 'Coinbase private key could not be loaded.';
  }
  switch (error.kind) {
    case 'invalid_base64':
      return 'Coinbase private key is not valid base64 or PEM.';
    case 'unexpected_length':
      return 'Coinbase Ed25519 private key has an unsupported decoded length.';
    case 'malformed_pem':
      return 'Coinbase PEM private key is incomplete or malformed.';
    case 'unsupported_key_type':
      return 'Coinbase private key type is unsupported.';
    case 'unsupported_curve':
      return 'Coinbase EC private key must use the P-256 curve.';
  }
}

/** Validate and canonicalize credentials without signing a probe payload. */
export function validateCoinbaseCredentials(
  credentials: CoinbaseCredentials,
): CoinbaseCredentialValidation {
  const keyName = normalizeKeyName(credentials.keyName);
  if (keyName === null) {
    return {
      ok: false,
      code: 'invalid_key_name',
      error: 'Enter one Coinbase API key identifier, not a key file or private key.',
    };
  }
  try {
    const parsed = parseCoinbasePrivateKey(credentials.privateKey);
    if (parsed.algorithm !== 'ES256') {
      return {
        ok: false,
        code: 'unsupported_algorithm',
        error: 'Coinbase App requires an ECDSA P-256 key; create a View-only ECDSA key.',
      };
    }
    if (parsed.format !== 'ecdsa-sec1-pem' && parsed.format !== 'ecdsa-pkcs8-pem') {
      return {
        ok: false,
        code: 'invalid_private_key',
        error: 'Coinbase ECDSA private key format is invalid.',
      };
    }
    return {
      ok: true,
      credentials: { keyName, privateKey: parsed.canonical },
      algorithm: 'ES256',
      keyFormat: parsed.format,
    };
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_private_key',
      error: privateKeyMessage(error),
    };
  }
}

/** Parse the `name` and `privateKey` values from a downloaded Coinbase key file. */
export function parseCoinbaseKeyFileJson(input: string): CoinbaseKeyFileParseResult {
  if (input.trim().length === 0) return { ok: false, error: 'The Coinbase key file is empty.' };
  if (Buffer.byteLength(input, 'utf8') > MAX_COINBASE_KEY_FILE_BYTES) {
    return { ok: false, error: 'The Coinbase key file is too large.' };
  }
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return { ok: false, error: 'The Coinbase key file is not valid JSON.' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'The Coinbase key file must contain one JSON object.' };
  }
  const record = value as Record<string, unknown>;
  if (typeof record['name'] !== 'string' || record['name'].trim().length === 0) {
    return { ok: false, error: 'The Coinbase key file is missing its name value.' };
  }
  if (
    typeof record['privateKey'] !== 'string' ||
    record['privateKey'].trim().length === 0
  ) {
    return { ok: false, error: 'The Coinbase key file is missing its privateKey value.' };
  }
  return {
    ok: true,
    credentials: {
      keyName: record['name'].trim(),
      privateKey: record['privateKey'].trim(),
    },
  };
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signJwt(
  parsed: ParsedCoinbasePrivateKey,
  keyName: string,
  method: 'GET',
  path: string,
  nowMs: number,
  nonce: string,
): string {
  if (parsed.algorithm !== 'ES256') {
    throw new TypeError('Coinbase App JWT signing requires an ECDSA P-256 key');
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new RangeError('Coinbase JWT time must be a non-negative epoch millisecond');
  }
  const nowSeconds = Math.floor(nowMs / 1_000);
  const header = { alg: 'ES256', typ: 'JWT', kid: keyName, nonce };
  const payload = {
    sub: keyName,
    iss: 'cdp',
    nbf: nowSeconds,
    exp: nowSeconds + 120,
    uri: `${method} ${COINBASE_API_HOST}${path}`,
  };
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = createSign('SHA256')
    .update(signingInput)
    .sign({ key: parsed.key, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${signingInput}.${signature}`;
}

/** Build the request-bound, two-minute Coinbase App JWT. */
export function buildCoinbaseJwt(
  credentials: CoinbaseCredentials,
  path: string,
  nowMs: number,
  nonce = randomBytes(16).toString('hex'),
): string {
  return signJwt(
    parseCoinbasePrivateKey(credentials.privateKey),
    credentials.keyName,
    'GET',
    path.split('?')[0]!,
    nowMs,
    nonce,
  );
}

/** Create a GET-only authenticated client; a fresh JWT is built for every retry. */
export function createCoinbaseReadHttpClient(
  credentials: CoinbaseCredentials,
  options: CoinbaseReadHttpClientOptions = {},
): CoinbaseReadHttpClient {
  const parsed = parseCoinbasePrivateKey(credentials.privateKey);
  if (parsed.algorithm !== 'ES256') {
    throw new TypeError('Coinbase App requires an ECDSA P-256 key');
  }
  const { nowMs = Date.now, nonce = () => randomBytes(16).toString('hex'), ...httpOptions } = options;
  const client = createHttpClient({
    ...httpOptions,
    prepareAttempt(url, init) {
      const parsedUrl = new URL(url);
      const method = (init.method ?? 'GET').toUpperCase();
      if (
        parsedUrl.protocol !== 'https:' ||
        parsedUrl.hostname !== COINBASE_API_HOST ||
        parsedUrl.port.length > 0 ||
        parsedUrl.username.length > 0 ||
        parsedUrl.password.length > 0 ||
        parsedUrl.hash.length > 0 ||
        method !== 'GET'
      ) {
        throw new TypeError('Authenticated Coinbase requests must be HTTPS GETs to api.coinbase.com');
      }
      const jwt = signJwt(
        parsed,
        credentials.keyName,
        'GET',
        parsedUrl.pathname,
        nowMs(),
        nonce(),
      );
      const headers = new Headers(init.headers);
      headers.set('authorization', `Bearer ${jwt}`);
      return { ...init, method: 'GET', headers };
    },
  });
  return { getJson: client.getJson, destroy: client.destroy };
}

/** Measure Coinbase clock skew from the midpoint of a public-time request. */
export async function fetchCoinbaseClockOffset(
  http: Pick<CoinbaseReadHttpClient, 'getJson'>,
  nowMs: () => number,
): Promise<CoinbaseClockResult> {
  const startedAt = nowMs();
  const result = await http.getJson<unknown>(COINBASE_TIME_URL);
  const endedAt = nowMs();
  if (!result.ok) {
    return {
      offsetMs: null,
      httpStatus: result.status || null,
      traceId: result.traceId ?? null,
    };
  }
  const data = typeof result.data === 'object' && result.data !== null
    ? result.data as Record<string, unknown>
    : {};
  const rawMilliseconds = data['epochMillis'];
  const rawSeconds = data['epochSeconds'];
  const epochMilliseconds = typeof rawMilliseconds === 'number' ||
    (typeof rawMilliseconds === 'string' && rawMilliseconds.trim().length > 0)
    ? Number(rawMilliseconds)
    : Number.NaN;
  const epochSeconds = typeof rawSeconds === 'number' ||
    (typeof rawSeconds === 'string' && rawSeconds.trim().length > 0)
    ? Number(rawSeconds)
    : Number.NaN;
  const serverMs = Number.isFinite(epochMilliseconds)
    ? epochMilliseconds
    : Number.isFinite(epochSeconds) ? epochSeconds * 1_000 : Number.NaN;
  return {
    offsetMs: Number.isFinite(serverMs)
      ? Math.round(serverMs - (startedAt + endedAt) / 2)
      : null,
    httpStatus: result.status,
    traceId: null,
  };
}
