import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { cashClaim, capitalHash, projectAccountBudget, evaluateCapitalFeasibility, BudgetDecimal as D, unknownNativeRule } from '@coqui/core';
import { ASSET, NOW, SCOPE, feasibility, source } from './helpers/feasibility.js';

describe('P2 independently specified budget mechanics', () => {
  it('deducts each hold only from ceilings that do not already reflect it', () => {
    const claims = [cashClaim({ scopeId: SCOPE, originKey: 'order-O', replacesId: null, assetId: 'USD', amount: '20', purpose: 'order',
      state: 'committed', reflectedIn: ['venue'], reflectionEvidence: ['provider-order-O'], evidenceRefs: ['fixture'] }),
      ...[['L', '10', 'order'], ['R', '15', 'profit_reserve']].map(([key, amount, purpose]) => cashClaim({ scopeId: SCOPE,
        originKey: key!, replacesId: null, assetId: 'USD', amount: amount!, purpose: purpose as 'order' | 'profit_reserve', state: 'committed', reflectedIn: [], reflectionEvidence: [], evidenceRefs: ['fixture'] }))];
    const input = source({ cashUsd: '100', equityUsd: '100', venueEligibleUsd: { state: 'known', value: '80' } });
    const report = projectAccountBudget(input, [...claims, claims[0]!], NOW);
    expect(report.spendableUsd).toBe('55'); expect(report.activeEquityUsd).toBe('85'); expect(report.claimIds).toHaveLength(3);
    const debit = projectAccountBudget(source({ ...input, cashUsd: '40', venueEligibleUsd: { state: 'known', value: '20' } }), claims, NOW);
    expect(debit.spendableUsd).toBeNull(); expect(debit.deficits['USD']).toBe('5'); expect(debit.reasonCodes).toContain('budget_underfunded');
  });
  it('retains unknown outcomes, resolves only explicit claim lineage, rejects conflicting heads', () => {
    const first = cashClaim({ scopeId: SCOPE, originKey: 'submission', replacesId: null, assetId: 'USD', amount: '70', purpose: 'order',
      state: 'unknown', reflectedIn: [], reflectionEvidence: [], evidenceRefs: ['intent'] });
    expect(projectAccountBudget(source({ cashUsd: '100' }), [first], NOW).spendableUsd).toBe('30');
    const released = cashClaim({ ...first, replacesId: first.id, state: 'released' });
    expect(projectAccountBudget(source({ cashUsd: '100' }), [first, released], NOW).spendableUsd).toBe('100');
    const conflict = cashClaim({ ...first, amount: '60' });
    expect(projectAccountBudget(source(), [first, conflict], NOW).reasonCodes).toContain('claim_revision_conflict');
  });
  it('distinguishes observed cash, zero crypto eligibility and unavailable ownership', () => {
    const connected = source({ provider: 'alpaca', environment: 'paper', cashUsd: '100', venueEligibleUsd: { state: 'known', value: '0' }, authority: 'unproven' });
    const report = projectAccountBudget(connected, [], NOW);
    expect(report.observedCashUsd).toBe('100'); expect(report.spendableUsd).toBeNull(); expect(report.reasonCodes).toContain('account_ownership_unproven');
    expect(projectAccountBudget(source({ cashUsd: '100', venueEligibleUsd: { state: 'known', value: '0' } }), [], NOW).spendableUsd).toBe('0');
    expect(projectAccountBudget({ ...connected, venueEligibleUsd: unknownNativeRule('missing') }, [], NOW).reasonCodes).toContain('venue_eligibility_unknown');
  });
  it('keeps stale evidence and unmatched holds unavailable without hiding observed balances', () => {
    const report = projectAccountBudget(source({ holdMatchingComplete: false }), [], NOW + 30_000);
    expect(report.reasonCodes).toEqual(['budget_source_stale', 'hold_matching_unknown']); expect(report.observedCashUsd).toBe('500');
  });
  it('reconciles an explicitly posted fee without deducting the same contingency twice', () => {
    const pending = cashClaim({ scopeId: SCOPE, originKey: 'fee-for-existing-fill', replacesId: null, assetId: 'USD', amount: '2',
      purpose: 'fee_contingency', state: 'committed', reflectedIn: [], reflectionEvidence: [], evidenceRefs: ['fill'] });
    expect(projectAccountBudget(source({ cashUsd: '100' }), [pending], NOW).spendableUsd).toBe('98');
    const posted = cashClaim({ ...pending, replacesId: pending.id, state: 'settled', evidenceRefs: ['fill', 'posted-fee-proof'] });
    expect(projectAccountBudget(source({ cashUsd: '98' }), [pending, posted, posted], NOW).spendableUsd).toBe('98');
  });
});

describe('P2 joint feasibility witnesses', () => {
  it.each([['99.99', '4.99'], ['100', '5'], ['100.01', '5'], ['999.99', '49.99'], ['1000', '50'],
    ['1000.01', '50'], ['9999.99', '499.99'], ['10000', '500'], ['10000.01', '500']])('keeps the same 5%% policy at the old tier boundary $%s', (capital, quantity) => {
    const input = feasibility(capital), report = evaluateCapitalFeasibility({ ...input, intents: [{ ...input.intents[0]!, deltaQuantity: '100000' }],
      policy: { ...input.policy, maxEntryFraction: '0.05' } });
    expect(report.orders[0]?.quantity).toBe(quantity);
  });
  it.each(['50', '100', '250', '500', '1000', '2500', '5000', '10000', '100000'])('conserves cash at $%s without increasing a requested trade', capital => {
    const input = feasibility(capital), report = evaluateCapitalFeasibility(input);
    expect(report.state).toBe('feasible'); expect(report.orders[0]?.quantity).toBe('10');
    expect(report.remainingBuyCashUsd).toBe(new D(capital).sub(10).toFixed()); expect(report.executionEligible).toBe(false);
  });
  it('enforces the $25 discretionary floor independently of native legality and fees', () => {
    const input = feasibility('100');
    expect(evaluateCapitalFeasibility({ ...input, policy: { ...input.policy, maxEntryFraction: '0.05', discretionaryFloorUsd: '25' } }).blocked[0]?.reasons).toContain('discretionary_floor_not_met');
    const five = feasibility('500');
    const exact = { ...five, intents: [{ ...five.intents[0]!, deltaQuantity: '25' }], policy: { ...five.policy, maxEntryFraction: '0.05', discretionaryFloorUsd: '25' } };
    expect(evaluateCapitalFeasibility(exact).orders[0]?.quantity).toBe('25');
    expect(evaluateCapitalFeasibility({ ...exact, fees: { ...exact.fees, rate: '0.0025' } }).orders).toHaveLength(0);
  });
  it('deducts a received-asset buy fee through delivery and equity, once', () => {
    const input = feasibility(), report = evaluateCapitalFeasibility({ ...input, fees: { ...input.fees, currency: 'received', rate: '0.0025' } });
    expect(report.orders[0]).toMatchObject({ cashDebitUsd: '10', deliveredQuantity: '9.975', feeUsd: '0.025' });
    expect(report.projectedEquityUsd).toBe('499.975'); expect(report.projectedCashUsd).toBe('490');
  });
  it('nets strategy exposures before sizing and does not double-charge turnover', () => {
    const input = feasibility(), report = evaluateCapitalFeasibility({ ...input, intents: [input.intents[0]!, { ...input.intents[0]!, deltaQuantity: '-4', strategyRef: 'second' }] });
    expect(report.orders[0]?.quantity).toBe('6'); expect(report.oneWayTurnoverUsd).toBe('6'); expect(report.orders[0]?.strategyRefs).toHaveLength(2);
  });
  it('uses the declared priority order when two independent buys compete for cash', () => {
    const input = feasibility('100'), original = input.assets[0]!;
    const second = { ...original, assetId: 'z-priority', rules: { ...original.rules, assetId: 'z-priority' } };
    const report = evaluateCapitalFeasibility({ ...input, assets: [original, second], intents: [
      { ...input.intents[0]!, assetId: second.assetId, deltaQuantity: '80' }, { ...input.intents[0]!, deltaQuantity: '80' }] });
    expect(report.orders.map(row => [row.assetId, row.quantity])).toEqual([['z-priority', '80'], [ASSET, '20']]);
  });
  it('exposes exact exit dust, and only bypasses a discretionary floor under explicit risk-exit policy', () => {
    const budget = projectAccountBudget(source({ cashUsd: '100', equityUsd: '100.123', positions: { [ASSET]: '0.123' } }), [], NOW);
    const input = feasibility('100', { budget, expectedRevision: budget.revision });
    const rule = { ...input.assets[0]!.rules, quantityMin: { state: 'known' as const, value: '0.10' } };
    const exit = { ...input, assets: [{ ...input.assets[0]!, rules: rule }], intents: [{ assetId: ASSET, deltaQuantity: '-0.123', reason: 'risk_exit' as const, strategyRef: 'exit' }],
      policy: { ...input.policy, discretionaryFloorUsd: '25', riskExitBypassesDiscretionaryFloor: true } };
    const report = evaluateCapitalFeasibility(exit); expect(report.orders[0]?.quantity).toBe('0.12'); expect(report.quantities[ASSET]).toBe('0.003');
    expect(evaluateCapitalFeasibility({ ...exit, policy: { ...exit.policy, riskExitBypassesDiscretionaryFloor: false } }).orders).toHaveLength(0);
    expect(evaluateCapitalFeasibility({ ...exit, policy: { ...exit.policy, killSwitchEngaged: true } }).state).toBe('infeasible');
  });
  it('preserves hard account caps and reports current concentration breaches', () => {
    const budget = projectAccountBudget(source({ cashUsd: '50', equityUsd: '100', positions: { [ASSET]: '50' } }), [], NOW);
    const input = feasibility('100', { budget, expectedRevision: budget.revision });
    const report = evaluateCapitalFeasibility({ ...input, policy: { ...input.policy, accountMaxPositionFraction: '0.4' } });
    expect(report.orders).toHaveLength(0); expect(report.riskResiduals).toContain(`position_limit:${ASSET}`);
    expect(report.operatingFloor.state).toBe('unavailable');
  });
  it('does not spend unfilled sales or relax concentration after a hypothetical reserve', () => {
    const held = source({ cashUsd: '0', equityUsd: '100', positions: { [ASSET]: '100' } });
    const budget = projectAccountBudget(held, [], NOW), input = feasibility('100', { budget, expectedRevision: budget.revision });
    const second = { ...input.assets[0]!, assetId: 'second', rules: { ...input.assets[0]!.rules, assetId: 'second' } };
    const report = evaluateCapitalFeasibility({ ...input, assets: [...input.assets, second], intents: [
      { ...input.intents[0]!, deltaQuantity: '-50', reason: 'risk_exit' }, { ...input.intents[0]!, assetId: 'second', deltaQuantity: '50' }] });
    expect(report.orders).toHaveLength(1); expect(report.orders[0]?.side).toBe('sell'); expect(report.remainingBuyCashUsd).toBe('0');
    const reserve = cashClaim({ scopeId: SCOPE, originKey: 'hypothetical-only', replacesId: null, assetId: 'USD', amount: '50', purpose: 'profit_reserve',
      state: 'committed', reflectedIn: [], reflectionEvidence: [], evidenceRefs: ['simulation_not_funded'] });
    const reserved = projectAccountBudget(source({ cashUsd: '60', equityUsd: '100', positions: { [ASSET]: '40' } }), [reserve], NOW);
    const result = evaluateCapitalFeasibility({ ...input, budget: reserved, expectedRevision: reserved.revision,
      policy: { ...input.policy, maxPositionFraction: '0.5', accountMaxPositionFraction: '0.5' } });
    expect(result.riskResiduals).toContain(`position_limit:${ASSET}`); expect(result.orders).toHaveLength(0);
  });
  it('handles sell fees in received USD, fixed expense, and native minimum boundaries exactly', () => {
    const budget = projectAccountBudget(source({ cashUsd: '5', equityUsd: '15', positions: { [ASSET]: '10' } }), [], NOW);
    const input = feasibility('15', { budget, expectedRevision: budget.revision });
    const result = evaluateCapitalFeasibility({ ...input, intents: [{ ...input.intents[0]!, deltaQuantity: '-10' }],
      fees: { ...input.fees, currency: 'received', rate: '0.0025', fixedUsd: '1' } });
    expect(result.orders[0]).toMatchObject({ cashDebitUsd: '1', cashCreditUsd: '9.975', feeUsd: '1.025' });
    expect(result.projectedCashUsd).toBe('13.975'); expect(result.projectedEquityUsd).toBe('13.975');
    const base = feasibility();
    for (const [quantity, expected] of [['0.09', 0], ['0.10', 1], ['0.11', 1]] as const) {
      const boundary = evaluateCapitalFeasibility({ ...base, assets: [{ ...base.assets[0]!, rules: { ...base.assets[0]!.rules,
        quantityMin: { state: 'known', value: '0.10' } } }], intents: [{ ...base.intents[0]!, deltaQuantity: quantity }] });
      expect(boundary.orders).toHaveLength(expected);
    }
  });
  it('refuses stale budgets, unknown native maxima and missing marks, rather than guessing', () => {
    const input = feasibility();
    expect(evaluateCapitalFeasibility({ ...input, expectedRevision: capitalHash('old') }).reasonCodes).toContain('budget_revision_stale');
    expect(evaluateCapitalFeasibility({ ...input, assets: [{ ...input.assets[0]!, rules: { ...input.assets[0]!.rules, quantityMax: unknownNativeRule('absent') } }] }).state).toBe('unavailable');
    expect(evaluateCapitalFeasibility({ ...input, nowMs: NOW + 60_001 }).state).toBe('unavailable');
  });
  it('floors all quantities and respects fee-inclusive cash over generated sequences', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 5000 }), { minLength: 1, maxLength: 20 }), values => {
      const input = feasibility('50');
      const desired = new D(values.reduce((sum, n) => sum + n, 0)).div(100);
      const report = evaluateCapitalFeasibility({ ...input, intents: [{ ...input.intents[0]!, deltaQuantity: desired.toFixed() }], fees: { ...input.fees, rate: '0.0025' } });
      expect(new D(report.remainingBuyCashUsd!)).toBeDefined(); expect(new D(report.remainingBuyCashUsd!).gte(0)).toBe(true);
      for (const order of report.orders) { expect(new D(order.quantity).lte(desired)).toBe(true); expect(new D(order.quantity).mod('0.01').isZero()).toBe(true); }
    }), { numRuns: 100 });
  });
});
