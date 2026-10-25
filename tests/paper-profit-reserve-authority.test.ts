import { describe,it,expect } from 'vitest';
import { reserveServiceFixture } from './helpers/paper-profit-reserve.js';
import { settings } from './helpers/profit-reserve.js';
import { checkPaperReserveAuthority } from '@coqui/services';
import { saveWalletRiskState, activateWalletSafetyStop } from '@coqui/storage';
describe('P6 current purpose-bound authority',()=>{
  it('refuses strategy pause, a lost profile gate, kill switch and every non-normal risk state',()=>{const f=reserveServiceFixture();try{
    expect(()=>checkPaperReserveAuthority({...f.authorityContext(),strategyPaused:()=>true},f.now(),f.db)).toThrow('stopped_or_paused');
    expect(()=>checkPaperReserveAuthority({...f.authorityContext(),operationAllowed:()=>false},f.now(),f.db)).toThrow('host_or_lease');
    for(const stage of ['throttle','cash_buffer','hard_stop']) {
      saveWalletRiskState({profileId:'main',stage,dailyPeakUsd:null,rollingPeakUsd:null,lifetimePeakUsd:null,hardStopped:stage==='hard_stop',reason:'synthetic',updatedAt:f.now()},f.db);
      expect(()=>checkPaperReserveAuthority(f.authorityContext(),f.now(),f.db)).toThrow(stage==='hard_stop'?'stopped_or_paused':'risk_exposure_reconciliation');
    }
    saveWalletRiskState({profileId:'main',stage:'normal',dailyPeakUsd:null,rollingPeakUsd:null,lifetimePeakUsd:null,hardStopped:false,reason:null,updatedAt:f.now()},f.db);
    activateWalletSafetyStop({eventId:f.uuid(850),profileId:'main',kind:'manual',reason:'synthetic kill',at:f.now(),runId:null},f.db);
    expect(()=>checkPaperReserveAuthority(f.authorityContext(),f.now(),f.db)).toThrow('stopped_or_paused');
  }finally{f.db.close();}});
  it('loses its process-local permit on restart/disarm and requires separate manual Resume without resetting H',()=>{
    const f=reserveServiceFixture();try{f.service.savePolicy({...f.request(),settings:settings()});f.service.authorize(f.request());f.roundTrip();const p=f.service.preview();f.service.review({...f.request(),proposalId:p.id});
      f.service.disarm();expect(f.service.view().armed).toBe(false);expect(()=>f.service.review({...f.request(),proposalId:f.service.preview().id})).toThrow('manual_resume');
      expect(f.service.resume(f.request()).state?.hUsd).toBe('50');expect(f.service.view().armed).toBe(true);
      expect(()=>f.service.authorize(f.request())).toThrow('use_manual_resume');expect(f.service.view().state?.hUsd).toBe('50');
    }finally{f.db.close();}
  });
  it('an expired lease/fence refuses a reviewed allocation and retains all durable state',()=>{const f=reserveServiceFixture();try{f.service.savePolicy({...f.request(),settings:settings()});f.service.authorize(f.request());f.roundTrip();const p=f.service.preview();const r={...f.request(),proposalId:p.id};
    f.db.prepare('UPDATE execution_leases_v1 SET fencing_token=fencing_token+1').run();expect(()=>f.service.review(r)).toThrow('host_or_lease');expect(f.authority.armed).toBe(false);expect(f.service.view().state?.hUsd).toBe('0');
  }finally{f.db.close();}});
  it('a source correction/manual balance edit cannot silently continue',()=>{const f=reserveServiceFixture();try{f.service.savePolicy({...f.request(),settings:settings()});f.service.authorize(f.request());f.roundTrip();const p=f.service.preview();
    f.db.prepare("UPDATE paper_balances_v3 SET quantity_text='999' WHERE asset_id='USD'").run();expect(()=>f.service.review({...f.request(),proposalId:p.id})).toThrow('proposal_stale');expect(f.service.view().state?.hUsd).toBe('0');
  }finally{f.db.close();}});
});
