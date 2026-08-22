import { describe, expect, it } from 'vitest';

import { CHANNEL_KINDS, CHANNEL_NAMES } from '../packages/contracts/src/index.js';
import { FixedClock, type UsdAmount } from '../packages/core/src/index.js';
import { RiskDashboardService } from '../packages/services/src/index.js';
import { openDatabase, savePortfolioSnapshot, type Db } from '../packages/storage/src/index.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

function seeded(values: readonly number[]): Db {
  const database = openDatabase(':memory:');
  values.forEach((value, index) => {
    savePortfolioSnapshot(
      {
        at: T0 + index * DAY,
        valueUsd: value.toFixed(2) as UsdAmount,
        costUsd: '10000.00' as UsdAmount,
        realizedPnlUsd: '0' as UsdAmount,
      },
      database,
    );
  });
  return database;
}

function view(values: readonly number[], atMs = T0 + values.length * DAY) {
  const database = seeded(values);
  const result = new RiskDashboardService({ database, clock: new FixedClock(atMs) }).view();
  database.close();
  return result;
}

/** A flat then falling series, deep enough to trip the hard stop. */
function crash(): number[] {
  const rising = Array.from({ length: 40 }, (_, index) => 10_000 + index * 10);
  const falling = Array.from({ length: 20 }, (_, index) => 10_400 * (1 - (index + 1) * 0.03));
  return [...rising, ...falling];
}

describe('the ladder is derived, never stored', () => {
  it('reports normal on a steady series', () => {
    const result = view(Array.from({ length: 40 }, (_, index) => 10_000 + index * 5));
    expect(result.stage).toBe('normal');
    expect(result.exposureScale).toBe(1);
  });

  it('drops exposure as the drawdown deepens', () => {
    const result = view(crash());
    // The rung is a consequence of the equity curve, computed on this read.
    // Nothing persists it, so nothing can be out of date with the curve.
    expect(result.stage).toBe('hard_stop');
    expect(result.exposureScale).toBe(0);
    expect(result.maxTradeCount).toBe(0);
    expect(result.blockReason).not.toBeNull();
  });

  it('always describes every rung, including the ones not active', () => {
    const result = view([10_000, 10_100]);
    // A ladder showing only the current rung teaches the user that the absence
    // of a warning means nothing was checked.
    expect(result.ladder.map((rung) => rung.stage)).toEqual([
      'normal',
      'caution',
      'defense',
      'hard_stop',
    ]);
    expect(result.ladder.filter((rung) => rung.active)).toHaveLength(1);
  });
});

describe('a short history says so', () => {
  it('flags an insufficient sample rather than reporting a confident zero', () => {
    const result = view([10_000, 10_050]);
    // A drawdown computed over two points is arithmetic, not information, and
    // it renders identically to a real measurement unless it is labelled.
    expect(result.insufficientHistory).toBe(true);
    expect(result.sampleCount).toBe(2);
  });

  it('stops flagging once there is enough', () => {
    expect(view(Array.from({ length: 40 }, () => 10_000)).insufficientHistory).toBe(false);
  });
});

describe('snapshot age is reported, and is not price staleness', () => {
  it('reports how old the equity history is', () => {
    const result = view(Array.from({ length: 40 }, () => 10_000), T0 + 60 * DAY);
    expect(result.snapshotAgeMs).toBe(21 * DAY);
  });

  it('does not turn a daily snapshot cadence into a permanent hard stop', () => {
    // The staleness control measures a *price feed*, whose timeout is two
    // hours. Feeding it snapshot age would hard-stop a perfectly healthy
    // application every day — and the dashboard would then disagree with the
    // gate, which is worse than showing nothing.
    const result = view(Array.from({ length: 40 }, () => 10_000), T0 + 60 * DAY);
    expect(result.staleMarketData).toBe(false);
    expect(result.stage).toBe('normal');
  });
});

describe('the gate cannot be edited from the UI', () => {
  it('exposes no write channel that could change it', () => {
    // P8's exit criterion, asserted structurally. The absence of a channel is a
    // stronger guarantee than a disabled control, and this test is what keeps
    // one from being added without the reasoning being revisited.
    expect(CHANNEL_KINDS.write).toEqual(['portfolio.reconciliation.resolve']);
    expect(CHANNEL_NAMES.filter((channel) => channel.startsWith('risk.'))).toEqual([
      'risk.dashboard',
      'risk.evidence-gate',
    ]);
    for (const channel of CHANNEL_NAMES) {
      if (channel.startsWith('risk.')) expect(CHANNEL_KINDS.write).not.toContain(channel);
    }
  });

  it('offers no setter on the service', () => {
    const database = openDatabase(':memory:');
    const service = new RiskDashboardService({ database, clock: new FixedClock(T0) });
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    expect(methods.filter((name) => name !== 'constructor')).toEqual(['view']);
    database.close();
  });
});
