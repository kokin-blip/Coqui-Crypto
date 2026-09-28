import { instrumentKey, mapUniverseProducts, universeHash, UNIVERSE_DAY,
  type UniverseAssetEvidence, type DynamicUniverseSlot, type UniverseLiquidity } from '../../packages/core/src/index.js';

export const UNIVERSE_NOW = Date.UTC(2026, 8, 28, 0, 5);
export function liquidity(atMs = UNIVERSE_NOW): UniverseLiquidity {
  return { quoteAtMs: atMs, bookAtMs: atMs, capturedAtMs: atMs, bid: '99.9', ask: '100.1',
    bids: [{ price: '99.9', size: '100000' }], asks: [{ price: '100.1', size: '100000' }] };
}
export function universeEvidence(base = 'BTC', atMs = UNIVERSE_NOW): UniverseAssetEvidence {
  const instrument = { venue: 'coinbase' as const, productType: 'spot' as const, productId: `${base}-USD` };
  const product = { instrument, baseAsset: base, quoteAsset: 'USD' as const, status: 'online',
    tradingDisabled: false, cancelOnly: false, limitOnly: false, postOnly: false,
    baseIncrement: '0.000000001', quoteIncrement: '0.01', minMarketFunds: '1' };
  const asset = { id: `asset-${base}`, symbol: `${base}/USD`, class: 'crypto', status: 'active', tradable: true,
    min_order_size: '0.001', min_trade_increment: '0.000000001', price_increment: '0.01' };
  const end = Math.floor(atMs / UNIVERSE_DAY) * UNIVERSE_DAY;
  return { product, asset, mapping: mapUniverseProducts([product], [asset])[0]!.mapping, mappingReason: null,
    catalogObservedAtMs: end - 3600_000, accountObservedAtMs: atMs, accountReady: true,
    listedAtMs: null, currentProduct: { ...product, baseMinSize: '0.000000001', auctionMode: false, isDisabled: false },
    currentAsset: asset, rulesObservedAtMs: atMs,
    coinbase: liquidity(atMs), alpaca: liquidity(atMs),
    bars: Array.from({ length: 180 }, (_, index) => ({ assetId: instrumentKey(instrument), source: 'coinbase',
      interval: '1d', startTimeMs: end - (180 - index) * UNIVERSE_DAY,
      endTimeMs: end - (179 - index) * UNIVERSE_DAY,
      open: 90 + index / 20, high: 91 + index / 20, low: 89 + index / 20, close: 90 + index / 20,
      volume: 100, isComplete: true, retrievedAtMs: atMs, quality: 'reported_ohlc' })) };
}
export function universeSlot(bases = ['BTC', 'ETH', 'LTC', 'SOL'], atMs = UNIVERSE_NOW): DynamicUniverseSlot {
  const observations = bases.map((base) => ({ atMs, evidence: universeEvidence(base, atMs) }));
  return { slotMs: Math.floor(atMs / (UNIVERSE_DAY / 6)) * (UNIVERSE_DAY / 6), observations,
    catalogHash: universeHash('catalog'), catalogAssetIds: observations.map((o) => instrumentKey(o.evidence.product.instrument)) };
}
export const UNIVERSE_ANCHOR = Object.fromEntries(['BTC', 'ETH', 'LTC'].map((base) => [`coinbase|spot|${base}-USD`, '90']));
