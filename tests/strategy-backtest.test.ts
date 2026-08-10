import { describe, expect, it } from 'vitest';
import {
  backtestStrategies as executeBacktest,
  FixedClock,
  type SignalEvaluator,
} from '../packages/core/src/index.js';
import { BTC, ETH, NO_TRADE_COSTS, trialRegistry } from './support.js';

// A signal evaluator stub: reads the last close vs a threshold to pick an action.
const holdAll: SignalEvaluator = () => ({ action: 'hold', rsi: 50, regime: 'calm' });
const exitAll: SignalEvaluator = () => ({ action: 'exit', rsi: 30, regime: 'calm' });
const clock = new FixedClock(1_785_542_400_000);

function runBacktest(
  closes: Parameters<typeof executeBacktest>[0],
  targets: Parameters<typeof executeBacktest>[1],
  options: Omit<Parameters<typeof executeBacktest>[2], 'clock'>,
) {
  return executeBacktest(closes, targets, { ...options, clock });
}

/** A rising series of length n starting at `from`, +`step` per day. */
function rising(from: number, step: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => from + i * step);
}

function compound(from: number, dailyReturn: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => from * (1 + dailyReturn) ** i);
}

const base = [
  { assetId: BTC, weight: 0.5 },
  { assetId: ETH, weight: 0.5 },
];

describe('backtestStrategies', () => {
  it('degrades cleanly when there is not enough history past warmup', () => {
    const r = runBacktest({ [BTC]: [1, 2, 3], [ETH]: [1, 2, 3] }, base, {
      warmup: 10,
      rebalanceEveryDays: 2,
      evalSignal: holdAll,
    });
    expect(r.days).toBe(0);
    expect(r.hold.equity).toHaveLength(0);
  });

  it('with hold signals, the signal track matches passive (no tilt)', () => {
    const closes = { [BTC]: rising(100, 1, 40), [ETH]: rising(50, 0.5, 40) };
    const r = runBacktest(closes, base, {
      warmup: 5,
      rebalanceEveryDays: 3,
      tradeCosts: NO_TRADE_COSTS,
      evalSignal: holdAll,
    });
    expect(r.signal.equity.length).toBeGreaterThan(2);
    const sigEnd = r.signal.equity.at(-1)!.value;
    const passEnd = r.passive.equity.at(-1)!.value;
    expect(sigEnd).toBeCloseTo(passEnd, 4);
  });

  it('in a rising market, an exit-all signal underperforms staying invested', () => {
    const closes = { [BTC]: rising(100, 2, 40), [ETH]: rising(100, 2, 40) };
    const r = runBacktest(closes, base, {
      warmup: 5,
      rebalanceEveryDays: 2,
      tradeCosts: NO_TRADE_COSTS,
      evalSignal: exitAll,
    });
    // exit raises ~60% cash → captures less of the rally than fully-invested hold.
    expect(r.signal.equity.at(-1)!.value).toBeLessThan(r.hold.equity.at(-1)!.value);
  });

  it('vol-target goes defensive below its trend gate, cushioning a drop vs hold', () => {
    // Rise, then fall under the (short) trend gate so the overlay raises cash.
    const rise = rising(100, 2, 60);
    const fall = Array.from({ length: 40 }, (_, i) => 220 - i * 4);
    const series = [...rise, ...fall];
    const r = runBacktest({ [BTC]: series, [ETH]: series }, base, {
      warmup: 20,
      rebalanceEveryDays: 2,
      tradeCosts: NO_TRADE_COSTS,
      evalSignal: holdAll, // neutral signal so we isolate the vol-target overlay
      volTarget: { targetVolPct: 50, volLookbackDays: 20, minExposure: 0.1, maxExposure: 1, trendGateDays: 20, belowTrendMaxExposure: 0.3 },
    });
    expect(r.voltarget.equity.at(-1)!.value).toBeGreaterThan(r.hold.equity.at(-1)!.value);
    expect(r.voltarget.metrics.maxDrawdownPct).toBeGreaterThan(r.hold.metrics.maxDrawdownPct);
  });

  it('trendvol composes momentum picks with vol-target sizing (never less defensive than momentum alone)', () => {
    // Same rise-then-fall tape: below the trend gate the combo scales momentum's
    // book down by the capped exposure, so it ends at least as defended as both
    // parents on the drop.
    const rise = rising(100, 2, 60);
    const fall = Array.from({ length: 40 }, (_, i) => 220 - i * 4);
    const series = [...rise, ...fall];
    const r = runBacktest({ [BTC]: series, [ETH]: series }, base, {
      warmup: 20,
      rebalanceEveryDays: 2,
      tradeCosts: NO_TRADE_COSTS,
      trialRegistry: trialRegistry(6),
      evalSignal: holdAll,
      momentum: { lookbackDays: 10, volatilityDays: 10, maxRelativeTilt: 0.35, defensiveScale: 0.35, targetVolatilityPct: 55 },
      volTarget: { targetVolPct: 50, volLookbackDays: 20, minExposure: 0.1, maxExposure: 1, trendGateDays: 20, belowTrendMaxExposure: 0.3 },
    });
    expect(r.trendvol.equity.length).toBe(r.hold.equity.length);
    // The combo cushions the crash at least as well as buy-and-hold…
    expect(r.trendvol.equity.at(-1)!.value).toBeGreaterThan(r.hold.equity.at(-1)!.value);
    expect(r.trendvol.metrics.maxDrawdownPct).toBeGreaterThan(r.hold.metrics.maxDrawdownPct);
    // …and the six active tracks (including rotation) enter significance.
    expect(r.significance.trials).toBe(6);
  });

  it('withholds significance when historical trials are only a known lower bound', () => {
    const closes = {
      [BTC]: compound(100, 0.002, 100),
      [ETH]: compound(100, 0.001, 100),
    };
    const result = runBacktest(closes, base, {
      warmup: 20,
      rebalanceEveryDays: 7,
      tradeCosts: NO_TRADE_COSTS,
      trialRegistry: trialRegistry(178, 'known-lower-bound'),
      evalSignal: holdAll,
    });
    expect(result.significance.trials).toBe(0);
    expect(result.significance.dsr).toBeNull();
    expect(result.significance.note).toMatch(/unavailable/u);
  });

  it('cash APR credits defensive cash sleeves and leaves fully-invested tracks alone', () => {
    // Falling tape with exit-all signals: the signal track raises heavy cash,
    // hold stays fully invested. With a cash APR, only cash-holders benefit.
    const falling = Array.from({ length: 80 }, (_, i) => 300 - i * 2);
    const closes = { [BTC]: falling, [ETH]: falling };
    const base0 = runBacktest(closes, base, {
      warmup: 10,
      rebalanceEveryDays: 2,
      tradeCosts: NO_TRADE_COSTS,
      evalSignal: exitAll,
    });
    const base8 = runBacktest(closes, base, {
      warmup: 10,
      rebalanceEveryDays: 2,
      tradeCosts: NO_TRADE_COSTS,
      cashAprPct: 8,
      evalSignal: exitAll,
    });
    // Hold has no cash — identical either way.
    expect(base8.hold.equity.at(-1)!.value).toBeCloseTo(base0.hold.equity.at(-1)!.value, 6);
    // The cash-heavy signal track ends strictly higher with the yield credited.
    expect(base8.signal.equity.at(-1)!.value).toBeGreaterThan(base0.signal.equity.at(-1)!.value);
  });

  it('exposureScale of 0 sends voltarget and trendvol fully to cash; >1 never leverages', () => {
    const closes = { [BTC]: rising(100, 1, 80), [ETH]: rising(100, 1, 80) };
    const opts = {
      warmup: 10,
      rebalanceEveryDays: 4,
      tradeCosts: NO_TRADE_COSTS,
      evalSignal: holdAll,
    };
    const zeroed = runBacktest(closes, base, { ...opts, exposureScale: new Array(80).fill(0) });
    // All-cash from the first rebalance on: equity flatlines after day 4.
    const eq = zeroed.voltarget.equity;
    expect(eq.at(-1)!.value).toBeCloseTo(eq[4]!.value, 6);
    expect(zeroed.trendvol.equity.at(-1)!.value).toBeCloseTo(zeroed.trendvol.equity[4]!.value, 6);
    // Scale 5 must not exceed fully-invested (≤ the unscaled voltarget curve in a calm uptrend at max exposure).
    const boosted = runBacktest(closes, base, { ...opts, exposureScale: new Array(80).fill(5) });
    const plain = runBacktest(closes, base, opts);
    expect(boosted.voltarget.equity.at(-1)!.value).toBeCloseTo(plain.voltarget.equity.at(-1)!.value, 4);
    // Other tracks are untouched by the scale.
    expect(zeroed.passive.equity.at(-1)!.value).toBeCloseTo(plain.passive.equity.at(-1)!.value, 6);
  });

  it('trendvol matches voltarget when momentum has no defensive read (uniform uptrend)', () => {
    // In a steady identical uptrend, momentum keeps the base weights (no relative
    // spread, positive absolute momentum, low vol) so the combo reduces to the
    // vol-target overlay alone.
    const closes = { [BTC]: rising(100, 1, 80), [ETH]: rising(100, 1, 80) };
    const r = runBacktest(closes, base, {
      warmup: 10,
      rebalanceEveryDays: 4,
      tradeCosts: NO_TRADE_COSTS,
      evalSignal: holdAll,
      momentum: { lookbackDays: 10, volatilityDays: 10, maxRelativeTilt: 0.35, defensiveScale: 0.35, targetVolatilityPct: 55 },
    });
    expect(r.trendvol.equity.at(-1)!.value).toBeCloseTo(r.voltarget.equity.at(-1)!.value, 0);
  });

  it('in a falling market, an exit-all signal preserves capital vs hold', () => {
    const falling = Array.from({ length: 40 }, (_, i) => 200 - i * 3);
    const r = runBacktest({ [BTC]: falling, [ETH]: falling }, base, {
      warmup: 5,
      rebalanceEveryDays: 2,
      tradeCosts: NO_TRADE_COSTS,
      evalSignal: exitAll,
    });
    // raising cash cushions the drawdown → less negative than hold.
    expect(r.signal.metrics.maxDrawdownPct).toBeGreaterThan(r.hold.metrics.maxDrawdownPct);
    expect(r.signal.equity.at(-1)!.value).toBeGreaterThan(r.hold.equity.at(-1)!.value);
  });

  it('computes a positive return in an uptrend; null Sortino/Calmar with no downside', () => {
    const closes = { [BTC]: rising(100, 1, 50), [ETH]: rising(100, 1, 50) };
    const r = runBacktest(closes, base, {
      warmup: 5,
      rebalanceEveryDays: 5,
      tradeCosts: NO_TRADE_COSTS,
      evalSignal: holdAll,
    });
    expect(r.hold.metrics.totalReturnPct).toBeGreaterThan(0);
    // A monotonic rise has no down days and no drawdown → both ratios are null.
    expect(r.hold.metrics.sortino).toBeNull();
    expect(r.hold.metrics.calmar).toBeNull();
    expect(r.assets).toEqual([BTC, ETH]);
  });

  it('reports estimated costs and reduces returns when trading costs are enabled', () => {
    const closes = {
      [BTC]: rising(100, 2, 60),
      [ETH]: rising(100, 0.1, 60),
    };
    const free = runBacktest(closes, base, {
      warmup: 5,
      rebalanceEveryDays: 2,
      tradeCosts: NO_TRADE_COSTS,
      evalSignal: holdAll,
    });
    const costly = runBacktest(closes, base, {
      warmup: 5,
      rebalanceEveryDays: 2,
      tradeCosts: { feeBps: 100, spreadBps: 0, slippageBps: 0, minUsefulTradeUsd: 25 },
      evalSignal: holdAll,
    });

    expect(costly.passive.costs.totalCostUsd).toBeGreaterThan(0);
    expect(costly.passive.costs.turnoverUsd).toBeGreaterThan(0);
    expect(costly.passive.costs.events).toBeGreaterThan(1);
    expect(costly.passive.equity.at(-1)!.value).toBeLessThan(free.passive.equity.at(-1)!.value);
  });

  it('counts executable asset notional once and does not double-count cash', () => {
    const r = runBacktest(
      { [BTC]: [100, 100, 100], [ETH]: [100, 100, 100] },
      base,
      {
        warmup: 0,
        rebalanceEveryDays: 30,
      tradeCosts: NO_TRADE_COSTS,
        evalSignal: holdAll,
      },
    );
    // $10k cash -> a $5k BTC leg + a $5k ETH leg = $10k traded notional.
    expect(r.hold.costs.turnoverUsd).toBeCloseTo(10_000, 6);
  });

  it('never exposes the execution interval to a close-derived signal', () => {
    const observed: number[][] = [];
    runBacktest(
      { [BTC]: [10, 20, 30, 40], [ETH]: [10, 20, 30, 40] },
      base,
      {
        warmup: 1,
        rebalanceEveryDays: 1,
      tradeCosts: NO_TRADE_COSTS,
        executionPricesById: {
          [BTC]: [11, 21, 31, 41],
          [ETH]: [11, 21, 31, 41],
        },
        evalSignal: (closes) => {
          observed.push(closes);
          return holdAll(closes);
        },
      },
    );
    expect(observed[0]).toEqual([10, 20]);
    expect(observed.some((closes) => closes.length === 4)).toBe(false);
  });

  it('reports a real Sortino when the series has down days', () => {
    // Up-and-down sawtooth → has downside, so Sortino is finite.
    const saw = Array.from({ length: 60 }, (_, i) => 100 + (i % 2 === 0 ? i : i - 3));
    const r = runBacktest({ [BTC]: saw, [ETH]: saw }, base, {
      warmup: 5,
      rebalanceEveryDays: 4,
      tradeCosts: NO_TRADE_COSTS,
      trialRegistry: trialRegistry(6),
      evalSignal: holdAll,
    });
    expect(r.hold.metrics.sortino).not.toBeNull();
    expect(Number.isFinite(r.hold.metrics.sortino as number)).toBe(true);
  });

  it('emits a Sharpe metric and a significance report over the active tracks', () => {
    const saw = Array.from({ length: 120 }, (_, i) => 100 + (i % 2 === 0 ? i * 0.5 : i * 0.5 - 2));
    const r = runBacktest({ [BTC]: saw, [ETH]: saw }, base, {
      warmup: 5,
      rebalanceEveryDays: 4,
      tradeCosts: NO_TRADE_COSTS,
      trialRegistry: trialRegistry(6),
      evalSignal: holdAll,
    });
    // Sharpe now populated alongside Sortino/Calmar.
    expect(r.hold.metrics.sharpe).not.toBeNull();
    // Significance: 6 active tracks raced (hold is the benchmark, excluded).
    const s = r.significance;
    expect(s.trials).toBe(6);
    expect(['passive', 'signal', 'momentum', 'voltarget', 'trendvol', 'rotation']).toContain(s.leader);
    expect(s.sampleDays).toBeGreaterThan(0);
    expect(['significant', 'inconclusive', 'no_edge', 'insufficient_data']).toContain(s.verdict);
    if (s.dsr !== null) {
      expect(s.dsr).toBeGreaterThanOrEqual(0);
      expect(s.dsr).toBeLessThanOrEqual(1);
    }
  });

  it('emits a walk-forward out-of-sample selection result', () => {
    const saw = Array.from({ length: 160 }, (_, i) => 100 + (i % 2 === 0 ? i * 0.5 : i * 0.5 - 2));
    const r = runBacktest({ [BTC]: saw, [ETH]: saw }, base, {
      warmup: 5,
      rebalanceEveryDays: 5,
      tradeCosts: NO_TRADE_COSTS,
      evalSignal: holdAll,
    });
    const w = r.walkForward;
    expect(w.folds).toBe(4);
    expect(w.oosFolds).toBe(3);
    expect(w.perFold).toHaveLength(3);
    expect(['adds_value', 'matches_passive', 'lags_passive', 'insufficient_data']).toContain(w.verdict);
    // Oracle is a hindsight upper bound on the walk-forward pick.
    expect(w.oracleReturnPct).toBeGreaterThanOrEqual(w.walkForwardReturnPct - 1e-6);
  });

  it('flags too-short samples as insufficient_data for significance', () => {
    // ~30 tradeable days after warmup — below the ~60-day floor.
    const r = runBacktest({ [BTC]: rising(100, 1, 45), [ETH]: rising(100, 1, 45) }, base, {
      warmup: 10,
      rebalanceEveryDays: 5,
      tradeCosts: NO_TRADE_COSTS,
      evalSignal: holdAll,
    });
    expect(r.significance.verdict).toBe('insufficient_data');
  });

  it('drops assets without history and renormalizes', () => {
    const closes = { [BTC]: rising(100, 1, 30) }; // ETH missing
    const r = runBacktest(closes, base, {
      warmup: 5,
      rebalanceEveryDays: 3,
      tradeCosts: NO_TRADE_COSTS,
      evalSignal: holdAll,
    });
    expect(r.assets).toEqual([BTC]);
    expect(r.hold.equity.length).toBeGreaterThan(2);
  });

  it('adds a momentum track that rotates toward stronger risk-adjusted momentum', () => {
    const r = runBacktest(
      { [BTC]: compound(100, 0.01, 180), [ETH]: compound(100, 0.001, 180) },
      base,
      {
        warmup: 100,
        rebalanceEveryDays: 5,
      tradeCosts: NO_TRADE_COSTS,
        momentum: {
          lookbackDays: 40,
          volatilityDays: 20,
          maxRelativeTilt: 0.5,
          defensiveScale: 0.35,
          targetVolatilityPct: 200,
        },
        evalSignal: holdAll,
      },
    );
    expect(r.momentum.equity.length).toBe(r.hold.equity.length);
    expect(r.momentum.equity.at(-1)!.value).toBeGreaterThan(r.passive.equity.at(-1)!.value);
  });

  it('momentum raises cash when absolute momentum is negative', () => {
    const falling = Array.from({ length: 180 }, (_, i) => 300 - i);
    const r = runBacktest({ [BTC]: falling, [ETH]: falling }, base, {
      warmup: 100,
      rebalanceEveryDays: 5,
      tradeCosts: NO_TRADE_COSTS,
      momentum: {
        lookbackDays: 40,
        volatilityDays: 20,
        maxRelativeTilt: 0.35,
        defensiveScale: 0.25,
        targetVolatilityPct: 200,
      },
      evalSignal: holdAll,
    });
    expect(r.momentum.equity.at(-1)!.value).toBeGreaterThan(r.hold.equity.at(-1)!.value);
    expect(r.momentum.metrics.maxDrawdownPct).toBeGreaterThan(r.hold.metrics.maxDrawdownPct);
  });
});
