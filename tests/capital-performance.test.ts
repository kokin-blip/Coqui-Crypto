import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { calculateCapitalPerformance, capitalEventHeads, type CapitalMetric, type CapitalPerformanceInput } from '@coqui/core';
import { batch, DAY, epoch, event, mark, scope, YEAR } from './helpers/capital.js';

function value(metric: CapitalMetric): string | null { return metric.state === 'available' ? metric.value : null; }
function report(rows = [mark(0, '500'), mark(DAY, '500')], events: CapitalPerformanceInput['events'] = [],
  overrides: Partial<CapitalPerformanceInput> = {}) {
  return calculateCapitalPerformance({ scope, epoch: epoch(rows[0]!), batches: [batch], events, valuations: rows, ...overrides });
}

describe('capital-flow-performance-v1 independent accounting regressions', () => {
  it('does not infer contributions from basis, trades or retained sale proceeds', () => {
    const r = report(undefined, [event({ kind: 'trade', externalFlowUsd: '0', feeUsd: null })]);
    expect(value(r.metrics.economicPnlUsd)).toBe('0');
    expect(value(r.metrics.timeWeightedReturnPct)).toBe('0');
    expect(value(r.metrics.contributionsUsd)).toBe('0');
    expect(r.metrics.realizedPnlUsd.state).toBe('unavailable');
    expect(r.metrics.feesUsd.state).toBe('unavailable');
  });
  it('a deposit-only doubling cannot become annualized investment return', () => {
    const before = mark(YEAR, '500'), after = mark(YEAR, '1000', 1);
    const r = report([mark(0, '500'), before, after], [event({ effectiveTime: { precision: 'instant', fromMs: YEAR, toMs: YEAR },
      beforeValuationId: before.id, afterValuationId: after.id })]);
    expect(value(r.metrics.economicPnlUsd)).toBe('0');
    expect(value(r.metrics.timeWeightedReturnPct)).toBe('0');
    expect(value(r.metrics.annualizedReturnPct)).toBe('0');
    expect(value(r.metrics.moneyWeightedReturnPct)).toBe('0');
  });
  it('withdrawal-only equity decline is not a drawdown', () => {
    const before = mark(DAY, '1000'), after = mark(DAY, '500', 1);
    const r = report([mark(0, '1000'), before, after], [event({ kind: 'outflow', externalFlowUsd: '-500',
      beforeValuationId: before.id, afterValuationId: after.id, confirmedUserReceiptUsd: '500' })]);
    expect(value(r.metrics.economicPnlUsd)).toBe('0');
    expect(value(r.metrics.maxDrawdownPct)).toBe('0');
    expect(value(r.metrics.confirmedUserReceiptsUsd)).toBe('500');
  });
  it('keeps a supported period return while missing daily risk remains unavailable', () => {
    const r = report([mark(0, '1000'), mark(DAY * 2, '1100')]);
    expect(value(r.metrics.timeWeightedReturnPct)).toBe('10');
    expect(value(r.metrics.economicPnlUsd)).toBe('100');
    expect(r.metrics.maxDrawdownPct.state).toBe('unavailable');
    expect(r.metrics.volatilityPct.state).toBe('unavailable');
    expect(r.metrics.annualizedReturnPct.state).toBe('unavailable');
  });
  it('accounts for a $102 debit with $100 delivery and $2 account fee once', () => {
    const r = report([mark(0, '1000'), mark(DAY, '898')], [event({ kind: 'outflow', externalFlowUsd: '-100', feeUsd: '2', confirmedUserReceiptUsd: '100' })]);
    expect(value(r.metrics.economicPnlUsd)).toBe('-2');
    expect(value(r.metrics.feesUsd)).toBe('2');
    expect(r.metrics.timeWeightedReturnPct.state).toBe('unavailable');
  });
  it('preserves dollar P&L without flow-time marks; date precision is never midnight', () => {
    const r = report([mark(0, '500'), mark(DAY * 2, '1000')], [event({ effectiveTime: { precision: 'date', fromMs: DAY, toMs: DAY * 2 - 1 } })]);
    expect(value(r.metrics.economicPnlUsd)).toBe('0');
    expect(r.metrics.timeWeightedReturnPct.state).toBe('unavailable');
    expect(r.metrics.moneyWeightedReturnPct.state).toBe('unavailable');
  });
  it('does not value an in-kind contribution using an invented historical price', () => {
    const r = report(undefined, [event({ externalFlowUsd: null, flowVerified: false,
      legs: [{ asset: 'BTC', quantity: '0.01', role: 'asset', valueUsd: null, valuationRef: null }] })]);
    expect(r.metrics.economicPnlUsd.state).toBe('unavailable');
    expect(value(r.metrics.equityUsd)).toBe('500');
  });
  it('does not hide economic P&L solely because tax basis is unknown', () => {
    const r = report([mark(0, '500'), mark(DAY, '550')]);
    expect(value(r.metrics.economicPnlUsd)).toBe('50');
    expect(r.metrics.unrealizedPnlUsd.state).toBe('unavailable');
  });
  it('does not treat an unsupported journal or a pending transfer as funding', () => {
    for (const e of [event({ kind: 'unknown', flowVerified: false, externalFlowUsd: null }),
      event({ status: 'pending', flowVerified: false, externalFlowUsd: null })]) {
      expect(report(undefined, [e]).metrics.economicPnlUsd.state).toBe('unavailable');
    }
  });
  it('keeps overlapping/unbounded effective intervals explicit', () => {
    const r = report(undefined, [event({ effectiveTime: { precision: 'unknown', fromMs: null, toMs: DAY } })]);
    expect(r.reasonCodes).toContain('flow_boundary_ambiguous');
    expect(r.metrics.economicPnlUsd.state).toBe('unavailable');
  });
  it('requires complete coverage independently of complete current pricing', () => {
    const r = report(undefined, [], { batches: [{ ...batch, coverage: { ...batch.coverage, complete: false } }] });
    expect(value(r.metrics.equityUsd)).toBe('500');
    expect(r.metrics.economicPnlUsd.state).toBe('unavailable');
  });
  it('does not invent an economic opening', () => {
    const r = report(undefined, [], { epoch: null });
    expect(value(r.metrics.equityUsd)).toBe('500');
    expect(r.reasonCodes).toContain('opening_missing');
  });
  it('fails closed on wrong financial scope', () => {
    expect(() => report(undefined, [], { valuations: [{ ...mark(0, '500'), scopeId: 'wrong' }] })).toThrow('scope mismatch');
  });
  it('selects corrections through lineage rather than arrival order', () => {
    const first = event(), correction = event({ externalFlowUsd: '400', replacesId: first.id, correctionAuthority: 'provider_revision' });
    expect(capitalEventHeads([correction, first, first]).events).toEqual([correction]);
    expect(value(report([mark(0, '500'), mark(DAY, '900')], [first, correction]).metrics.economicPnlUsd)).toBe('0');
    expect(report(undefined, [first, event({ externalFlowUsd: '400' })]).reasonCodes).toContain('conflicting_revision');
  });
  it('can report a real total loss without confusing it with full redemption', () => {
    const loss = report([mark(0, '500'), mark(DAY, '0')]);
    expect(value(loss.metrics.timeWeightedReturnPct)).toBe('-100');
    expect(value(loss.metrics.maxDrawdownPct)).toBe('-100');
    const pre = mark(DAY, '500'), post = mark(DAY, '0', 1);
    const redeemed = report([mark(0, '500'), pre, post], [event({ kind: 'outflow', externalFlowUsd: '-500', beforeValuationId: pre.id, afterValuationId: post.id })]);
    expect(value(redeemed.metrics.timeWeightedReturnPct)).toBe('0');
  });
  it('does not bridge a zero NAV through new funding', () => {
    const pre = mark(DAY * 2, '0'), post = mark(DAY * 2, '500', 1);
    const r = report([mark(0, '500'), mark(DAY, '0'), pre, post], [event({
      effectiveTime: { precision: 'instant', fromMs: DAY * 2, toMs: DAY * 2 }, beforeValuationId: pre.id, afterValuationId: post.id })]);
    expect(value(r.metrics.economicPnlUsd)).toBe('-500');
    expect(r.metrics.timeWeightedReturnPct.state).toBe('unavailable');
  });
  it.each(['50', '100', '250', '500', '1000', '2500', '5000', '10000', '100000'])('is flow neutral at capital %s', (capital) => {
    const before = mark(DAY, capital), after = mark(DAY, String(Number(capital) * 2), 1);
    const r = report([mark(0, capital), before, after], [event({ externalFlowUsd: capital, beforeValuationId: before.id, afterValuationId: after.id })]);
    expect(value(r.metrics.economicPnlUsd)).toBe('0');
    expect(value(r.metrics.timeWeightedReturnPct)).toBe('0');
  });
  it('certifies conventional IRR and rejects an unproven multi-sign-change root', () => {
    expect(value(report([mark(0, '100'), mark(YEAR, '110')]).metrics.moneyWeightedReturnPct)).toBe('10');
    const r = report([mark(0, '100'), mark(YEAR * 2, '110')], [
      event({ kind: 'outflow', externalFlowUsd: '-230', effectiveTime: { precision: 'instant', fromMs: YEAR / 2, toMs: YEAR / 2 } }),
      event({ logicalKey: 'fixture:later', externalFlowUsd: '132', effectiveTime: { precision: 'instant', fromMs: YEAR, toMs: YEAR } }),
    ]);
    expect(r.metrics.moneyWeightedReturnPct).toMatchObject({ state: 'unavailable', reasonCodes: ['irr_uniqueness_unproven'] });
    expect(report([mark(0, '100'), mark(YEAR, '0')]).metrics.moneyWeightedReturnPct).toMatchObject({ state: 'unavailable', reasonCodes: ['irr_no_solution'] });
  });
  it('keeps reports deterministic under input reorder and repeated event facts', () => {
    const rows = [mark(0, '500'), mark(DAY, '550')];
    expect(report(rows).inputHash).toBe(report([...rows].reverse(), [], { epoch: epoch(rows[0]!) }).inputHash);
    expect(report(rows).metrics).toEqual(report([...rows].reverse(), [], { epoch: epoch(rows[0]!) }).metrics);
  });
  it('conserves arbitrary capital when a verified boundary adds capital', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: 1_000_000 }), (opening, deposit) => {
      const before = mark(DAY, String(opening)), after = mark(DAY, String(opening + deposit), 1);
      const r = report([mark(0, String(opening)), before, after], [event({ externalFlowUsd: String(deposit), beforeValuationId: before.id, afterValuationId: after.id })]);
      expect(value(r.metrics.economicPnlUsd)).toBe('0'); expect(value(r.metrics.timeWeightedReturnPct)).toBe('0');
    }), { numRuns: 100 });
  });
  it('keeps confirmed flow totals available when a terminal asset price is missing', () => {
    const end = { ...mark(DAY * 2, '1000'), equityUsd: null, verified: false, missingComponents: ['prices_incomplete'] };
    const r = report([mark(0, '500'), end], [event()]);
    expect(value(r.metrics.contributionsUsd)).toBe('500');
    expect(r.metrics.economicPnlUsd.state).toBe('unavailable');
    expect(value(r.metrics.feesUsd)).toBe('0');
  });
  it('keeps a no-flow period return when an intermediate valuation is incomplete', () => {
    const middle = { ...mark(DAY, '500'), verified: false, missingComponents: ['price_time_unknown'] };
    const r = report([mark(0, '500'), middle, mark(DAY * 2, '550')]);
    expect(value(r.metrics.timeWeightedReturnPct)).toBe('10');
    expect(r.metrics.maxDrawdownPct.state).toBe('unavailable');
    expect(r.points[1]?.unitNavUsd).toBeNull();
  });
  it('requires a second observation before reporting investment return', () => {
    expect(report([mark(0, '500')]).metrics.timeWeightedReturnPct).toMatchObject({ state: 'unavailable', reasonCodes: ['insufficient_observations'] });
  });
  it('keeps paired internal transfers out of contributions and charges their actual fee once', () => {
    const r = report([mark(0, '500'), mark(DAY, '498')], [event({ kind: 'internal_transfer', externalFlowUsd: '0',
      legs: [{ asset: 'USD', quantity: '-100', role: 'cash', valueUsd: '-100', valuationRef: 'wallet-a' },
        { asset: 'USD', quantity: '100', role: 'cash', valueUsd: '100', valuationRef: 'wallet-b' }] }),
      event({ logicalKey: 'fixture:fee', kind: 'fee', externalFlowUsd: '0', feeUsd: '2' })]);
    expect(value(r.metrics.contributionsUsd)).toBe('0'); expect(value(r.metrics.netOutflowsUsd)).toBe('0');
    expect(value(r.metrics.economicPnlUsd)).toBe('-2'); expect(value(r.metrics.timeWeightedReturnPct)).toBe('-0.4');
  });
  it('applies an explicit opening-valuation correction while preserving the prior epoch identity', () => {
    const opening = mark(0, '500'), replacement = { ...mark(0, '400'), replacesId: opening.id };
    const r = report([opening, replacement, mark(DAY, '550')], [], { epoch: epoch(opening) });
    expect(value(r.metrics.economicPnlUsd)).toBe('150'); expect(value(r.metrics.timeWeightedReturnPct)).toBe('37.5');
    expect(r.epochId).toBe(epoch(opening).id);
  });
});
