import { BudgetDecimal as D, budgetAmount as amount, budgetText as text, identifiedBudgetFact } from '../execution/native-rules.js';
import { capitalHash } from './capital-ledger.js';
import { reserveUnavailable, reserveValue, type ReserveMetric } from './profit-reserve.js';

export interface ReserveInvestmentFill {
  readonly id: string; readonly assetId: string; readonly side: 'buy' | 'sell'; readonly quantity: string;
  readonly priceUsd: string; readonly feeUsd: string | null; readonly atMs: number; readonly sequence: number | null;
}
export interface ReserveInvestmentInput {
  readonly scopeId: string; readonly assurance: 'observed' | 'scenario'; readonly fromMs: number; readonly toMs: number;
  readonly opening: readonly { readonly assetId: string; readonly quantity: string; readonly costUsd: string | null }[];
  readonly fills: readonly ReserveInvestmentFill[]; readonly finalQuantities: Readonly<Record<string, string>>;
  readonly marks: Readonly<Record<string, string>>; readonly incomeUsd: ReserveMetric; readonly expensesUsd: ReserveMetric;
  readonly coverageComplete: boolean; readonly feesComplete: boolean; readonly reasonCodes: readonly string[]; readonly evidenceRefs: readonly string[];
}
export interface ReserveEligibilityReport {
  readonly id: string; readonly version: 'profit-reserve-eligibility-v1'; readonly scopeId: string; readonly fromMs: number; readonly toMs: number;
  readonly assurance: 'observed' | 'scenario'; readonly realizedPnlUsd: ReserveMetric; readonly unrealizedPnlUsd: ReserveMetric;
  readonly completedWins: ReserveMetric; readonly reasonCodes: readonly string[]; readonly inputHash: string;
  readonly evidenceRefs: readonly string[]; readonly basisMethod: 'scope-fifo-investment-v1';
}
/** Exact FIFO investment accounting. Opening market value is never substituted for acquisition basis. */
export function projectReserveInvestment(input: ReserveInvestmentInput): ReserveEligibilityReport {
  const reasons = [...input.reasonCodes], byId = new Map<string, ReserveInvestmentFill>();
  if (!input.coverageComplete) reasons.push('investment_history_incomplete');
  if (!input.feesComplete) reasons.push('fee_accounting_incomplete');
  if (input.fromMs > input.toMs || input.fills.length > 100_000) throw new TypeError('reserve_investment_interval');
  for (const f of input.fills) {
    if (!amount(f.quantity).gt(0) || !amount(f.priceUsd).gt(0) || f.feeUsd !== null && amount(f.feeUsd).lt(0) || f.atMs < input.fromMs || f.atMs > input.toMs) throw new TypeError('reserve_invalid_fill');
    const prior = byId.get(f.id); if (prior && capitalHash(prior) !== capitalHash(f)) reasons.push('fill_revision_conflict');
    byId.set(f.id, f);
  }
  const fills = [...byId.values()].sort((a, b) => a.atMs - b.atMs || (a.sequence ?? 0) - (b.sequence ?? 0));
  const ties = new Map<string, ReserveInvestmentFill[]>();
  for (const f of fills) { const key = `${f.assetId}:${f.atMs}`, group = ties.get(key) ?? []; group.push(f); ties.set(key, group); }
  for (const group of ties.values()) if (group.length > 1 && (group.some(f => f.sequence === null) || new Set(group.map(f => f.sequence)).size !== group.length)) reasons.push('fill_ordering_unverified');
  type Lot = { quantity: InstanceType<typeof D>; cost: InstanceType<typeof D> | null };
  const lots = new Map<string, Lot[]>(), episodes = new Map<string, { profit: InstanceType<typeof D>; known: boolean }>();
  for (const o of input.opening) {
    if (lots.has(o.assetId) || amount(o.quantity).lt(0) || o.costUsd !== null && amount(o.costUsd).lt(0)) throw new TypeError('reserve_invalid_opening');
    lots.set(o.assetId, amount(o.quantity).isZero() ? [] : [{ quantity: amount(o.quantity), cost: o.costUsd === null ? null : amount(o.costUsd) }]);
    if (amount(o.quantity).gt(0)) episodes.set(o.assetId, { profit: new D(0), known: false });
  }
  let realized = new D(0), wins = 0, realizedKnown = true, winsKnown = true;
  for (const f of fills) {
    const queue = lots.get(f.assetId) ?? []; lots.set(f.assetId, queue);
    if (f.side === 'buy') {
      if (queue.length === 0) episodes.set(f.assetId, { profit: new D(0), known: true });
      queue.push({ quantity: amount(f.quantity), cost: f.feeUsd === null ? null : amount(f.quantity).mul(f.priceUsd).add(f.feeUsd) });
      continue;
    }
    let remaining = amount(f.quantity), basis = new D(0), known = f.feeUsd !== null;
    while (remaining.gt(0) && queue.length) {
      const lot = queue[0]!, take = D.min(lot.quantity, remaining);
      if (lot.cost === null) known = false;
      else { const consumed = lot.cost.mul(take).div(lot.quantity); basis = basis.add(consumed); lot.cost = lot.cost.sub(consumed); }
      lot.quantity = lot.quantity.sub(take); remaining = remaining.sub(take); if (lot.quantity.isZero()) queue.shift();
    }
    if (remaining.gt(0)) { known = false; reasons.push('quantity_ownership_unreconciled'); }
    const pnl = amount(f.quantity).mul(f.priceUsd).sub(f.feeUsd ?? '0').sub(basis);
    if (known) realized = realized.add(pnl); else realizedKnown = false;
    const episode = episodes.get(f.assetId) ?? { profit: new D(0), known: false };
    episode.profit = episode.profit.add(pnl); episode.known &&= known; episodes.set(f.assetId, episode);
    if (queue.length === 0) { if (!episode.known) winsKnown = false; else if (episode.profit.gt(0)) wins++; episodes.delete(f.assetId); }
  }
  let unrealized = new D(0), unrealizedKnown = true;
  for (const id of new Set([...lots.keys(), ...Object.keys(input.finalQuantities)])) {
    const queue = lots.get(id) ?? [], held = queue.reduce((sum, lot) => sum.add(lot.quantity), new D(0));
    if (!held.eq(input.finalQuantities[id] ?? '0')) reasons.push('investment_positions_unreconciled');
    if (held.gt(0)) {
      const mark = input.marks[id]; if (mark === undefined || !amount(mark).gt(0) || queue.some(lot => lot.cost === null)) unrealizedKnown = false;
      else unrealized = unrealized.add(held.mul(mark).sub(queue.reduce((sum, lot) => sum.add(lot.cost!), new D(0))));
    }
  }
  const financialReasons = [...new Set(reasons)].sort();
  if (input.incomeUsd.state === 'unavailable') financialReasons.push(...input.incomeUsd.reasonCodes);
  if (input.expensesUsd.state === 'unavailable') financialReasons.push(...input.expensesUsd.reasonCodes);
  const refs = input.evidenceRefs, aggregateReasons = [...new Set(financialReasons)].sort();
  const rp = aggregateReasons.length ? reserveUnavailable(...aggregateReasons) : !realizedKnown ? reserveUnavailable('cost_basis_unavailable') :
    reserveValue(text(realized.add(input.incomeUsd.state === 'available' ? input.incomeUsd.value : '0').sub(input.expensesUsd.state === 'available' ? input.expensesUsd.value : '0')), refs);
  return identifiedBudgetFact({ version: 'profit-reserve-eligibility-v1' as const, scopeId: input.scopeId, fromMs: input.fromMs, toMs: input.toMs, assurance: input.assurance,
    realizedPnlUsd: rp, unrealizedPnlUsd: aggregateReasons.length ? reserveUnavailable(...aggregateReasons) : unrealizedKnown ? reserveValue(text(unrealized), refs) : reserveUnavailable('cost_basis_or_marks_unavailable'),
    completedWins: aggregateReasons.length || !winsKnown || !realizedKnown ? reserveUnavailable(...aggregateReasons, ...(!winsKnown || !realizedKnown ? ['episode_accounting_incomplete'] : [])) : reserveValue(String(wins), refs),
    reasonCodes: aggregateReasons, inputHash: identifiedBudgetFact(input).id, evidenceRefs: refs, basisMethod: 'scope-fifo-investment-v1' as const });
}
