import { describe, expect, it, vi } from 'vitest';

import { HOURLY_EXECUTION_V1, advanceHourlyExecution, hourlySlotAt, openingHourlyState, replayHourlyExecution,
  type HourlyExecutionObservation } from '../packages/core/src/research/hourly-execution.js';
import { canonicalJson, instrumentKey, sha256Hex } from '../packages/core/src/index.js';
import { collectParallelHourlyShadow, hourlyShadowStatus, hourlyExecutionSourceHash } from '../packages/services/src/paper/parallel-hourly-shadow.js';
import { PARALLEL_INSTRUMENTS } from '../packages/services/src/paper/parallel-signal.js';
import { appendHourlyExecutionRecord, listHourlyExecutionRecords, openDatabase } from '../packages/storage/src/index.js';

const START = Date.parse('2026-09-29T00:00:00Z');
const HOUR = 3_600_000;
const HASH = sha256Hex('hourly-study');

function row(hour: number, price = 100, target = 0.5): HourlyExecutionObservation {
  const slotMs = START + hour * HOUR;
  return { slotMs, capturedAtMs: slotMs + 60_000,
    decisionDay: new Date(slotMs - 86_400_000).toISOString().slice(0, 10),
    datasetHash: HASH, targetHash: HASH, targets: [target, 0, 0],
    quotes: [0, 1, 2].map(() => ({ bid: price - 0.1, ask: price + 0.1, atMs: slotMs + 59_000 })),
    assets: [0, 1, 2].map(() => ({ tradable: true, status: 'active',
      minOrderSize: '0.001', minTradeIncrement: '0.001' })) };
}

describe('hourly TrendVol execution candidate', () => {
  it('has exact slot boundaries and rejects unfinished or stale evidence', () => {
    expect(hourlySlotAt(START + 14 * 60_000)).toBe(START);
    expect(hourlySlotAt(START + 15 * 60_000)).toBeNull();
    expect(() => advanceHourlyExecution({ observation: { ...row(0),
      quotes: row(0).quotes.map((quote) => ({ ...quote, atMs: START - 120_000 })) },
      state: openingHourlyState(1000, [0, 0, 0]), policy: 'trendvol-hourly-execution-v1' }))
      .toThrow('stale_or_ineligible_hourly_evidence');
    expect(() => advanceHourlyExecution({ observation: { ...row(0), decisionDay: '2026-09-29' },
      state: openingHourlyState(1000, [0, 0, 0]), policy: 'trendvol-hourly-execution-v1' }))
      .toThrow('invalid_hourly_observation');
  });

  it('models fees, sizing, cooldown, cadence and pending partial fills', () => {
    const open = openingHourlyState(1000, [0, 0, 0]);
    const first = advanceHourlyExecution({ observation: row(0), state: open,
      policy: 'trendvol-hourly-execution-v1' });
    expect(first.orders).toHaveLength(1);
    expect(first.orders[0]!.feeUsd).toBeGreaterThan(0);
    const one = advanceHourlyExecution({ observation: row(1, 120), state: first.state,
      policy: 'trendvol-hourly-execution-v1' });
    expect(one.orders).toHaveLength(0);
    expect(one.blocked).toContainEqual({ assetIndex: 0, reason: 'cooldown' });
    const baseline = advanceHourlyExecution({ observation: row(1, 120), state: first.state,
      policy: 'daily-plus-four-hour' });
    expect(baseline.blocked).toContainEqual({ assetIndex: 0, reason: 'cadence' });
    const two = advanceHourlyExecution({ observation: row(2, 120), state: one.state,
      policy: 'trendvol-hourly-execution-v1' });
    expect(two.orders).toHaveLength(1);
    const partial = advanceHourlyExecution({ observation: row(0), state: open,
      policy: 'trendvol-hourly-execution-v1', fillFraction: 0.5 });
    expect(partial.orders[0]!.partial).toBe(true);
    expect(partial.state.pending).toHaveLength(1);
    const resumed = advanceHourlyExecution({ observation: row(1, 120), state: partial.state,
      policy: 'trendvol-hourly-execution-v1' });
    expect(resumed.state.pending).toHaveLength(0);
    expect(resumed.blocked).toContainEqual({ assetIndex: 0, reason: 'pending' });
  });

  it('compares identical daily targets and rejects incomplete or changed tapes', () => {
    const tape = Array.from({ length: 24 }, (_, hour) => row(hour, hour === 0 ? 100 : 120));
    const opening = openingHourlyState(1000, [0, 0, 0]);
    const base = replayHourlyExecution(tape, opening);
    expect(base.status).toBe('modeled_replay_only');
    expect(base.results).toHaveLength(2);
    expect(base.results[0]!.feesUsd).toBeGreaterThan(0);
    expect(base.results[1]!.blockedByReason['cooldown']).toBeGreaterThan(0);
    expect(replayHourlyExecution(tape, opening, 2).results[0]!.netReturn)
      .toBeLessThan(base.results[0]!.netReturn);
    expect(replayHourlyExecution(tape.slice(1), opening).status).toBe('incomplete_days');
    const changed = [...tape]; changed[3] = { ...changed[3]!, targets: [0.4, 0, 0] };
    expect(replayHourlyExecution(changed, opening).status).toBe('invalid_or_gapped_hourly_tape');
    const later = [...tape]; later[23] = row(23, 200);
    expect(replayHourlyExecution(later, opening).results[0]!.equityCurve.slice(0, 23))
      .toEqual(base.results[0]!.equityCurve.slice(0, 23));
  });

  it('requires explicit registration before collection, persists virtual slots, and resumes idempotently', async () => {
    const db = openDatabase(':memory:');
    let nowMs = START - 86_400_000 + 60_000;
    const submit = vi.fn();
    const read = { latestCryptoQuotes: async () => ({ quotes: Object.fromEntries(['BTC', 'ETH', 'LTC'].map((symbol) =>
      [`${symbol}/USD`, { bp: '99.9', ap: '100.1', t: new Date(nowMs - 1000).toISOString() }])) }),
    asset: async (symbol: string) => ({ symbol, tradable: true, status: 'active',
      min_order_size: '0.001', min_trade_increment: '0.001' }),
    account: async () => ({ cash: '1000' }), positions: async () => [], submit };
    const decision = { day: '2026-09-27', weights: Object.fromEntries(
      PARALLEL_INSTRUMENTS.map((instrument, index) => [instrumentKey(instrument), index === 0 ? 0.5 : 0])) };
    const collect = () => collectParallelHourlyShadow({ profileId: 'main', experimentId: HASH, db, nowMs,
      datasetHash: HASH, decision: { ...decision,
        day: new Date(nowMs - 86_400_000).toISOString().slice(0, 10) }, read: read as never });
    await collect();
    expect(listHourlyExecutionRecords('main', 'study', db)).toHaveLength(0);
    appendHourlyExecutionRecord('main', {kind:'study',key:HOURLY_EXECUTION_V1.id,atMs:nowMs,body:{version:HOURLY_EXECUTION_V1.id,
      experimentId:HASH,startMs:START,foldEndsMs:[20,40,60].map(days=>START+days*86_400_000),holdoutEndMs:START+90*86_400_000,
      planHash:sha256Hex(canonicalJson(HOURLY_EXECUTION_V1)),sourceHash:hourlyExecutionSourceHash()}},db);
    expect(hourlyShadowStatus('main', db).startMs).toBe(START);
    expect(listHourlyExecutionRecords('main', 'observation', db)).toHaveLength(0);
    nowMs = START + 60_000;
    await collect(); await collect();
    expect(listHourlyExecutionRecords('main', 'observation', db)).toHaveLength(1);
    expect(listHourlyExecutionRecords('main', 'shadow', db)).toHaveLength(1);
    nowMs += HOUR;
    await collect();
    expect(listHourlyExecutionRecords('main', 'shadow', db)).toHaveLength(2);
    nowMs = START + 9 * HOUR + 60_000; // Daily order window missed; stored target is still usable.
    await collect(); await collect();
    expect(listHourlyExecutionRecords('main', 'shadow', db)).toHaveLength(3);
    await expect(collectParallelHourlyShadow({ profileId: 'main', experimentId: sha256Hex('other'),
      db, nowMs, datasetHash: HASH, decision: { ...decision,
        day: new Date(nowMs - 86_400_000).toISOString().slice(0, 10) }, read: read as never }))
      .rejects.toThrow('hourly_experiment_changed');
    expect(submit).not.toHaveBeenCalled();
    db.close();
  });

  it('keeps hourly evidence profile-scoped and immutable', () => {
    const db = openDatabase(':memory:');
    const record = { kind: 'observation' as const, key: 'slot', atMs: START, body: { value: 1 } };
    expect(appendHourlyExecutionRecord('main', record, db)).toBe(true);
    expect(appendHourlyExecutionRecord('main', record, db)).toBe(false);
    expect(listHourlyExecutionRecords('other', 'observation', db)).toHaveLength(0);
    expect(() => appendHourlyExecutionRecord('main', { ...record, body: { value: 2 } }, db))
      .toThrow('hourly_execution_record_conflict');
    expect(() => db.exec("UPDATE hourly_execution_records_v1 SET at_ms=1 WHERE profile_id='main'"))
      .toThrow('hourly execution evidence is immutable');
    db.close();
  });
});
