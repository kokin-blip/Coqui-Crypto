import type { HttpClient } from '../http/index.js';
import { referenceFailure, referenceRecord, type ReferenceResult } from './common.js';

/** Host the DefiLlama yields API is served from. */
export const YIELDS_HOST = 'yields.llama.fi';

const YIELDS_URL = `https://${YIELDS_HOST}/pools`;

/**
 * Only single-asset pools above a TVL floor are considered. LP pairs and thin
 * pools produce headline APYs that do not survive contact with liquidity, and
 * this surface is read by a human deciding where to park an asset.
 */
const MIN_TVL_USD = 1_000_000;
const SINGLE_ASSET = /^[A-Z0-9]{1,32}$/u;
const MAX_POOLS = 50_000;

/** The best single-asset earn opportunity found for one token. */
export interface AssetYield {
  /** Token symbol, upper-case. */
  readonly symbol: string;
  /** Best APY found, in percent. */
  readonly apyPct: number;
  /** Protocol offering it, e.g. "kamino-lend". */
  readonly project: string;
  /** Chain it is offered on. */
  readonly chain: string;
  /** Pool TVL in USD — a liquidity and credibility hint, not a guarantee. */
  readonly tvlUsd: number;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128
    ? value.trim()
    : fallback;
}

function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Map of token symbol to its highest-APY single-asset pool.
 *
 * Ported from the predecessor's `src/core/market/yields.ts`. The selection
 * rules (single-asset symbols only, TVL floor, best APY wins) are preserved
 * exactly; only the failure contract changed — see `./common.ts`.
 */
export async function fetchYields(
  http: HttpClient,
  signal?: AbortSignal,
): Promise<ReferenceResult<ReadonlyMap<string, AssetYield>>> {
  const response = await http.getJson<unknown>(YIELDS_URL, signal ? { signal } : undefined);
  if (!response.ok) return { ok: false, code: referenceFailure(response) };

  const body = referenceRecord(response.data);
  const pools = body === null ? null : body['data'];
  if (!Array.isArray(pools)) return { ok: false, code: 'invalid_response' };
  if (pools.length > MAX_POOLS) return { ok: false, code: 'response_too_large' };

  const best = new Map<string, AssetYield>();
  for (const candidate of pools) {
    const pool = referenceRecord(candidate);
    if (pool === null) continue;
    const rawSymbol = pool['symbol'];
    const symbol = typeof rawSymbol === 'string' ? rawSymbol.trim().toUpperCase() : '';
    const apyPct = positive(pool['apy']);
    const tvlUsd = positive(pool['tvlUsd']);
    if (!SINGLE_ASSET.test(symbol) || apyPct <= 0 || tvlUsd < MIN_TVL_USD) continue;

    const current = best.get(symbol);
    if (current !== undefined && current.apyPct >= apyPct) continue;
    best.set(symbol, {
      symbol,
      apyPct,
      project: text(pool['project'], 'unknown'),
      chain: text(pool['chain'], 'unknown'),
      tvlUsd,
    });
  }

  // DefiLlama's pool feed carries no publication timestamp, so observation time
  // is the moment of retrieval and the service records it as such.
  return { ok: true, value: best, observedAtMs: null };
}
