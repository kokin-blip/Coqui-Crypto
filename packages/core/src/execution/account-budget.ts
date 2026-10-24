import { capitalHash } from '../portfolio/capital-ledger.js';
import { BudgetDecimal as D, budgetAmount, budgetText, identifiedBudgetFact, type NativeRuleValue } from './native-rules.js';
import type { FeasibilityFeesV1 } from './capital-feasibility.js';

export interface CashClaimV1 {
  readonly id: string; readonly scopeId: string; readonly originKey: string; readonly replacesId: string | null;
  readonly assetId: string; readonly amount: string;
  readonly purpose: 'order' | 'fee_contingency' | 'operational_buffer' | 'profit_reserve' | 'tax_hold';
  readonly state: 'committed' | 'unknown' | 'settled' | 'released';
  readonly reflectedIn: readonly ('cash' | 'venue' | 'position')[];
  readonly reflectionEvidence: readonly string[]; readonly evidenceRefs: readonly string[];
}
export interface AccountBudgetEvidenceV1 {
  readonly id: string; readonly scopeId: string; readonly bookId: string;
  readonly provider: 'local_paper' | 'coinbase' | 'alpaca' | 'robinhood';
  readonly environment: 'simulation' | 'paper' | 'production_read_only';
  readonly observedAtMs: number; readonly expiresAtMs: number;
  readonly cashUsd: string | null; readonly equityUsd: string | null;
  readonly venueEligibleUsd: NativeRuleValue;
  readonly positions: Readonly<Record<string, string>>;
  readonly marks: Readonly<Record<string, string>>;
  readonly quotes: Readonly<Record<string, { readonly bid: string; readonly ask: string; readonly atMs: number }>>;
  readonly ruleIds: readonly string[]; readonly fees: FeasibilityFeesV1 | null;
  readonly complete: boolean; readonly holdMatchingComplete: boolean;
  readonly authority: 'isolated_book' | 'unproven' | 'legacy_writer';
  readonly assurance: 'observed' | 'scenario'; readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
}
export interface BudgetReportV1 {
  readonly id: string; readonly version: 'account-budget-v1'; readonly scopeId: string; readonly bookId: string;
  readonly sourceId: string; readonly revision: string; readonly evaluatedAtMs: number;
  readonly observedAtMs: number; readonly expiresAtMs: number; readonly assurance: 'observed' | 'scenario';
  readonly state: 'available' | 'unavailable'; readonly observedCashUsd: string | null;
  readonly equityUsd: string | null; readonly activeEquityUsd: string | null; readonly spendableUsd: string | null;
  readonly quantities: Readonly<Record<string, string>>; readonly deficits: Readonly<Record<string, string>>;
  readonly positions: Readonly<Record<string, string>>;
  readonly deductions: readonly { readonly claimId: string; readonly cashUsd: string; readonly venueUsd: string }[];
  readonly claimIds: readonly string[]; readonly reasonCodes: readonly string[]; readonly restoration: readonly string[];
  readonly executionEligible: boolean;
}
export function cashClaim(input: Omit<CashClaimV1, 'id'>): CashClaimV1 { return identifiedBudgetFact(input); }
export function budgetEvidence(input: Omit<AccountBudgetEvidenceV1, 'id'>): AccountBudgetEvidenceV1 { return identifiedBudgetFact(input); }
export function budgetClaimHeads(claims: readonly CashClaimV1[]): { heads: CashClaimV1[]; conflicts: string[] } {
  const all = [...new Map(claims.map(row => [row.id, row])).values()];
  const replaced = new Set(all.map(row => row.replacesId));
  const heads = all.filter(row => !replaced.has(row.id)).sort((a, b) => a.id.localeCompare(b.id));
  const counts = new Map<string, number>(); for (const row of heads) counts.set(row.originKey, (counts.get(row.originKey) ?? 0) + 1);
  return { heads, conflicts: [...counts].filter(([, n]) => n > 1).map(([key]) => key) };
}
export function projectAccountBudget(source: AccountBudgetEvidenceV1, claims: readonly CashClaimV1[], nowMs: number): BudgetReportV1 {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || claims.some(row => row.scopeId !== source.scopeId)) throw new TypeError('budget_scope_mismatch');
  const { heads, conflicts } = budgetClaimHeads(claims), reasons = [...source.reasonCodes];
  const revision = capitalHash({ version: 'account-budget-v1', sourceId: source.id, claims: heads.map(row => row.id),
    complete: source.complete, holdMatchingComplete: source.holdMatchingComplete, reasonCodes: source.reasonCodes });
  if (!source.complete) reasons.push('budget_source_incomplete');
  if (!source.holdMatchingComplete) reasons.push('hold_matching_unknown');
  if (conflicts.length) reasons.push('claim_revision_conflict');
  if (nowMs < source.observedAtMs || nowMs >= source.expiresAtMs || nowMs - source.observedAtMs > 30_000) reasons.push('budget_source_stale');
  if (source.cashUsd === null) reasons.push('cash_unavailable');
  if (source.provider !== 'local_paper' && source.venueEligibleUsd.state !== 'known') reasons.push('venue_eligibility_unknown');
  if (source.authority !== 'isolated_book') reasons.push(source.authority === 'legacy_writer' ? 'legacy_writer_conflict' : 'account_ownership_unproven');
  let cash = budgetAmount(source.cashUsd ?? '0');
  let venue = source.venueEligibleUsd.state === 'known' ? budgetAmount(source.venueEligibleUsd.value) : cash;
  const quantities = Object.fromEntries(Object.entries(source.positions).map(([id, amount]) => [id, budgetAmount(amount)]));
  let reserves = new D(0);
  const deductions: { claimId: string; cashUsd: string; venueUsd: string }[] = [];
  for (const claim of heads) {
    const amount = budgetAmount(claim.amount); if (amount.lt(0)) throw new TypeError('budget_negative_claim');
    if (claim.reflectedIn.length && !claim.reflectionEvidence.length) reasons.push('hold_reflection_unproved');
    if (claim.state === 'released' || claim.state === 'settled') continue;
    // Unknown submission continues to encumber funds. It is not a release.
    if (claim.assetId !== 'USD') {
      if (!claim.reflectedIn.includes('position')) quantities[claim.assetId] = (quantities[claim.assetId] ?? new D(0)).sub(amount);
      continue;
    }
    if (claim.purpose === 'profit_reserve' || claim.purpose === 'tax_hold') reserves = reserves.add(amount);
    const c = claim.reflectedIn.includes('cash') ? new D(0) : amount, v = claim.reflectedIn.includes('venue') ? new D(0) : amount;
    cash = cash.sub(c); venue = venue.sub(v); deductions.push({ claimId: claim.id, cashUsd: budgetText(c), venueUsd: budgetText(v) });
  }
  const deficits: Record<string, string> = {};
  const capacity = D.min(cash, venue);
  const exactHolds = source.complete && source.holdMatchingComplete && conflicts.length === 0 && !reasons.includes('hold_reflection_unproved');
  if (exactHolds) {
    if (capacity.lt(0)) deficits['USD'] = budgetText(capacity.neg());
    for (const [asset, quantity] of Object.entries(quantities)) if (quantity.lt(0)) deficits[asset] = budgetText(quantity.neg());
  }
  if (Object.keys(deficits).length) reasons.push('budget_underfunded');
  const active = source.equityUsd === null ? null : budgetAmount(source.equityUsd).sub(reserves);
  if (active?.lt(0)) reasons.push('active_equity_negative');
  const reasonCodes = [...new Set(reasons)].sort(), available = reasonCodes.length === 0;
  const body = { version: 'account-budget-v1' as const, scopeId: source.scopeId, bookId: source.bookId,
    sourceId: source.id, revision, evaluatedAtMs: nowMs, observedAtMs: source.observedAtMs, expiresAtMs: source.expiresAtMs,
    assurance: source.assurance, state: available ? 'available' as const : 'unavailable' as const,
    observedCashUsd: source.cashUsd, equityUsd: source.equityUsd, activeEquityUsd: active === null ? null : budgetText(active),
    spendableUsd: available ? budgetText(D.max(0, capacity)) : null,
    positions: source.positions, quantities: exactHolds ? Object.fromEntries(Object.entries(quantities).map(([id, quantity]) => [id, budgetText(D.max(0, quantity))])) : {},
    deficits, deductions, claimIds: heads.map(row => row.id), reasonCodes,
    restoration: reasonCodes.map(reason => `Refresh and reconcile ${reason.replaceAll('_', ' ')} for this account; no missing funds or ownership is inferred.`),
    executionEligible: available && source.assurance === 'observed' && source.provider === 'local_paper' && source.authority === 'isolated_book' };
  return { ...body, id: capitalHash(body) };
}
