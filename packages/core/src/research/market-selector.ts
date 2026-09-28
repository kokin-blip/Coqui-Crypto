import { Decimal } from 'decimal.js';
import { DEFAULT_AUTO_TRADE_GUARDRAILS } from '../risk/autotrade.js';
import { breakoutFourHourBars, evaluateBreakoutSlot, BREAKOUT_RULES,
  type BreakoutAssetInput } from './breakout.js';
import { evaluateRangeRotationSlot, RANGE_ROTATION_RULES } from './range-rotation.js';
import { freezeUniverse, UNIVERSE_DAY, universeHash, validateUniversePolicy,
  type UniversePolicy } from './wider-universe.js';

const HOUR = 3_600_000;
export const MARKET_SELECTOR_VERSION = 'paper-market-selector-v1' as const;
export type SelectedStrategy = 'trendvol' | 'breakout' | 'range_rotation' | 'cash';
export type MarketState = 'sustained_trend' | 'new_breakout' | 'stable_range' | 'uncertain';
export const MARKET_SELECTOR_RULES = freezeUniverse({ version: MARKET_SELECTOR_VERSION,
  trendDays: 7, trendMinimumReturn: 0.04, trendAlignmentHours: 24,
  precedence: ['sustained_trend', 'new_breakout', 'stable_range', 'uncertain'],
  confirmationSlots: 2, slotsUtc: [0, 4, 8, 12, 16, 20],
  trendVersion: 'trendvol-v4.2', breakoutVersion: BREAKOUT_RULES.version,
  rangeVersion: RANGE_ROTATION_RULES.version });

export function createMarketSelectorStudy(registeredAtMs: number, sourceContentHash: string,
  policy: UniversePolicy, anchor: Readonly<Record<string, string>>) {
  if (!Number.isSafeInteger(registeredAtMs) || registeredAtMs <= 0 ||
      !/^[a-f0-9]{64}$/u.test(sourceContentHash)) throw new Error('invalid_selector_study');
  validateUniversePolicy(policy);
  const startMs = (Math.floor(registeredAtMs / UNIVERSE_DAY) + 1) * UNIVERSE_DAY;
  const plan = { schemaVersion: 1 as const, version: MARKET_SELECTOR_VERSION, registeredAtMs,
    startMs, holdoutStartMs: startMs + 60 * UNIVERSE_DAY,
    endExclusiveMs: startMs + 150 * UNIVERSE_DAY, sourceContentHash,
    policyHash: universeHash(policy), policy, anchor, rules: MARKET_SELECTOR_RULES,
    dataDefinitionHash: universeHash({ daily: 'completed_coinbase', hourly: 'completed_coinbase',
      hourlyWarmup: 720, firstRetrievalAsOf: true, universePolicyHash: universeHash(policy) }),
    openingCash: '100000', candidates: ['selector', 'trendvol', 'breakout', 'range_rotation'] as const,
    guardrails: DEFAULT_AUTO_TRADE_GUARDRAILS,
    costs: { takerFee: '0.0025', adverseSlippage: '0.0015', spread: 'observed', multipliers: [1, 2] },
    promotion: 'disabled' as const };
  return freezeUniverse({ ...plan, planHash: universeHash(plan) });
}
export type MarketSelectorStudy = ReturnType<typeof createMarketSelectorStudy>;

export interface SelectorPrevious {
  readonly slotMs: number; readonly selected: SelectedStrategy;
  readonly observedState: MarketState; readonly streak: number;
  readonly confirmationState: MarketState; readonly lastIntradaySlotMs: number | null;
  readonly target: Readonly<Record<string, number>>;
  readonly rangeSlotMs: number | null;
  readonly rangeQualifiedIds: readonly string[];
  readonly rangeReplacementIds: readonly string[];
}
export interface SelectorInput {
  readonly slotMs: number; readonly assets: readonly BreakoutAssetInput[];
  readonly baselineTarget: Readonly<Record<string, number>> | null;
  readonly heldAssetIds: readonly string[];
  readonly previous: SelectorPrevious | null;
}

function previousIntradaySlot(slotMs: number): number {
  return slotMs - (new Date(slotMs).getUTCHours() === 4 ? 8 : 4) * HOUR;
}
function asOfAsset(asset: BreakoutAssetInput): BreakoutAssetInput {
  return asset.hourlyBars.every((bar) => bar.retrievedAtMs !== undefined &&
    bar.retrievedAtMs >= bar.startTimeMs + HOUR && bar.retrievedAtMs <= asset.observedAtMs) ?
    asset : { ...asset, hourlyBars: [] };
}
function trendEvidence(assets: readonly BreakoutAssetInput[], slotMs: number) {
  const details = ['BTC', 'ETH'].map((base) => {
    const assetId = `coinbase|spot|${base}-USD`;
    const asset = assets.find((item) => item.assetId === assetId);
    if (!asset?.eligibility.eligible) {
      return { assetId, valid: false, direction: 0, sevenDayReturn: null, dayReturn: null, hourlyHash: null };
    }
    const bars = breakoutFourHourBars(assetId, asset.hourlyBars, slotMs);
    if (!bars) return { assetId, valid: false, direction: 0, sevenDayReturn: null,
      dayReturn: null, hourlyHash: null };
    const prior = bars.slice(-43, -1), latest = bars.at(-1)!;
    const high = Decimal.max(...prior.map((bar) => bar.high));
    const low = Decimal.min(...prior.map((bar) => bar.low));
    const midpoint = high.plus(low).div(2);
    const seven = latest.close.div(bars.at(-43)!.close).minus(1);
    const day = latest.close.div(bars.at(-7)!.close).minus(1);
    const direction = seven.abs().gte(MARKET_SELECTOR_RULES.trendMinimumReturn) &&
      ((seven.gt(0) && day.gt(0) && latest.close.gt(midpoint)) ||
        (seven.lt(0) && day.lt(0) && latest.close.lt(midpoint))) ? seven.gt(0) ? 1 : -1 : 0;
    return { assetId, valid: true, direction, sevenDayReturn: seven.toFixed(),
      dayReturn: day.toFixed(), hourlyHash: universeHash(asset.hourlyBars) };
  });
  return { details, sustained: details.every((item) => item.valid && item.direction !== 0) &&
    details[0]!.direction === details[1]!.direction };
}

/** Pure selector: candidate policies read the selector portfolio, never their standalone books. */
export function evaluateMarketSelectorSlot(input: SelectorInput) {
  const hour = new Date(input.slotMs).getUTCHours();
  if (!Number.isSafeInteger(input.slotMs) || input.slotMs % (4 * HOUR) !== 0 ||
      !MARKET_SELECTOR_RULES.slotsUtc.includes(hour)) throw new Error('invalid_selector_slot');
  const previous = input.previous;
  const assets = input.assets.map(asOfAsset);
  const eligibleIds = input.assets.filter((asset) => asset.eligibility.eligible).map((asset) => asset.assetId).sort();
  const baselineAvailable = input.baselineTarget !== null && Object.values(input.baselineTarget)
    .every((value) => Number.isFinite(value) && value >= 0) &&
    Object.values(input.baselineTarget).reduce((sum, value) => sum + value, 0) <= 1.00000001;
  const trend = trendEvidence(assets, input.slotMs);
  const midnight = hour === 0;
  const breakout = !midnight ? evaluateBreakoutSlot({ slotMs: input.slotMs,
    assets, heldAssetIds: input.heldAssetIds }) : null;
  const range = !midnight && trend.details.every((item) => item.valid) ? evaluateRangeRotationSlot({ slotMs: input.slotMs,
    assets, heldAssetIds: input.heldAssetIds,
    previousSlotMs: previous?.rangeSlotMs ?? null,
    previousQualifiedIds: previous?.rangeQualifiedIds ?? [],
    previousReplacementIds: previous?.rangeReplacementIds ?? [] }) : null;
  const newBreakout = breakout?.assessments.some((a) => a.reason === 'entry_selected') ?? false;
  const heldEvidenceAvailable = input.heldAssetIds.every((id) => {
    const asset = assets.find((item) => item.assetId === id);
    return asset !== undefined && asset.quote !== null && asset.quote.atMs <= asset.observedAtMs &&
      asset.observedAtMs - asset.quote.atMs <= 60_000 &&
      breakoutFourHourBars(id, asset.hourlyBars, input.slotMs) !== null;
  });
  const breakoutAvailable = breakout !== null && heldEvidenceAvailable;
  const rangeAvailable = range !== null && heldEvidenceAvailable;
  const continuingBreakout = previous?.selected === 'breakout' &&
    Object.keys(breakout?.weights ?? {}).length > 0 && breakout?.assessments.some((a) => a.reason === 'retained');
  const observedState: MarketState = trend.sustained ? 'sustained_trend' :
    newBreakout || continuingBreakout ? 'new_breakout' : range?.marketPass ? 'stable_range' : 'uncertain';
  const preferred: SelectedStrategy = observedState === 'sustained_trend' ? 'trendvol' :
    observedState === 'new_breakout' ? 'breakout' : observedState === 'stable_range' ?
      'range_rotation' : baselineAvailable ? 'trendvol' : 'cash';
  const available = (strategy: SelectedStrategy): boolean => strategy === 'cash' ||
    strategy === 'trendvol' ? strategy === 'cash' || baselineAvailable :
      strategy === 'breakout' ? breakoutAvailable : rangeAvailable;
  let selected: SelectedStrategy; let reason: string;
  const priorSelected = previous?.selected;
  if (midnight) {
    const carried = priorSelected === 'breakout' || priorSelected === 'range_rotation';
    const stillEligible = [...new Set([...Object.keys(previous?.target ?? {}),
      ...input.heldAssetIds])].every((id) => eligibleIds.includes(id));
    selected = carried && stillEligible ? priorSelected : baselineAvailable ? 'trendvol' : 'cash';
    reason = carried && stillEligible ? 'midnight_carry' : 'midnight_daily_or_fallback';
  } else if (priorSelected === undefined) {
    selected = baselineAvailable ? 'trendvol' : 'cash'; reason = 'initial_baseline';
  } else if (!available(priorSelected)) {
    selected = baselineAvailable ? 'trendvol' : 'cash'; reason = 'incumbent_unavailable';
  } else if (preferred === priorSelected) {
    selected = priorSelected; reason = 'state_matches_incumbent';
  } else {
    const confirmed = previous?.lastIntradaySlotMs === previousIntradaySlot(input.slotMs) &&
      previous.confirmationState === observedState && previous.streak >= 1;
    selected = confirmed && available(preferred) ? preferred : priorSelected;
    reason = selected === preferred ? 'state_confirmed' : !available(preferred) ?
      'preferred_unavailable' : 'awaiting_state_confirmation';
  }
  const streak = midnight ? previous?.streak ?? 0 : previous?.confirmationState === observedState &&
    previous.lastIntradaySlotMs === previousIntradaySlot(input.slotMs) ?
      Math.min(2, previous.streak + 1) : 1;
  const target = selected === 'trendvol' ? input.baselineTarget ?? {} : selected === 'breakout' ?
    midnight ? previous?.target ?? {} : breakout?.weights ?? {} : selected === 'range_rotation' ?
      midnight ? previous?.target ?? {} : range?.weights ?? {} : {};
  const candidates = { trendvol: { available: baselineAvailable, target: input.baselineTarget },
    breakout: { available: breakoutAvailable, target: breakout?.weights ?? null,
      reasons: breakout?.assessments ?? [] },
    range_rotation: { available: rangeAvailable, target: range?.weights ?? null,
      reasons: range?.assessments ?? [], desiredExits: range?.desiredExits ?? [] } };
  return freezeUniverse({ version: MARKET_SELECTOR_VERSION, slotMs: input.slotMs, observedState,
    trend, selected, preferred, streak, reason, eligibleIds, target,
    confirmationState: midnight ? previous?.confirmationState ?? 'uncertain' : observedState,
    lastIntradaySlotMs: midnight ? previous?.lastIntradaySlotMs ?? null : input.slotMs,
    rejectedAlternatives: (['trendvol', 'breakout', 'range_rotation'] as const)
      .filter((name) => name !== selected).map((name) => ({ strategy: name,
        reason: !candidates[name].available ? 'unavailable' : name === preferred ?
          'awaiting_confirmation' : 'lower_precedence' })),
    candidates, rangeSlotMs: midnight ? previous?.rangeSlotMs ?? null : range?.slotMs ?? null,
    rangeQualifiedIds: midnight ? previous?.rangeQualifiedIds ?? [] : range?.qualifiedIds ?? [],
    rangeReplacementIds: midnight ? previous?.rangeReplacementIds ?? [] : range?.replacementIds ?? [],
    inputHash: universeHash(input), executionEnabled: false as const,
    virtualExecutionAllowed: !midnight || selected === 'trendvol' });
}
