import {describe,it,expect} from 'vitest';
import {openDatabase,readReplayResult,replayRecords,readReplaySpec} from '@coqui/storage';
import {runCapitalReplay,readCapitalReplayRuns,readCapitalReplayDetail} from '@coqui/services';
import {capitalReplayResultSchema,capitalReplaySpecSchema,capitalReplayTapeSchema} from '@coqui/contracts';
import {capitalHash,capitalReplayJsonBytes} from '@coqui/core';
import {replayFixture} from './helpers/capital-replay.js';
function setup(){const db=openDatabase(':memory:'),{spec,tape}=replayFixture();return {db,spec,tape,input:{spec,loadTape:async()=>tape,context:{profileId:spec.originProfileId,workspaceId:spec.workspaceId,assertCurrent(){}},runtime:{codeRevision:spec.codeRevision,sourceManifestHash:spec.sourceManifestHash,lockfileHash:spec.lockfileHash},now:()=>1,retry:false}};}
describe('P4 durable offline service',()=>{
 it('strictly validates and roundtrips actual stored results and exact retries',async()=>{
  const {db,spec,tape,input}=setup();try{
   expect(capitalReplaySpecSchema.parse(spec)).toEqual(spec);expect(capitalReplayTapeSchema.parse(tape)).toEqual(tape);
   const result=await runCapitalReplay(input,db);expect(capitalReplayResultSchema.parse(result)).toEqual(result);
   const hash=capitalHash(spec);expect(readReplayResult(hash,db)?.id).toBe(result.id);expect(readReplaySpec(hash,db)).toEqual(spec);
   const changes=db.prepare('SELECT total_changes() AS n').get()?.['n'];
   expect((await runCapitalReplay({...input,loadTape:async()=>{throw new Error('must not reload');}},db)).id).toBe(result.id);
   const runs=readCapitalReplayRuns(spec.originProfileId,db);const view=readCapitalReplayDetail(spec.originProfileId,db,{runId:hash,cellId:null,page:0,limit:1});expect(view.traces).toHaveLength(1);expect(view.hasMore).toBe(true);expect(runs.runs[0]?.status).toBe('complete');
   expect(db.prepare('SELECT total_changes() AS n').get()?.['n']).toBe(changes);
   expect(readCapitalReplayRuns('copied-profile',db).runs[0]?.archived).toBe(true);
   expect(Number(db.prepare('SELECT COUNT(*) AS n FROM capital_scopes_v1').get()?.['n'])).toBe(0);
  }finally{db.close();}
 });
 it('retains failed attempts and requires explicit retry before reopening inputs',async()=>{
  const {db,spec,input}=setup();try{await expect(runCapitalReplay({...input,loadTape:async()=>{throw new Error('bad input');}},db)).rejects.toThrow('replay_input_or_execution_failed');
   await expect(runCapitalReplay(input,db)).rejects.toThrow('explicit_retry');expect(replayRecords(capitalHash(spec),'capital_replay_attempt',db)).toHaveLength(1);
   const r=await runCapitalReplay({...input,retry:true},db);expect(r.cells).toHaveLength(36);expect(replayRecords(capitalHash(spec),'capital_replay_attempt',db)).toHaveLength(2);
  }finally{db.close();}
 });
 it('rolls back a crash after chunks and before root publication and does not write finances',async()=>{
  const {db,spec,input}=setup();try{db.exec("CREATE TRIGGER fail_replay_root BEFORE INSERT ON research_integrity_events WHEN NEW.kind='capital_replay_result' BEGIN SELECT RAISE(ABORT,'synthetic_crash'); END;");
   await expect(runCapitalReplay(input,db)).rejects.toThrow();expect(readReplayResult(capitalHash(spec),db)).toBeNull();expect(replayRecords(capitalHash(spec),'capital_replay_chunk',db)).toHaveLength(0);
   db.exec('DROP TRIGGER fail_replay_root');expect((await runCapitalReplay({...input,retry:true},db)).cells.length).toBe(36);
  }finally{db.close();}
 });
 it('honors cancellation, runtime identity and lifecycle before result publication',async()=>{
  const {db,input}=setup();try{await expect(runCapitalReplay({...input,runtime:{...input.runtime,codeRevision:'other'}},db)).rejects.toThrow('runtime');
   const abort=new AbortController();abort.abort();await expect(runCapitalReplay({...input,signal:abort.signal},db)).rejects.toThrow('cancelled');
   await expect(runCapitalReplay({...input,retry:true,context:{...input.context,assertCurrent(){throw new Error('replay_lifecycle_changed');}}},db)).rejects.toThrow('lifecycle');
  }finally{db.close();}
 });
});

it('bounds exported UTF-8 bytes rather than treating non-ASCII evidence as one byte',()=>{
 for(const sample of [{label:'USD'},{label:'é'},{label:'口'},{label:'🦜'}])expect(capitalReplayJsonBytes(sample)).toBe(Buffer.byteLength(JSON.stringify(sample),'utf8'));
});
