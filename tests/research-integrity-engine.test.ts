import { describe, expect, it } from 'vitest';
import { buildDecisionMarketDataset, instrumentKey, FixedClock, DEFAULT_TRADE_COST_CONFIG,
  backtestIntegrityDataset, decisionFrameAt, validateDecisionDataset, validateTimedExposure,
  modeledFill, rebalanceResearchBook, researchBookValue, type MarketBar } from '../packages/core/src/index.js';
const DAY = 86_400_000, START = Date.UTC(2024, 0, 1);
const BTC = instrumentKey({ venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' });
function dataset(count = 12, future = false) {
  const bars: MarketBar[] = Array.from({ length: count }, (_, index) => ({
    assetId: BTC, source: 'coinbase', interval: '1d', startTimeMs: START + index * DAY,
    endTimeMs: START + (index + 1) * DAY, open: 100, close: future && index > 7 ? 500 : 100,
    high: 500, low: 50, volume: 100, isComplete: true, retrievedAtMs: START + count * DAY,
    quality: 'reported_ohlc',
  }));
  return buildDecisionMarketDataset({ [BTC]: bars }, [BTC], { policy: 'reject-on-gap', nowMs: START + (count + 1) * DAY });
}
const options = { clock: new FixedClock(0), warmup: 3, rebalanceEveryDays: 1,
  evalSignal: () => ({ action: 'hold' as const, rsi: 50, regime: 'calm' as const }) };
const base = [{ assetId: BTC, weight: 1 }];
describe('attainable research timing', () => {
  it('cannot fill at the opening boundary before the prior bar publication', () => {
    const frame = decisionFrameAt(dataset(), 3);
    expect(frame.observedEndExclusive).toBe(2);
    expect(frame.availableAtMs).toBe(START + 2 * DAY + 300_000);
    expect(frame.executionAtMs).toBeGreaterThan(frame.decisionAtMs);
    expect(() => decisionFrameAt(dataset(), 12)).toThrow('No execution bar');
  });
  it('rejects rewritten arrays, timestamps, and future overlays', () => {
    const d = dataset();
    expect(() => validateDecisionDataset({ ...d, generatedAtMs: NaN })).toThrow();
    expect(() => validateTimedExposure(decisionFrameAt(d, 3), { value: 1, availableAtMs: START, observedThroughMs: START + 1 })).toThrow();
    expect(() => validateDecisionDataset({ ...d, opensById: { [BTC]: [1] } })).toThrow();
    expect(() => validateTimedExposure(decisionFrameAt(d, 3), {
      value: 1, availableAtMs: START + 4 * DAY, observedThroughMs: START,
    })).toThrow();
    expect(() => backtestIntegrityDataset(d, base, { ...options, exposureScale: [1] })).toThrow();
  });
  it('preserves earlier decisions when future prices change or data are appended', () => {
    const original = backtestIntegrityDataset(dataset(), base, options);
    const changed = backtestIntegrityDataset(dataset(12, true), base, options);
    const appended = backtestIntegrityDataset(dataset(14), base, options);
    expect(changed.tracesByStrategy.signal.slice(0, 5)).toEqual(original.tracesByStrategy.signal.slice(0, 5));
    expect(appended.tracesByStrategy.trendvol.slice(0, 9)).toEqual(original.tracesByStrategy.trendvol);
  });
  it('uses available context at a scored fold opening rather than demanding the entire fold offset', () => {
    const result = backtestIntegrityDataset(dataset(), base, { ...options, warmup: 7, minimumHistoryBars: 3,
      momentum: { lookbackDays: 3, volatilityDays: 3, maxRelativeTilt: 0.35, defensiveScale: 0.2, targetVolatilityPct: 55 } });
    expect(result.tracesByStrategy.momentum[0]!.reason).toBe('strategy');
    expect(result.tracesByStrategy.momentum[0]!.fills.length).toBeGreaterThan(0);
  });
  it('includes opening costs and leaves insufficient-history strategies in cash', () => {
    const result = backtestIntegrityDataset(dataset(), base, options);
    expect(result.hold.equity[0]!.value).toBe(10000);
    expect(result.hold.metrics.totalReturnPct).toBeLessThan(0);
    expect(result.tracesByStrategy.trendvol[0]!.reason).toBe('insufficient_history');
    expect(result.trendvol.costs.totalCostUsd).toBe(0);
    expect(result.cash.metrics.totalReturnPct).toBe(0);
  });
  it('waits for every configured signal window even when the scored warmup is shorter', () => {
    const result = backtestIntegrityDataset(dataset(20), base, { ...options, warmup: 5, minimumHistoryBars: 3,
      momentum: { lookbackDays: 3, volatilityDays: 8, maxRelativeTilt: 0.35, defensiveScale: 0.2, targetVolatilityPct: 55 },
      volTarget: { targetVolPct: 40, volLookbackDays: 3, minExposure: 0.1, maxExposure: 1, trendGateDays: 12, belowTrendMaxExposure: 0.7 } });
    for (const family of ['momentum', 'voltarget', 'trendvol'] as const) {
      const required = family === 'momentum' ? 9 : 12;
      for (const trace of result.tracesByStrategy[family]) {
        if (trace.frame.observedEndExclusive < required) {
          expect(trace.reason).toBe('insufficient_history');
          expect(trace.fills).toHaveLength(0);
        } else expect(trace.reason).toBe('strategy');
      }
    }
  });
});
describe('self-financing research books', () => {
  it('conserves book value across a deterministic range of prices, targets and roundings', () => {
    let book = { cash: '1000', units: new Map<typeof BTC, string>() };
    const costs = { ...DEFAULT_TRADE_COST_CONFIG, impactCoefBps: 60 };
    for (let step = 0; step < 40; step += 1) {
      const prices = new Map([[BTC, 80 + ((step * 37) % 150)]]);
      const before = researchBookValue(book, prices).toNumber();
      const transition = rebalanceResearchBook(book, prices, new Map([[BTC, ((step * 13) % 11) / 10]]), costs);
      const charged = transition.fills.reduce((sum, fill) => sum + Number(fill.totalCost), 0);
      expect(researchBookValue(transition.book, prices).toNumber()).toBeCloseTo(before - charged, 9);
      expect(Number(transition.book.cash)).toBeGreaterThanOrEqual(0);
      expect([...transition.book.units.values()].every((quantity) => Number(quantity) >= 0)).toBe(true);
      for (const fill of transition.fills) expect(Number(fill.totalCost)).toBeCloseTo(
        Number(fill.venueFee) + Number(fill.spreadCost) + Number(fill.slippageCost) + Number(fill.impactCost), 9);
      book = { cash: transition.book.cash, units: new Map(transition.book.units) };
    }
  });
  it('matches a hand-calculated purchase and sale, charging costs exactly once', () => {
    const costs = { ...DEFAULT_TRADE_COST_CONFIG, feeBps: 100, spreadBps: 100, slippageBps: 0 };
    const buy = modeledFill('buy', '2', '100', costs);
    expect(buy.executionPrice).toBe('101'); expect(buy.cashChange).toBe('-204');
    const sell = modeledFill('sell', '2', '110', costs);
    expect(sell.cashChange).toBe('215.6');
    expect(Number(buy.cashChange) + Number(sell.cashChange)).toBeCloseTo(11.6, 10);
  });
  it('conserves capital with impact, constrains buys and never invents holdings', () => {
    const prices = new Map([[BTC, 100]]);
    const initial = { cash: '1000', units: new Map() };
    const costs = { ...DEFAULT_TRADE_COST_CONFIG, impactCoefBps: 60 };
    const bought = rebalanceResearchBook(initial, prices, new Map([[BTC, 1]]), costs);
    const loss = 1000 - researchBookValue(bought.book, prices).toNumber();
    expect(loss).toBeCloseTo(Number(bought.fills[0]!.totalCost), 10);
    expect(Number(bought.book.cash)).toBeGreaterThanOrEqual(0);
    const value = researchBookValue(bought.book, prices);
    const actualWeight = Number(bought.book.units.get(BTC)) * 100 / value.toNumber();
    expect(rebalanceResearchBook(bought.book, prices, new Map([[BTC, actualWeight]]), costs).fills).toHaveLength(0);
    const sold = rebalanceResearchBook(bought.book, prices, new Map(), costs);
    expect(sold.book.units.get(BTC)).toBe('0');
    expect(Number(sold.book.cash)).toBeGreaterThan(0);
  });
});
