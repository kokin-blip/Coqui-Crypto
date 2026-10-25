import { describe,it,expect } from 'vitest';
import { paperReserveCadenceSlot, createPaperRunLoopTask, runPaperDecision } from '@coqui/services';
import { reserveServiceFixture } from './helpers/paper-profit-reserve.js';
describe('P6 observation cadence and exclusive run dispatch',()=>{
  it('uses stable UTC current slots, calendar months and no manual catch-up',()=>{
    expect(paperReserveCadenceSlot('manual',0)).toBeNull();expect(paperReserveCadenceSlot('daily',86_400_000-1)).toBe('day:0');
    expect(paperReserveCadenceSlot('monthly',Date.UTC(2026,0,31,23,59))).toBe('month:2026-01');expect(paperReserveCadenceSlot('monthly',Date.UTC(2026,1,1))).toBe('month:2026-02');
    const monday=Date.UTC(2026,9,26);expect(paperReserveCadenceSlot('weekly',monday)).not.toBe(paperReserveCadenceSlot('weekly',monday-1));
  });
  it('a new cash book cannot enter the legacy initializer and missing runtime injection fails closed',async()=>{
    const f=reserveServiceFixture();try{let observed=0,decided=0;
      const deps={profileId:'main',database:f.db,clock:{nowMs:f.now},market:{rules:()=>null,bars:()=>[]},holdings:()=>[],policy:()=>null,preparation:()=>({ok:false as const,code:'insufficient_history' as const}),historicalGrossEdgeLowerBoundPct:null};
      expect(()=>runPaperDecision(deps,0)).toThrow('runtime_required');
      const summary={profileId:'main',runId:'synthetic',strategyVersion:'paper-reserve-cash-v1',scheduledForMs:0,decidedAtMs:f.now(),standDown:'no_intents' as const,filledCount:0,submittedCount:0,refusedCount:0,preDecisionBalances:[]};
      const task=createPaperRunLoopTask({...deps,reserveObserve:()=>{observed++;},capitalRun:()=>{decided++;return summary;}});
      expect(await task.execute({scheduledForMs:0})).toEqual({status:'completed'});expect(observed).toBe(1);expect(decided).toBe(1);
      expect(f.db.prepare('SELECT COUNT(*) n FROM paper_book_origins_v1').get()!['n']).toBe(0);expect(f.service.view().armed).toBe(false);
    }finally{f.db.close();}
  });
});
