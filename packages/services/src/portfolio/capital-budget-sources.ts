import { normalizeCoinbaseCapitalRules, normalizeAlpacaCapitalRules, type CoinbaseEvidenceAcquisition, type AlpacaPaperAccount } from '@coqui/adapters';
import { budgetEvidence, budgetAmount, budgetText, capitalHash, instrumentKey, inapplicableNativeRule,
  knownNativeRule, unknownNativeRule, sha256Hex, budgetClaimHeads, type AccountBudgetEvidenceV1, type CashClaimV1, type CapitalScope, type BudgetReportV1 } from '@coqui/core';
import { getCapitalScope, getPaperBookOrigin, getPaperExecutionPolicy, listCapitalBindings, listCapitalValuations, listCashClaims,
  listPaperBalances, listSubmittedPaperExecutions, saveBudgetSource, saveCashClaim, saveNativeExecutionRules, saveBudgetReport, currentBudget,
  inTransaction, setSetting, appendRuntimeIncident, type Db } from '@coqui/storage';

/** This module accepts acquired evidence, never a provider or financial-write client. */
function base(scope: CapitalScope, atMs: number): Omit<AccountBudgetEvidenceV1, 'id'> {
  return { scopeId: scope.id, bookId: scope.accountIdentityHash, provider: scope.provider, environment: scope.environment,
    observedAtMs: atMs, expiresAtMs: atMs + 30_000, cashUsd: null, equityUsd: null,
    venueEligibleUsd: unknownNativeRule('not_acquired'), positions: {}, marks: {}, quotes: {}, ruleIds: [], fees: null,
    complete: false, holdMatchingComplete: false, authority: 'unproven', assurance: 'observed', reasonCodes: [], evidenceRefs: [] };
}
function persist(source: AccountBudgetEvidenceV1, claims: readonly CashClaimV1[], database: Db, profileId?: string): void {
  inTransaction(database, () => {
    saveBudgetSource(source, database); for (const claim of claims) saveCashClaim(claim, database);
    const report = currentBudget(source.scopeId, source.observedAtMs, database);
    if (report) { saveBudgetReport(report, database); recordBudgetDeficit(report, database, profileId); }
  });
}
export function recordBudgetDeficit(report: BudgetReportV1, database: Db, profileId?: string): void {
  if (!Object.keys(report.deficits).length) return;
  const scope = getCapitalScope(report.scopeId, database)!;
  appendRuntimeIncident({ id: capitalHash({ kind: 'p2-budget-deficit', scopeId: scope.id, revision: report.revision, profileId: profileId ?? scope.originProfileId }),
    profileId: profileId ?? scope.originProfileId, runId: null, kind: 'reconciliation', severity: 'blocking', source: 'capital_budget_v1',
    detailJson: JSON.stringify({ scopeId: scope.id, revision: report.revision, deficits: report.deficits, claimsRetained: true }),
    occurredAt: report.observedAtMs, resolvedAt: null, resolution: null }, database);
}
export function recordBudgetCaptureFailure(scopeId: string, atMs: number, database: Db): void {
  setSetting(`capital.budget_failure.${scopeId}`, String(atMs), database);
}
export function localCapitalBudgetEvidence(profileId: string, atMs: number, database: Db, compatibleWriter = false): AccountBudgetEvidenceV1 | null {
  const origin = getPaperBookOrigin(profileId, database); if (!origin || origin.snapshot.profileId !== profileId) return null;
  const identity = capitalHash({ profileId, originHash: origin.contentHash });
  const binding = listCapitalBindings(profileId, database).find(row => row.mode === 'active' && getCapitalScope(row.scopeId, database)?.accountIdentityHash === identity);
  if (!binding) return null;
  const scope = getCapitalScope(binding.scopeId, database)!, balances = listPaperBalances(profileId, database);
  const ledger = database.prepare('SELECT account,asset_id,amount_usd_text,quantity_text,id,run_id,fill_id,order_id FROM paper_ledger_entries_v3 WHERE profile_id=? ORDER BY rowid LIMIT 100001')
    .all(profileId) as { account: string; asset_id: string | null; amount_usd_text: string; quantity_text: string; id: string;
      run_id: string; fill_id: string | null; order_id: string | null }[];
  if (ledger.length > 100_000) throw new Error('budget_evidence_capacity');
  const totals = new Map<string, ReturnType<typeof budgetAmount>>();
  for (const row of ledger) {
    const asset = row.account === 'cash' ? 'USD' : ['opening', 'asset'].includes(row.account) ? row.asset_id : null;
    if (asset !== null) totals.set(asset, (totals.get(asset) ?? budgetAmount('0')).add(row.account === 'cash' ? row.amount_usd_text : row.quantity_text));
  }
  const fillProof = database.prepare('SELECT id FROM paper_fills_v3 WHERE id=? AND order_id=? AND profile_id=?');
  const knownRows = ledger.every(row => row.account === 'opening' ? row.run_id === `paper-origin:${origin.contentHash}` :
    ['cash', 'asset', 'venue_fee'].includes(row.account) && row.fill_id !== null && row.order_id !== null &&
      fillProof.get(row.fill_id, row.order_id, profileId) !== undefined);
  const opening = ledger.filter(row => row.account === 'opening');
  const expectedOpening = new Map([['USD', origin.snapshot.cashUsd], ...origin.snapshot.balances.map(row => [row.assetId, row.quantity] as const)]);
  const openingMatches = [...expectedOpening].every(([id, quantity]) => budgetAmount(quantity).eq(opening.filter(row => row.asset_id === id)
    .reduce((sum, row) => sum.add(row.quantity_text), budgetAmount('0')))) && opening.every(row => row.asset_id !== null && expectedOpening.has(row.asset_id));
  const complete = knownRows && openingMatches && balances.every(row => budgetAmount(row.quantity).eq(totals.get(row.assetId) ?? '0')) &&
    [...totals].every(([id, quantity]) => quantity.eq(balances.find(row => row.assetId === id)?.quantity ?? '0'));
  const positions = Object.fromEntries(balances.filter(row => row.assetId !== 'USD').map(row => [row.assetId, row.quantity]));
  const currentClaims = budgetClaimHeads(listCashClaims(scope.id, database)).heads;
  const pending = listSubmittedPaperExecutions(profileId, database);
  // A legacy pending intent has no certified future execution-price/fee bound. Do not guess its hold.
  const uncovered = pending.some(row => !currentClaims.some(claim => claim.originKey === `paper-order:${row.orderId}` && claim.state === 'committed'));
  const valuation = listCapitalValuations(scope.id, database).filter(row => row.verified && row.atMs <= atMs && atMs - row.atMs <= 30_000).at(-1);
  const marks: Record<string, string> = {};
  if (valuation) for (const leg of valuation.legs) if (leg.role === 'asset' && leg.valueUsd !== null && budgetAmount(leg.quantity).gt(0)) marks[leg.asset] = budgetText(budgetAmount(leg.valueUsd).div(leg.quantity));
  const markedSameHoldings = valuation?.legs.filter(leg => leg.role === 'asset').every(leg => budgetAmount(positions[leg.asset] ?? '0').eq(leg.quantity)) &&
    Object.entries(positions).every(([id, quantity]) => budgetAmount(quantity).isZero() || marks[id] !== undefined);
  const legacyWriter = !compatibleWriter && getPaperExecutionPolicy(profileId, database).mode !== 'off';
  const source = budgetEvidence({ ...base(scope, atMs), cashUsd: balances.find(row => row.assetId === 'USD')?.quantity ?? null,
    equityUsd: markedSameHoldings ? valuation?.equityUsd ?? null : null, positions, marks,
    venueEligibleUsd: inapplicableNativeRule('isolated_simulation_cash_only'), complete, holdMatchingComplete: !uncovered,
    authority: legacyWriter ? 'legacy_writer' : 'isolated_book', reasonCodes: [...(uncovered ? ['legacy_pending_hold_unbounded'] : []),
      ...(!knownRows || !openingMatches ? ['paper_funding_or_ledger_provenance_unknown'] : [])],
    evidenceRefs: [origin.contentHash, capitalHash(ledger), ...(valuation ? [valuation.id] : [])] });
  return source;
}
export function captureLocalCapitalBudget(profileId: string, atMs: number, database: Db): void {
  const source = localCapitalBudgetEvidence(profileId, atMs, database); if (source) persist(source, [], database, profileId);
}

export function captureCoinbaseCapitalBudget(profileId: string, scopeId: string, acquisition: CoinbaseEvidenceAcquisition, atMs: number, database: Db): void {
  const scope = getCapitalScope(scopeId, database); if (!scope || scope.provider !== 'coinbase') throw new Error('budget_scope_identity');
  const members = acquisition.capitalEvidence?.accounts;
  const membership = members !== undefined && acquisition.accounts.every(row => members.some(member => member.accountUuid === row.accountUuid && member.portfolioIdentityHash === scope.accountIdentityHash));
  const dollars = acquisition.accounts.filter(row => row.currency === 'USD');
  const cash = dollars.reduce((sum, row) => sum.add(row.totalQuantity), budgetAmount('0'));
  const eligible = dollars.reduce((sum, row) => sum.add(row.availableQuantity), budgetAmount('0'));
  const rules = (acquisition.budgetEvidence?.products ?? []).flatMap(product => {
    const productId = product['product_id']; if (typeof productId !== 'string') return [];
    try { return [normalizeCoinbaseCapitalRules(product, { productId, assetId: instrumentKey({ venue: 'coinbase', productId, productType: 'spot' }),
      observedAtMs: atMs, evidenceRef: acquisition.datasetHash, tradabilityChecked: false })]; } catch { return []; }
  });
  const positions: Record<string, string> = {};
  for (const row of acquisition.accounts.filter(row => row.currency !== 'USD')) {
    const id = instrumentKey({ venue: 'coinbase', productType: 'spot', productId: `${row.currency}-USD` });
    positions[id] = budgetText(budgetAmount(positions[id] ?? '0').add(row.totalQuantity));
  }
  const source = budgetEvidence({ ...base(scope, atMs), cashUsd: membership ? budgetText(cash) : null,
    venueEligibleUsd: membership ? knownNativeRule(budgetText(eligible)) : unknownNativeRule('portfolio_membership_missing'),
    positions,
    ruleIds: rules.map(rule => rule.id), complete: membership, authority: 'unproven', holdMatchingComplete: false,
    reasonCodes: ['account_open_order_hold_matching_unverified'], evidenceRefs: [acquisition.datasetHash] });
  inTransaction(database, () => { for (const rule of rules) saveNativeExecutionRules(rule, database); persist(source, [], database, profileId); });
}
export interface AcquiredAlpacaBudgetAsset { readonly symbol: string; readonly assetId: string; readonly value: unknown }
export function captureAlpacaCapitalBudget(scopeId: string, account: AlpacaPaperAccount, atMs: number, evidenceRef: string, database: Db,
  assets: readonly AcquiredAlpacaBudgetAsset[] = [], profileId?: string): void {
  const scope = getCapitalScope(scopeId, database);
  if (!scope || scope.provider !== 'alpaca' || sha256Hex(account.id.toLowerCase()) !== scope.accountIdentityHash || account.currency !== 'USD') throw new Error('budget_scope_identity');
  if (assets.length > 100) throw new Error('budget_evidence_capacity');
  const rules = assets.map(asset => normalizeAlpacaCapitalRules(asset.value, { symbol: asset.symbol, assetId: asset.assetId, observedAtMs: atMs, evidenceRef }));
  const source = budgetEvidence({ ...base(scope, atMs), cashUsd: account.cash, ruleIds: rules.map(rule => rule.id),
    venueEligibleUsd: typeof account.non_marginable_buying_power === 'string' ? knownNativeRule(account.non_marginable_buying_power) : unknownNativeRule('non_marginable_buying_power_missing'),
    equityUsd: null, complete: false, holdMatchingComplete: false, authority: 'legacy_writer',
    reasonCodes: ['current_positions_open_orders_and_financial_cut_unverified'], evidenceRefs: [evidenceRef] });
  inTransaction(database, () => { for (const rule of rules) saveNativeExecutionRules(rule, database); persist(source, [], database, profileId); });
}
