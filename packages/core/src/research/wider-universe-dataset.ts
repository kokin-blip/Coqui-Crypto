import { trendVolTargets } from '../strategies/trend-vol.js';
import { DEFAULT_AUTO_TRADE_GUARDRAILS } from '../risk/autotrade.js';
import { instrumentKey, type InstrumentKey } from '../types/index.js';
import { evaluateUniverseAsset, freezeUniverse, positive, UNIVERSE_COSTS, UNIVERSE_DAY,
  universeHash, validateUniversePolicy, WIDER_UNIVERSE_POLICY, type UniverseAssetEvidence, type UniversePolicy } from './wider-universe.js';

export const WIDER_BASELINE_IDS = ['BTC', 'ETH', 'LTC'].map((base) => instrumentKey({ venue: 'coinbase', productType: 'spot', productId: `${base}-USD` }));
export interface UniverseObservation {
  readonly atMs: number; readonly evidence: UniverseAssetEvidence;
}
export interface DynamicUniverseSlot {
  readonly slotMs: number; readonly observations: readonly UniverseObservation[];
  /** Complete previous-day catalog, including unsupported products. */
  readonly catalogAssetIds: readonly string[];
  readonly catalogHash: string;
}
export interface DynamicUniverseDataset {
  readonly schemaVersion: 1; readonly startMs: number; readonly endExclusiveMs: number;
  readonly slots: readonly DynamicUniverseSlot[]; readonly datasetHash: string;
  readonly universeHash: string; readonly missingSlots: readonly number[];
}
export function prepareDynamicUniverseDataset(slots: readonly DynamicUniverseSlot[], startMs: number,
  endExclusiveMs: number): DynamicUniverseDataset {
  if (![startMs, endExclusiveMs].every((v) => Number.isSafeInteger(v) && v % UNIVERSE_DAY === 0) ||
      endExclusiveMs <= startMs) throw new Error('invalid_universe_period');
  const canonical = slots.filter((s) => s.slotMs >= startMs && s.slotMs < endExclusiveMs)
    .map((s) => ({ ...s, catalogAssetIds: [...s.catalogAssetIds].sort(),
      observations: s.observations.map((o) => ({ ...o, evidence: { ...o.evidence,
        bars: [...o.evidence.bars].sort((a, b) => a.startTimeMs - b.startTimeMs) } })).sort((a, b) => instrumentKey(a.evidence.product.instrument)
        .localeCompare(instrumentKey(b.evidence.product.instrument))) })).sort((a, b) => a.slotMs - b.slotMs);
  const seen = new Set<number>();
  for (const slot of canonical) {
    if (seen.has(slot.slotMs) || slot.slotMs % (UNIVERSE_DAY / 6) !== 0 || !/^[a-f0-9]{64}$/u.test(slot.catalogHash)) throw new Error('invalid_universe_slot');
    seen.add(slot.slotMs);
    const ids: string[] = slot.observations.map((o) => instrumentKey(o.evidence.product.instrument));
    if (new Set(ids).size !== ids.length || new Set(slot.catalogAssetIds).size !== slot.catalogAssetIds.length ||
        ids.some((id) => !slot.catalogAssetIds.includes(id)) || slot.catalogAssetIds.some((id) => !ids.includes(id)) ||
        slot.observations.some((o) => o.atMs < slot.slotMs || o.atMs >= slot.slotMs + 900_000)) throw new Error('incomplete_universe_slot');
  }
  const missingSlots: number[] = [];
  for (let t = startMs; t < endExclusiveMs; t += UNIVERSE_DAY / 6) if (!seen.has(t)) missingSlots.push(t);
  const membership = canonical.map((s) => [s.slotMs, s.catalogHash, s.observations.map((o) =>
    [instrumentKey(o.evidence.product.instrument), o.evidence.mapping, o.evidence.catalogObservedAtMs])]);
  return freezeUniverse({ schemaVersion: 1, startMs, endExclusiveMs, slots: canonical, missingSlots,
    universeHash: universeHash(membership), datasetHash: universeHash({ schemaVersion: 1, startMs, endExclusiveMs, slots: canonical }) });
}
export function universeStrategyInput(slot: DynamicUniverseSlot, anchor: Readonly<Record<string, string>>,
  policy: UniversePolicy = WIDER_UNIVERSE_POLICY) {
  const evaluations = slot.observations.map((o) => evaluateUniverseAsset(o.evidence, o.atMs, policy));
  const eligibleIds = evaluations.filter((e) => e.eligible).map((e) => e.assetId).sort();
  const endMs = Math.floor(slot.slotMs / UNIVERSE_DAY) * UNIVERSE_DAY;
  const histories: Record<string, number[]> = {};
  for (const id of new Set([...WIDER_BASELINE_IDS, ...eligibleIds])) {
    const observation = slot.observations.find((o) => instrumentKey(o.evidence.product.instrument) === id);
    if (!observation) throw new Error('baseline_history_missing');
    const bars = observation.evidence.bars;
    const values: number[] = [];
    for (let t = endMs - 121 * UNIVERSE_DAY; t < endMs; t += UNIVERSE_DAY) {
      const matching = bars.filter((b) => b.startTimeMs === t && b.endTimeMs === t + UNIVERSE_DAY && b.isComplete &&
        b.assetId === id && b.source === 'coinbase' && b.quality === 'reported_ohlc');
      if (matching.length !== 1 || !Number.isFinite(matching[0]!.close) || matching[0]!.close <= 0) throw new Error('strategy_history_gap');
      values.push(matching[0]!.close);
    }
    histories[id] = values;
  }
  for (const id of WIDER_BASELINE_IDS) if (!positive(anchor[id] ?? '')) throw new Error('baseline_anchor_missing');
  const mix = Array.from({ length: 121 }, (_, i) => WIDER_BASELINE_IDS.reduce((sum, id) =>
    sum + histories[id]![i]! / Number(anchor[id]) / 3, 0));
  const targetsFor = (ids: readonly string[]) => {
    if (ids.length === 0) return {};
    const result = trendVolTargets(ids.map((assetId) => ({ assetId: assetId as InstrumentKey, weight: 1 / ids.length })), histories, mix);
    if (result.historyStatus !== 'complete') throw new Error('strategy_history_incomplete');
    return Object.fromEntries(result.targets.map((t) => [t.assetId, t.weight]));
  };
  return freezeUniverse({ schemaVersion: 1, decisionBeforeMs: endMs, slotMs: slot.slotMs,
    policyHash: universeHash(policy), membershipHash: universeHash(evaluations),
    datasetHash: universeHash(slot), anchorHash: universeHash(anchor), eligibleIds, histories, evaluations,
    baselineTargets: targetsFor(WIDER_BASELINE_IDS), proposedTargets: targetsFor(eligibleIds),
    executionAuthority: 'none' as const, mode: 'shadow' as const });
}
export function createWiderUniverseStudy(registeredAtMs: number, sourceContentHash: string,
  anchor: Readonly<Record<string, string>>, policy: UniversePolicy = WIDER_UNIVERSE_POLICY) {
  if (!/^[a-f0-9]{64}$/u.test(sourceContentHash) || !Number.isSafeInteger(registeredAtMs) || registeredAtMs <= 0) throw new Error('invalid_study_provenance');
  validateUniversePolicy(policy);
  const startMs = (Math.floor(registeredAtMs / UNIVERSE_DAY) + 1) * UNIVERSE_DAY;
  const plan = { schemaVersion: 1, version: `wider-universe-v1:${universeHash(policy)}`, registeredAtMs,
    startMs, holdoutStartMs: startMs + 60 * UNIVERSE_DAY, endExclusiveMs: startMs + 150 * UNIVERSE_DAY,
    sourceContentHash, anchor, policy, strictPolicy: { ...policy, version: `${policy.version}-liquid`,
      maxSpreadBps: Math.min(policy.maxSpreadBps, 25), depthMultiple: Math.max(policy.depthMultiple, 20) },
    candidates: ['baseline', 'wider', 'liquid'] as const,
    costs: { version: 'alpaca-universe-cost-v1', ...UNIVERSE_COSTS,
      spread: 'observed', multipliers: [1, 2], buyFee: 'received_asset', sellFee: 'received_cash' },
    guardrails: { ...DEFAULT_AUTO_TRADE_GUARDRAILS },
    openingCash: '100000', execution: 'daily-plus-four-hour', promotion: 'disabled',
    historicalQualification: 'requires_complete_untouched_evaluation' };
  return freezeUniverse({ ...plan, planHash: universeHash(plan) });
}
export type WiderUniverseStudy = ReturnType<typeof createWiderUniverseStudy>;
