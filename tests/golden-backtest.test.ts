import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  backtestStrategies,
  FixedClock,
  instrumentKey,
  type InstrumentKey,
} from '../packages/core/src/index.js';
import { trialRegistry } from './support.js';

interface GoldenFixture {
  closes: Record<string, number[]>;
  targets: { assetId: string; weight: number }[];
  warmup: number;
  rebalanceEveryDays: number;
  trialCount: number;
  expected: {
    days: number;
    holdReturnPct: number;
    passiveReturnPct: number;
    passiveTurnoverUsd: number;
    passiveCostUsd: number;
    dsr: number;
    trials: number;
    firstPassiveValue: number;
    lastPassiveValue: number;
  };
}

describe('golden backtest fixture', () => {
  it('keeps execution timing, costs, turnover, and significance reproducible', () => {
    const fixture = JSON.parse(
      readFileSync(join(process.cwd(), 'tests/fixtures/golden-backtest-v2.json'), 'utf8'),
    ) as GoldenFixture;
    const keyFor = (symbol: string): InstrumentKey =>
      instrumentKey({ venue: 'coinbase', productId: `${symbol}-USD`, productType: 'spot' });
    const closes = Object.fromEntries(
      Object.entries(fixture.closes).map(([assetId, values]) => [keyFor(assetId), values]),
    );
    const targets = fixture.targets.map((target) => ({
      assetId: keyFor(target.assetId),
      weight: target.weight,
    }));
    const opens = Object.fromEntries(
      Object.entries(fixture.closes).map(([assetId, closes], assetIndex) => [
        keyFor(assetId),
        closes.map((value, day) =>
          value * (assetIndex === 0 ? (day % 2 ? 1.002 : 0.998) : day % 2 ? 0.997 : 1.003),
        ),
      ]),
    );
    const result = backtestStrategies(closes, targets, {
      clock: new FixedClock(1_785_542_400_000),
      warmup: fixture.warmup,
      rebalanceEveryDays: fixture.rebalanceEveryDays,
      executionPricesById: opens,
      trialRegistry: trialRegistry(fixture.trialCount),
      evalSignal: (closes) => ({
        action: closes.length % 4 === 0 ? 'accumulate' : 'hold',
        rsi: 45,
        regime: 'calm',
      }),
    });
    expect({
      days: result.days,
      holdReturnPct: result.hold.metrics.totalReturnPct,
      passiveReturnPct: result.passive.metrics.totalReturnPct,
      passiveTurnoverUsd: result.passive.costs.turnoverUsd,
      passiveCostUsd: result.passive.costs.totalCostUsd,
      dsr: result.significance.dsr,
      trials: result.significance.trials,
      firstPassiveValue: result.passive.equity[0]!.value,
      lastPassiveValue: result.passive.equity.at(-1)!.value,
    }).toEqual(fixture.expected);
  });
});
