import { BudgetDecimal as D, budgetAmount as amount, budgetText as text, identifiedBudgetFact } from '../execution/native-rules.js';
import { capitalHash, type CapitalMetric } from './capital-ledger.js';
import { canonicalJson, type CanonicalJsonValue } from '../evidence/index.js';
import type { ReserveCapitalWitness } from './reserve-capital-witness.js';

export type ReserveMetric = CapitalMetric;
export const reserveUnavailable = (...codes: string[]): ReserveMetric => ({ state: 'unavailable', reasonCodes: [...new Set(codes)].sort(),
  missingEvidence: [...new Set(codes)].sort(), restoration: [...new Set(codes)].sort().map(code => `Reconcile ${code.replaceAll('_', ' ')} for this scope; missing evidence is not zero.`) });
export const reserveValue = (value: string, refs: readonly string[] = []): Extract<ReserveMetric, { state: 'available' }> => ({ state: 'available', value: text(amount(value)), method: 'profit-reserve-eligibility-v1', evidenceRefs: refs });
export function reserveMinimum(values: readonly ReserveMetric[]): ReserveMetric {
  const missing = values.flatMap(v => v.state === 'unavailable' ? v.reasonCodes : []);
  return missing.length ? reserveUnavailable(...missing) : reserveValue(text(D.max(0, D.min(...values.map(v => amount(v.state === 'available' ? v.value : '0'))))));
}
export interface ReserveSettings {
  readonly goal: 'keep_invested' | 'preview'; readonly trigger: { readonly kind: 'profit_usd' | 'growth_bps' | 'balance_usd'; readonly value: string };
  readonly shareBps: number; readonly retainedCapitalUsd: string; readonly minimumBatchUsd: string;
  readonly cadence: 'manual' | 'daily' | 'weekly' | 'monthly'; readonly reviewWinCount: number | null;
  readonly taxHold: { readonly amountUsd: string; readonly backing: 'principal' | 'profit' | 'unknown' };
}
export interface ReservePolicy {
  readonly id: string; readonly version: 'profit-reserve-policy-v1'; readonly scopeId: string; readonly originProfileId: string;
  readonly previousId: string | null; readonly createdAtMs: number; readonly settings: ReserveSettings;
}
export interface ReserveState {
  readonly id: string; readonly domain: 'preview'; readonly scopeId: string; readonly streamId: string; readonly policyId: string;
  readonly previousId: string | null; readonly operationKey: string; readonly atMs: number;
  readonly event: 'baseline' | 'cycle_open' | 'assessment' | 'release' | 'cancel' | 'closure';
  readonly baseline: 'ready' | 'awaiting_evidence'; readonly hUsd: string; readonly excludedProfitUsd: string;
  readonly baseUsd: string | null; readonly baseProfitUsd: string | null;
  readonly cycle: { readonly id: string; readonly ceilingUsd: string } | null; readonly balanceConsumed: boolean;
  readonly allocatedUsd: string; readonly reservedUsd: string; readonly taxHoldUsd: string; readonly profitBackedTaxUsd: string; readonly pendingUsd: string;
  readonly evidenceRefs: readonly string[];
}
export interface ReserveFinancialInput {
  readonly scopeId: string; readonly epochId: string | null; readonly fromMs: number | null; readonly toMs: number | null;
  readonly assurance: 'observed' | 'scenario'; readonly observedAtMs: number | null; readonly expiresAtMs: number;
  readonly economicPnlUsd: ReserveMetric; readonly realizedPnlUsd: ReserveMetric; readonly unrealizedPnlUsd: ReserveMetric;
  readonly openingEquityUsd: ReserveMetric; readonly sourceCutHash: string | null; readonly trackingLimitations: readonly string[];
  readonly observedCashUsd: ReserveMetric; readonly riskAssetValueUsd: ReserveMetric; readonly equityUsd: ReserveMetric; readonly activeEquityUsd: ReserveMetric; readonly spendableUsd: ReserveMetric;
  readonly contributionsUsd: ReserveMetric; readonly netOutflowsUsd: ReserveMetric; readonly confirmedReceiptsUsd: ReserveMetric;
  readonly incomeUsd: ReserveMetric; readonly feesUsd: ReserveMetric; readonly completedWins: ReserveMetric;
  readonly actualReservedUsd: ReserveMetric; readonly actualTaxHoldUsd: ReserveMetric; readonly actualPendingUsd: ReserveMetric;
  readonly priorProfitBackedUsd: ReserveMetric; readonly reasonCodes: readonly string[]; readonly evidenceRefs: readonly string[];
  readonly budgetRevision: string | null; readonly generation: number | null;
}
export interface ReservePreview {
  readonly id: string; readonly version: 'profit-reserve-preview-v1'; readonly mode: 'preview_only'; readonly scopeId: string;
  readonly policyId: string; readonly stateId: string; readonly evaluatedAtMs: number; readonly expiresAtMs: number;
  readonly assurance: 'observed' | 'scenario'; readonly executionEligible: false; readonly liveExecutionPermitted: false;
  readonly state: 'eligible' | 'deferred' | 'unavailable' | 'disabled'; readonly reasonCodes: readonly string[];
  readonly financial: ReserveFinancialInput; readonly modeledHUsd: string; readonly excludedProfitUsd: string;
  readonly baseUsd: string | null; readonly cycleCeilingUsd: string | null; readonly freshProfitUsd: ReserveMetric;
  readonly triggerReached: boolean; readonly wouldRequestReview: boolean; readonly triggerAmountUsd: ReserveMetric;
  readonly caps: { readonly economicUsd: ReserveMetric; readonly realizedUsd: ReserveMetric; readonly cashUsd: ReserveMetric; readonly capitalUsd: ReserveMetric };
  readonly reserveUsd: ReserveMetric; readonly assessedProfitUsd: ReserveMetric; readonly retainedActiveUsd: ReserveMetric;
  readonly roundingResidualUsd: ReserveMetric; readonly cashShortfallUsd: ReserveMetric;
  readonly operatingRequirement: ReserveCapitalWitness;
  readonly inputHash: string; readonly inputsJson: string; readonly evidenceRefs: readonly string[];
}
export function validateReserveSettings(s: ReserveSettings): void {
  if (!['keep_invested', 'preview'].includes(s.goal) || !['profit_usd', 'growth_bps', 'balance_usd'].includes(s.trigger.kind) ||
    !['manual', 'daily', 'weekly', 'monthly'].includes(s.cadence) || !['principal', 'profit', 'unknown'].includes(s.taxHold.backing) ||
    !Number.isSafeInteger(s.shareBps) || s.shareBps < 0 || s.shareBps > 10_000 || s.reviewWinCount !== null && (!Number.isSafeInteger(s.reviewWinCount) || s.reviewWinCount < 1 || s.reviewWinCount > 10_000)) throw new TypeError('reserve_invalid_settings');
  for (const v of [s.trigger.value, s.retainedCapitalUsd, s.minimumBatchUsd, s.taxHold.amountUsd]) if (amount(v).lt(0) || amount(v).precision() > 30) throw new TypeError('reserve_invalid_amount');
  if (!amount(s.trigger.value).gt(0) || !amount(s.minimumBatchUsd).gte('0.01') || [s.minimumBatchUsd, s.taxHold.amountUsd].some(v => amount(v).decimalPlaces() > 2) ||
    s.trigger.kind === 'growth_bps' && (!amount(s.trigger.value).isInteger() || amount(s.trigger.value).gt(100_000))) throw new TypeError('reserve_invalid_threshold');
}
export function reservePolicy(input: Omit<ReservePolicy, 'id' | 'version'>): ReservePolicy {
  validateReserveSettings(input.settings); return identifiedBudgetFact({ ...input, version: 'profit-reserve-policy-v1' as const });
}
export function reserveTrigger(policy: ReservePolicy, state: ReserveState, f: ReserveFinancialInput) {
  const p = f.economicPnlUsd, e = f.activeEquityUsd, t = policy.settings.trigger;
  let threshold: ReserveMetric = reserveValue(t.value);
  if (t.kind === 'growth_bps') threshold = state.baseUsd === null || amount(state.baseUsd).lte(0) ? reserveUnavailable('assessment_base_unavailable') : reserveValue(text(amount(state.baseUsd).mul(t.value).div(10_000)));
  const ready = state.baseline === 'ready' && p.state === 'available' && e.state === 'available' && threshold.state === 'available';
  const fresh = p.state === 'available' ? D.max(0, amount(p.value).sub(state.hUsd)) : new D(0);
  const balance = ready && state.baseUsd !== null && state.baseProfitUsd !== null && !state.balanceConsumed && amount(t.value).gt(state.baseUsd) && fresh.gt(0) &&
    amount(e.value).gte(t.value) && amount(state.baseUsd).add(p.value).sub(state.baseProfitUsd).gte(t.value);
  return { threshold, reached: Boolean(ready && (t.kind === 'balance_usd' ? balance : threshold.state === 'available' && fresh.gte(threshold.value))),
    wouldRequestReview: policy.settings.reviewWinCount !== null && f.completedWins.state === 'available' && amount(f.completedWins.value).gte(policy.settings.reviewWinCount) };
}
export function evaluateProfitReserve(policy: ReservePolicy, state: ReserveState, f: ReserveFinancialInput, floor: ReserveCapitalWitness, nowMs: number): ReservePreview {
  validateReserveSettings(policy.settings);
  if (policy.scopeId !== state.scopeId || state.scopeId !== f.scopeId || state.policyId !== policy.id || floor.scopeId !== f.scopeId || state.domain !== 'preview') throw new TypeError('reserve_scope_mismatch');
  const reasons = [...f.reasonCodes], trigger = reserveTrigger(policy, state, f), p = f.economicPnlUsd;
  if (state.baseline !== 'ready') reasons.push('assessment_baseline_unavailable');
  if (trigger.threshold.state === 'unavailable') reasons.push(...trigger.threshold.reasonCodes);
  for (const metric of [f.realizedPnlUsd, f.unrealizedPnlUsd, f.feesUsd, f.incomeUsd]) if (metric.state === 'unavailable') reasons.push(...metric.reasonCodes);
  if (nowMs >= floor.expiresAtMs) reasons.push('operating_requirement_expired');
  if (nowMs >= f.expiresAtMs || f.observedAtMs === null || nowMs < f.observedAtMs) reasons.push('preview_expired');
  if (amount(state.pendingUsd).gt(0)) reasons.push('pending_operation_unresolved');
  if (f.spendableUsd.state === 'available' && amount(state.reservedUsd).add(state.taxHoldUsd).gt(f.spendableUsd.value)) reasons.push('modeled_reserve_underfunded');
  if (amount(policy.settings.taxHold.amountUsd).gt(0) && policy.settings.taxHold.backing === 'unknown') reasons.push('tax_hold_funding_unverified');
  const currentCeiling = state.cycle?.ceilingUsd ?? (trigger.reached && p.state === 'available' ? amount(p.value).toDecimalPlaces(2, D.ROUND_FLOOR).toFixed() : null);
  const g = p.state === 'available' ? reserveValue(text(D.max(0, D.min(p.value, currentCeiling ?? p.value).sub(state.hUsd)))) :
    p.state === 'unavailable' ? p : reserveValue('0');
  const tax = amount(policy.settings.taxHold.amountUsd), newTax = D.max(0, tax.sub(state.taxHoldUsd));
  const backing = policy.settings.taxHold.backing === 'profit' ? newTax : new D(0);
  const prior = f.priorProfitBackedUsd.state === 'available' ? amount(f.priorProfitBackedUsd.value).add(state.allocatedUsd).add(state.profitBackedTaxUsd).add(backing) : null;
  const cap = (metric: ReserveMetric) => prior === null ? f.priorProfitBackedUsd : metric.state === 'available' ? reserveValue(text(D.max(0, amount(metric.value).sub(prior)))) : metric;
  const cash = f.spendableUsd.state === 'available' ? reserveValue(text(D.max(0, amount(f.spendableUsd.value).sub(state.reservedUsd).sub(state.taxHoldUsd).sub(newTax)))) : f.spendableUsd;
  const capital = f.activeEquityUsd.state !== 'available' ? f.activeEquityUsd : floor.floorUsd.state !== 'available' ? floor.floorUsd :
    reserveValue(text(D.max(0, amount(f.activeEquityUsd.value).sub(state.reservedUsd).sub(state.taxHoldUsd).sub(newTax).sub(D.max(policy.settings.retainedCapitalUsd, floor.floorUsd.value)))));
  const caps = { economicUsd: cap(p), realizedUsd: cap(f.realizedPnlUsd), cashUsd: cash, capitalUsd: capital };
  const capacity = reserveMinimum(Object.values(caps));
  const missing = [g, capacity].flatMap(v => v.state === 'unavailable' ? v.reasonCodes : []); reasons.push(...missing);
  if (floor.floorUsd.state === 'available' && floor.budgetRevision !== f.budgetRevision) reasons.push('operating_requirement_binding_missing');
  const disabled = policy.settings.goal === 'keep_invested' || policy.settings.shareBps === 0;
  let r: ReserveMetric = reserveUnavailable(...(reasons.length ? reasons : ['reserve_not_evaluated'])), G = r, residual = r, retained = r;
  const activeCycle = state.cycle !== null || trigger.reached;
  if (!reasons.length && g.state === 'available' && capacity.state === 'available') {
    const gc = amount(g.value).mul(100).floor(), cc = amount(capacity.value).mul(100).floor(), b = policy.settings.shareBps;
    const rc = disabled ? new D(0) : D.min(gc.mul(b).div(10_000).floor(), cc);
    const Gc = rc.isZero() || b === 0 ? new D(0) : rc.mul(10_000).div(b).ceil();
    if (Gc.gt(gc) || b > 0 && !Gc.mul(b).div(10_000).floor().eq(rc)) throw new Error('reserve_slice_invariant');
    const actionable = !disabled && activeCycle && rc.gt(0) && rc.gte(amount(policy.settings.minimumBatchUsd).mul(100));
    if (!disabled && !activeCycle) reasons.push('milestone_not_reached');
    else if (!disabled && !actionable) reasons.push(gc.lte(0) ? 'no_new_profit_after_losses' : rc.lt(amount(policy.settings.minimumBatchUsd).mul(100)) ? 'below_reserve_batch' : 'reserve_capacity_unavailable');
    r = reserveValue(actionable ? text(rc.div(100)) : '0'); G = reserveValue(actionable ? text(Gc.div(100)) : '0');
    residual = reserveValue(actionable ? text(Gc.div(100).mul(b).div(10_000).sub(rc.div(100))) : '0');
    retained = f.activeEquityUsd.state === 'available' ? reserveValue(text(amount(f.activeEquityUsd.value).sub(state.reservedUsd).sub(state.taxHoldUsd).sub(newTax).sub(r.value))) : f.activeEquityUsd;
  }
  const desired = g.state === 'available' ? amount(g.value).mul(policy.settings.shareBps).div(10_000).toDecimalPlaces(2, D.ROUND_FLOOR) : null;
  const shortfall = cash.state !== 'available' ? cash : desired === null ? g : reserveValue(text(D.max(0, desired.sub(cash.value))));
  const inputs = { policy, state, financial: f, floor, nowMs }, codes = [...new Set(reasons)].sort();
  return identifiedBudgetFact({ version: 'profit-reserve-preview-v1' as const, mode: 'preview_only' as const, scopeId: f.scopeId, policyId: policy.id, stateId: state.id,
    evaluatedAtMs: nowMs, expiresAtMs: Math.min(f.expiresAtMs, floor.expiresAtMs, nowMs + 30_000), assurance: f.assurance, executionEligible: false as const, liveExecutionPermitted: false as const,
    state: disabled ? 'disabled' as const : missing.length || codes.some(c => !['milestone_not_reached', 'no_new_profit_after_losses', 'below_reserve_batch'].includes(c)) ? 'unavailable' as const : codes.length ? 'deferred' as const : 'eligible' as const,
    reasonCodes: codes, financial: f, modeledHUsd: state.hUsd, excludedProfitUsd: state.excludedProfitUsd, baseUsd: state.baseUsd, cycleCeilingUsd: currentCeiling,
    freshProfitUsd: g, triggerReached: activeCycle, wouldRequestReview: trigger.wouldRequestReview, triggerAmountUsd: trigger.threshold, caps, reserveUsd: r, assessedProfitUsd: G,
    retainedActiveUsd: retained, roundingResidualUsd: residual, cashShortfallUsd: shortfall, operatingRequirement: floor,
    inputHash: capitalHash(inputs), inputsJson: canonicalJson(inputs as unknown as CanonicalJsonValue), evidenceRefs: f.evidenceRefs });
}
