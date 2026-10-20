import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,expect,it } from 'vitest';
import { FixedClock } from '../packages/core/src/index.js';
import { startOperationsActivity } from '../packages/services/src/index.js';
import { appendOperationsActivity,openDatabase,readOperationsFloor,readOperationsJournalGroup,
  listOperationsJournal,appendResearchJobEvent,OPERATIONS_WORKERS } from '../packages/storage/src/index.js';
import { createDecisionHandlers } from '../apps/desktop/src/main/decision-handlers.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
import { observeAdvisorActivity } from '../packages/services/src/operations/advisor-activity.js';
import { appendAdvisorAuditEvent } from '../packages/storage/src/repositories/advisor-history.js';
import { recordParallelOperationsActivity } from '../packages/services/src/operations/parallel-activity.js';

describe('Operations journal boundaries and evidence',()=>{
  it('correlates delayed partial fills by order identity and waits for recorded pass completion',()=>{
    const db=openDatabase(':memory:');
    const event={experimentId:'campaign',profileId:'main',at:100};
    recordParallelOperationsActivity({...event,id:'intent',kind:'external_intent',detail:{clientOrderId:'client-one'}},'parallel:pass',db);
    recordParallelOperationsActivity({...event,id:'order',kind:'external_order',at:110,
      detail:{clientOrderId:'client-one',orderId:'order-one',status:'partially_filled'}},null,db);
    recordParallelOperationsActivity({...event,id:'fill',kind:'external_fill',at:120,
      detail:{orderId:'order-one',quantity:'0.1'}},null,db);
    let view=readOperationsJournalGroup('main','parallel:pass',null,50,null,db,200);
    expect(view.entries).toHaveLength(3);expect(view.group.status).toBe('waiting');
    expect(view.entries.at(-1)?.message).toContain('confirmed Alpaca paper fill');
    recordParallelOperationsActivity({...event,id:'complete',kind:'external_complete',at:130,detail:{}},'parallel:pass',db);
    view=readOperationsJournalGroup('main','parallel:pass',null,50,null,db,200);
    expect(view.group.status).toBe('completed');expect(listOperationsJournal('other',null,5,null,db,200).groups).toEqual([]);db.close();
  });
  it('keeps concurrent Advisor audit identities with their own requests and deduplicates outcomes',async()=>{
    const db=openDatabase(':memory:');let release!:()=>void;
    const barrier=new Promise<void>(resolve=>{release=resolve;});
    const observe=(workId:string,run:()=>Promise<string>)=>observeAdvisorActivity({database:db,profileId:'main',
      workId,now:()=>100,provider:'local',operation:'facts'},run);
    const first=observe('advisor:first',async()=>{await barrier;appendAdvisorAuditEvent('main','local','facts','succeeded','a'.repeat(64),100,db);return 'first';});
    expect(await observe('advisor:second',async()=>{appendAdvisorAuditEvent('main','local','facts','failed','b'.repeat(64),100,db);return 'fallback';})).toBe('fallback');
    release();expect(await first).toBe('first');
    const one=readOperationsJournalGroup('main','advisor:first',null,50,null,db,200);
    const two=readOperationsJournalGroup('main','advisor:second',null,50,null,db,200);
    expect(one.entries.find(e=>e.phase==='explanation_finished')?.facts.sourceRecord).toBe('advisor-audit:2');
    expect(two.entries.find(e=>e.phase==='explanation_finished')?.facts.sourceRecord).toBe('advisor-audit:1');
    expect(two.entries.find(e=>e.phase==='explanation_finished')?.message).toContain('local response');
    expect(listOperationsJournal('main',null,5,null,db,200).groups).toHaveLength(2);db.close();
  });
  it('does not let later advice overwrite a refusal and expires active work consistently with the floor',()=>{
    const db=openDatabase(':memory:');
    const active=startOperationsActivity({database:db,profileId:'main',workId:'market:deadline',worker:'market',source:'market',
      phase:'market_refresh_started',now:()=>100,deadlineAtMs:150});
    expect(readOperationsJournalGroup('main','market:deadline',null,50,null,db,160).group.status).toBe('unknown');
    expect(readOperationsFloor('main',db,160).find(item=>item.subsystem==='market')?.detail).toContain('unconfirmed');
    active.finish('market_refresh_finished');
    appendOperationsActivity({profileId:'main',workId:'host:blocked',attemptId:'risk',worker:'risk',source:'paper_ledger',
      phase:'gates_finished',status:'blocked',atMs:200,deadlineAtMs:null,facts:{reasonCode:'stale_market_data'}},db);
    appendOperationsActivity({profileId:'main',workId:'host:blocked',attemptId:'advisor',worker:'advisor',source:'advisor',
      phase:'explanation_finished',status:'completed',atMs:210,deadlineAtMs:null,facts:{}},db);
    expect(listOperationsJournal('main',null,5,null,db,220).groups[0]?.status).toBe('blocked');db.close();
  });
  it('validates both read channels without causing work or exposing extra request fields',async()=>{
    const db=openDatabase(':memory:'),dispatch=createDispatcher({handlers:createDecisionHandlers('main',new FixedClock(200),db)});
    const before=db.prepare('SELECT total_changes() AS value').get();
    const index=await dispatch('operations.journal',{worker:null,limit:5,cursor:null});
    expect(index.status).toBe('ok');
    expect(await dispatch('operations.journal',{worker:null,limit:5,cursor:null,profileId:'other'})).toMatchObject({status:'failed'});
    expect(await dispatch('operations.journal.group',{groupId:'missing',worker:null,limit:50,cursor:null})).toMatchObject({status:'failed'});
    expect(db.prepare('SELECT total_changes() AS value').get()).toEqual(before);db.close();
  });
  it('includes all six workers in an explicitly linked handoff and filters within that group',()=>{
    const db=openDatabase(':memory:');
    OPERATIONS_WORKERS.forEach((worker,index)=>appendOperationsActivity({profileId:'main',workId:'host:explicit-group',
      attemptId:`attempt-${worker}`,worker,source:'host',phase:worker==='research'?'worker_completed':worker==='advisor'?'explanation_finished':'evaluation_finished',
      status:'completed',atMs:100+index,deadlineAtMs:null,facts:{}},db));
    const index=listOperationsJournal('main',null,5,null,db,200);
    expect(index.groups).toHaveLength(1);expect(index.coverage.every(item=>item.status==='available')).toBe(true);
    expect(readOperationsJournalGroup('main','host:explicit-group',null,50,null,db,200).entries.map(item=>item.worker)).toEqual(OPERATIONS_WORKERS);
    expect(readOperationsJournalGroup('main','host:explicit-group','risk',50,null,db,200).entries).toHaveLength(1);
    expect(readOperationsFloor('main',db).find(item=>item.subsystem==='advisor')?.detail).toContain('I completed');db.close();
  });
  it('projects unowned research lifecycle as global without forwarding raw job requests',()=>{
    const db=openDatabase(':memory:');
    db.prepare(`INSERT INTO research_jobs(id,kind,status,created_at,started_at,completed_at,request_json,progress_json)
      VALUES('global-job','matrix','completed',100,110,120,'{"private":"CANARY"}','{}')`).run();
    appendResearchJobEvent('global-job','worker_started','{"attemptId":"attempt-one"}',110,db);
    appendResearchJobEvent('global-job','worker_completed','{"attemptId":"attempt-one","resultHash":null}',120,db);
    const view=readOperationsJournalGroup('main','research:global-job',null,50,null,db,200);
    expect(view.group.scope).toBe('global');expect(view.entries[0]?.message).toBe('I started this research attempt.');
    expect(view.entries[1]?.message).toContain('I finished');expect(JSON.stringify(view)).not.toContain('CANARY');
    expect(listOperationsJournal('other',null,5,null,db,200).groups[0]?.scope).toBe('global');db.close();
  });
  it('records no fake success when observation persistence or its reporting callback fails',()=>{
    const db=openDatabase(':memory:');db.exec(`CREATE TRIGGER refuse_operations BEFORE INSERT ON operations_activity_events_v1
      BEGIN SELECT RAISE(ABORT,'fixture refusal'); END;`);
    const activity=startOperationsActivity({database:db,profileId:'main',workId:'host:one',worker:'host',source:'host',
      phase:'evaluation_started',now:()=>100,onUnexpectedError:()=>{throw new Error('reporter failed');}});
    expect(()=>activity.finish('evaluation_finished')).not.toThrow();
    expect(listOperationsJournal('main',null,5,null,db,200).groups).toEqual([]);db.close();
  });
  it('detects integrity failure instead of showing tampered narration',()=>{
    const db=openDatabase(':memory:');appendOperationsActivity({profileId:'main',workId:'market:one',attemptId:'one',worker:'market',
      source:'market',phase:'market_refresh_finished',status:'completed',atMs:100,deadlineAtMs:null,facts:{instruments:'BTC-USD'}},db);
    db.exec('DROP TRIGGER operations_activity_no_update');db.prepare('UPDATE operations_activity_events_v1 SET facts_json=?').run('{"instruments":"ETH-USD"}');
    expect(()=>readOperationsJournalGroup('main','market:one',null,50,null,db,200)).toThrow('operations_activity_integrity');db.close();
  });
  it('notices detached writers and never claims their abandoned operation is still running',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'coqui-journal-')),path=join(dir,'journal.db');
    const db=openDatabase(path),external=openDatabase(path);
    try {
      const dispatch=createDispatcher({handlers:createDecisionHandlers('main',new FixedClock(200),db)});
      expect(await dispatch('operations.journal',{worker:null,limit:5,cursor:null})).toMatchObject({status:'ok',value:{groups:[]}});
      appendOperationsActivity({profileId:'main',workId:'market:external',attemptId:'external',worker:'market',source:'market',
        phase:'market_refresh_started',status:'running',atMs:100,deadlineAtMs:null,facts:{instruments:'BTC-USD'}},external);
      expect(await dispatch('operations.journal',{worker:null,limit:5,cursor:null})).toMatchObject({status:'ok',value:{groups:[{status:'unknown'}]}});
    } finally {external.close();db.close();rmSync(dir,{recursive:true,force:true});}
  });
  it('keeps same-timestamp sequence order across entry pages',()=>{
    const db=openDatabase(':memory:');
    for(let i=0;i<70;i++)appendOperationsActivity({profileId:'main',workId:'host:long',attemptId:`a-${i}`,worker:'host',source:'host',
      phase:'recorded',status:'completed',atMs:100,deadlineAtMs:null,facts:{sequence:i}},db);
    const first=readOperationsJournalGroup('main','host:long',null,50,null,db,200);
    const second=readOperationsJournalGroup('main','host:long',null,50,first.nextCursor,db,200);
    expect([...second.entries,...first.entries].map(item=>item.facts.sequence)).toEqual(Array.from({length:70},(_,i)=>i));db.close();
  });
});
