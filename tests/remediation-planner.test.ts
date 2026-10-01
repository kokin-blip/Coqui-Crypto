import { describe, expect, it } from 'vitest';
import { planExecution, revalidateExecutionPlan, classifyTargetChange, openingMatchedBook, applyModeledFill, modelMarketFill,
  type ExecutionPlanInput } from '../packages/core/src/index.js';
import { advanceRemediationBook } from '../packages/services/src/paper/execution-remediation-shadow.js';

const SLOT = Date.parse('2026-10-15T00:00:00Z');
function input(overrides: Partial<ExecutionPlanInput> = {}): ExecutionPlanInput {
  return { namespace: 'study-one', revision: 0, slotMs: SLOT, nowMs: SLOT + 1000, policy: 'C', stage: 'sell',
    target: { id: 'target-new', completedDay: '2026-10-14', datasetHash: 'a'.repeat(64), weights: { LTC: '0.1351' } },
    previousTarget: { id: 'target-old', completedDay: '2026-10-13', datasetHash: 'b'.repeat(64), weights: { LTC: '0.1743' } },
    snapshot: { atMs: SLOT, accountAtMs: SLOT, positionsAtMs: SLOT, cash: '81800', equity: '100000',
      assets: [{ id: 'LTC', symbol: 'LTCUSD', held: '182', marketValue: '18200', bid: '99', ask: '101',
        quoteAtMs: SLOT, rulesAtMs: SLOT, tradable: true, status: 'active', increment: '0.01', minimum: '0.01', completedClose: '110' }] },
    fulfilledAssetIds: [], pendingAssetIds: [], reservedCash: '0',
    limits: { maxOrders: 6, maxTurnoverUsd: '100000', maxOrderUsd: '100000', maxPositionWeight: '1', maxInvestedWeight: '1' }, ...overrides };
}
describe('versioned shadow execution planner', () => {
  it('revises plans when sizing inputs change and never silently amends attempted intents', () => {
    const original=input(),prior=planExecution(original);
    const updated={...original,snapshot:{...original.snapshot,assets:original.snapshot.assets.map((a)=>({...a,held:'190',marketValue:'19000'}))}};
    expect(revalidateExecutionPlan(original,updated,[]).id).not.toBe(prior.id);
    expect(()=>revalidateExecutionPlan(original,updated,[prior.orders[0]!.id])).toThrow('attempted_intent_requires_reconciliation');
    expect(revalidateExecutionPlan(original,{...original,nowMs:original.nowMs+1000},[])).toEqual(prior);
  });

  it('reproduces A ignoring the 4.69-point midnight LTC overweight while B/C reduce', () => {
    expect(planExecution(input({policy:'A'})).orders).toHaveLength(0);
    expect(planExecution(input({policy:'B'})).orders[0]?.quantity).toBe('46.9');
    expect(planExecution(input()).orders[0]).toMatchObject({quantity:'46.9', reason:'target_reduction'});
  });
  it('distinguishes price drift from changes in the immutable target', () => {
    const row = input();
    expect(classifyTargetChange(row.target,row.target,'LTC')).toBe('unchanged');
    const plan = planExecution({...row, previousTarget:row.target});
    expect(plan.orders[0]).toMatchObject({quantity:'16.9', reason:'routine_drift'});
  });
  it('preserves daily A close sizing and intraday A midpoint sizing', () => {
    const row = input(); const snapshot = {...row.snapshot, assets: [{...row.snapshot.assets[0]!,held:'250',marketValue:'25000'}]};
    expect(planExecution({...row,policy:'A',snapshot}).orders[0]?.quantity).toBe('127.18');
    expect(planExecution({...row,policy:'A',slotMs:SLOT+14_400_000,nowMs:SLOT+14_400_001,
      snapshot:{...snapshot,atMs:SLOT+14_400_000,accountAtMs:SLOT+14_400_000,positionsAtMs:SLOT+14_400_000,
        assets:snapshot.assets.map(a=>({...a,quoteAtMs:SLOT+14_400_000,rulesAtMs:SLOT+14_400_000}))}}).orders[0]?.quantity).toBe('114.9');
  });
  it('rejects conflicting immutable target identities and future previous targets', () => {
    const row=input();
    expect(()=>planExecution({...row,previousTarget:{...row.target,weights:{LTC:'0.5'}}})).toThrow('target_identity_conflict');
    expect(()=>planExecution({...row,previousTarget:{...row.previousTarget!,completedDay:'2026-10-16'}})).toThrow('invalid_target_chronology');
  });
  it('keeps IDs deterministic and revisions distinct', () => {
    const a = planExecution(input()); expect(planExecution(input())).toEqual(a);
    expect(planExecution(input({revision:1})).orders[0]?.clientOrderId).not.toBe(a.orders[0]?.clientOrderId);
  });
  it('never gates required reductions on expensive entries', () => {
    expect(planExecution(input({policy:'D'})).orders[0]?.side).toBe('sell');
    const row=input({policy:'D',stage:'buy',previousTarget:null});
    const snapshot={...row.snapshot,assets:row.snapshot.assets.map(a=>({...a,held:'0',marketValue:'0'}))};
    expect(planExecution({...row,snapshot}).blocked[0]?.reason).toBe('discretionary_entry_cost');
  });
  it('rejects stale evidence, pending quantities, and dust after rounding', () => {
    expect(planExecution(input({pendingAssetIds:['LTC']})).blocked[0]?.reason).toBe('pending_order');
    const row=input();
    expect(planExecution({...row,snapshot:{...row.snapshot,assets:row.snapshot.assets.map(a=>({...a,quoteAtMs:SLOT-60_001}))}}).blocked[0]?.reason).toBe('stale_evidence');
    expect(planExecution({...row,snapshot:{...row.snapshot,assets:row.snapshot.assets.map(a=>({...a,increment:'100'}))}}).blocked[0]?.reason).toBe('minimum_after_rounding');
  });
  it('reserves cash at doubled costs without funding buys from unfilled sells', () => {
    const original=input(); const row=input({stage:'buy',policy:'B',costMultiplier:2,target:{...original.target,weights:{LTC:'1'}}});
    const snapshot={...row.snapshot,cash:'100',assets:row.snapshot.assets.map(a=>({...a,held:'0',marketValue:'0'}))};
    const plan=planExecution({...row,snapshot}); const order=plan.orders[0]!;
    const book=modelMarketFill({...openingMatchedBook(),cash:'100'},order,snapshot.assets[0]!,2);
    expect(Number(book.cash)).toBeGreaterThanOrEqual(0);
    expect(Number(order.reservedCash)).toBeLessThanOrEqual(100);
  });
  it('applies cumulative partial buys exactly once with fees in crypto', () => {
    const row=input({stage:'buy',policy:'B'}); const snapshot={...row.snapshot,assets:row.snapshot.assets.map(a=>({...a,held:'0',marketValue:'0'}))};
    const order=planExecution({...row,snapshot}).orders[0]!;
    const evidence={cumulativeQuantity:'1',cumulativeNotional:'100',cumulativeFee:'0.0025',final:false};
    const book=applyModeledFill(openingMatchedBook(),order,evidence);
    expect(book.quantities['LTC']).toBe('0.9975'); expect(book.cash).toBe('99900');
    expect(applyModeledFill(book,order,evidence)).toEqual(book);
    expect(book.pending).toEqual(['LTC']);
    expect(()=>applyModeledFill(book,order,{...evidence,cumulativeQuantity:'0.5'})).toThrow('invalid_cumulative_fill');
  });
  it('maintains independent equal-capital controls and identifies all seven arms', () => {
    const row=input(), frame={slotMs:SLOT,capturedAtMs:SLOT+1000,target:row.target,assets:row.snapshot.assets};
    const cash=advanceRemediationBook(frame,'cash',1,null,'cash');
    const baseline=advanceRemediationBook(frame,'A',1,null,'baseline');
    expect(cash.state.cash).toBe('100000'); expect(cash.state.quantities).toEqual({});
    expect(baseline.modeledOnly).toBe(true); expect(cash.state).not.toBe(baseline.state);
  });
});
