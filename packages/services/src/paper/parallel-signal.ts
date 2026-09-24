import { instrumentKey, trendVolTargets, type DecisionMarketDataset, type InstrumentIdentity } from '@coqui/core';

export const PARALLEL_TRENDVOL_VERSION = 'trendvol-qc-v4.2-paper' as const;
export const PARALLEL_INSTRUMENTS: readonly InstrumentIdentity[] = Object.freeze(
  ['BTC-USD', 'ETH-USD', 'LTC-USD'].map((productId) => ({
    venue: 'coinbase' as const, productType: 'spot' as const, productId,
  })),
);
export const PARALLEL_SYMBOLS = ['BTCUSD', 'ETHUSD', 'LTCUSD'] as const;
export const PARALLEL_COSTS = Object.freeze({ fee: '0.006', spread: '0.001', slippage: '0.0015' });

export type ParallelAnchor = Readonly<Record<string, string>>;

export function parallelAnchor(dataset: DecisionMarketDataset): ParallelAnchor {
  if (dataset.dayKeys.length < 121) throw new Error('insufficient_history');
  const index = dataset.dayKeys.length - 121;
  return Object.fromEntries(PARALLEL_INSTRUMENTS.map((instrument) => {
    const id = instrumentKey(instrument);
    const close = dataset.closesById[id]?.[index];
    if (close === undefined || !Number.isFinite(close) || close <= 0) throw new Error('market_alignment_failed');
    return [id, String(close)];
  }));
}

export function parallelDecision(dataset: DecisionMarketDataset, anchor: ParallelAnchor) {
  if (dataset.dayKeys.length < 121) throw new Error('insufficient_history');
  const keys = dataset.dayKeys.slice(-121);
  for (let i = 1; i < keys.length; i += 1) {
    if (Date.parse(`${keys[i]}T00:00:00Z`) - Date.parse(`${keys[i - 1]}T00:00:00Z`) !== 86_400_000) {
      throw new Error('market_alignment_failed');
    }
  }
  const mix = dataset.dayKeys.map((_, index) => PARALLEL_INSTRUMENTS.reduce((sum, instrument) => {
    const id = instrumentKey(instrument);
    const close = dataset.closesById[id]?.[index];
    const start = Number(anchor[id]);
    if (close === undefined || !Number.isFinite(close) || !Number.isFinite(start) || start <= 0) {
      throw new Error('market_alignment_failed');
    }
    return sum + close / start / 3;
  }, 0));
  const base = PARALLEL_INSTRUMENTS.map((instrument) => ({ assetId: instrumentKey(instrument), weight: 1 / 3 }));
  const result = trendVolTargets(base, dataset.closesById, mix);
  if (result.historyStatus !== 'complete') throw new Error('insufficient_history');
  return Object.freeze({ day: keys.at(-1)!, weights: Object.fromEntries(result.targets.map((item) => [item.assetId, item.weight])),
    exposure: result.exposure, cashWeight: result.cashWeight,
    mixVolPct: result.volatility.realizedVolPct, belowTrend: result.volatility.belowTrend });
}
