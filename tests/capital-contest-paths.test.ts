import {it,expect} from 'vitest';
import {capitalHash} from '@coqui/core';
import {openDatabase,readContestPath} from '@coqui/storage';
import {runCapitalContest,reconstructCapitalContestPath} from '@coqui/services';
import {contestFixture} from './helpers/capital-contest.js';
import {REPLAY_START as T,REPLAY_DAY as DAY} from './helpers/capital-replay.js';
it('reconstructs every full-book hash from a stored path without writing or reopening input files',async()=>{
 const {manifest:base,data:original}=contestFixture(1),warmup=Array.from({length:29},(_,i)=>({...original.warmup[i%10]!,atMs:T-(29-i)*DAY,endMs:T-(28-i)*DAY}));
 const data={...original,warmup,membership:original.membership.map(x=>({...x,fromMs:T-29*DAY,observedAtMs:T-30*DAY}))},m={...base,dataHash:capitalHash(data),replay:{...base.replay,warmupFromMs:T-29*DAY},folds:[{...base.folds[0]!,trainFromMs:T-29*DAY}],inference:{...base.inference,resamples:1},contrasts:[{...base.contrasts[0]!,right:'C'}]};
 const db=openDatabase(':memory:'),context={profileId:m.replay.originProfileId,workspaceId:m.replay.workspaceId,assertCurrent(){}},runtime={codeRevision:m.replay.codeRevision,sourceManifestHash:m.replay.sourceManifestHash,lockfileHash:m.replay.lockfileHash};
 try{const result=await runCapitalContest({manifest:m,loadData:async()=>data,context,runtime,now:()=>1,resume:false},db),id=capitalHash(m),path=readContestPath(id,'0',db)!;expect(path.cellHashes).toHaveLength(72);expect(result.pathIds).toEqual([path.id]);const n=db.prepare('SELECT total_changes() AS n').get()?.['n'];
  const rebuilt=await reconstructCapitalContestPath({runId:id,index:0,trialId:m.trials[0]!.id,context,runtime,check(){}},db);expect(rebuilt.selected?.result.id).toBe(path.cellHashes[0]);expect(db.prepare('SELECT total_changes() AS n').get()?.['n']).toBe(n);
 }finally{db.close();}
},30000);
