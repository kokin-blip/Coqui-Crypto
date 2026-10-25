import { describe, it, expect } from 'vitest';
import { currentBudget, listCashClaims } from '@coqui/storage';
import { reserveServiceFixture, seedPaperReserveEvidence } from './helpers/paper-profit-reserve.js';
import { settings } from './helpers/profit-reserve.js';
describe('P6 real SQLite reviewed reserve boundary',()=>{
  it('saves disarmed, requires real bound eligibility, reserves once, protects cash, releases with H retained',()=>{
    const f=reserveServiceFixture();try {
      expect(f.service.savePolicy({...f.request(),settings:settings()}).armed).toBe(false);
      expect(f.service.authorize(f.request()).armed).toBe(true);f.roundTrip();
      const p=f.service.preview();expect(p.state).toBe('eligible');
      const command={...f.request(),proposalId:p.id};const result=f.service.review(command);
      expect(result.state).toMatchObject({hUsd:'50',reservedUsd:'12.5',allocatedUsd:'12.5'});
      expect(result.activeSleeve.timeWeightedReturnPct).toMatchObject({state:'available',value:'10'});
      expect(result.budget).toMatchObject({equityUsd:'550',activeEquityUsd:'537.5',spendableUsd:'537.5'});
      expect(f.service.review(command)).toEqual(result);expect(listCashClaims(command.scopeId,f.db)).toHaveLength(1);
      const release=f.service.preview();expect(f.service.release({...f.request(),proposalId:release.id,purpose:'profit_reserve',amountUsd:'12.5'}).state).toMatchObject({hUsd:'50',allocatedUsd:'12.5',reservedUsd:'0'});
      expect(f.service.preview().reserveUsd).toMatchObject({value:'0'});
      expect(f.service.view().financial.economicPnlUsd).toMatchObject({value:'50'});
    }finally{f.db.close();}
  });
  it('does not turn a preview or saved policy into qualification',()=>{const f=reserveServiceFixture(false);try {
    f.service.savePolicy({...f.request(),settings:settings()});expect(()=>f.service.authorize(f.request())).toThrow('qualification_missing');expect(f.authority.armed).toBe(false);expect(listCashClaims(f.request().scopeId,f.db)).toEqual([]);
  }finally{f.db.close();}});
  it('replays a refused command after qualification changes; a new explicit command is required',()=>{const f=reserveServiceFixture(false);try {
    f.service.savePolicy({...f.request(),settings:settings()});const r=f.request();
    expect(()=>f.service.authorize(r)).toThrow('qualification_missing');
    seedPaperReserveEvidence(f.db,'main',f.now());
    expect(()=>f.service.authorize(r)).toThrow('qualification_missing');expect(f.authority.armed).toBe(false);
    expect(f.db.prepare("SELECT COUNT(*) n FROM paper_reserve_events_v1 WHERE content_json LIKE '%command_refused%'").get()).toEqual({n:1});
    expect(f.service.authorize(f.request()).armed).toBe(true);
    expect(()=>f.service.authorize({...r,authorityHash:'0'.repeat(64)})).toThrow('command_conflict');
  }finally{f.db.close();}});
  it.each(['paper_reserve_assessments_v1','capital_cash_claim_revisions_v1','paper_reserve_runtime_bindings_v1','paper_reserve_commands_v1'])('fault at %s rolls claims, state and receipt back; manual Resume required',table=>{
    const f=reserveServiceFixture();try{
      f.service.savePolicy({...f.request(),settings:settings()});f.service.authorize(f.request());f.roundTrip();const p=f.service.preview(),r={...f.request(),proposalId:p.id},before=f.service.view();
      f.db.exec(`CREATE TEMP TRIGGER fail_p6 BEFORE ${table==='paper_reserve_runtime_bindings_v1'?'UPDATE':'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT,'injected_p6'); END;`);
      expect(()=>f.service.review(r)).toThrow('injected_p6');expect(f.authority.armed).toBe(false);
      expect(f.service.view().state?.id).toBe(before.state?.id);expect(listCashClaims(r.scopeId,f.db)).toEqual([]);expect(currentBudget(r.scopeId,f.now(),f.db)?.spendableUsd).toBe('550');
    }finally{f.db.close();}
  });
});

describe('P6 exact sleeve boundary evidence',()=>{it('never interpolates a later allocation mark into an earlier observed cut',()=>{const f=reserveServiceFixture();try{f.service.savePolicy({...f.request(),settings:settings()});f.service.authorize(f.request());f.roundTrip();const p=f.service.preview(),r={...f.request(),proposalId:p.id};f.advance(1);const v=f.service.review(r);expect(v.financial.economicPnlUsd).toMatchObject({state:'available',value:'50'});expect(v.activeSleeve.timeWeightedReturnPct).toMatchObject({state:'unavailable',reasonCodes:['active_sleeve_flow_time_marks_missing']});}finally{f.db.close();}});});
