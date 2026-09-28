import { describe, expect, it } from 'vitest';
import { compareRangeRotationStudy, createRangeRotationStudy, evaluateRangeRotationSlot,
  evaluateUniverseAsset, planRangeRotationShadow, universeHash, WIDER_UNIVERSE_POLICY,
  type BreakoutAssetInput, type BreakoutHourlyBar } from '../packages/core/src/index.js';
import { appendRangeRotationRecord, listRangeRotationRecords, openDatabase } from '../packages/storage/src/index.js';
import { universeEvidence, universeSlot, UNIVERSE_ANCHOR } from './fixtures/wider-universe.js';

const HOUR = 3_600_000;
const SLOT = Date.parse('2026-09-28T04:00:00Z');
function bars(assetId: string, slotMs: number, lastClose = '98'): BreakoutHourlyBar[] {
  return Array.from({ length: 720 }, (_, index) => ({ assetId,
    startTimeMs: slotMs - (720 - index) * HOUR,
    open: '97', high: '104', low: '96', close: index === 719 ? lastClose : '97',
    volume: '10', retrievedAtMs: slotMs - HOUR }));
}
function asset(base: string, slotMs = SLOT, lastClose = '98', eligible = true): BreakoutAssetInput {
  const evidence = universeEvidence(base, slotMs + 30_000), assetId = evidence.mapping!.assetId;
  return { assetId, hourlyBars: bars(assetId, slotMs, lastClose),
    eligibility: { ...evaluateUniverseAsset(evidence, slotMs + 30_000), eligible },
    quote: { bid: '97.98', ask: '98.02', atMs: slotMs + 20_000 },
    observedAtMs: slotMs + 30_000 };
}
function input(slotMs = SLOT, bases = ['BTC', 'ETH', 'LTC', 'SOL'], heldAssetIds: string[] = [],
  previousSlotMs: number | null = null, previousQualifiedIds: string[] = [],
  previousReplacementIds: string[] = []) {
  return { slotMs, assets: bases.map((base) => asset(base, slotMs)), heldAssetIds,
    previousSlotMs, previousQualifiedIds, previousReplacementIds };
}

describe('frozen sideways range rotation', () => {
  it('requires both broad-market ranges and two consecutive qualified slots', () => {
    const first = evaluateRangeRotationSlot(input());
    expect(first.marketPass).toBe(true);
    expect(first.weights).toEqual({});
    expect(first.qualifiedIds).toHaveLength(4);
    const second = evaluateRangeRotationSlot(input(SLOT + 4 * HOUR,
      ['BTC', 'ETH', 'LTC', 'SOL'], [], SLOT, first.qualifiedIds));
    expect(Object.keys(second.weights)).toHaveLength(3);
    expect(Object.values(second.weights)).toEqual([0.1, 0.1, 0.1]);
    const failed = input(SLOT + 4 * HOUR);
    failed.assets[0] = asset('BTC', SLOT + 4 * HOUR, '110');
    const gate = evaluateRangeRotationSlot(failed);
    expect(gate.marketPass).toBe(false);
    expect(gate.weights).toEqual({});
  });
  it('rejects gaps, future-known history, stale quotes, and insufficient benefit', () => {
    const missing = input();
    missing.assets[2] = { ...missing.assets[2]!, hourlyBars: missing.assets[2]!.hourlyBars.slice(1) };
    expect(evaluateRangeRotationSlot(missing).assessments.find((a) => a.assetId.endsWith('LTC-USD'))?.reason)
      .toBe('hourly_history_incomplete');
    const future = input();
    future.assets[2] = { ...future.assets[2]!, hourlyBars: future.assets[2]!.hourlyBars.map((bar) => ({
      ...bar, retrievedAtMs: SLOT + 60_000 })) };
    expect(evaluateRangeRotationSlot(future).qualifiedIds).not.toContain(future.assets[2]!.assetId);
    const stale = input();
    stale.assets[2] = { ...stale.assets[2]!, quote: { bid: '97.98', ask: '98.02', atMs: SLOT - 70_000 } };
    expect(evaluateRangeRotationSlot(stale).qualifiedIds).not.toContain(stale.assets[2]!.assetId);
    const costly = input();
    costly.assets[2] = { ...costly.assets[2]!, quote: { bid: '97', ask: '99', atMs: SLOT + 20_000 } };
    expect(evaluateRangeRotationSlot(costly).assessments.find((a) => a.assetId.endsWith('LTC-USD'))?.reason)
      .toBe('benefit_below_cost');
  });
  it('exits on gate loss and eligibility loss; unstable ranks cannot rotate immediately', () => {
    const confirmed = evaluateRangeRotationSlot(input(SLOT + 4 * HOUR,
      ['BTC', 'ETH', 'LTC', 'SOL'], [], SLOT, ['coinbase|spot|BTC-USD', 'coinbase|spot|ETH-USD',
        'coinbase|spot|LTC-USD', 'coinbase|spot|SOL-USD']));
    const held = Object.keys(confirmed.weights);
    const changed = evaluateRangeRotationSlot(input(SLOT + 8 * HOUR,
      ['BTC', 'ETH', 'LTC', 'SOL', 'ZEC'], held, SLOT + 4 * HOUR, confirmed.qualifiedIds));
    expect(Object.keys(changed.weights)).toEqual(held);
    expect(changed.replacementIds).toContain('coinbase|spot|ZEC-USD');
    const rotated = evaluateRangeRotationSlot(input(SLOT + 12 * HOUR,
      ['BTC', 'ETH', 'LTC', 'SOL', 'ZEC'], held, SLOT + 8 * HOUR,
      changed.qualifiedIds, changed.replacementIds));
    expect(rotated.weights['coinbase|spot|ZEC-USD']).toBe(0.1);
    expect(rotated.desiredExits.length).toBeGreaterThan(0);
    const lost = input(SLOT + 8 * HOUR, ['BTC', 'ETH', 'LTC', 'SOL'], held,
      SLOT + 4 * HOUR, confirmed.qualifiedIds);
    lost.assets[2] = asset('LTC', SLOT + 8 * HOUR, '98', false);
    const exit = evaluateRangeRotationSlot(lost);
    expect(exit.desiredExits).toContain('coinbase|spot|LTC-USD');
    const marketLost = input(SLOT + 8 * HOUR, ['BTC', 'ETH', 'LTC', 'SOL'], held);
    marketLost.assets[0] = asset('BTC', SLOT + 8 * HOUR, '110');
    expect(evaluateRangeRotationSlot(marketLost).desiredExits).toEqual([...held].sort());
  });
  it('enforces virtual turnover and keeps records immutable across restarts', () => {
    const db = openDatabase(':memory:');
    const study = createRangeRotationStudy(SLOT, universeHash('source'), WIDER_UNIVERSE_POLICY, UNIVERSE_ANCHOR);
    expect(study.holdoutStartMs - study.startMs).toBe(60 * 86_400_000);
    expect(appendRangeRotationRecord('main', { kind: 'study', key: 'v1', atMs: SLOT, body: study }, db)).toBe(true);
    expect(appendRangeRotationRecord('main', { kind: 'study', key: 'v1', atMs: SLOT, body: study }, db)).toBe(false);
    expect(listRangeRotationRecords('other', 'study', db)).toEqual([]);
    expect(() => db.exec('DELETE FROM range_rotation_records_v1')).toThrow('immutable');
    const slot = universeSlot(['BTC', 'ETH', 'LTC', 'SOL'], SLOT + 30_000);
    const second = evaluateRangeRotationSlot(input(SLOT, ['BTC', 'ETH', 'LTC', 'SOL'], [], SLOT - 8 * HOUR,
      ['coinbase|spot|BTC-USD', 'coinbase|spot|ETH-USD', 'coinbase|spot|LTC-USD', 'coinbase|spot|SOL-USD']));
    const limited = planRangeRotationShadow(slot, second, { cash: '100000', quantities: {} },
      '100000', '60000', WIDER_UNIVERSE_POLICY);
    expect(limited.orders).toHaveLength(0);
    expect(limited.dailyTurnoverUsd).toBe('60000');
    expect(limited.rejected.some((r) => r.reasons.includes('turnover_cap'))).toBe(true);
    db.close();
  });
  it('requires complete matched evidence and never promotes a replay result', () => {
    const original = createRangeRotationStudy(SLOT - 2 * 86_400_000, universeHash('source'),
      WIDER_UNIVERSE_POLICY, UNIVERSE_ANCHOR);
    expect(compareRangeRotationStudy(original, [], 'development', original.holdoutStartMs,
      original.sourceContentHash, () => [])).toMatchObject({ status: 'incomplete', results: null });
    const startMs = SLOT - 4 * HOUR;
    const short = { ...original, startMs, holdoutStartMs: startMs + 86_400_000,
      endExclusiveMs: startMs + 2 * 86_400_000 };
    const { planHash: unused, ...material } = short;
    expect(unused).toMatch(/^[a-f0-9]{64}$/u);
    const study = { ...material, planHash: universeHash(material) };
    const slots = [0, 4, 8, 12, 16, 20].map((hour) => universeSlot(['BTC', 'ETH', 'LTC', 'SOL'],
      startMs + hour * HOUR + 30_000));
    const report = compareRangeRotationStudy(study, slots, 'development', study.holdoutStartMs,
      study.sourceContentHash, (assetId, _fromMs, toMs, observedAtMs) => bars(assetId, toMs)
        .map((bar) => ({ ...bar, retrievedAtMs: observedAtMs - HOUR })));
    expect(report.status).toBe('modeled_only');
    if (report.status !== 'modeled_only') throw new Error('Expected modeled result');
    expect(report.results).toHaveLength(6);
    expect(report.results.find((result) => result.candidate === 'range_rotation' &&
      result.multiplier === 1)?.orders).toBeGreaterThan(0);
    expect(report.promotion).toBe('disabled');
    const gap = compareRangeRotationStudy(study, slots, 'development', study.holdoutStartMs,
      study.sourceContentHash, () => []);
    expect(gap.status).toBe('invalid_evidence');
  });
});
