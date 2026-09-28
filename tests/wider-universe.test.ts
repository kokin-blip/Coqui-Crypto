import { describe, expect, it } from 'vitest';
import { createWiderUniverseStudy, evaluateUniverseAsset, mapUniverseProducts, prepareDynamicUniverseDataset,
  planUniverseShadow, compareWiderUniverse, universeHash, universeQuantity, universeStrategyInput,
  WIDER_UNIVERSE_POLICY, STRICT_UNIVERSE_POLICY, UNIVERSE_DAY } from '../packages/core/src/index.js';
import { parallelDecision } from '../packages/services/src/index.js';
import { universeEvidence, universeSlot, UNIVERSE_NOW, UNIVERSE_ANCHOR } from './fixtures/wider-universe.js';

describe('wider-universe eligibility', () => {
  it('qualifies evidenced assets and preserves deterministic hashes and immutable output', () => {
    const e = universeEvidence(), result = evaluateUniverseAsset(e, UNIVERSE_NOW);
    expect(result.eligible).toBe(true);
    expect(result.history).toMatchObject({ coveredDays: 180, longestGap: 0, evidencedAgeDays: 180, hourlyReadiness: 'not_collected' });
    expect(evaluateUniverseAsset(JSON.parse(JSON.stringify(e)), UNIVERSE_NOW)).toEqual(result);
    expect(Object.isFrozen(result.checks)).toBe(true);
    expect(evaluateUniverseAsset(e, UNIVERSE_NOW, STRICT_UNIVERSE_POLICY).policyHash).not.toBe(result.policyHash);
  });
  it('rejects current catalogs used backward, missing days, future and stale market evidence', () => {
    const e = universeEvidence();
    expect(evaluateUniverseAsset({ ...e, catalogObservedAtMs: UNIVERSE_NOW }, UNIVERSE_NOW).reasons).toContain('catalog_asof');
    expect(evaluateUniverseAsset({ ...e, catalogObservedAtMs: UNIVERSE_NOW - 3 * UNIVERSE_DAY }, UNIVERSE_NOW).reasons).toContain('catalog_asof');
    for (const offset of [-60_001, 1]) {
      expect(evaluateUniverseAsset({ ...e, alpaca: { ...e.alpaca!, quoteAtMs: UNIVERSE_NOW + offset } }, UNIVERSE_NOW).reasons).toContain('alpaca_fresh');
    }
    expect(evaluateUniverseAsset({ ...e, accountReady: null }, UNIVERSE_NOW).checks).toContainEqual(
      { code: 'account_ready', status: 'unknown', measured: null, threshold: null });
  });
  it('records gaps, duplicates, incomplete candles and young products without interpolating', () => {
    const e = universeEvidence();
    const missing = evaluateUniverseAsset({ ...e, bars: e.bars.slice(3) }, UNIVERSE_NOW);
    expect(missing.history).toMatchObject({ coveredDays: 177, longestGap: 3 });
    expect(missing.reasons).toEqual(expect.arrayContaining(['history_complete', 'product_age']));
    expect(evaluateUniverseAsset({ ...e, bars: [...e.bars, e.bars[0]!] }, UNIVERSE_NOW).reasons).toContain('history_complete');
    expect(evaluateUniverseAsset({ ...e, bars: e.bars.map((b, i) => ({ ...b, isComplete: i !== 179 })) }, UNIVERSE_NOW).history.incompleteBars).toBe(1);
  });
  it('rejects wide spreads, shallow depth, unknown increments and expensive native minima', () => {
    const e = universeEvidence();
    expect(evaluateUniverseAsset({ ...e, alpaca: { ...e.alpaca!, ask: '102' } }, UNIVERSE_NOW).reasons).toContain('alpaca_spread');
    expect(evaluateUniverseAsset(e, UNIVERSE_NOW, WIDER_UNIVERSE_POLICY, '10000000').reasons).toContain('alpaca_depth');
    expect(evaluateUniverseAsset({ ...e, asset: { ...e.asset!, min_trade_increment: '0' } }, UNIVERSE_NOW).reasons).toContain('alpaca_rules');
    expect(evaluateUniverseAsset({ ...e, asset: { ...e.asset!, min_order_size: '1' } }, UNIVERSE_NOW).reasons).toContain('alpaca_minimum');
    expect(evaluateUniverseAsset({ ...e, currentAsset: { ...e.asset!, tradable: false } }, UNIVERSE_NOW).reasons).toContain('alpaca_current_tradable');
    expect(evaluateUniverseAsset({ ...e, currentProduct: { ...e.currentProduct!, baseMinSize: '1' } }, UNIVERSE_NOW).reasons).toContain('coinbase_minimum');
    expect(evaluateUniverseAsset({ ...e, currentProduct: { ...e.currentProduct!, auctionMode: true } }, UNIVERSE_NOW).reasons).toContain('coinbase_not_auction');
  });
  it('maps exact identities only and records unsupported or ambiguous products', () => {
    const e = universeEvidence();
    expect(mapUniverseProducts([e.product], [])[0]!.reason).toBe('alpaca_product_absent');
    expect(mapUniverseProducts([e.product], [e.asset!, e.asset!])[0]!.reason).toBe('ambiguous_mapping');
    expect(evaluateUniverseAsset({ ...e, mapping: { ...e.mapping!, alpacaAssetId: 'other' } }, UNIVERSE_NOW).eligible).toBe(false);
  });
  it('rounds to venue increments without truncating nine-decimal quantities', () => {
    expect(universeQuantity('1.0000000099', '0.000000001', '0.001')).toBe('1.000000009');
    expect(universeQuantity('0.0001', '0.001', '0.01')).toBe('0');
    expect(() => universeQuantity('1', '0', '0.01')).toThrow();
  });
});

describe('dynamic inputs and shadow accounting', () => {
  it('handles zero, one, three and many eligible assets with canonical ordering', () => {
    for (const count of [0, 1, 3, 8]) {
      const bases = ['BTC', 'ETH', 'LTC', ...Array.from({ length: 5 }, (_, i) => `ASSET${i}`)];
      const original = universeSlot(bases);
      const observations = original.observations.map((o, i) => ({ ...o, evidence: { ...o.evidence,
        currentAsset: { ...o.evidence.asset!, tradable: i < count } } }));
      const slot = { ...original, observations };
      const input = universeStrategyInput(slot, UNIVERSE_ANCHOR);
      expect(input.eligibleIds).toHaveLength(count);
      expect(Object.keys(input.proposedTargets)).toHaveLength(count);
      const start = original.slotMs, end = start + UNIVERSE_DAY;
      expect(prepareDynamicUniverseDataset([slot], start, end).datasetHash).toBe(
        prepareDynamicUniverseDataset([{ ...slot, observations: [...observations].reverse() }], start, end).datasetHash);
    }
  });
  it('matches unchanged three-coin TrendVol and fixed anchor', () => {
    const slot = universeSlot(['BTC', 'ETH', 'LTC']);
    const input = universeStrategyInput(slot, UNIVERSE_ANCHOR);
    const bars = slot.observations[0]!.evidence.bars;
    const data = { dayKeys: bars.map((b) => new Date(b.startTimeMs).toISOString().slice(0, 10)),
      closesById: Object.fromEntries(slot.observations.map((o) => [o.evidence.mapping!.assetId, o.evidence.bars.map((b) => b.close)])) };
    expect(input.baselineTargets).toEqual(parallelDecision(data as never, UNIVERSE_ANCHOR).weights);
    expect(input.proposedTargets).toEqual(input.baselineTargets);
  });
  it('preserves the calendar, rejects duplicate/missing membership and future observation slots', () => {
    const slot = universeSlot();
    const dataset = prepareDynamicUniverseDataset([slot], slot.slotMs, slot.slotMs + UNIVERSE_DAY);
    expect(dataset.missingSlots).toHaveLength(5);
    expect(() => prepareDynamicUniverseDataset([slot, slot], slot.slotMs, slot.slotMs + UNIVERSE_DAY)).toThrow();
    expect(() => prepareDynamicUniverseDataset([{ ...slot, observations: slot.observations.slice(1) }], slot.slotMs, slot.slotMs + UNIVERSE_DAY)).toThrow();
    expect(() => prepareDynamicUniverseDataset([{ ...slot, observations: slot.observations.map((o) => ({ ...o, atMs: slot.slotMs + 900_000 })) }], slot.slotMs, slot.slotMs + UNIVERSE_DAY)).toThrow();
  });
  it('models fees in received assets and reports stress, turnover and concentration', () => {
    const slot = universeSlot(), id = slot.catalogAssetIds[0]!;
    const first = planUniverseShadow(slot, { [id]: 0.2 }, { cash: '1000', quantities: {} });
    const stress = planUniverseShadow(slot, { [id]: 0.2 }, { cash: '1000', quantities: {} }, WIDER_UNIVERSE_POLICY, 2);
    expect(first.orders).toHaveLength(1);
    expect(first.mode).toBe('shadow'); expect(first.applied).toBe(false);
    expect(Number(first.portfolio.quantities[id])).toBeLessThan(Number(first.orders[0]!.quantity));
    expect(Number(stress.equity)).toBeLessThan(Number(first.equity));
    expect(first.concentrationIndex).toBe(1); expect(first.effectiveAssetCount).toBe(1);
    expect(Number(first.turnoverUsd)).toBeGreaterThan(0);
  });
  it('retains dust, allows evidenced exits after history loss, and blocks missing held valuations', () => {
    const slot = universeSlot(), id = slot.catalogAssetIds[0]!;
    const dust = planUniverseShadow(slot, {}, { cash: '1000', quantities: { [id]: '0.001' } });
    expect(dust.portfolio.quantities[id]).toBe('0.001');
    const excluded = { ...slot, observations: slot.observations.map((o) => ({ ...o, evidence: { ...o.evidence, bars: [] } })) };
    expect(planUniverseShadow(excluded, {}, { cash: '1000', quantities: { [id]: '1' } }).orders[0]!.side).toBe('sell');
    expect(() => planUniverseShadow(slot, {}, { cash: '1000', quantities: { unknown: '1' } })).toThrow('missing_valuation_evidence');
  });
  it('enforces risk and liquidity against proposed order size rather than the discovery probe', () => {
    const slot = universeSlot(), id = slot.catalogAssetIds[0]!;
    const small = { ...slot, observations: slot.observations.map((o) => ({ ...o, evidence: { ...o.evidence,
      alpaca: { ...o.evidence.alpaca!, bids: [{ price: '99.9', size: '3' }], asks: [{ price: '100.1', size: '3' }] } } })) };
    expect(evaluateUniverseAsset(small.observations[0]!.evidence, UNIVERSE_NOW).eligible).toBe(true);
    expect(planUniverseShadow(small, { [id]: 0.2 }, { cash: '1000', quantities: {} }).rejected[0]!.reasons).toContain('alpaca_depth');
    expect(planUniverseShadow(slot, { [id]: 0.9 }, { cash: '1000', quantities: {} }).rejected[0]!.reasons).toContain('turnover_cap');
  });
  it('seals the holdout, reports missing evidence and rejects tampered registration', () => {
    const study = createWiderUniverseStudy(UNIVERSE_NOW, universeHash('source'), UNIVERSE_ANCHOR);
    expect(compareWiderUniverse(study, [], 'holdout', study.endExclusiveMs - 1).status).toBe('collecting');
    const poisoned = { get slotMs(): number { throw new Error('holdout accessed'); } };
    expect(compareWiderUniverse(study, [poisoned as never], 'holdout', UNIVERSE_NOW).status).toBe('collecting');
    const incomplete = compareWiderUniverse(study, [], 'development', study.holdoutStartMs);
    expect(incomplete.status).toBe('incomplete'); expect(incomplete.results).toBeNull();
    expect(() => compareWiderUniverse({ ...study, openingCash: '1' }, [], 'development', study.endExclusiveMs)).toThrow('study_integrity');
    expect(compareWiderUniverse(study, [], 'development', study.endExclusiveMs, universeHash('changed')).status).toBe('source_changed');
  });
  it('compares all three candidates at both costs on a complete registered development calendar', () => {
    const study = createWiderUniverseStudy(UNIVERSE_NOW, universeHash('source'), UNIVERSE_ANCHOR);
    const slots = Array.from({ length: 60 * 6 }, (_, i) => universeSlot(['BTC', 'ETH', 'LTC', 'SOL'],
      study.startMs + i * UNIVERSE_DAY / 6 + 300_000));
    const result = compareWiderUniverse(study, slots, 'development', study.holdoutStartMs);
    expect(result.status).toBe('modeled_only');
    expect(result.results).toHaveLength(6);
    for (const row of result.results ?? []) {
      expect(row.curve).toHaveLength(360);
      expect(row.assetSlots).toBe(1440);
      expect(row.netReturn).toBeLessThanOrEqual(0); // Flat quotes cannot manufacture a gain after costs.
      if (row.candidate === 'baseline') expect(row.netReturnDifference).toBe(0);
      expect(row.maxDrawdown).toBeLessThanOrEqual(0);
    }
    const missing = { ...slots[0]!, observations: slots[0]!.observations.map((o, i) => i === 3
      ? { ...o, evidence: { ...o.evidence, alpaca: null } } : o) };
    expect(compareWiderUniverse(study, [missing, ...slots.slice(1)], 'development', study.holdoutStartMs).status).toBe('invalid_evidence');
  }, 30_000);
});
