import { describe, expect, it } from 'vitest';
import { breakoutFourHourBars, compareBreakoutStudy, createBreakoutStudy, evaluateBreakoutSlot, evaluateUniverseAsset,
  universeHash, WIDER_UNIVERSE_POLICY, type BreakoutHourlyBar } from '../packages/core/src/index.js';
import { appendBreakoutRecord, listBreakoutHourlyBars, listBreakoutRecords, openDatabase,
  saveBreakoutHourlyBars } from '../packages/storage/src/index.js';
import { universeEvidence, universeSlot, UNIVERSE_ANCHOR } from './fixtures/wider-universe.js';

const HOUR = 3_600_000;
const SLOT = Date.parse('2026-09-28T04:00:00Z');
function bars(assetId: string, lastClose = '101.5'): BreakoutHourlyBar[] {
  return Array.from({ length: 720 }, (_, index) => {
    const close = index === 719 ? lastClose : '100';
    return { assetId, startTimeMs: SLOT - (720 - index) * HOUR,
      open: '100', high: close, low: '100', close, volume: '10', retrievedAtMs: SLOT - HOUR };
  });
}
function asset(base = 'BTC', lastClose = '101.5', eligible = true) {
  const evidence = universeEvidence(base, SLOT + 30_000);
  const assetId = evidence.mapping!.assetId;
  return { assetId, hourlyBars: bars(assetId, lastClose),
    eligibility: { ...evaluateUniverseAsset(evidence, SLOT + 30_000), eligible },
    quote: { bid: '100.98', ask: '101.02', atMs: SLOT + 20_000 }, observedAtMs: SLOT + 30_000 };
}

describe('frozen intraday breakout', () => {
  it('uses exactly 720 completed hours and ignores duplicate, malformed or future-known bars', () => {
    const a = asset();
    expect(breakoutFourHourBars(a.assetId, a.hourlyBars, SLOT)).toHaveLength(180);
    expect(breakoutFourHourBars(a.assetId, a.hourlyBars, SLOT)?.[0]?.volume.toString()).toBe('40');
    for (const changed of [a.hourlyBars.slice(1), [...a.hourlyBars, a.hourlyBars[0]!],
      a.hourlyBars.map((bar, i) => i === 3 ? { ...bar, high: '0' } : bar),
      a.hourlyBars.map((bar, i) => i === 4 ? { ...bar, volume: null } : bar)]) {
      expect(breakoutFourHourBars(a.assetId, changed, SLOT)).toBeNull();
    }
    expect(evaluateBreakoutSlot({ slotMs: SLOT, assets: [{ ...a,
      hourlyBars: a.hourlyBars.map((bar) => ({ ...bar, retrievedAtMs: SLOT + 40_000 })) }],
      heldAssetIds: [] }).weights).toEqual({});
  });
  it('enters above the fixed cost hurdle, sizes at 15%, exits below three prior lows', () => {
    const a = asset();
    const entry = evaluateBreakoutSlot({ slotMs: SLOT, assets: [a], heldAssetIds: [] });
    expect(entry.weights).toEqual({ [a.assetId]: 0.15 });
    expect(entry.assessments[0]!.reason).toBe('entry_selected');
    expect(evaluateBreakoutSlot({ slotMs: SLOT, assets: [asset('BTC', '100.2')], heldAssetIds: [] }).weights).toEqual({});
    const exitAsset = asset('BTC', '98');
    exitAsset.hourlyBars[719] = { ...exitAsset.hourlyBars[719]!, high: '100', low: '98' };
    const exit = evaluateBreakoutSlot({ slotMs: SLOT, assets: [exitAsset], heldAssetIds: [a.assetId] });
    expect(exit.desiredExits).toEqual([a.assetId]);
    expect(exit.weights).toEqual({});
  });
  it('does not enter with stale quotes or lost eligibility and ranks tied entries canonically', () => {
    const assets = ['BTC', 'ETH', 'LTC', 'SOL', 'ADA', 'DOGE'].map((base) => asset(base));
    const decision = evaluateBreakoutSlot({ slotMs: SLOT, assets: [...assets].reverse(), heldAssetIds: [] });
    expect(Object.keys(decision.weights)).toHaveLength(5);
    expect(Object.keys(decision.weights)).toEqual(assets.map((a) => a.assetId).sort().slice(0, 5));
    expect(decision.assessments.filter((a) => a.reason === 'capacity_reached')).toHaveLength(1);
    expect(evaluateBreakoutSlot({ slotMs: SLOT, assets: [{ ...assets[0]!,
      quote: { ...assets[0]!.quote, atMs: SLOT - 70_000 } }], heldAssetIds: [] }).weights).toEqual({});
    expect(evaluateBreakoutSlot({ slotMs: SLOT, assets: [asset('BTC', '101.5', false)], heldAssetIds: [] }).weights).toEqual({});
    expect(evaluateBreakoutSlot({ slotMs: SLOT, assets: [assets[0]!], heldAssetIds: [] })).toEqual(
      evaluateBreakoutSlot({ slotMs: SLOT, assets: [assets[0]!], heldAssetIds: [] }));
  });
  it('registers distinct prospective evidence and stores hourly bars immutably by profile', () => {
    const study = createBreakoutStudy(SLOT, universeHash('source'), WIDER_UNIVERSE_POLICY, UNIVERSE_ANCHOR);
    expect(study.startMs).toBe(Date.parse('2026-09-29T00:00:00Z'));
    expect(study.holdoutStartMs - study.startMs).toBe(60 * 86_400_000);
    const db = openDatabase(':memory:'), a = asset();
    const hourly = { ...a.hourlyBars[0]!, source: 'public' as const, retrievedAtMs: SLOT };
    saveBreakoutHourlyBars('main', [hourly], db);
    saveBreakoutHourlyBars('main', [hourly], db);
    expect(listBreakoutHourlyBars('main', a.assetId, hourly.startTimeMs,
      hourly.startTimeMs + HOUR, SLOT - 1, db)).toEqual([]);
    expect(listBreakoutHourlyBars('main', a.assetId, hourly.startTimeMs,
      hourly.startTimeMs + HOUR, SLOT, db)).toHaveLength(1);
    expect(listBreakoutHourlyBars('other', a.assetId, hourly.startTimeMs,
      hourly.startTimeMs + HOUR, SLOT, db)).toEqual([]);
    expect(() => saveBreakoutHourlyBars('main', [{ ...hourly, close: '99' }], db)).toThrow('conflict');
    expect(appendBreakoutRecord('main', { kind: 'study', key: 'v1', atMs: SLOT, body: study }, db)).toBe(true);
    expect(appendBreakoutRecord('main', { kind: 'study', key: 'v1', atMs: SLOT, body: study }, db)).toBe(false);
    expect(listBreakoutRecords('main', 'study', db)).toHaveLength(1);
    expect(compareBreakoutStudy(study, [], 'development', SLOT, study.sourceContentHash,
      () => [])).toMatchObject({ status: 'collecting', results: null });
    expect(compareBreakoutStudy(study, [], 'development', study.holdoutStartMs,
      study.sourceContentHash, () => [])).toMatchObject({ status: 'incomplete', results: null });
    expect(compareBreakoutStudy(study, [], 'holdout', study.endExclusiveMs,
      universeHash('changed'), () => [])).toMatchObject({ status: 'source_changed', results: null });
    expect(() => db.exec('DELETE FROM breakout_research_records_v1')).toThrow('immutable');
    db.close();
  });
  it('replays a complete matched calendar without changing the real paper portfolio', () => {
    const original = createBreakoutStudy(SLOT - 2 * 86_400_000, universeHash('source'),
      WIDER_UNIVERSE_POLICY, UNIVERSE_ANCHOR);
    const short = { ...original, startMs: SLOT - 4 * HOUR,
      holdoutStartMs: SLOT - 4 * HOUR + 86_400_000,
      endExclusiveMs: SLOT - 4 * HOUR + 2 * 86_400_000 };
    const { planHash: oldHash, ...material } = short;
    expect(oldHash).toMatch(/^[a-f0-9]{64}$/u);
    const study = { ...material, planHash: universeHash(material) };
    const slots = [0, 4, 8, 12, 16, 20].map((hour) => universeSlot(['BTC', 'ETH', 'LTC', 'SOL'],
      short.startMs + hour * HOUR + 30_000));
    const report = compareBreakoutStudy(study, slots, 'development', short.holdoutStartMs,
      study.sourceContentHash, (assetId, fromMs, toMs, observedAtMs) => {
        const offset = toMs - SLOT;
        return bars(assetId).map((bar) => ({ ...bar, startTimeMs: bar.startTimeMs + offset,
          retrievedAtMs: observedAtMs - HOUR }));
      });
    expect(report.status).toBe('modeled_only');
    if (report.status !== 'modeled_only') throw new Error('Expected modeled comparison.');
    expect(report.results).toHaveLength(4);
    expect(report.results.find((result) => result.candidate === 'breakout' && result.multiplier === 1)!.orders).toBeGreaterThan(0);
    expect(report.promotion).toBe('disabled');
  });
});
