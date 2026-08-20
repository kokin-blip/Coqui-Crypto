import type { HttpClient } from '../http/index.js';
import { COINGECKO_PUBLIC_ROOT } from '../coingecko/public.js';
import { referenceFailure, referenceRecord, type ReferenceResult } from './common.js';

const TRENDING_URL = `${COINGECKO_PUBLIC_ROOT}/search/trending`;
const MAX_ENTRIES = 100;
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,31}$/u;

/**
 * One entry from CoinGecko's trending-search list.
 *
 * Ported from the predecessor's `src/core/market/markets.ts`. This ranks what
 * people are *searching for*, not what is performing. It is informational only
 * and the service layer marks it non-signal; treating search interest as a
 * trading input is exactly the behaviour the evidence gate exists to prevent.
 */
export interface TrendingCoin {
  readonly coingeckoId: string;
  readonly symbol: string;
  readonly name: string;
  readonly marketCapRank: number | null;
  readonly thumbnailUrl: string | null;
}

function rank(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function httpsUrl(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('https://') && value.length <= 512
    ? value
    : null;
}

export async function fetchTrendingCoins(
  http: HttpClient,
  signal?: AbortSignal,
): Promise<ReferenceResult<readonly TrendingCoin[]>> {
  const response = await http.getJson<unknown>(TRENDING_URL, signal ? { signal } : undefined);
  if (!response.ok) return { ok: false, code: referenceFailure(response) };

  const body = referenceRecord(response.data);
  const coins = body === null ? null : body['coins'];
  if (!Array.isArray(coins)) return { ok: false, code: 'invalid_response' };
  if (coins.length > MAX_ENTRIES) return { ok: false, code: 'response_too_large' };

  const trending: TrendingCoin[] = [];
  const seen = new Set<string>();
  for (const candidate of coins) {
    const wrapper = referenceRecord(candidate);
    const item = wrapper === null ? null : referenceRecord(wrapper['item']);
    if (item === null) continue;

    const id = item['id'];
    const rawSymbol = item['symbol'];
    const name = item['name'];
    if (typeof id !== 'string' || typeof rawSymbol !== 'string' || typeof name !== 'string') {
      continue;
    }
    const coingeckoId = id.trim();
    const symbol = rawSymbol.trim().toUpperCase();
    const trimmedName = name.trim();
    if (coingeckoId.length === 0 || trimmedName.length === 0 || !SYMBOL.test(symbol)) continue;
    if (seen.has(coingeckoId)) continue;
    seen.add(coingeckoId);

    trending.push({
      coingeckoId,
      symbol,
      name: trimmedName,
      marketCapRank: rank(item['market_cap_rank']),
      thumbnailUrl: httpsUrl(item['thumb']),
    });
  }

  // CoinGecko's trending payload carries no publication timestamp.
  return { ok: true, value: trending, observedAtMs: null };
}
