import {describe,it,expect} from 'vitest';
import {openDatabase,appendIntegrityEvent,contestRecords,readContestResult} from '@coqui/storage';
import {capitalHash} from '@coqui/core';
import {runCapitalContest,readCapitalContestRuns} from '@coqui/services';
import {createCapitalContestHandlers} from '../apps/desktop/src/main/capital-contest-handlers.js';
import {isWriteChannel} from '@coqui/contracts';
import {contestFixture} from './helpers/capital-contest.js';
function setup(){const {manifest:m,data}=contestFixture(1),db=openDatabase(':memory:');return {db,m,input:{manifest:m,loadData:async()=>data,context:{profileId:m.replay.originProfileId,workspaceId:m.replay.workspaceId,assertCurrent(){}},runtime:{codeRevision:m.replay.codeRevision,sourceManifestHash:m.replay.sourceManifestHash,lockfileHash:m.replay.lockfileHash},now:()=>1,resume:false}};}
describe('P5 governance and actual mutation boundary',()=>{
 it('refuses consumed intervals before invoking data and writes no final/registration evidence',async()=>{const {db,m,input}=setup();let read=false;try{appendIntegrityEvent({namespace:'old-consumed',kind:'final_claim',key:'final',atMs:0,body:{startMs:m.replay.warmupFromMs,endExclusiveMs:m.replay.toMs,assets:m.replay.assets}},db);
  await expect(runCapitalContest({...input,manifest:{...m,replay:{...m.replay,exposure:'exposed_development'}},loadData:async()=>{read=true;return input.loadData();}},db)).rejects.toThrow();expect(read).toBe(false);expect(db.prepare("SELECT COUNT(*) AS n FROM research_integrity_events WHERE kind='final_claim'").get()?.['n']).toBe(1);
 }finally{db.close();}});
 it('retains complete cells after an interrupted attempt, resumes once, and keeps queries nonmutating',async()=>{const {db,m,input}=setup();let calls=0;try{const abort=new AbortController();const context={...input.context,assertCurrent(){if(Number(db.prepare("SELECT COUNT(*) AS n FROM research_integrity_events WHERE kind='contest_cell'").get()?.['n'])>=2)abort.abort();}};
  await expect(runCapitalContest({...input,context,signal:abort.signal},db)).rejects.toThrow('cancelled');const count=contestRecords(capitalHash(m),'contest_cell',db).length;expect(count).toBeGreaterThan(0);expect(readContestResult(capitalHash(m),db)).toBeNull();expect(readCapitalContestRuns(m.replay.originProfileId,db).runs[0]?.status).toBe('interrupted');
  const result=await runCapitalContest({...input,resume:true,loadData:async()=>{calls++;return input.loadData();}},db);expect(calls).toBe(0);expect(result.cellIds).toHaveLength(72);expect(contestRecords(capitalHash(m),'contest_cell',db)).toHaveLength(72);
  const handlers=createCapitalContestHandlers(m.replay.originProfileId,db),before=db.prepare('SELECT total_changes() AS n').get()?.['n'];expect(Object.keys(handlers).sort()).toEqual(['research.capital-contest.detail','research.capital-contest.runs']);expect(isWriteChannel('research.capital-contest.runs')).toBe(false);
  const read=handlers['research.capital-contest.runs']!;expect(await read({limit:10} as never)).toHaveProperty('ok',true);expect(db.prepare('SELECT total_changes() AS n').get()?.['n']).toBe(before);
  for(const table of ['capital_scopes_v1','paper_orders_v3','paper_fills_v3','research_preregistrations','capital_cash_claim_revisions_v1']){const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);if(exists)expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.['n']).toBe(0);}
 }finally{db.close();}});
});
