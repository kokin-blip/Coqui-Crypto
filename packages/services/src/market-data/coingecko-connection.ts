import type { Clock } from '@coqui/core';
import type { SecretStore, SecretStoreErrorCode } from '@coqui/adapters';

/**
 * Connect, verify and forget a CoinGecko Demo key.
 *
 * The authenticated adapter and the `coingecko-api-key` secret slot both
 * existed; nothing wrapped them, so the composition root could only ever build
 * an unauthenticated client and the key slot was unreachable.
 *
 * Two properties are load-bearing.
 *
 * **The key never leaves the main process** (invariant 3). This service accepts
 * it, hands it to a verifier, writes it to the OS secret store, and returns a
 * *presence* flag — never the value, never a prefix, never a length. `status`
 * is deliberately shaped so there is nothing secret it could carry.
 *
 * **A key that does not work is not stored.** Verifying before writing means a
 * connected state always means a key that authenticated at least once, so
 * "connected but every request fails" cannot be a state the user has to
 * diagnose.
 */

export type CoinGeckoConnectionIssueCode =
  | 'key_missing'
  | 'key_malformed'
  | 'verification_unauthorized'
  | 'verification_rate_limited'
  | 'verification_network'
  | 'verification_failed'
  | 'secret_store_unavailable'
  | 'secret_store_rejected';

export type CoinGeckoConnectionResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly issues: readonly { readonly code: CoinGeckoConnectionIssueCode }[] };

export interface CoinGeckoConnectionStatus {
  /** Whether a verified key is stored. Never the key, nor anything derived. */
  readonly connected: boolean;
  readonly asOfMs: number;
  /**
   * Which tier the market-data sources will use. `demo` only when a key is
   * present, so a surface cannot claim an authenticated tier it is not on.
   */
  readonly tier: 'public' | 'demo';
}

export type CoinGeckoVerificationResult =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly reasonCode: 'unauthorized' | 'rate_limited' | 'network' | 'failed';
  };

export interface CoinGeckoKeyVerifier {
  verify(apiKey: string, signal?: AbortSignal): Promise<CoinGeckoVerificationResult>;
}

export interface CoinGeckoConnectionDependencies {
  readonly clock: Clock;
  readonly secretStore: SecretStore;
  readonly verifier: CoinGeckoKeyVerifier;
}

/** Demo keys are `CG-` plus an opaque token; anything else never reaches the venue. */
const KEY_SHAPE = /^CG-[A-Za-z0-9]{8,64}$/u;

const VERIFICATION_ISSUES: Readonly<
  Record<Exclude<CoinGeckoVerificationResult, { ok: true }>['reasonCode'], CoinGeckoConnectionIssueCode>
> = Object.freeze({
  unauthorized: 'verification_unauthorized',
  rate_limited: 'verification_rate_limited',
  network: 'verification_network',
  failed: 'verification_failed',
});

function failure(code: CoinGeckoConnectionIssueCode): CoinGeckoConnectionResult<never> {
  return Object.freeze({ ok: false, issues: Object.freeze([Object.freeze({ code })]) });
}

function secretIssue(code: SecretStoreErrorCode): CoinGeckoConnectionResult<never> {
  return failure(code === 'unavailable' ? 'secret_store_unavailable' : 'secret_store_rejected');
}

export class CoinGeckoConnectionService {
  readonly #clock: Clock;
  readonly #secretStore: SecretStore;
  readonly #verifier: CoinGeckoKeyVerifier;

  constructor(dependencies: CoinGeckoConnectionDependencies) {
    this.#clock = dependencies.clock;
    this.#secretStore = dependencies.secretStore;
    this.#verifier = dependencies.verifier;
  }

  /** Presence only. There is no shape of this result that could carry the key. */
  async status(): Promise<CoinGeckoConnectionResult<CoinGeckoConnectionStatus>> {
    const read = await this.#secretStore.read('coingecko-api-key', null);
    if (!read.ok) return secretIssue(read.code);
    const connected = read.value !== null && read.value.length > 0;
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        connected,
        asOfMs: this.#clock.nowMs(),
        tier: connected ? ('demo' as const) : ('public' as const),
      }),
    });
  }

  /**
   * Verify a key, then store it.
   *
   * In that order, always. Storing first and verifying after would leave a
   * broken key in the OS keychain on a failed attempt, and the user would have
   * a "connected" application that cannot fetch anything.
   */
  async connect(
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<CoinGeckoConnectionResult<CoinGeckoConnectionStatus>> {
    const trimmed = apiKey.trim();
    if (trimmed.length === 0) return failure('key_missing');
    // Rejected locally rather than sent: a malformed key would be a request
    // carrying a credential-shaped string to a third party for no reason.
    if (!KEY_SHAPE.test(trimmed)) return failure('key_malformed');

    const verification = await this.#verifier.verify(trimmed, signal);
    if (!verification.ok) return failure(VERIFICATION_ISSUES[verification.reasonCode]);

    const write = await this.#secretStore.write('coingecko-api-key', trimmed, null);
    if (!write.ok) return secretIssue(write.code);

    return Object.freeze({
      ok: true,
      value: Object.freeze({ connected: true, asOfMs: this.#clock.nowMs(), tier: 'demo' as const }),
    });
  }

  /** Remove the key. Removing one that is absent succeeds — the end state is the goal. */
  async disconnect(): Promise<CoinGeckoConnectionResult<CoinGeckoConnectionStatus>> {
    const removed = await this.#secretStore.remove('coingecko-api-key', null);
    if (!removed.ok) return secretIssue(removed.code);
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        connected: false,
        asOfMs: this.#clock.nowMs(),
        tier: 'public' as const,
      }),
    });
  }
}
