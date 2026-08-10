import type { CoinbaseCredentials } from '../coinbase/auth.js';

export const SECRET_STORE_SERVICE = 'kokincrypto';
export const MAIN_WALLET_ID = 'main';
export const MAX_SECRET_BYTES = 64 * 1_024;

export type SecretKey =
  | 'coinbase-credentials'
  | 'coingecko-api-key'
  | 'coinmarketcap-api-key';

export type SecretStoreErrorCode =
  | 'unavailable'
  | 'invalid_value'
  | 'corrupt';

export interface SecretStoreFailure {
  ok: false;
  code: SecretStoreErrorCode;
  /** Stable, secret-safe text. Backend error messages never cross this boundary. */
  message: string;
}

export type SecretReadResult =
  | { ok: true; value: string | null }
  | SecretStoreFailure;

export type SecretMutationResult =
  | { ok: true }
  | SecretStoreFailure;

export interface SecretStore {
  read(key: SecretKey, walletId?: string | null): Promise<SecretReadResult>;
  write(
    key: SecretKey,
    value: string,
    walletId?: string | null,
  ): Promise<SecretMutationResult>;
  remove(key: SecretKey, walletId?: string | null): Promise<SecretMutationResult>;
}

export interface SecretBackend {
  get(account: string): Promise<string | null>;
  set(account: string, value: string): Promise<void>;
  delete(account: string): Promise<void>;
}

export interface KeyringModuleLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, value: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export type KeyringModuleLoader = () => Promise<KeyringModuleLike>;

function unavailable(): SecretStoreFailure {
  return {
    ok: false,
    code: 'unavailable',
    message: 'Secure credential storage is unavailable.',
  };
}

function invalidValue(): SecretStoreFailure {
  return {
    ok: false,
    code: 'invalid_value',
    message: 'The secret value is invalid.',
  };
}

function normalizeWalletId(walletId: string | null | undefined): string {
  if (walletId === null || walletId === undefined || walletId === MAIN_WALLET_ID) {
    return MAIN_WALLET_ID;
  }
  const normalized = walletId.trim();
  const hasControl = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (
    normalized.length === 0 ||
    normalized.length > 256 ||
    normalized.includes(':') ||
    hasControl
  ) {
    throw new TypeError('Invalid wallet scope');
  }
  return normalized;
}

/** Preserve the predecessor's exact generic-password account identifiers. */
export function secretAccountForScope(
  walletId: string | null | undefined,
  key: SecretKey,
): string {
  if (key === 'coingecko-api-key' || key === 'coinmarketcap-api-key') return key;
  const scope = normalizeWalletId(walletId);
  return scope === MAIN_WALLET_ID ? key : `${key}:${scope}`;
}

function validSecret(value: string): boolean {
  return value.length > 0 && Buffer.byteLength(value, 'utf8') <= MAX_SECRET_BYTES;
}

/**
 * Add scoped caching and a non-throwing, secret-safe result boundary around an
 * OS or test backend. Successful, missing, and failed reads are cached.
 */
export function createCachedSecretStore(backend: SecretBackend): SecretStore {
  const reads = new Map<string, SecretReadResult>();
  const inflight = new Map<string, Promise<SecretReadResult>>();

  function account(
    key: SecretKey,
    walletId: string | null | undefined,
  ): string | SecretStoreFailure {
    try {
      return secretAccountForScope(walletId, key);
    } catch {
      return invalidValue();
    }
  }

  return {
    async read(key, walletId) {
      const resolved = account(key, walletId);
      if (typeof resolved !== 'string') return resolved;
      const cached = reads.get(resolved);
      if (cached !== undefined) return cached;
      const pending = inflight.get(resolved);
      if (pending !== undefined) return pending;
      const request = backend.get(resolved).then<SecretReadResult, SecretReadResult>(
        (value) => ({ ok: true, value }),
        () => unavailable(),
      );
      inflight.set(resolved, request);
      void request.then((result) => {
        reads.set(resolved, result);
        inflight.delete(resolved);
      });
      return request;
    },
    async write(key, value, walletId) {
      if (!validSecret(value)) return invalidValue();
      const resolved = account(key, walletId);
      if (typeof resolved !== 'string') return resolved;
      try {
        await backend.set(resolved, value);
        reads.set(resolved, { ok: true, value });
        inflight.delete(resolved);
        return { ok: true };
      } catch {
        return unavailable();
      }
    },
    async remove(key, walletId) {
      const resolved = account(key, walletId);
      if (typeof resolved !== 'string') return resolved;
      try {
        await backend.delete(resolved);
        reads.delete(resolved);
        inflight.delete(resolved);
        return { ok: true };
      } catch {
        return unavailable();
      }
    },
  };
}

async function loadKeyring(): Promise<KeyringModuleLike> {
  return await import('@napi-rs/keyring/keytar.js');
}

/**
 * Production store backed by the user's native credential manager. The module
 * is loaded lazily so startup and non-secret tests never initialize a keyring.
 */
export function createOsKeyringSecretStore(
  loader: KeyringModuleLoader = loadKeyring,
): SecretStore {
  let module: Promise<KeyringModuleLike> | undefined;
  const keyring = () => {
    module ??= loader();
    return module;
  };
  return createCachedSecretStore({
    async get(account) {
      return await (await keyring()).getPassword(SECRET_STORE_SERVICE, account);
    },
    async set(account, value) {
      await (await keyring()).setPassword(SECRET_STORE_SERVICE, account, value);
    },
    async delete(account) {
      await (await keyring()).deletePassword(SECRET_STORE_SERVICE, account);
    },
  });
}

/** In-memory test store. It never touches disk or an OS credential manager. */
export function createMemorySecretStore(
  seed: Readonly<Record<string, string>> = {},
): SecretStore {
  const values = new Map(Object.entries(seed));
  return createCachedSecretStore({
    get: async (account) => values.get(account) ?? null,
    set: async (account, value) => {
      values.set(account, value);
    },
    delete: async (account) => {
      values.delete(account);
    },
  });
}

export function serializeCoinbaseCredentials(
  credentials: CoinbaseCredentials,
): string {
  return JSON.stringify(credentials);
}

export function parseStoredCoinbaseCredentials(
  value: string,
): CoinbaseCredentials | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed['keyName'] !== 'string' ||
      parsed['keyName'].trim().length === 0 ||
      typeof parsed['privateKey'] !== 'string' ||
      parsed['privateKey'].trim().length === 0
    ) return null;
    return {
      keyName: parsed['keyName'],
      privateKey: parsed['privateKey'],
    };
  } catch {
    return null;
  }
}

export type StoredCoinbaseCredentialsResult =
  | { ok: true; credentials: CoinbaseCredentials | null }
  | SecretStoreFailure;

/** Read and parse credentials without exposing malformed stored material. */
export async function readStoredCoinbaseCredentials(
  store: SecretStore,
  walletId?: string | null,
): Promise<StoredCoinbaseCredentialsResult> {
  const result = await store.read('coinbase-credentials', walletId);
  if (!result.ok) return result;
  if (result.value === null) return { ok: true, credentials: null };
  const credentials = parseStoredCoinbaseCredentials(result.value);
  return credentials === null
    ? {
        ok: false,
        code: 'corrupt',
        message: 'Stored Coinbase credentials are invalid.',
      }
    : { ok: true, credentials };
}
