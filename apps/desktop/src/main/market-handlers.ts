import type { AssetRef } from '@coqui/core';
import type { MarketDisplayQueryService } from '@coqui/services';

import type { CoinbaseMarketStreamService } from './coinbase-market-stream.js';
import type { ChannelHandlers } from './dispatch.js';

/** Keep the market boundary together as live display data joins completed history. */
export function createMarketHandlers(
  marketData: MarketDisplayQueryService,
  liveMarket: CoinbaseMarketStreamService,
  trackedAssets: () => readonly AssetRef[],
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
    'market-data.live': () => ({
      ok: true,
      value: liveMarket.snapshot(trackedAssets().map((asset) => asset.instrument.productId)),
    }),
  } as ChannelHandlers;
}
