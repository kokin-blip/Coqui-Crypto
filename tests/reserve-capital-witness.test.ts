import { describe, expect, it } from 'vitest';
import { budgetEvidence, evaluateCapitalFeasibility, projectAccountBudget, reserveCapitalWitness, reserveHypotheticalFrame } from '@coqui/core';
import { ASSET, NOW, feasibility, source } from './helpers/feasibility.js';
describe('conditional retained-capital requirement for a fixed request',()=>{
  it('derives exact full-request bounds and verifies the next cent below cannot satisfy the request',()=>{
    const f=feasibility('500'),w=reserveCapitalWitness(f);expect(w.floorUsd).toMatchObject({value:'10'});
    expect(evaluateCapitalFeasibility(reserveHypotheticalFrame(f,'490')).state).toBe('feasible');
    expect(evaluateCapitalFeasibility(reserveHypotheticalFrame(f,'490.01')).state).toBe('infeasible');
  });
  it('includes fixed and variable cost and strict entry constraints',()=>{
    const f=feasibility('500'),w=reserveCapitalWitness({...f,fees:{...f.fees,rate:'0.0025'},policy:{...f.policy,maxEntryFraction:'0.05'}});
    expect(w.floorUsd).toMatchObject({value:'200.03'});
  });
  it('protects held concentration both before a trade and after it',()=>{
    const f=feasibility('600'),s=budgetEvidence({...source({cashUsd:'500',equityUsd:'600',positions:{[ASSET]:'100'}})}),budget=projectAccountBudget(s,[],NOW);
    const w=reserveCapitalWitness({...f,budget,expectedRevision:budget.revision,policy:{...f.policy,maxPositionFraction:'0.2'},fees:{...f.fees,rate:'0.0025'}});
    expect(w.floorUsd).toMatchObject({value:'550.03'});
    expect(w.constraints.some(c=>c.minimumUsd==='500')).toBe(true);
  });
  it('does not certify an empty/clipped/native-illegal request as a trading floor',()=>{
    const f=feasibility('50');expect(reserveCapitalWitness({...f,intents:[]}).floorUsd.state).toBe('unavailable');
    expect(reserveCapitalWitness({...f,intents:[{...f.intents[0]!,deltaQuantity:'100'}]}).floorUsd.state).toBe('unavailable');
    expect(reserveCapitalWitness({...f,policy:{...f.policy,discretionaryFloorUsd:'25'}}).floorUsd.state).toBe('unavailable');
  });
  it('does not certify equity containing unmodeled liabilities or receivables',()=>{
    const f=feasibility('100');expect(reserveCapitalWitness({...f,budget:{...f.budget,equityUsd:'110'}}).floorUsd.state).toBe('unavailable');
  });
  it('limits a cash-only objective to an explicit empty book and propagates expiry/unknown holds',()=>{
    const f=feasibility('50');expect(reserveCapitalWitness({...f,intents:[]},'cash_only')).toMatchObject({objective:'cash_only',floorUsd:{value:'0'}});
    expect(reserveCapitalWitness({...f,nowMs:NOW+30_000}).floorUsd.state).toBe('unavailable');
    expect(reserveCapitalWitness({...f,budget:{...f.budget,state:'unavailable',spendableUsd:null,reasonCodes:['unproven_holds']}}).floorUsd.state).toBe('unavailable');
  });
});
