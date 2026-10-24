import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BudgetDecimal as D, applyModeledReserve, evaluateProfitReserve, reserveUnavailable, reserveValue } from '@coqui/core';
import { financial, fixture } from './helpers/profit-reserve.js';
import { NOW } from './helpers/feasibility.js';

describe('P3 exact profit assessment (independent expected arithmetic)', () => {
  it.each([[2500,'50','100','12.5','50'],[2500,'100','10','10','40'],[3300,'100','10','10','30.31'],[10000,'0.01','1','0.01','0.01'],[1,'100','100','0.01','100']])('assesses %s bps with exact caps', (shareBps,p,c,r,G) => {
    const { evaluate } = fixture({ shareBps, trigger: { kind: 'profit_usd', value: '0.01' } });
    const report = evaluate(financial({ economicPnlUsd: reserveValue(p), realizedPnlUsd: reserveValue(p), spendableUsd: reserveValue(c) }));
    expect(report.reserveUsd).toMatchObject({state:'available',value:r}); expect(report.assessedProfitUsd).toMatchObject({value:G});
  });
  it('closed winners cannot outweigh larger open losses', () => {
    const r = fixture({ reviewWinCount: 1 }).evaluate(financial({ economicPnlUsd: reserveValue('-25'), realizedPnlUsd: reserveValue('50') }));
    expect(r.state).toBe('deferred'); expect(r.reserveUsd).toMatchObject({value:'0'}); expect(r.wouldRequestReview).toBe(true);
  });
  it('caps by net realized profit, not sale proceeds', () => {
    const r = fixture().evaluate(financial({economicPnlUsd:reserveValue('100'),realizedPnlUsd:reserveValue('4'),spendableUsd:reserveValue('30')}));
    expect(r.reserveUsd).toMatchObject({value:'4'});
  });
  it.each(['realizedPnlUsd','economicPnlUsd','spendableUsd','priorProfitBackedUsd'] as const)('preserves independent available fields with missing %s', field => {
    const r = fixture().evaluate(financial({[field]:reserveUnavailable('missing_evidence')}));
    expect(r.state).toBe('unavailable'); expect(r.reserveUsd.state).toBe('unavailable'); expect(r.financial.equityUsd.state).toBe('available');
  });
  it('tax provenance blocks eligibility, and a profit-backed hold is not counted twice', () => {
    expect(fixture({taxHold:{amountUsd:'5',backing:'unknown'}}).evaluate().state).toBe('unavailable');
    const f=fixture({taxHold:{amountUsd:'5',backing:'profit'}}), r=f.evaluate();
    expect(r.caps.economicUsd).toMatchObject({value:'45'}); expect(r.caps.cashUsd).toMatchObject({value:'545'});
  });
  it('respects a retained-capital preference and minimum batch without division by zero', () => {
    expect(fixture({retainedCapitalUsd:'545'}).evaluate().reserveUsd).toMatchObject({value:'5'});
    expect(fixture({minimumBatchUsd:'15'}).evaluate().state).toBe('deferred');
    expect(fixture({shareBps:0}).evaluate()).toMatchObject({state:'disabled',reserveUsd:{value:'0'}});
    expect(fixture({goal:'keep_invested'}).evaluate().state).toBe('disabled');
  });
  it('keeps a frozen percentage base and rejects deposit-only balance crossings', () => {
    const growth=fixture({trigger:{kind:'growth_bps',value:'1000'}});
    expect(growth.evaluate(financial({activeEquityUsd:reserveValue('750')})).triggerAmountUsd).toMatchObject({value:'50'});
    const balance=fixture({trigger:{kind:'balance_usd',value:'550'}});
    const r=balance.evaluate(financial({economicPnlUsd:reserveValue('10'),activeEquityUsd:reserveValue('710'),contributionsUsd:reserveValue('200')}));
    expect(r.triggerReached).toBe(false);expect(r.reserveUsd).toMatchObject({value:'0'});
    expect(balance.evaluate().triggerReached).toBe(true);
  });
  it('zero denominators, pending obligations, stale evidence and missing operating proof stay explicit', () => {
    const f=fixture({trigger:{kind:'growth_bps',value:'100'}});
    expect(f.evaluate(financial(),{...f.state,baseUsd:'0'}).triggerAmountUsd.state).toBe('unavailable');
    expect(f.evaluate(financial(),{...f.state,pendingUsd:'1'}).reasonCodes).toContain('pending_operation_unresolved');
    expect(f.evaluate(financial({expiresAtMs:NOW})).reasonCodes).toContain('preview_expired');
    expect(f.evaluate(financial(),f.state,{...f.floor,floorUsd:reserveUnavailable('no_floor')}).state).toBe('unavailable');
  });
  it('late fees and underfunding cannot release or reassess modeled obligations',()=>{
    const f=fixture(),state=applyModeledReserve(f.policy,f.state,f.evaluate(),'fund',NOW).state;
    const late=f.evaluate(financial({feesUsd:reserveUnavailable('late_fee')}),state);
    expect(late.state).toBe('unavailable');expect(late.financial.economicPnlUsd.state).toBe('available');
    const deficit=f.evaluate(financial({economicPnlUsd:reserveValue('100'),spendableUsd:reserveValue('1')}),state);
    expect(deficit.reasonCodes).toContain('modeled_reserve_underfunded');expect(state).toMatchObject({hUsd:'50',reservedUsd:'12.5'});
  });
  it('has no authority and binds the exact evidence and calculation', () => {
    const f=fixture(), r=f.evaluate(); expect(r).toMatchObject({mode:'preview_only',executionEligible:false,liveExecutionPermitted:false});
    expect(f.evaluate().id).toBe(r.id); expect(JSON.parse(r.inputsJson).financial.scopeId).toBe(r.scopeId);
  });
  it('independent integer-cent event sequences conserve and assess once, including unknown evidence', () => {
    fc.assert(fc.property(fc.array(fc.record({gain:fc.integer({min:-10000,max:10000}),unknown:fc.boolean()}),{minLength:1,maxLength:30}),events=>{
      const f=fixture({trigger:{kind:'profit_usd',value:'0.01'},shareBps:3300});let state=f.state,profit=0;
      for(const [n,event] of events.entries()){
        profit+=event.gain;const P=new D(profit).div(100).toFixed();
        const money=financial({economicPnlUsd:reserveValue(P),realizedPnlUsd: event.unknown?reserveUnavailable('late_fee'):reserveValue(P)});
        const r=evaluateProfitReserve(f.policy,state,money,f.floor,NOW); const prior=state;
        if(r.state==='eligible'){
          const next=applyModeledReserve(f.policy,state,r,`op-${n}`,NOW).state;
          expect(new D(next.hUsd).gte(state.hUsd)).toBe(true);
          const dc=new D(next.reservedUsd).sub(state.reservedUsd),g=new D(next.hUsd).sub(state.hUsd);
          expect(g.mul(3300).div(10000).mul(100).floor().eq(dc.mul(100))).toBe(true);
          expect(new D(next.allocatedUsd).gte(next.reservedUsd)).toBe(true);state=next;
        }else expect(state).toEqual(prior);
      }
    }),{numRuns:100});
  });
});
