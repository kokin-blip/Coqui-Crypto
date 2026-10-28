import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { preparePaperReserveSale, projectAccountBudget, budgetAmount as a, capitalHash, type PaperReserveSaleInput } from '@coqui/core';
import { feasibility, source, ASSET, NOW } from './helpers/feasibility.js';

function fixture(scale = '500'): PaperReserveSaleInput {
  const value = a(scale).mul('1.1').toFixed(), f = feasibility(value);
  const budget = projectAccountBudget(source({ cashUsd: '0', equityUsd: value, positions: { [ASSET]: '1' } }), [], NOW);
  return { frame: { ...f, budget, expectedRevision: budget.revision,
    assets: [{ ...f.assets[0]!, markUsd: value, quote: { bid: value, ask: value, atMs: NOW } }] },
    lots: [{ id: 'lot', assetId: ASSET, quantity: '1', basisUsd: scale, acquiredAtMs: NOW - 1, sequence: 0, evidenceRef: 'independent-buy' }],
    objective: { reserveUsd: a(scale).mul('0.025').toFixed(), economicBackingUsd: a(scale).mul('0.1').toFixed(), realizedBackingUsd: '0', freshProfitUsd: a(scale).mul('0.1').toFixed(),
      shareBps: 2500, additionalTaxUsd: '0', profitBackedTaxUsd: '0', retainedFloorUsd: a(scale).mul('0.8').toFixed(),
      maxCostUsd: '0', maxNotionalUsd: value, maxExposureReductionUsd: value, eligibleAssetIds: [ASSET], reviewRef: 'synthetic-reviewed-objective' }, policyId: capitalHash('policy'), stateId: capitalHash('state') };
}
describe('bounded FIFO reserve sale consequences', () => {
  it('realizing $12.50 on $500 basis/$550 value requires $137.50 proceeds', () => {
    const result = preparePaperReserveSale(fixture());
    expect(result).toMatchObject({ state: 'modeled', selectedAssetId: ASSET, fundsEligibility: false, orderSubmissionPermitted: false });
    expect(result.candidates[0]).toMatchObject({ quantity: '0.25', notionalUsd: '137.5', realizedGainUsd: '12.5', residualQuantity: '0.75' });
  });
  it.each(['50','100','250','500','1000','2500','5000','10000','100000'])('uses the actual $%s book', capital => {
    const result = preparePaperReserveSale(fixture(capital));
    expect(result.state).toBe('modeled'); expect(result.candidates[0]?.quantity).toBe('0.25');
    expect(a(result.candidates[0]!.realizedGainUsd!).eq(a(capital).mul('0.025'))).toBe(true);
  });
  it('intersects loss-making and profitable FIFO segments instead of choosing the cheapest lot', () => {
    const f = fixture(), result = preparePaperReserveSale({ ...f, lots: [
      { ...f.lots[0]!, id: 'first', quantity: '0.5', basisUsd: '300' },
      { ...f.lots[0]!, id: 'second', quantity: '0.5', basisUsd: '200', acquiredAtMs: NOW, sequence: 1 },
    ] });
    expect(result.candidates[0]).toMatchObject({ quantity: '0.75', notionalUsd: '412.5', realizedGainUsd: '12.5' });
  });
  it('fees reduce both fresh/economic profit and realized backing', () => {
    const f = fixture(), fees = { ...f.frame.fees, rate: '0.01' };
    expect(preparePaperReserveSale({ ...f, frame: { ...f.frame, fees }, objective: { ...f.objective, maxCostUsd: '2' } }).state).toBe('infeasible');
    const result = preparePaperReserveSale({ ...f, frame: { ...f.frame, fees }, objective: { ...f.objective, reserveUsd: '12', maxCostUsd: '2' } });
    expect(result.candidates[0]).toMatchObject({ quantity: '0.27', costUsd: '1.485', realizedGainUsd: '12.015', netProceedsUsd: '147.015' });
  });
  it('respects native, turnover, exposure and cost limits and preserves missing basis', () => {
    const f = fixture();
    for (const key of ['maxNotionalUsd','maxExposureReductionUsd'] as const) expect(preparePaperReserveSale({ ...f, objective: { ...f.objective, [key]: '137.49' } }).state).toBe('infeasible');
    expect(preparePaperReserveSale({ ...f, frame: { ...f.frame, policy: { ...f.frame.policy, maxTurnoverUsd: '137.49' } } }).state).toBe('infeasible');
    expect(preparePaperReserveSale({ ...f, lots: [{ ...f.lots[0]!, basisUsd: null }] }).state).toBe('unavailable');
    expect(preparePaperReserveSale({ ...f, frame: { ...f.frame, nowMs: NOW + 30_000 } }).state).toBe('unavailable');
    expect(f.frame.budget.positions[ASSET]).toBe('1');
  });
  it('does not sell when the objective is already funded', () => {
    const f = fixture(), b = projectAccountBudget(source({ cashUsd: '550', equityUsd: '550' }), [], NOW);
    expect(preparePaperReserveSale({ ...f, frame: { ...f.frame, budget: b, expectedRevision: b.revision }, lots: [], objective: { ...f.objective, realizedBackingUsd: '50' } }).state).toBe('already_funded');
  });
  it('matches an independent exhaustive increment oracle across two FIFO lots', () => {
    fc.assert(fc.property(fc.integer({min:100,max:400}),fc.integer({min:100,max:400}),fc.integer({min:1,max:10}), (firstBasis, secondBasis, target) => {
      const f = fixture(), profit = 550 - firstBasis - secondBasis;
      const input = { ...f, objective: { ...f.objective, reserveUsd: String(target), economicBackingUsd: String(profit), freshProfitUsd: String(profit), retainedFloorUsd: '0' },
        lots: [{ ...f.lots[0]!, id: 'one', quantity: '0.5', basisUsd: String(firstBasis) }, { ...f.lots[0]!, id: 'two', acquiredAtMs: NOW, sequence: 1, quantity: '0.5', basisUsd: String(secondBasis) }] };
      let expected: number | null = null;
      if (profit >= target * 4) for (let n = 1; n <= 100; n++) {
        const q = n / 100, consumed = Math.min(q, .5) * firstBasis * 2 + Math.max(q - .5, 0) * secondBasis * 2;
        if (q * 550 - consumed + 1e-9 >= target && q * 550 >= target) { expected = n; break; }
      }
      const result = preparePaperReserveSale(input);
      expect(result.candidates[0]?.quantity ?? null).toBe(expected === null ? null : a(String(expected)).div(100).toFixed());
    }), {numRuns:100});
  });
});
