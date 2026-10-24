import { describe, expect, it } from 'vitest';
import { applyModeledReserve, cancelReserveCycle, openReserveCycle, releaseModeledReserve, reserveBaseline, reservePolicy, reserveUnavailable, reserveValue } from '@coqui/core';
import { fixture, financial, settings } from './helpers/profit-reserve.js';
import { NOW } from './helpers/feasibility.js';
describe('P3 modeled state and loss carry-forward',()=>{
  it('partial cycle stays capped, losses/recovery produce no repeated gains, and release keeps H',()=>{
    const f=fixture(), m=financial({economicPnlUsd:reserveValue('100'),realizedPnlUsd:reserveValue('100'),spendableUsd:reserveValue('10')});
    const cycle=openReserveCycle(f.policy,f.state,m,'open',NOW), first=applyModeledReserve(f.policy,cycle,f.evaluate(m,cycle),'one',NOW).state;
    expect(first).toMatchObject({hUsd:'40',reservedUsd:'10',cycle:{ceilingUsd:'100'}});
    for(const p of ['30','40'])expect(f.evaluate(financial({economicPnlUsd:reserveValue(p)}),first).reserveUsd).toMatchObject({value:'0'});
    const r=f.evaluate(financial({economicPnlUsd:reserveValue('60'),realizedPnlUsd:reserveValue('60')}),first);
    expect(r.reserveUsd).toMatchObject({value:'5'});
    const released=releaseModeledReserve(first,'10','release',NOW);expect(released).toMatchObject({hUsd:'40',allocatedUsd:'10',reservedUsd:'0'});
    expect(f.evaluate(financial({economicPnlUsd:reserveValue('40')}),released).reserveUsd).toMatchObject({value:'0'});
  });
  it('later gains cannot expand the ceiling, one open cycle survives repeat inspection',()=>{
    const f=fixture(), s=openReserveCycle(f.policy,f.state,financial(),'open',NOW);
    expect(openReserveCycle(f.policy,s,financial({economicPnlUsd:reserveValue('100')}),'repeat',NOW)).toBe(s);
    const pending={...f.state,pendingUsd:'1'};expect(openReserveCycle(f.policy,pending,financial(),'pending',NOW)).toBe(pending);
    expect(f.evaluate(financial({economicPnlUsd:reserveValue('100')}),s).assessedProfitUsd).toMatchObject({value:'50'});
    expect(cancelReserveCycle(s,'cancel',NOW)).toMatchObject({hUsd:'0',reservedUsd:'0',cycle:null});
  });
  it('policy changes exclude old gains, retain losses and block unknown pending operations',()=>{
    const f=fixture(), policy=reservePolicy({...f.policy,previousId:f.policy.id,settings:settings({shareBps:5000})});
    expect(reserveBaseline(policy,f.state,financial(),'change',NOW)).toMatchObject({hUsd:'50',excludedProfitUsd:'50'});
    expect(reserveBaseline(policy,{...f.state,hUsd:'100'},financial(),'change',NOW)).toMatchObject({hUsd:'100',excludedProfitUsd:'0'});
    expect(reserveBaseline(policy,null,financial({economicPnlUsd:reserveUnavailable('gap')}),'unknown',NOW)).toMatchObject({baseline:'awaiting_evidence',baseUsd:null,hUsd:'0'});
    expect(()=>reserveBaseline(policy,{...f.state,pendingUsd:'1'},financial(),'change',NOW)).toThrow('pending');
    expect(()=>reserveBaseline(policy,f.state,financial({reasonCodes:['funded_operation_unresolved']}),'change',NOW)).toThrow('pending');
  });
  it('closes tiny remainder without assessing it and does not rearm a consumed balance level',()=>{
    const f=fixture({trigger:{kind:'balance_usd',value:'550'},shareBps:3300,minimumBatchUsd:'1'}),r=f.evaluate();
    const next=applyModeledReserve(f.policy,f.state,r,'assess',NOW).state;
    expect(next.balanceConsumed).toBe(true);expect(next.cycle).toBeNull();expect(next.hUsd).toBe('50');
    expect(f.evaluate(financial({economicPnlUsd:reserveValue('100')}),next).triggerReached).toBe(false);
  });
  it('refuses expired, altered and financial-domain transitions',()=>{
    const f=fixture(),r=f.evaluate();
    expect(()=>applyModeledReserve(f.policy,f.state,r,'expired',r.expiresAtMs)).toThrow();
    expect(()=>applyModeledReserve(f.policy,f.state,{...r,reserveUsd:reserveValue('500')},'forged',NOW)).toThrow();
    expect(()=>releaseModeledReserve({...f.state,domain:'paper' as never},'1','wrong',NOW)).toThrow();
  });
});
