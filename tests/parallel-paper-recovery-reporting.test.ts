import { describe, expect, it, vi } from 'vitest';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '../packages/storage/src/index.js';
import { validateParallelPositions, parallelAttemptsResolved } from '../packages/services/src/paper/parallel-paper-recovery.js';
import { reconcileParallelPaper } from '../packages/services/src/paper/parallel-paper-reconciliation.js';
import { parallelPaperFailureDetail, ParallelReconciliationError } from '../packages/services/src/paper/parallel-paper-utils.js';
import { finalizeParallelSlots } from '../packages/services/src/paper/parallel-paper-slots.js';
import { activeParallelEvents, supersedeUnsubmittedParallelPlans } from '../packages/services/src/paper/parallel-paper-plans.js';
import { parallelReconciliationAttention } from '../packages/services/src/paper/parallel-paper-attention.js';
import { CHANNEL_SCHEMAS } from '../packages/contracts/src/index.js';
import { parallelFeeAccounting } from '../packages/services/src/paper/parallel-fee-accounting.js';
import { parallelBrokerEvidence } from '../packages/services/src/paper/parallel-broker-evidence.js';
import { projectParallelPaperActivity } from '../packages/services/src/paper/parallel-paper-activity.js';
import { AlpacaPaperError, createAlpacaPaperClient } from '../packages/adapters/src/index.js';
import { observedParallelClient } from '../packages/services/src/paper/parallel-execution-safety.js';

const start = Date.parse('2026-10-02T00:00:00Z');
const experiment = { id: 'e', profileId: 'main', startedAt: start } as ParallelPaperExperiment;
let sequence = 0;
function event(kind: string, detail: Record<string, unknown>, at = start): ParallelPaperEvent {
  return { id: `e-${sequence++}`, experimentId: 'e', profileId: 'main', kind, detail, at };
}
function filledHistory() {
  return [event('external_intent', { clientOrderId: 'client', symbol: 'BTCUSD', side: 'buy', qty: '1' }),
    event('submit_attempt', { clientOrderId: 'client' }),
    event('external_order', { clientOrderId: 'client', orderId: 'broker', status: 'filled', filledQty: '1', symbol: 'BTCUSD', side: 'buy' }),
    event('external_fill', { orderId: 'broker', symbol: 'BTC/USD', quantity: '1', price: '100' })];
}

describe('complete paper recovery evidence', () => {
  it('round-trips pending fee diagnostics safely and clears attention only after successful checks',()=>{
    const pendingFeeEvidence={status:'awaiting' as const,oldestFillAtMs:start,latestFillAtMs:start,reviewAfterMs:start+2*86_400_000};
    const detail=parallelPaperFailureDetail(new ParallelReconciliationError('broker_positions_mismatch','positions',undefined,[],undefined,pendingFeeEvidence),'unknown');
    const history=[event('paused',{reason:'broker_positions_mismatch'}),event('reconciliation_error',detail)];
    const attention=parallelReconciliationAttention(history,'paused');
    expect(attention).toMatchObject({blocked:true,latestFailure:{pendingFeeEvidence}});
    const schema=CHANNEL_SCHEMAS['parallel.paper.status'].response.unwrap().shape.reconciliationAttention;
    expect(schema.safeParse(attention).success).toBe(true);
    history.push(event('reconciliation_error',{...detail,pendingFeeEvidence:{...pendingFeeEvidence,oldestFillAtMs:'secret'}}));
    expect(parallelReconciliationAttention(history,'paused').latestFailure?.pendingFeeEvidence).toBeNull();
    history.push(event('readiness',{operation:'broker_reconciliation',status:'validated'}));
    expect(parallelReconciliationAttention(history,'paused').blocked).toBe(false);
  });
  it('labels successful position reads as mismatches and preserves safe transport diagnostics',()=>{
    const mismatch=event('reconciliation_error',{reason:'broker_positions_mismatch',operation:'positions'});
    const detail=parallelPaperFailureDetail(new AlpacaPaperError('unavailable','account',null,2,3.2,10000,9996.8,'ENOTFOUND'),'unknown');
    const history=[mismatch,event('reconciliation_error',detail)];
    expect(projectParallelPaperActivity(history).activity).toEqual(expect.arrayContaining([
      expect.objectContaining({title:'Alpaca position reconciliation mismatch'}),
      expect.objectContaining({detail:expect.stringContaining('ENOTFOUND · 3ms elapsed')})]));
    const attention=parallelReconciliationAttention(history,'paused');
    expect(attention.latestFailure).toMatchObject({networkCode:'ENOTFOUND'});
    history.push(event('reconciliation_error',{...detail,networkCode:'private-url-and-secret',
      feeReconciliation:{kind:'fee_shaped_limit_exceeded',observedValueUsd:'private-secret',maxAbsoluteValueUsd:'25',maxEquityValueUsd:'50'}}));
    expect(parallelReconciliationAttention(history,'paused').latestFailure).toMatchObject({networkCode:null,feeReconciliation:null});
    expect(projectParallelPaperActivity(history).activity[0]!.detail).not.toContain('private-url-and-secret');
  });
  it('passes recovery-limit evidence through the error, projection, and response contract',()=>{
    const feeReconciliation={kind:'fee_shaped_limit_exceeded',observedValueUsd:'80.06',maxAbsoluteValueUsd:'25',maxEquityValueUsd:'51.45'};
    const history=[event('reconciliation_error',{reason:'broker_positions_mismatch',operation:'positions',feeReconciliation})];
    const attention=parallelReconciliationAttention(history,'paused');
    expect(attention.latestFailure?.feeReconciliation).toEqual(feeReconciliation);
    const schema=CHANNEL_SCHEMAS['parallel.paper.status'].response.unwrap().shape.reconciliationAttention;
    expect(schema.safeParse(attention).success).toBe(true);
    expect(schema.safeParse({...attention,latestFailure:{...attention.latestFailure,networkCode:'private-secret'}}).success).toBe(false);
  });
  it('retains a network failure through the production observation wrapper and channel contract',async()=>{
    const history:ParallelPaperEvent[]=[];
    const client=createAlpacaPaperClient({keyId:'test',secretKey:'test'},async()=>{
      throw new TypeError('private-credential',{cause:{code:'ENOTFOUND'}});
    },undefined,attempt=>history.push(event('broker_read_attempt',{...attempt})));
    const observed=observedParallelClient(client,()=>start,(kind,_key,detail)=>history.push(event(kind,detail)));
    try{await observed.account();throw new Error('expected_failure');}catch(error){
      const detail=parallelPaperFailureDetail(error,'unknown');
      expect(detail).toMatchObject({reason:'alpaca_unavailable',operation:'account',networkCode:'ENOTFOUND',attemptCount:2});
      history.push(event('reconciliation_error',detail));
    }
    expect(history.find(row=>row.kind==='readiness')?.detail).toMatchObject({networkCode:'ENOTFOUND'});
    const attention=parallelReconciliationAttention(history,'paused');
    expect(CHANNEL_SCHEMAS['parallel.paper.status'].response.unwrap().shape.reconciliationAttention.safeParse(attention).success).toBe(true);
    expect(attention.latestFailure).toMatchObject({networkCode:'ENOTFOUND'});
    expect(JSON.stringify(history)).not.toContain('private-credential');
  });
  it('labels failures by their actual phase and keeps historical unknown phases honest', () => {
    const history = [event('reconciliation_error', { reason: 'deadline_exceeded', operation: 'market_preparation', elapsedMs: 1_254, remainingMs: 0 }),
      event('reconciliation_error', { reason: 'alpaca_unavailable', operation: 'activities', httpStatus: 503 }),
      event('reconciliation_error', { reason: 'deadline_exceeded' })];
    const { activity } = projectParallelPaperActivity(history);
    expect(activity.find(item => item.title === 'Market preparation timed out')?.detail).toContain('1.3s elapsed · 0.0s remaining');
    expect(activity.find(item => item.title === 'Alpaca activities read failed')?.detail).toContain('HTTP 503');
    expect(activity.some(item => item.title === 'Paper recovery check timed out')).toBe(true);
    expect(parallelReconciliationAttention(history.slice(0, 1), 'paused').latestFailure)
      .toMatchObject({ operation: 'market_preparation', elapsedMs: 1_254, remainingMs: 0 });
  });
  it('preserves billing dates separately from publication times and leaves booked fee records unchanged', async () => {
    const history = filledHistory();
    const fees = [{id:'fee-1',activity_type:'CFEE',symbol:'BTCUSD',qty:'-0.001',price:'100',date:'2026-10-05',created_at:'2026-10-03T04:00:00Z'}];
    const input={experiment,client:{activities:async()=>fees} as never,events:()=>history,now:()=>start,
      append:(kind:string,_key:string,detail:Record<string,unknown>)=>history.push(event(kind,detail))};
    await reconcileParallelPaper(input);
    const original=history.find((item)=>item.kind==='external_fee')!;
    expect(original.detail).not.toHaveProperty('createdAt');
    expect(parallelFeeAccounting(history,null).valuations[0]).toMatchObject({at:null,billingDate:'2026-10-05',createdAt:'2026-10-03T04:00:00Z'});
    expect(parallelBrokerEvidence(history,start).latestFeeCreatedAtMs).toBe(Date.parse('2026-10-03T04:00:00Z'));
  });

  it('does not let a completed foreign order disappear from the reconciliation audit', async () => {
    const history=filledHistory();
    await expect(reconcileParallelPaper({experiment,client:{activities:async()=>[{id:'foreign-fill',activity_type:'FILL',
      order_id:'foreign',transaction_time:new Date(start+1000).toISOString()}]} as never,
      events:()=>history,now:()=>start,append:vi.fn()})).rejects.toMatchObject({message:'unexpected_alpaca_order',operation:'activities'});
  });

  it('expires quote freshness independently of stream connectivity and refuses to infer complete fees', () => {
    const history=[event('readiness',{operation:'trade_stream',status:'listening'}),
      event('readiness',{operation:'quote',status:'received',oldestQuoteAtMs:start}),
      event('external_fill',{at:new Date(start).toISOString()})];
    expect(parallelBrokerEvidence(history,start+60_001)).toMatchObject({tradeStream:'listening',quoteStatus:'stale',feeCoverage:'unconfirmed'});
    history.push(event('readiness',{operation:'quote',status:'unavailable'}));
    expect(parallelBrokerEvidence(history,start+60_001).quoteStatus).toBe('unavailable');
  });
  it('requires exactly matching recorded fills and positions, including delayed crypto fees', async () => {
    const history = filledHistory();
    const client = { positions: async () => [{ symbol: 'BTCUSD', qty: '0.999' }] };
    expect(parallelAttemptsResolved(history)).toBe(true);
    await expect(validateParallelPositions({ positions: async () => [{ symbol: 'ETHUSD', qty: '1' }] } as never,
      [...history.slice(0, -1), event('external_fill', { orderId: 'broker', symbol: 'ETHUSD', quantity: '1' })])).rejects.toThrow('broker_positions_mismatch');
    await expect(validateParallelPositions(client as never, history)).rejects.toMatchObject({ message: 'broker_positions_mismatch', operation: 'positions' });
    history.push(event('external_fee', { symbol: 'BTCUSD', quantity: '-0.001' }));
    await expect(validateParallelPositions(client as never, history)).resolves.toBeUndefined();
    await expect(validateParallelPositions({ positions: async () => [] } as never, history)).rejects.toThrow('broker_positions_mismatch');
    await expect(validateParallelPositions({ positions: async () => [{ symbol: 'DOGEUSD', qty: '1' }] } as never, history)).rejects.toThrow('broker_positions_mismatch');
    expect(parallelAttemptsResolved([...history, event('external_fill', { orderId: 'broker', quantity: '0.1' })])).toBe(false);
  });

  it('does not declare a truncated activity audit complete and records its operation', async () => {
    const history: ParallelPaperEvent[] = [];
    let page = 0;
    const activities = vi.fn(async () => Array.from({ length: 100 }, (_, i) => ({ id: `row-${page++}-${i}`, activity_type: 'FILL' })));
    await expect(reconcileParallelPaper({ experiment, client: { activities } as never,
      events: () => history, now: () => start, append: (kind, _key, detail) => history.push(event(kind, detail)) }))
      .rejects.toMatchObject({ message: 'alpaca_activity_page_limit', operation: 'activities' });
    expect(activities).toHaveBeenCalledTimes(20);
    expect(history.some((item) => item.kind === 'activity_audit' || item.detail['operation'] === 'broker_reconciliation')).toBe(false);
  });

  it('resumes a full audit from the last completed page after a timeout and a new reader', async () => {
    const history: ParallelPaperEvent[] = [];
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: `fee-${i}`, activity_type: 'CFEE', symbol: 'USD', net_amount: '-1' }));
    const append = (kind: string, key: string, detail: Record<string, unknown>) => {
      if (!history.some(row => row.id === key)) history.push({ ...event(kind, detail), id: key });
    };
    const reads = vi.fn(async (_after: string, cursor?: string) => {
      if (!cursor) return firstPage;
      throw new Error('deadline_exceeded');
    });
    await expect(reconcileParallelPaper({ experiment, fullAudit: true, client: { activities: reads } as never,
      events: () => history.slice(), now: () => start, append })).rejects.toThrow('deadline_exceeded');
    expect(history.findLast(row => row.kind === 'activity_audit_progress')?.detail).toMatchObject({
      pagesCompleted: 1, pageToken: 'fee-99', afterMs: start });
    expect(history.some(row => row.kind === 'activity_audit')).toBe(false);
    const next = vi.fn(async () => [{ id: 'fee-100', activity_type: 'CFEE', symbol: 'USD', net_amount: '-1' }]);
    await reconcileParallelPaper({ experiment, client: { activities: next } as never,
      events: () => history.slice(), now: () => start + 60_000, append });
    expect(next).toHaveBeenCalledExactlyOnceWith(new Date(start).toISOString(), 'fee-99');
    expect(history.filter(row => row.kind === 'external_fee')).toHaveLength(101);
    expect(history.filter(row => row.kind === 'activity_audit')).toHaveLength(1);
    const fresh = vi.fn(async () => []);
    await reconcileParallelPaper({ experiment, fullAudit: true, client: { activities: fresh } as never,
      events: () => history.slice(), now: () => start + 120_000, append });
    expect(fresh).toHaveBeenCalledExactlyOnceWith(new Date(start).toISOString(), undefined);
  });

  it('does not checkpoint a partially validated page or reuse a previous day cursor', async () => {
    const history: ParallelPaperEvent[] = [];
    const append = (kind: string, _key: string, detail: Record<string, unknown>) => history.push(event(kind, detail));
    const broken = [{ id: 'fee-valid', activity_type: 'CFEE' }, { id: '', activity_type: 'CFEE' }];
    await expect(reconcileParallelPaper({ experiment, client: { activities: async () => broken } as never,
      events: () => history, now: () => start, append })).rejects.toThrow('invalid_alpaca_activity');
    expect(history.some(row => row.kind === 'activity_audit_progress' || row.kind === 'activity_audit')).toBe(false);
    history.push(event('activity_audit_progress', { day: '2026-10-02', afterMs: start,
      auditId: 'old-audit', pageToken: 'old-cursor', pagesCompleted: 1 }));
    const reads = vi.fn(async () => []);
    await reconcileParallelPaper({ experiment, client: { activities: reads } as never,
      events: () => history, now: () => start + 86_400_000, append });
    expect(reads).toHaveBeenCalledExactlyOnceWith(new Date(start).toISOString(), undefined);
  });

  it('uses recent overlap after a daily audit even when the experiment has no fills', async () => {
    const now = start + 5 * 86_400_000;
    const history = [event('activity_audit', { day: '2026-10-07', afterMs: start }, now),
      event('readiness', { operation: 'activity_reconciliation', status: 'validated' }, now)];
    const reads = vi.fn(async () => []);
    await reconcileParallelPaper({ experiment, client: { activities: reads } as never,
      events: () => history, now: () => now + 60_000, append: vi.fn() });
    expect(reads).toHaveBeenCalledExactlyOnceWith(new Date(now - 86_400_000).toISOString(), undefined);
  });

  it('rejects a client ID lookup returning a different order identity', async () => {
    const history = filledHistory().slice(0, 2);
    await expect(reconcileParallelPaper({ experiment,
      client: { orderByClientId: async () => ({ client_order_id: 'different', symbol: 'BTCUSD', side: 'buy' }) } as never,
      events: () => history, now: () => start, append: vi.fn() }))
      .rejects.toMatchObject({ message: 'broker_order_identity_mismatch', operation: 'order_lookup' });
  });

  it('keeps uncertainty visible after twenty later activity entries', () => {
    const history = filledHistory().slice(0, 2);
    history.push(event('paused', { reason: 'paper_execution_unknown' }));
    history.push(event('reconciliation_error', { reason: 'alpaca_rate_limited', operation: 'activities', httpStatus: 429, attemptCount: 1 }));
    for (let i = 0; i < 25; i++) history.push(event('scheduler_check', {}));
    expect(parallelReconciliationAttention(history, 'paused')).toMatchObject({ blocked: true,
      latestFailure: { operation: 'activities', reason: 'alpaca_rate_limited', httpStatus: 429 },
      unresolvedOrders: [{ clientOrderId: 'client', orderId: null }] });
    expect(CHANNEL_SCHEMAS['parallel.paper.reconcile'].request.safeParse({ commandId: '00000000-0000-4000-8000-000000000001' }).success).toBe(true);
  });

  it('retires only unsubmitted intents while preserving attempted IDs and all history', () => {
    const history = filledHistory();
    const plan = event('buy_plan', { day: '2026-10-01', orders: [{ clientOrderId: 'client' }, { clientOrderId: 'unsubmitted' }] });
    history.push(plan, event('external_intent', { clientOrderId: 'unsubmitted' }));
    supersedeUnsubmittedParallelPlans(history, (kind, _key, detail) => history.push(event(kind, detail)));
    const active = activeParallelEvents(history);
    expect(active.some((item) => item.detail['clientOrderId'] === 'unsubmitted')).toBe(false);
    expect(active.some((item) => item.kind === 'submit_attempt' && item.detail['clientOrderId'] === 'client')).toBe(true);
    expect(history).toContain(plan);
    const append = vi.fn(); supersedeUnsubmittedParallelPlans(history, append);
    expect(append).not.toHaveBeenCalled();
  });
});

describe('definitive slot outcomes', () => {
  it('records gaps on restart once, without replaying any slot', () => {
    const history = [event('started', {}), event('scheduler_check', {}), event('external_complete', { day: '2026-10-01' })];
    const append = (kind: string, _key: string, detail: Record<string, unknown>) => history.push(event(kind, detail, start + 9 * 3_600_000));
    finalizeParallelSlots(experiment, history, start + 9 * 3_600_000, append);
    expect(history.filter((item) => item.kind === 'slot_finalized').map((item) => item.detail['outcome']))
      .toEqual(['no_order', 'host_unavailable', 'host_unavailable']);
    expect(history.at(-1)?.detail['inferred']).toBe(true);
    const size = history.length;
    finalizeParallelSlots(experiment, history, start + 10 * 3_600_000, append);
    expect(history).toHaveLength(size);
  });

  it('reports acknowledgments without fill activity as pending at the cutoff', () => {
    const history = [...filledHistory().slice(0, -1), event('scheduler_check', {}),
      event('external_complete', { day: '2026-10-01' })];
    finalizeParallelSlots(experiment, history, start + 900_000,
      (kind, _key, detail) => history.push(event(kind, detail)));
    expect(history.at(-1)?.detail['outcome']).toBe('pending_order');
  });

  it('distinguishes stale quotes, pauses, and completed recovery before cutoff', () => {
    const history = [event('started', {}), event('scheduler_check', {}), event('paused', { reason: 'paper_execution_unknown' }),
      event('scheduler_check', {}, start + 4 * 3_600_000),
      event('intraday_skipped', { reason: 'stale_alpaca_quote' }, start + 4 * 3_600_000),
      event('resumed', {}, start + 8 * 3_600_000), event('scheduler_check', {}, start + 8 * 3_600_000),
      event('intraday_complete', { slot: '2026-10-02T08' }, start + 8 * 3_600_000)];
    finalizeParallelSlots(experiment, history, start + 9 * 3_600_000,
      (kind, _key, detail) => history.push(event(kind, detail)));
    expect(history.filter((item) => item.kind === 'slot_finalized').map((item) => item.detail['outcome']))
      .toEqual(['paused', 'stale_quote', 'no_order']);
  });
});

it('retains exact position differences without granting order authority', async () => {
  const history=filledHistory();
  try { await validateParallelPositions({positions:async()=>[{symbol:'BTCUSD',qty:'0.999'}]} as never,history); throw new Error('expected mismatch'); }
  catch(error){
    const detail=parallelPaperFailureDetail(error,'unavailable');
    expect(detail).toMatchObject({reason:'broker_positions_mismatch',operation:'positions',positionDifferences:[{symbol:'BTCUSD',expectedQty:'1',observedQty:'0.999',differenceQty:'-0.001'}]});
    history.push(event('paused',{reason:'broker_positions_mismatch'}),event('reconciliation_error',detail));
    expect(parallelReconciliationAttention(history,'paused')).toMatchObject({blocked:true,latestFailure:{positionDifferences:detail.positionDifferences}});
  }
});
