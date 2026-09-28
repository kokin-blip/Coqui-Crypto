import { describe, expect, it } from 'vitest';
import { compareMarketSelectorStudy, createMarketSelectorStudy, evaluateMarketSelectorSlot,
  evaluateUniverseAsset, reconcileSelectorVirtualFill, universeHash, WIDER_UNIVERSE_POLICY,
  type BreakoutAssetInput, type BreakoutHourlyBar,
  type SelectorPrevious } from '../packages/core/src/index.js';
import { appendMarketSelectorRecord, listMarketSelectorRecords,
  openDatabase } from '../packages/storage/src/index.js';
import { universeEvidence, universeSlot, UNIVERSE_ANCHOR } from './fixtures/wider-universe.js';

const HOUR = 3_600_000, DAY = 24 * HOUR;
const SLOT = Date.parse('2026-09-28T04:00:00Z');
const id = (base: string) => `coinbase|spot|${base}-USD`;
function bars(base: string, slotMs: number, mode: 'range' | 'up' | 'down' | 'breakout' = 'range'):
  BreakoutHourlyBar[] {
  return Array.from({ length: 720 }, (_, index) => {
    const progress = Math.max(0, (index - 552) / 167);
    const price = mode === 'up' ? 100 + 8 * progress : mode === 'down' ? 100 - 8 * progress :
      mode === 'breakout' && index >= 716 ? 110 : 98;
    return { assetId: id(base), startTimeMs: slotMs - (720 - index) * HOUR,
      open: String(price), high: mode === 'range' ? '104' : String(price + 1),
      low: mode === 'range' ? '96' : String(price - 1), close: String(price), volume: '10',
      retrievedAtMs: slotMs };
  });
}
function asset(base: string, slotMs: number, mode: 'range' | 'up' | 'down' | 'breakout' = 'range',
  eligible = true): BreakoutAssetInput {
  const evidence = universeEvidence(base, slotMs + 30_000);
  return { assetId: id(base), eligibility: { ...evaluateUniverseAsset(evidence, slotMs + 30_000), eligible },
    hourlyBars: bars(base, slotMs, mode), quote: { bid: '97.98', ask: '98.02', atMs: slotMs + 20_000 },
    observedAtMs: slotMs + 30_000 };
}
function previous(decision: ReturnType<typeof evaluateMarketSelectorSlot>): SelectorPrevious { return decision; }
function decide(slotMs: number, modes: Record<string, 'range' | 'up' | 'down' | 'breakout'> = {},
  prior: SelectorPrevious | null = null, heldAssetIds: string[] = [], baseline = { [id('BTC')]: 0.2 }) {
  return evaluateMarketSelectorSlot({ slotMs, assets: ['BTC', 'ETH', 'LTC', 'SOL']
    .map((base) => asset(base, slotMs, modes[base] ?? 'range')),
  baselineTarget: baseline, heldAssetIds, previous: prior });
}

describe('shadow market-state selector', () => {
  it('gives sustained bull and bear trends precedence over a new breakout', () => {
    const bullish = decide(SLOT, { BTC: 'up', ETH: 'up', LTC: 'breakout' });
    expect(bullish.observedState).toBe('sustained_trend');
    expect(bullish.preferred).toBe('trendvol');
    expect(bullish.candidates.breakout.reasons.some((r) => r.reason === 'entry_selected')).toBe(true);
    const bearish = decide(SLOT, { BTC: 'down', ETH: 'down' });
    expect(bearish.observedState).toBe('sustained_trend');
    expect(bearish.trend.details.map((item) => item.direction)).toEqual([-1, -1]);
  });
  it('ranks a cost-qualified breakout ahead of a stable range and falls back from an invalid incumbent', () => {
    const conflict = decide(SLOT, { LTC: 'breakout' });
    expect(conflict.candidates.range_rotation.available).toBe(true);
    expect(conflict.candidates.range_rotation.target).toEqual({});
    expect(conflict.observedState).toBe('new_breakout');
    expect(conflict.preferred).toBe('breakout');
    const confirmed = decide(SLOT + 4 * HOUR, { LTC: 'breakout' }, previous(conflict));
    expect(confirmed.selected).toBe('breakout');
    expect(confirmed.target[id('LTC')]).toBe(0.15);
    const staleHeld = evaluateMarketSelectorSlot({ slotMs: SLOT + 8 * HOUR,
      assets: ['BTC', 'ETH', 'LTC'].map((base) => base === 'LTC' ?
        { ...asset(base, SLOT + 8 * HOUR), hourlyBars: [] } : asset(base, SLOT + 8 * HOUR)),
      baselineTarget: { [id('BTC')]: 0.2 }, heldAssetIds: [id('LTC')], previous: confirmed });
    expect(staleHeld.selected).toBe('trendvol');
    expect(staleHeld.reason).toBe('incumbent_unavailable');
    const staleQuote = evaluateMarketSelectorSlot({ slotMs: SLOT + 8 * HOUR,
      assets: ['BTC', 'ETH', 'LTC'].map((base) => base === 'LTC' ?
        { ...asset(base, SLOT + 8 * HOUR),
          quote: { bid: '97.98', ask: '98.02', atMs: SLOT + 8 * HOUR - 90_000 } } :
        asset(base, SLOT + 8 * HOUR)),
      baselineTarget: { [id('BTC')]: 0.2 }, heldAssetIds: [id('LTC')], previous: confirmed });
    expect(staleQuote.selected).toBe('trendvol');
    expect(staleQuote.reason).toBe('incumbent_unavailable');
  });
  it('requires consecutive intraday slots and carries the confirmed strategy through midnight', () => {
    const first = decide(SLOT);
    expect(first.observedState).toBe('stable_range');
    expect(first.selected).toBe('trendvol');
    const second = decide(SLOT + 4 * HOUR, {}, previous(first));
    expect(second.selected).toBe('range_rotation');
    expect(second.reason).toBe('state_confirmed');
    const at16 = decide(SLOT + 12 * HOUR, {}, previous(second));
    const at20 = decide(SLOT + 16 * HOUR, {}, previous(at16));
    const midnight = decide(SLOT + 20 * HOUR, {}, previous(at20));
    expect(midnight.selected).toBe('range_rotation');
    expect(midnight.virtualExecutionAllowed).toBe(false);
    expect(midnight.streak).toBe(at20.streak);
    const next4 = decide(SLOT + DAY, {}, previous(midnight));
    expect(next4.selected).toBe('range_rotation');
    expect(next4.streak).toBe(2);
    const removed = evaluateMarketSelectorSlot({ slotMs: SLOT + 20 * HOUR,
      assets: ['BTC', 'ETH', 'LTC', 'SOL'].map((base) => asset(base, SLOT + 20 * HOUR,
        'range', base !== 'LTC')), baselineTarget: { [id('BTC')]: 0.2 },
      heldAssetIds: [id('LTC')], previous: { ...at20, target: { [id('LTC')]: 0.1 } } });
    expect(removed.selected).toBe('trendvol');
    const blockedExit = evaluateMarketSelectorSlot({ slotMs: SLOT + 20 * HOUR,
      assets: ['BTC', 'ETH', 'LTC', 'SOL'].map((base) => asset(base, SLOT + 20 * HOUR,
        'range', base !== 'LTC')), baselineTarget: { [id('BTC')]: 0.2 },
      heldAssetIds: [id('LTC')], previous: { ...at20, target: {} } });
    expect(blockedExit.selected).toBe('trendvol');
  });
  it('uses cash when the baseline is unavailable and rejects missing or future-known evidence', () => {
    const missing = evaluateMarketSelectorSlot({ slotMs: SLOT, assets: [], baselineTarget: null,
      heldAssetIds: [], previous: null });
    expect(missing.observedState).toBe('uncertain');
    expect(missing.selected).toBe('cash');
    const assets = ['BTC', 'ETH', 'LTC'].map((base) => asset(base, SLOT));
    assets[0] = { ...assets[0]!, hourlyBars: assets[0]!.hourlyBars.slice(1) };
    const invalid = evaluateMarketSelectorSlot({ slotMs: SLOT, assets, baselineTarget: null,
      heldAssetIds: [], previous: null });
    expect(invalid.observedState).toBe('uncertain');
    expect(invalid.selected).toBe('cash');
    assets[0] = { ...asset('BTC', SLOT), hourlyBars: bars('BTC', SLOT).map((bar) =>
      ({ ...bar, retrievedAtMs: SLOT + 60_000 })) };
    expect(evaluateMarketSelectorSlot({ slotMs: SLOT, assets, baselineTarget: null,
      heldAssetIds: [], previous: null }).trend.details[0]?.valid).toBe(false);
  });
  it('limits missing history to a newly eligible asset and rejects stale breakout quotes', () => {
    const assets = ['BTC', 'ETH', 'LTC', 'SOL'].map((base) => asset(base, SLOT));
    assets[3] = { ...asset('SOL', SLOT, 'breakout'), hourlyBars: bars('SOL', SLOT).slice(1) };
    const incomplete = evaluateMarketSelectorSlot({ slotMs: SLOT, assets,
      baselineTarget: { [id('BTC')]: 0.2 }, heldAssetIds: [], previous: null });
    expect(incomplete.observedState).toBe('stable_range');
    assets[3] = { ...asset('SOL', SLOT, 'breakout'),
      quote: { bid: '97.98', ask: '98.02', atMs: SLOT - 90_000 } };
    const stale = evaluateMarketSelectorSlot({ slotMs: SLOT, assets,
      baselineTarget: { [id('BTC')]: 0.2 }, heldAssetIds: [], previous: null });
    expect(stale.candidates.breakout.reasons.find((item) => item.assetId === id('SOL'))?.reason)
      .toBe('quote_unavailable_or_stale');
  });
  it('reconciles cumulative partial virtual fills exactly once and preserves pending quantity', () => {
    const book = { portfolio: { cash: '1000', quantities: {} }, pending: [{ id: 'o1',
      assetId: id('BTC'), side: 'buy' as const, quantity: '2', cumulativeFilled: '0',
      modeledPrice: '100', feeRate: '0.0025' }] };
    const half = reconcileSelectorVirtualFill(book, 'o1', '1');
    expect(half.portfolio.cash).toBe('900');
    expect(half.portfolio.quantities[id('BTC')]).toBe('0.9975');
    expect(half.pending).toHaveLength(1);
    const same = reconcileSelectorVirtualFill(half, 'o1', '1');
    expect(same.portfolio).toEqual(half.portfolio);
    const full = reconcileSelectorVirtualFill(same, 'o1', '2');
    expect(full.pending).toHaveLength(0);
    expect(full.portfolio.cash).toBe('800');
    expect(() => reconcileSelectorVirtualFill(half, 'o1', '0.5')).toThrow('invalid_virtual_fill');
  });
  it('stores profile-scoped immutable studies and reports only matched, completed evidence', () => {
    const db = openDatabase(':memory:');
    const study = createMarketSelectorStudy(SLOT, universeHash('source'), WIDER_UNIVERSE_POLICY,
      UNIVERSE_ANCHOR);
    expect(study.holdoutStartMs - study.startMs).toBe(60 * DAY);
    expect(study.endExclusiveMs - study.holdoutStartMs).toBe(90 * DAY);
    expect(appendMarketSelectorRecord('main', { kind: 'study', key: 'v1', atMs: SLOT,
      body: study }, db)).toBe(true);
    expect(appendMarketSelectorRecord('main', { kind: 'study', key: 'v1', atMs: SLOT,
      body: study }, db)).toBe(false);
    expect(listMarketSelectorRecords('other', 'study', db)).toEqual([]);
    expect(() => db.exec('DELETE FROM market_selector_records_v1')).toThrow('immutable');
    expect(compareMarketSelectorStudy(study, [], 'development', SLOT,
      study.sourceContentHash, () => [])).toMatchObject({ status: 'collecting', results: null });
    expect(compareMarketSelectorStudy(study, [], 'development', study.holdoutStartMs,
      study.sourceContentHash, () => [])).toMatchObject({ status: 'incomplete', results: null });
    const startMs = SLOT - 4 * HOUR;
    const short = { ...study, startMs, holdoutStartMs: startMs + DAY,
      endExclusiveMs: startMs + 2 * DAY };
    const { planHash: unused, ...material } = short;
    expect(unused).toMatch(/^[a-f0-9]{64}$/u);
    const shortened = { ...material, planHash: universeHash(material) };
    const slots = [0, 4, 8, 12, 16, 20].map((hour) => universeSlot(['BTC', 'ETH', 'LTC', 'SOL'],
      startMs + hour * HOUR + 30_000));
    const report = compareMarketSelectorStudy(shortened, slots, 'development', shortened.holdoutStartMs,
      shortened.sourceContentHash, (assetId, _fromMs, toMs, observedAtMs) =>
        bars(assetId.split('|').at(-1)!.split('-')[0]!, toMs).map((bar) =>
          ({ ...bar, retrievedAtMs: observedAtMs })));
    expect(report.status).toBe('modeled_only');
    if (report.status !== 'modeled_only') throw new Error('Expected modeled result');
    expect(report.results).toHaveLength(8);
    expect(report.results.every((result) => result.multiplier === 1 || result.multiplier === 2)).toBe(true);
    expect(report.promotion).toBe('disabled');
    const unavailable = compareMarketSelectorStudy(shortened, slots, 'development', shortened.holdoutStartMs,
      shortened.sourceContentHash, () => []);
    expect(unavailable.status).toBe('invalid_evidence');
    db.close();
  });
});
