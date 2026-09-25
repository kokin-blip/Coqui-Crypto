import type { CoinbaseDisplayDataService, MarketDisplayQueryService } from '@coqui/services';

import type { CoinbaseMarketStreamService } from './coinbase-market-stream.js';
import type { createCoinbaseMarketDiagnostics } from './coinbase-market-diagnostics.js';
import type { ChannelHandlers } from './dispatch.js';

/** Keep the market boundary together as live display data joins completed history. */
export function createMarketHandlers(
  marketData: MarketDisplayQueryService,
  displayData: CoinbaseDisplayDataService,
  liveMarket: CoinbaseMarketStreamService,
  diagnostics: ReturnType<typeof createCoinbaseMarketDiagnostics>,
): ChannelHandlers {
  return {
    'market-data.prices': () => marketData.prices(),
    'market-data.markets': () => marketData.markets(),
    'market-data.fear-greed': () => marketData.fearGreed(),
    'market-data.trending': () => marketData.trending(),
    'market-data.yields': () => marketData.yields(),
    'market-data.news': (payload: { readonly limit: number }) => marketData.news(payload.limit),
    'market-data.candles': (payload: {
      readonly instrument: Parameters<MarketDisplayQueryService['candles']>[0];
      readonly lookbackDays: number;
    }) => marketData.candles(payload.instrument, payload.lookbackDays),
    'market-data.live': () => ({ ok: true, value: liveMarket.snapshot() }),
    'market-data.coinbase-diagnostics': async (payload: { readonly productId: string }) =>
      ({ ok: true, value: await diagnostics.snapshot(payload.productId) }),
    'market-data.products': async (payload: { readonly query: string; readonly limit: number }) => {
      const result = await displayData.products(payload.query, payload.limit);
      return result.ok ? { ok: true, value: {
        products: result.value.products.map((asset) => ({
          instrument: asset.instrument,
          symbol: asset.symbol,
          name: asset.name,
          baseAsset: asset.baseAsset,
          quoteAsset: 'USD' as const,
        })),
        source: 'coinbase_exchange_rest' as const,
        informationalOnly: true as const,
        decisionEligible: false as const,
        asOfMs: result.value.asOfMs,
      } } : result;
    },
    'market-data.display-bars': async (payload: {
      readonly productId: string;
      readonly interval: '1m' | '5m' | '15m' | '1h' | '6h' | '1d';
      readonly startTimeMs: number;
      readonly endTimeMs: number;
    }) => {
      const result = await displayData.bars(payload);
      return result.ok ? { ok: true, value: {
        productId: payload.productId,
        interval: payload.interval,
        bars: result.value.bars.map((bar) => ({
          productId: bar.productId, interval: bar.interval,
          startTimeMs: bar.startTimeMs, endTimeMs: bar.endTimeMs,
          open: bar.open, high: bar.high, low: bar.low, close: bar.close,
          volume: bar.volume, isComplete: true as const,
          retrievedAtMs: bar.retrievedAtMs,
          informationalOnly: true as const, decisionEligible: false as const,
        })),
        source: 'coinbase_exchange_rest' as const,
        completeness: 'completed_only' as const,
        informationalOnly: true as const,
        decisionEligible: false as const,
        asOfMs: result.value.asOfMs,
      } } : result;
    },
    'market-data.live-candles': (payload: {
      readonly productIds: readonly string[];
      readonly interval: '1m' | '5m' | '15m' | '1h' | '6h' | '1d';
    }) => ({ ok: true, value: liveMarket.snapshotCandles(payload.productIds, payload.interval) }),
  } as ChannelHandlers;
}
