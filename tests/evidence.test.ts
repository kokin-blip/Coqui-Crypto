import { describe, expect, it } from 'vitest';
import {
  backtestStrategies,
  evidenceFromBacktest,
  evidenceGateChecklist,
  EVIDENCE_MIN_SAMPLE_DAYS,
  FixedClock,
  type EvidenceSnapshot,
} from '../packages/core/src/index.js';
import { BTC, ETH, NO_TRADE_COSTS } from './support.js';

function snapshot(overrides: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot {
  return {
    dayMs: 0,
    leader: 'trendvol',
    dsr: 0.96,
    psr: 0.99,
    sigVerdict: 'significant',
    wfVerdict: 'adds_value',
    leaderSortino: 0.6,
    holdSortino: 0.2,
    passiveSortino: 0.1,
    sampleDays: 900,
    ...overrides,
  };
}

describe('evidenceGateChecklist', () => {
  it('requires all four checks and keeps the result advisory', () => {
    const gate = evidenceGateChecklist(snapshot());
    expect(gate.items).toHaveLength(4);
    expect(gate.items.every((item) => item.met)).toBe(true);
    expect(gate.allMet).toBe(true);
    expect(gate.summary).toContain('stays disabled');
  });

  it('fails significance below the 95% bar', () => {
    const gate = evidenceGateChecklist(snapshot({ sigVerdict: 'inconclusive', dsr: 0.92 }));
    expect(gate.allMet).toBe(false);
    expect(gate.items.find((item) => item.id === 'significance')).toMatchObject({ met: false });
    expect(gate.items.find((item) => item.id === 'significance')?.detail).toContain('92%');
    expect(gate.summary).toContain('3 of 4');
  });

  it('fails when the leader does not beat both benchmarks', () => {
    expect(
      evidenceGateChecklist(snapshot({ leaderSortino: 0.15, holdSortino: 0.2 })).items.find(
        (item) => item.id === 'beats_benchmarks',
      )?.met,
    ).toBe(false);
    expect(
      evidenceGateChecklist(snapshot({ leaderSortino: null })).items.find(
        (item) => item.id === 'beats_benchmarks',
      )?.met,
    ).toBe(false);
  });

  it('requires the minimum sample and an adds-value walk-forward verdict', () => {
    expect(
      evidenceGateChecklist(snapshot({ sampleDays: EVIDENCE_MIN_SAMPLE_DAYS - 1 })).items.find(
        (item) => item.id === 'sample_size',
      )?.met,
    ).toBe(false);
    expect(
      evidenceGateChecklist(snapshot({ wfVerdict: 'matches_passive' })).items.find(
        (item) => item.id === 'walk_forward',
      )?.met,
    ).toBe(false);
  });
});

describe('evidenceFromBacktest', () => {
  it('maps a scoreboard run into a snapshot with the named leader Sortino', () => {
    const saw = Array.from({ length: 160 }, (_, index) =>
      100 + (index % 2 === 0 ? index * 0.5 : index * 0.5 - 2),
    );
    const result = backtestStrategies(
      { [BTC]: saw, [ETH]: saw },
      [
        { assetId: BTC, weight: 0.5 },
        { assetId: ETH, weight: 0.5 },
      ],
      {
        clock: new FixedClock(123),
        warmup: 5,
        rebalanceEveryDays: 4,
        tradeCosts: NO_TRADE_COSTS,
        evalSignal: () => ({ action: 'hold', rsi: 50, regime: 'calm' }),
      },
    );
    const mapped = evidenceFromBacktest(result, 123);
    expect(mapped.dayMs).toBe(123);
    expect(mapped.leader).toBe(result.significance.leader);
    expect(mapped.sampleDays).toBe(result.days);
    expect(mapped.leaderSortino).toBe(
      result[result.significance.leader as keyof Pick<
        typeof result,
        'passive' | 'signal' | 'momentum' | 'voltarget' | 'trendvol' | 'rotation'
      >].metrics.sortino,
    );
  });
});
