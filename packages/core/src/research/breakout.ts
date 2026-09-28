import { Decimal } from 'decimal.js';
import { DEFAULT_AUTO_TRADE_GUARDRAILS } from '../risk/autotrade.js';
import { freezeUniverse, UNIVERSE_COSTS, UNIVERSE_DAY, universeHash,
  validateUniversePolicy, type UniverseEligibility, type UniversePolicy } from './wider-universe.js';

const HOUR = 3_600_000;
const FOUR_HOURS = 4 * HOUR;
const HISTORY_HOURS = 30 * 24;
export const BREAKOUT_VERSION = 'wider-breakout-v1' as const;
export const BREAKOUT_RULES = freezeUniverse({ version: BREAKOUT_VERSION, historyHours: HISTORY_HOURS,
  entryBars: 6, exitBars: 3, maxPositions: 5, weightPerPosition: 0.15,
  slotsUtc: [4, 8, 12, 16, 20] });

export function createBreakoutStudy(registeredAtMs: number, sourceContentHash: string,
  policy: UniversePolicy, anchor: Readonly<Record<string, string>>) {
  if (!Number.isSafeInteger(registeredAtMs) || registeredAtMs <= 0 ||
      !/^[a-f0-9]{64}$/u.test(sourceContentHash)) {
    throw new Error('invalid_breakout_study');
  }
  validateUniversePolicy(policy);
  const startMs = (Math.floor(registeredAtMs / UNIVERSE_DAY) + 1) * UNIVERSE_DAY;
  const plan = { schemaVersion: 1 as const, version: BREAKOUT_VERSION, registeredAtMs,
    startMs, holdoutStartMs: startMs + 60 * UNIVERSE_DAY,
    endExclusiveMs: startMs + 150 * UNIVERSE_DAY, sourceContentHash,
    policyHash: universeHash(policy), policy, anchor,
    rules: BREAKOUT_RULES, openingCash: '100000', costs: { ...UNIVERSE_COSTS, spread: 'observed', multipliers: [1, 2] },
    guardrails: DEFAULT_AUTO_TRADE_GUARDRAILS, candidates: ['trendvol', 'breakout'] as const,
    promotion: 'disabled' as const };
  return freezeUniverse({ ...plan, planHash: universeHash(plan) });
}
export type BreakoutStudy = ReturnType<typeof createBreakoutStudy>;

export interface BreakoutHourlyBar {
  readonly assetId: string; readonly startTimeMs: number;
  readonly open: string; readonly high: string; readonly low: string; readonly close: string;
  readonly volume: string | null;
  readonly retrievedAtMs?: number;
}
export interface BreakoutAssetInput {
  readonly assetId: string;
  readonly eligibility: UniverseEligibility;
  readonly hourlyBars: readonly BreakoutHourlyBar[];
  readonly quote: { readonly bid: string; readonly ask: string; readonly atMs: number } | null;
  readonly observedAtMs: number;
}
export interface BreakoutSlotInput {
  readonly slotMs: number;
  readonly assets: readonly BreakoutAssetInput[];
  /** Actual holdings of the separate virtual breakout portfolio, not TrendVol holdings. */
  readonly heldAssetIds: readonly string[];
}

function finitePositive(value: string): Decimal | null {
  try { const d = new Decimal(value); return d.isFinite() && d.gt(0) ? d : null; }
  catch { return null; }
}
function validVolume(value: string | null): Decimal | null {
  if (value === null) return null;
  try { const volume = new Decimal(value); return volume.isFinite() && !volume.isNegative() ? volume : null; }
  catch { return null; }
}

/** Build only exact, complete four-hour bars ending at this decision slot. */
export function breakoutFourHourBars(assetId: string, hourlyBars: readonly BreakoutHourlyBar[], slotMs: number) {
  if (!Number.isSafeInteger(slotMs) || slotMs % FOUR_HOURS !== 0) throw new Error('invalid_breakout_slot');
  const start = slotMs - HISTORY_HOURS * HOUR;
  const byTime = new Map<number, BreakoutHourlyBar>();
  for (const bar of hourlyBars) {
    if (bar.assetId !== assetId || bar.startTimeMs < start || bar.startTimeMs >= slotMs) continue;
    if (byTime.has(bar.startTimeMs)) return null;
    byTime.set(bar.startTimeMs, bar);
  }
  if (byTime.size !== HISTORY_HOURS) return null;
  const fourHour: { startTimeMs: number; open: Decimal; high: Decimal;
    low: Decimal; close: Decimal; volume: Decimal }[] = [];
  for (let t = start; t < slotMs; t += FOUR_HOURS) {
    let open: Decimal | null = null, high = new Decimal(0), low: Decimal | null = null;
    let close: Decimal | null = null, volume = new Decimal(0);
    for (let h = t; h < t + FOUR_HOURS; h += HOUR) {
      const bar = byTime.get(h);
      if (!bar) return null;
      const o = finitePositive(bar.open), hi = finitePositive(bar.high);
      const lo = finitePositive(bar.low), c = finitePositive(bar.close);
      const v = validVolume(bar.volume);
      if (!o || !hi || !lo || !c || v === null || hi.lt(Decimal.max(o, lo, c)) ||
          lo.gt(Decimal.min(o, hi, c))) return null;
      open ??= o; high = Decimal.max(high, hi); low = low === null ? lo : Decimal.min(low, lo);
      close = c; volume = volume.plus(v);
    }
    fourHour.push({ startTimeMs: t, open: open!, high, low: low!, close: close!, volume });
  }
  return fourHour;
}

export function evaluateBreakoutSlot(input: BreakoutSlotInput) {
  if (input.slotMs % FOUR_HOURS !== 0 || !BREAKOUT_RULES.slotsUtc.includes(new Date(input.slotMs).getUTCHours())) {
    throw new Error('invalid_breakout_slot');
  }
  const held = new Set(input.heldAssetIds);
  const seen = new Set<string>();
  const assessments: { assetId: string; reason: string; held: boolean; marginBps: string | null;
    roundTripBps: string | null; hourlyHash: string | null; eligibilityHash: string }[] = [];
  const entries: { assetId: string; edge: Decimal }[] = [];
  const retained = new Set<string>();
  const desiredExits: string[] = [];
  for (const asset of [...input.assets].sort((a, b) => a.assetId.localeCompare(b.assetId))) {
    if (seen.has(asset.assetId) || asset.eligibility.assetId !== asset.assetId) throw new Error('invalid_breakout_asset');
    seen.add(asset.assetId);
    const wasHeld = held.has(asset.assetId);
    const bars = asset.hourlyBars.some((bar) => bar.retrievedAtMs !== undefined &&
      bar.retrievedAtMs > asset.observedAtMs) ? null :
      breakoutFourHourBars(asset.assetId, asset.hourlyBars, input.slotMs);
    const hourlyHash = bars === null ? null : universeHash(asset.hourlyBars);
    const quote = asset.quote;
    const bid = quote === null ? null : finitePositive(quote.bid), ask = quote === null ? null : finitePositive(quote.ask);
    const fresh = quote !== null && bid !== null && ask !== null && ask.gte(bid) &&
      quote.atMs <= asset.observedAtMs && asset.observedAtMs - quote.atMs <= 60_000 &&
      asset.observedAtMs >= input.slotMs && asset.observedAtMs < input.slotMs + 900_000;
    const midpoint = fresh ? bid!.plus(ask!).div(2) : null;
    const roundTrip = midpoint === null ? null : new Decimal(UNIVERSE_COSTS.takerFee)
      .plus(UNIVERSE_COSTS.adverseSlippage).mul(2).plus(ask!.minus(bid!).div(midpoint));
    let reason = 'no_breakout'; let margin: Decimal | null = null;
    if (wasHeld && !asset.eligibility.eligible) {
      reason = 'eligibility_lost'; desiredExits.push(asset.assetId);
    } else if (bars === null) {
      reason = 'hourly_history_incomplete';
      if (wasHeld) retained.add(asset.assetId);
    } else {
      const current = bars.at(-1)!;
      const exitLow = Decimal.min(...bars.slice(-4, -1).map((bar) => bar.low));
      if (wasHeld && current.close.lt(exitLow)) {
        reason = 'exit_below_prior_three_lows'; desiredExits.push(asset.assetId);
      } else if (wasHeld) { reason = 'retained'; retained.add(asset.assetId); }
      else if (!asset.eligibility.eligible) reason = 'not_eligible';
      else if (!fresh || roundTrip === null) reason = 'quote_unavailable_or_stale';
      else {
        const entryHigh = Decimal.max(...bars.slice(-7, -1).map((bar) => bar.high));
        margin = current.close.div(entryHigh).minus(1);
        if (margin.gt(roundTrip)) { reason = 'entry_candidate'; entries.push({ assetId: asset.assetId, edge: margin.minus(roundTrip) }); }
      }
    }
    assessments.push({ assetId: asset.assetId, reason, held: wasHeld,
      marginBps: margin?.mul(10_000).toFixed() ?? null,
      roundTripBps: roundTrip?.mul(10_000).toFixed() ?? null,
      hourlyHash, eligibilityHash: universeHash(asset.eligibility) });
  }
  for (const id of held) if (!seen.has(id)) { desiredExits.push(id); assessments.push({ assetId: id,
    reason: 'asset_evidence_missing', held: true, marginBps: null, roundTripBps: null,
    hourlyHash: null, eligibilityHash: universeHash(null) }); }
  entries.sort((a, b) => b.edge.cmp(a.edge) || a.assetId.localeCompare(b.assetId));
  const selected = new Set([...retained].sort().slice(0, BREAKOUT_RULES.maxPositions));
  for (const entry of entries) if (selected.size < BREAKOUT_RULES.maxPositions && !held.has(entry.assetId)) selected.add(entry.assetId);
  for (const assessment of assessments) if (assessment.reason === 'entry_candidate') {
    assessment.reason = selected.has(assessment.assetId) ? 'entry_selected' : 'capacity_reached';
  }
  const weights = Object.fromEntries([...selected].sort().map((id) => [id, BREAKOUT_RULES.weightPerPosition]));
  return freezeUniverse({ version: BREAKOUT_VERSION, slotMs: input.slotMs, weights, desiredExits: desiredExits.sort(),
    assessments: assessments.sort((a, b) => a.assetId.localeCompare(b.assetId)),
    inputHash: universeHash({ slotMs: input.slotMs, assets: input.assets, heldAssetIds: [...held].sort() }),
    applied: false as const, executionEnabled: false as const });
}
