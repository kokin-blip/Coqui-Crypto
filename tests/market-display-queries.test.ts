import { describe, expect, it } from 'vitest';

import type {
  AssetYield,
  FearGreedReading,
  NewsItem,
  PolicyItem,
  ProviderMarketSnapshot,
  ReferenceResult,
  TrendingCoin,
} from '../packages/adapters/src/index.js';
import {
  FixedClock,
  instrumentKey,
  type Clock,
  type InstrumentIdentity,
  type InstrumentKey,
  type MarketBar,
} from '../packages/core/src/index.js';
import {
  MarketDisplayQueryService,
  type CandleSource,
  type ReferenceSources,
} from '../packages/services/src/index.js';

const BTC: InstrumentIdentity = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' };
const BTC_KEY = instrumentKey(BTC);
const NOW = 1_724_000_000_000;

function snapshot(overrides: Partial<ProviderMarketSnapshot> = {}): ProviderMarketSnapshot {
  return {
    provider: 'coingecko',
    providerId: 'bitcoin',
    instrument: BTC,
    priceUsd: '64000.12' as ProviderMarketSnapshot['priceUsd'],
    marketCapUsd: null,
    volume24hUsd: null,
    marketCapRank: 1,
    change24hPct: 1.5,
    providerUpdatedAtMs: null,
    ...overrides,
  };
}

function unavailable<T>(): Promise<ReferenceResult<T>> {
  return Promise.resolve({ ok: false, code: 'network' });
}

function sources(overrides: Partial<ReferenceSources> = {}): ReferenceSources {
  const empty = new Map<InstrumentKey, ProviderMarketSnapshot>();
  return {
    prices: async () => ({ ok: true, value: empty, observedAtMs: null }),
    markets: async () => ({ ok: true, value: empty, observedAtMs: null }),
    fearGreed: unavailable<FearGreedReading>,
    trending: unavailable<readonly TrendingCoin[]>,
    yields: unavailable<ReadonlyMap<string, AssetYield>>,
    headlines: unavailable<readonly NewsItem[]>,
    policy: unavailable<readonly PolicyItem[]>,
    ...overrides,
  };
}

const noCandles: CandleSource = { dailyBars: async () => ({ ok: false }) };

function service(
  overrides: Partial<ReferenceSources> = {},
  candles: CandleSource = noCandles,
  clock: Clock = new FixedClock(NOW),
): MarketDisplayQueryService {
  return new MarketDisplayQueryService({ clock, sources: sources(overrides), candles });
}

function bar(startTimeMs: number, isComplete = true, assetId: InstrumentKey = BTC_KEY): MarketBar {
  return {
    assetId,
    source: 'coinbase',
    interval: '1d',
    startTimeMs,
    endTimeMs: startTimeMs + 86_400_000,
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 12,
    isComplete,
    retrievedAtMs: NOW,
  };
}

describe('MarketDisplayQueryService provenance', () => {
  it('marks reference data non-signal and informational at the type and value level', async () => {
    const reading: FearGreedReading = { value: 31, classification: 'Fear' };
    const result = await service({
      fearGreed: async () => ({ ok: true, value: reading, observedAtMs: NOW - 3_600_000 }),
    }).fearGreed();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.data).toEqual(reading);
    expect(result.value.provenance).toEqual({
      source: 'api.alternative.me',
      requestedAtMs: NOW,
      receivedAtMs: NOW,
      observedAtMs: NOW - 3_600_000,
      ageMs: 3_600_000,
      freshness: 'fresh',
      informationalOnly: true,
      neverASignal: true,
    });
  });

  it('grades freshness against each feed’s own cadence, not one global timeout', async () => {
    const aging = await service({
      fearGreed: async () => ({
        ok: true,
        value: { value: 50, classification: 'Neutral' },
        observedAtMs: NOW - 13 * 60 * 60_000,
      }),
    }).fearGreed();
    expect(aging.ok && aging.value.provenance.freshness).toBe('aging');

    const stale = await service({
      fearGreed: async () => ({
        ok: true,
        value: { value: 50, classification: 'Neutral' },
        observedAtMs: NOW - 40 * 60 * 60_000,
      }),
    }).fearGreed();
    expect(stale.ok && stale.value.provenance.freshness).toBe('stale');
  });

  it('reports unknown freshness rather than claiming fresh when no timestamp exists', async () => {
    const result = await service({
      trending: async () => ({ ok: true, value: [], observedAtMs: null }),
    }).trending();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provenance.ageMs).toBeNull();
    expect(result.value.provenance.freshness).toBe('unknown');
  });
});

describe('MarketDisplayQueryService failures', () => {
  it('names which failure occurred instead of returning an empty list', async () => {
    const rateLimited = await service({
      yields: async () => ({ ok: false, code: 'rate_limited' }),
    }).yields();
    expect(rateLimited).toEqual({
      ok: false,
      issues: [{ path: ['yields'], code: 'source_rate_limited' }],
    });

    const cancelled = await service({
      trending: async () => ({ ok: false, code: 'cancelled' }),
    }).trending();
    expect(cancelled).toEqual({
      ok: false,
      issues: [{ path: ['trending'], code: 'source_cancelled' }],
    });
  });

  it('fails closed when the clock is unusable', async () => {
    const broken: Clock = {
      nowMs() {
        throw new Error('no clock');
      },
    };
    const result = await service({}, noCandles, broken).prices();
    expect(result).toEqual({ ok: false, issues: [{ path: ['prices'], code: 'clock_unavailable' }] });
  });

  it('rejects an out-of-range news limit before making a request', async () => {
    let called = false;
    const result = await service({
      headlines: async () => {
        called = true;
        return { ok: true, value: [], observedAtMs: null };
      },
    }).news(0);
    expect(result).toEqual({ ok: false, issues: [{ path: ['news', 'limit'], code: 'invalid_limit' }] });
    expect(called).toBe(false);
  });
});

describe('MarketDisplayQueryService views', () => {
  it('orders markets by rank and yields by APY', async () => {
    const ranked = new Map<InstrumentKey, ProviderMarketSnapshot>([
      ['a' as InstrumentKey, snapshot({ marketCapRank: 9 })],
      ['b' as InstrumentKey, snapshot({ marketCapRank: 2 })],
      ['c' as InstrumentKey, snapshot({ marketCapRank: null })],
    ]);
    const markets = await service({
      markets: async () => ({ ok: true, value: ranked, observedAtMs: null }),
    }).markets();
    expect(markets.ok && markets.value.data.map((row) => row.marketCapRank)).toEqual([2, 9, null]);

    const best = new Map<string, AssetYield>([
      ['ETH', { symbol: 'ETH', apyPct: 3.2, project: 'p', chain: 'c', tvlUsd: 2_000_000 }],
      ['SOL', { symbol: 'SOL', apyPct: 9.4, project: 'p', chain: 'c', tvlUsd: 2_000_000 }],
    ]);
    const yields = await service({
      yields: async () => ({ ok: true, value: best, observedAtMs: null }),
    }).yields();
    expect(yields.ok && yields.value.data.map((row) => row.symbol)).toEqual(['SOL', 'ETH']);
  });

  it('degrades policy but not headlines, because losing headlines means the layer is down', async () => {
    const headline: NewsItem = { title: 'H', url: 'https://n/1', source: 'CoinDesk', publishedAtMs: NOW };
    const degraded = await service({
      headlines: async () => ({ ok: true, value: [headline], observedAtMs: NOW }),
      policy: async () => ({ ok: false, code: 'http' }),
    }).news();
    expect(degraded.ok).toBe(true);
    if (!degraded.ok) return;
    expect(degraded.value.data.headlines).toEqual([headline]);
    expect(degraded.value.data.policy).toEqual([]);

    const down = await service({
      headlines: async () => ({ ok: false, code: 'timeout' }),
      policy: async () => ({ ok: true, value: [], observedAtMs: null }),
    }).news();
    expect(down).toEqual({ ok: false, issues: [{ path: ['news'], code: 'source_timeout' }] });
  });
});

describe('MarketDisplayQueryService candles', () => {
  const source = (bars: readonly MarketBar[]): CandleSource => ({
    dailyBars: async () => ({ ok: true, bars }),
  });

  it('returns decision-grade provenance, not reference provenance', async () => {
    const result = await service({}, source([bar(NOW - 86_400_000)])).candles(BTC, 30);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provenance).toEqual({
      source: 'coinbase',
      requestedAtMs: NOW,
      receivedAtMs: NOW,
      interval: '1d',
      completedBarsOnly: true,
      informationalOnly: false,
    });
  });

  it('drops in-progress bars so a surface cannot observe an unclosed bar', async () => {
    const complete = bar(NOW - 172_800_000);
    const result = await service({}, source([complete, bar(NOW - 86_400_000, false)])).candles(BTC, 30);
    expect(result.ok && result.value.bars).toEqual([complete]);
  });

  it('drops bars belonging to a different instrument', async () => {
    const other = instrumentKey({ venue: 'coinbase', productId: 'ETH-USD', productType: 'spot' });
    const result = await service({}, source([bar(NOW - 86_400_000, true, other)])).candles(BTC, 30);
    expect(result).toEqual({ ok: false, issues: [{ path: ['candles'], code: 'bars_incomplete' }] });
  });

  it('validates the instrument and lookback before requesting anything', async () => {
    let called = false;
    const watched: CandleSource = {
      dailyBars: async () => {
        called = true;
        return { ok: true, bars: [] };
      },
    };
    const svc = service({}, watched);

    expect(await svc.candles({ ...BTC, venue: 'binance' }, 30)).toEqual({
      ok: false,
      issues: [{ path: ['candles', 'instrument'], code: 'invalid_instrument' }],
    });
    expect(await svc.candles({ ...BTC, productId: 'bad id' }, 30)).toEqual({
      ok: false,
      issues: [{ path: ['candles', 'instrument'], code: 'invalid_instrument' }],
    });
    expect(await svc.candles(BTC, 0)).toEqual({
      ok: false,
      issues: [{ path: ['candles', 'lookbackDays'], code: 'invalid_lookback' }],
    });
    expect(await svc.candles(BTC, 10_000)).toEqual({
      ok: false,
      issues: [{ path: ['candles', 'lookbackDays'], code: 'invalid_lookback' }],
    });
    expect(called).toBe(false);
  });

  it('reports an unavailable venue distinctly from an empty result', async () => {
    expect(await service({}, noCandles).candles(BTC, 30)).toEqual({
      ok: false,
      issues: [{ path: ['candles'], code: 'bars_unavailable' }],
    });
    expect(await service({}, source([])).candles(BTC, 30)).toEqual({
      ok: false,
      issues: [{ path: ['candles'], code: 'bars_incomplete' }],
    });
  });
});
