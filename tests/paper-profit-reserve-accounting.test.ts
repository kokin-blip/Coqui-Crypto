import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { paperReservePolicy, paperReserveBaseline, evaluatePaperReserve, applyPaperReserve, releasePaperReserve, reserveValue as v, capitalHash, identifiedBudgetFact } from '@coqui/core';
import { settings, financial, fixture } from './helpers/profit-reserve.js';
import { NOW, SCOPE } from './helpers/feasibility.js';
function setup(shareBps=2500) {
  const policy=paperReservePolicy({scopeId:SCOPE,originProfileId:'main',previousId:null,createdAtMs:NOW,settings:settings({shareBps}),requirementsId:capitalHash('requirements'),
    strategy:{strategyId:'synthetic',codeRevision:'test',costProfileHash:capitalHash('cost'),horizonMs:86_400_000,normalization:'gross_pct_per_turnover'}});
  const initial=financial({assurance:'observed',economicPnlUsd:v('0'),activeEquityUsd:v('500')});
  const state=paperReserveBaseline(policy,null,initial,'opening',NOW),f=financial({assurance:'observed'}),floor=fixture().floor;
  return {policy,state,f,floor};
}
describe('P6 funded cash accounting, separate from modeled P3',()=>{
  it('does not double deduct the existing $20 claim; $30 new allocation leaves $650 active and $50 reserved',()=>{
    const {policy,state,f,floor}=setup();const s=identifiedBudgetFact({...state,reservedUsd:'20',allocatedUsd:'20'});
    const input={...f,economicPnlUsd:v('200'),realizedPnlUsd:v('200'),equityUsd:v('700'),spendableUsd:v('680'),activeEquityUsd:v('680'),actualReservedUsd:v('20'),priorProfitBackedUsd:v('20')};
    const bounded={...floor,floorUsd:v('650')};const p=evaluatePaperReserve(policy,s,input,bounded,NOW);
    expect(p).toMatchObject({state:'eligible',reserveUsd:{value:'30'},retainedActiveUsd:{value:'650'},caps:{cashUsd:{value:'680'}}});
    const next=applyPaperReserve(policy,s,p,'review',NOW);expect(next.reservedUsd).toBe('50');expect(next.hUsd).toBe('120');
  });
  it.each([50,100,250,500,1000,2500,5000,10000,100000])('deposit/basis change and repeated/released gains cannot fund at $%s',opening=>{
    const {policy,state,f,floor}=setup();const noProfit={...f,economicPnlUsd:v('0'),realizedPnlUsd:v('0'),activeEquityUsd:v(String(opening+500)),spendableUsd:v(String(opening+500)),contributionsUsd:v('500')};
    expect(evaluatePaperReserve(policy,state,noProfit,floor,NOW).state).toBe('deferred');
    const p=evaluatePaperReserve(policy,state,f,floor,NOW),next=applyPaperReserve(policy,state,p,'a',NOW);
    const release=releasePaperReserve(next,'profit_reserve','12.5','r',NOW);expect(release.hUsd).toBe('50');expect(release.allocatedUsd).toBe('12.5');
    expect(evaluatePaperReserve(policy,release,{...f,priorProfitBackedUsd:v('12.5')},floor,NOW).reserveUsd).toMatchObject({value:'0'});
  });
  it('uses exact integer cents for 33 percent and never assesses more than new profit',()=>{
    fc.assert(fc.property(fc.integer({min:1,max:100000}),cents=>{
      const {policy,state,f,floor}=setup(3300);const profit=String(cents/100);
      const p=evaluatePaperReserve(policy,state,{...f,economicPnlUsd:v(profit),realizedPnlUsd:v(profit)},floor,NOW);
      if(p.state==='eligible'){const next=applyPaperReserve(policy,state,p,'p',NOW);expect(Number(next.hUsd)).toBeLessThanOrEqual(cents/100);expect(Number(next.reservedUsd)).toBe(Math.floor(cents*0.33)/100);}
    }),{numRuns:200});
  });
  it('withholds unknown tax backing, scenario evidence, stale facts and missing requirements',()=>{
    const {policy,state,f,floor}=setup();expect(evaluatePaperReserve(policy,state,{...f,assurance:'scenario'},floor,NOW).state).toBe('unavailable');
    expect(evaluatePaperReserve(policy,state,f,floor,NOW+30_000).state).toBe('unavailable');
    expect(evaluatePaperReserve(policy,state,f,{...floor,inputHash:null},NOW).state).toBe('unavailable');
    const unknown=paperReservePolicy({...policy,settings:settings({taxHold:{amountUsd:'5',backing:'unknown'}})});
    expect(evaluatePaperReserve(unknown,{...state,policyId:unknown.id},f,floor,NOW).reasonCodes).toContain('tax_hold_funding_unverified');
  });
  it('keeps principal and profit-backed tax cash distinct through allocation and release',()=>{
    const {policy,state,f,floor}=setup();
    for(const backing of ['principal','profit'] as const) {
      const p=paperReservePolicy({...policy,settings:settings({taxHold:{amountUsd:'5',backing}})}),s=identifiedBudgetFact({...state,policyId:p.id});
      const proposal=evaluatePaperReserve(p,s,f,floor,NOW),next=applyPaperReserve(p,s,proposal,backing,NOW);
      expect(next.taxHoldUsd).toBe('5');expect(next.profitBackedTaxUsd).toBe(backing==='profit'?'5':'0');
      expect(next.reservedUsd).toBe('12.5');expect(proposal.caps.realizedUsd).toMatchObject({value:backing==='profit'?'45':'50'});
      const released=releasePaperReserve(next,'tax_hold','5',`release:${backing}`,NOW);
      expect(released.profitBackedTaxUsd).toBe(next.profitBackedTaxUsd);expect(released.hUsd).toBe(next.hUsd);
    }
  });
  it('conserves cash and monotone assessment history across profit, loss, recovery and release sequences',()=>{
    const run=(events:readonly {profit:number;release:boolean}[])=>{
      const {policy,state,f,floor}=setup();let s=state,allocated=0,released=0,lastH=0;
      for(const [i,e] of events.entries()) {
        const equity=500+e.profit,free=equity-Number(s.reservedUsd);
        const p=evaluatePaperReserve(policy,s,{...f,equityUsd:v(String(equity)),activeEquityUsd:v(String(free)),spendableUsd:v(String(free)),economicPnlUsd:v(String(e.profit)),realizedPnlUsd:v(String(e.profit)),actualReservedUsd:v(s.reservedUsd),priorProfitBackedUsd:v(s.allocatedUsd)},floor,NOW);
        if(p.state==='eligible'){allocated+=Number(p.reserveUsd.state==='available'?p.reserveUsd.value:'0');s=applyPaperReserve(policy,s,p,`allocate:${i}`,NOW);}
        if(e.release && Number(s.reservedUsd)>0){released+=Number(s.reservedUsd);s=releasePaperReserve(s,'profit_reserve',s.reservedUsd,`release:${i}`,NOW);}
        expect(Number(s.hUsd)).toBeGreaterThanOrEqual(lastH);lastH=Number(s.hUsd);
        expect(Number(s.allocatedUsd)).toBeCloseTo(allocated,8);expect(Number(s.reservedUsd)).toBeCloseTo(allocated-released,8);
        expect(equity-Number(s.reservedUsd)+Number(s.reservedUsd)).toBeCloseTo(equity,8);
      }
      return s;
    };
    expect(run([{profit:50,release:true},{profit:-100,release:false},{profit:50,release:false},{profit:100,release:false}])).toMatchObject({hUsd:'100',allocatedUsd:'25',reservedUsd:'12.5'});
    fc.assert(fc.property(fc.array(fc.record({profit:fc.integer({min:-300,max:1000}),release:fc.boolean()}),{minLength:1,maxLength:40}),events=>{run(events);}),{numRuns:100});
  });
});
