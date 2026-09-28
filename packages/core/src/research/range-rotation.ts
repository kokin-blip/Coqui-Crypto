import { Decimal } from 'decimal.js';
import { DEFAULT_AUTO_TRADE_GUARDRAILS } from '../risk/autotrade.js';
import { breakoutFourHourBars, type BreakoutAssetInput } from './breakout.js';
import { freezeUniverse, UNIVERSE_COSTS, UNIVERSE_DAY, universeHash,
  validateUniversePolicy, type UniversePolicy } from './wider-universe.js';

const HOUR = 3_600_000;
export const RANGE_ROTATION_VERSION = 'wider-range-rotation-v1' as const;
export const RANGE_ROTATION_RULES = freezeUniverse({ version: RANGE_ROTATION_VERSION,
  slotsUtc: [4, 8, 12, 16, 20], hourlyWarmup: 720, rangeBars: 42,
  marketMaximumWidth: 0.12, marketMaximumReturn: 0.04,
  coinMinimumWidth: 0.04, coinMaximumWidth: 0.18,
  strengthHours: 24, benefitRealization: 0.5, lowerBandWeight: 0.5,
  maximumPositions: 3, positionWeight: 0.1, replacementScoreGap: 0.25,
  maximumSlotTurnover: 0.35, maximumDailyTurnover: 0.6, maximumSlotOrders: 6 });

export function createRangeRotationStudy(registeredAtMs: number, sourceContentHash: string,
  policy: UniversePolicy, anchor: Readonly<Record<string, string>>) {
  if (!Number.isSafeInteger(registeredAtMs) || registeredAtMs <= 0 ||
      !/^[a-f0-9]{64}$/u.test(sourceContentHash)) throw new Error('invalid_range_study');
  validateUniversePolicy(policy);
  const startMs = (Math.floor(registeredAtMs / UNIVERSE_DAY) + 1) * UNIVERSE_DAY;
  const plan = { schemaVersion: 1 as const, version: RANGE_ROTATION_VERSION, registeredAtMs,
    startMs, holdoutStartMs: startMs + 60 * UNIVERSE_DAY,
    endExclusiveMs: startMs + 150 * UNIVERSE_DAY, sourceContentHash,
    policyHash: universeHash(policy), policy, anchor, rules: RANGE_ROTATION_RULES,
    dataDefinitionHash: universeHash({ venue: 'coinbase', interval: '1h',
      completeness: 'completed_only', firstRetrievalAsOf: true,
      hourlyWarmup: RANGE_ROTATION_RULES.hourlyWarmup,
      universePolicyHash: universeHash(policy) }),
    openingCash: '100000', costs: { ...UNIVERSE_COSTS, spread: 'observed', multipliers: [1, 2] },
    guardrails: DEFAULT_AUTO_TRADE_GUARDRAILS,
    candidates: ['trendvol', 'breakout', 'range_rotation'] as const,
    promotion: 'disabled' as const };
  return freezeUniverse({ ...plan, planHash: universeHash(plan) });
}
export type RangeRotationStudy = ReturnType<typeof createRangeRotationStudy>;

export interface RangeRotationInput {
  readonly slotMs: number; readonly assets: readonly BreakoutAssetInput[];
  readonly heldAssetIds: readonly string[];
  readonly previousSlotMs: number | null;
  readonly previousQualifiedIds: readonly string[];
  readonly previousReplacementIds: readonly string[];
}

function priorSlot(slotMs: number): number {
  return slotMs - (new Date(slotMs).getUTCHours() === 4 ? 8 : 4) * HOUR;
}
function ratio(numerator: Decimal, denominator: Decimal): Decimal {
  return numerator.div(denominator);
}
function freshQuote(asset: BreakoutAssetInput, slotMs: number): Decimal | null {
  const q = asset.quote;
  if (!q || q.atMs > asset.observedAtMs || asset.observedAtMs - q.atMs > 60_000 ||
      asset.observedAtMs < slotMs || asset.observedAtMs >= slotMs + 900_000) return null;
  try {
    const bid = new Decimal(q.bid), ask = new Decimal(q.ask);
    if (!bid.isFinite() || !ask.isFinite() || !bid.gt(0) || ask.lt(bid)) return null;
    return new Decimal(UNIVERSE_COSTS.takerFee).plus(UNIVERSE_COSTS.adverseSlippage)
      .mul(2).plus(ask.minus(bid).div(bid.plus(ask).div(2)));
  } catch { return null; }
}

/** Immutable completed-bar decision; no credentials, brokerage calls, or mutable state. */
export function evaluateRangeRotationSlot(input: RangeRotationInput) {
  if (!Number.isSafeInteger(input.slotMs) || input.slotMs % (4 * HOUR) !== 0 ||
      !RANGE_ROTATION_RULES.slotsUtc.includes(new Date(input.slotMs).getUTCHours())) throw new Error('invalid_range_slot');
  const held = new Set(input.heldAssetIds);
  const previousValid = input.previousSlotMs === priorSlot(input.slotMs);
  const previousQualified = previousValid ? new Set(input.previousQualifiedIds) : new Set<string>();
  const previousReplacement = previousValid ? new Set(input.previousReplacementIds) : new Set<string>();
  const seen = new Set<string>();
  type Candidate = { assetId: string; lower: Decimal; strength: Decimal; benefit: Decimal;
    cost: Decimal; score: Decimal; rangeWidth: Decimal; eligible: boolean; inRange: boolean;
    atMidpoint: boolean; hourlyHash: string | null; eligibilityHash: string; reason: string };
  const candidates: Candidate[] = [];
  for (const asset of [...input.assets].sort((a, b) => a.assetId.localeCompare(b.assetId))) {
    if (seen.has(asset.assetId) || asset.eligibility.assetId !== asset.assetId) throw new Error('invalid_range_asset');
    seen.add(asset.assetId);
    const bars = asset.hourlyBars.some((bar) => bar.retrievedAtMs !== undefined &&
      bar.retrievedAtMs > asset.observedAtMs) ? null :
      breakoutFourHourBars(asset.assetId, asset.hourlyBars, input.slotMs);
    const item: Candidate = { assetId: asset.assetId, lower: new Decimal(0), strength: new Decimal(0),
      benefit: new Decimal(0), cost: new Decimal(0), score: new Decimal(0), rangeWidth: new Decimal(0),
      eligible: asset.eligibility.eligible, inRange: false, atMidpoint: false,
      hourlyHash: bars === null ? null : universeHash(asset.hourlyBars),
      eligibilityHash: universeHash(asset.eligibility), reason: 'hourly_history_incomplete' };
    if (bars !== null) {
      const prior = bars.slice(-43, -1), latest = bars.at(-1)!;
      const high = Decimal.max(...prior.map((bar) => bar.high));
      const low = Decimal.min(...prior.map((bar) => bar.low));
      const midpoint = high.plus(low).div(2);
      item.rangeWidth = ratio(high.minus(low), midpoint);
      item.inRange = latest.close.gte(low) && latest.close.lte(high);
      item.atMidpoint = latest.close.gte(midpoint);
      item.lower = item.inRange && !item.atMidpoint ? Decimal.max(0, Decimal.min(1,
        ratio(midpoint.minus(latest.close), midpoint.minus(low)))) : new Decimal(0);
      item.strength = ratio(latest.close, bars.at(-7)!.close).minus(1);
      item.benefit = item.atMidpoint ? new Decimal(0) :
        ratio(midpoint.minus(latest.close), latest.close).mul(RANGE_ROTATION_RULES.benefitRealization);
      item.cost = freshQuote(asset, input.slotMs) ?? new Decimal(Infinity);
      item.reason = !item.eligible ? 'not_eligible' : !item.inRange ? 'range_break' :
        item.atMidpoint ? 'midpoint_reached' :
          item.rangeWidth.lt(RANGE_ROTATION_RULES.coinMinimumWidth) ||
          item.rangeWidth.gt(RANGE_ROTATION_RULES.coinMaximumWidth) ? 'coin_range_width' :
            !item.cost.isFinite() ? 'quote_unavailable_or_stale' :
              !item.strength.gt(0) ? 'strength_not_positive' :
                !item.benefit.gt(item.cost) ? 'benefit_below_cost' : 'qualified';
    }
    candidates.push(item);
  }
  const market = ['BTC', 'ETH'].map((base) => {
    const item = candidates.find((c) => c.assetId === `coinbase|spot|${base}-USD`);
    const asset = input.assets.find((a) => a.assetId === item?.assetId);
    const bars = asset && item?.hourlyHash !== null ? breakoutFourHourBars(asset.assetId, asset.hourlyBars, input.slotMs) : null;
    if (!item || !bars) return { assetId: `coinbase|spot|${base}-USD`, pass: false, reason: 'history_missing' };
    const prior = bars.slice(-43, -1), latest = bars.at(-1)!;
    const marketReturn = ratio(latest.close, prior[0]!.open).minus(1).abs();
    const pass = item.eligible && item.inRange && item.rangeWidth.lte(RANGE_ROTATION_RULES.marketMaximumWidth) &&
      marketReturn.lte(RANGE_ROTATION_RULES.marketMaximumReturn);
    return { assetId: item.assetId, pass, reason: pass ? 'range_bound' : 'market_gate_failed',
      width: item.rangeWidth.toFixed(), absoluteReturn: marketReturn.toFixed(),
      hourlyHash: item.hourlyHash, eligibilityHash: item.eligibilityHash };
  });
  const marketPass = market.every((m) => m.pass);
  const qualified = candidates.filter((c) => c.reason === 'qualified' && marketPass);
  const byStrength = [...qualified].sort((a, b) => a.strength.cmp(b.strength) || a.assetId.localeCompare(b.assetId));
  byStrength.forEach((item, index) => {
    const relative = byStrength.length === 1 ? new Decimal('0.5') :
      new Decimal(index).div(byStrength.length - 1);
    item.score = item.lower.mul(RANGE_ROTATION_RULES.lowerBandWeight)
      .plus(relative.mul(1 - RANGE_ROTATION_RULES.lowerBandWeight));
  });
  const ordered = [...qualified].sort((a, b) => b.score.cmp(a.score) || a.assetId.localeCompare(b.assetId));
  const retained = new Set<string>(), desiredExits = new Set<string>();
  for (const id of held) {
    const c = candidates.find((item) => item.assetId === id);
    if (!marketPass || !c || !c.eligible || !c.inRange || c.atMidpoint || c.hourlyHash === null ||
        c.rangeWidth.lt(RANGE_ROTATION_RULES.coinMinimumWidth) ||
        c.rangeWidth.gt(RANGE_ROTATION_RULES.coinMaximumWidth)) desiredExits.add(id);
    else retained.add(id);
  }
  const replacementIds: string[] = [];
  const selected = new Set(retained);
  for (const c of ordered) {
    if (selected.has(c.assetId) || held.has(c.assetId)) continue;
    if (selected.size < RANGE_ROTATION_RULES.maximumPositions) {
      if (previousQualified.has(c.assetId)) selected.add(c.assetId);
      continue;
    }
    const weakest = [...selected].map((id) => candidates.find((item) => item.assetId === id)!)
      .sort((a, b) => a.score.cmp(b.score) || b.assetId.localeCompare(a.assetId))[0]!;
    if (c.score.minus(weakest.score).lt(RANGE_ROTATION_RULES.replacementScoreGap)) continue;
    replacementIds.push(c.assetId);
    if (previousQualified.has(c.assetId) && previousReplacement.has(c.assetId)) {
      selected.delete(weakest.assetId); desiredExits.add(weakest.assetId); selected.add(c.assetId);
    }
  }
  const weights = Object.fromEntries([...selected].sort().map((id) => [id, RANGE_ROTATION_RULES.positionWeight]));
  const assessments = candidates.map((c) => ({ assetId: c.assetId,
    reason: !marketPass && c.reason === 'qualified' ? 'market_gate_failed' :
      selected.has(c.assetId) ? 'selected' : c.reason === 'qualified' && !previousQualified.has(c.assetId) ?
        'awaiting_confirmation' : c.reason === 'qualified' ? 'not_selected' : c.reason,
    score: c.score.isFinite() ? c.score.toFixed() : null, strength24h: c.strength.toFixed(),
    rangeWidth: c.rangeWidth.toFixed(), benefitProxy: c.benefit.toFixed(),
    roundTripCost: c.cost.isFinite() ? c.cost.toFixed() : null,
    hourlyHash: c.hourlyHash, eligibilityHash: c.eligibilityHash }));
  return freezeUniverse({ version: RANGE_ROTATION_VERSION, slotMs: input.slotMs, market,
    marketPass, weights, qualifiedIds: qualified.map((c) => c.assetId).sort(),
    replacementIds: replacementIds.sort(), desiredExits: [...desiredExits].sort(),
    assessments, inputHash: universeHash(input), applied: false as const, executionEnabled: false as const });
}
