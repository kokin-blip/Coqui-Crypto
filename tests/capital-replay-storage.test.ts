import {describe,it,expect} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {capitalHash} from '@coqui/core';
import {openDatabase,backupDatabase,createFileProfileDatabaseDuplicator,readReplayResult,readProfileDeletionImpact,replayRecords} from '@coqui/storage';
import {runCapitalReplay,readCapitalReplayRuns} from '@coqui/services';import {replayFixture,variantChange} from './helpers/capital-replay.js';
describe('P4 immutable evidence and profile lifecycle',()=>{
 it('preserves populated results through backup and copy, with archived origin and no authority',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'coqui-p4-copy-')),db=openDatabase(join(folder,'main.db'));const dbs=[db];try{const f=replayFixture(),spec={...f.spec,originProfileId:'main'};
   const input={spec,loadTape:async()=>f.tape,context:{profileId:'main',workspaceId:spec.workspaceId,assertCurrent(){}},runtime:{codeRevision:spec.codeRevision,sourceManifestHash:spec.sourceManifestHash,lockfileHash:spec.lockfileHash},now:()=>1,retry:false};
   const result=await runCapitalReplay(input,db),hash=capitalHash(spec);const count=Number(db.prepare("SELECT COUNT(*) AS n FROM research_integrity_events WHERE kind LIKE 'capital_replay_%'").get()?.['n']);expect(readProfileDeletionImpact('main',db).researchEvidenceRecords).toBe(count);
   backupDatabase(db,join(folder,'restore.db'));const restored=openDatabase(join(folder,'restore.db'));dbs.push(restored);expect(readReplayResult(hash,restored)).toEqual(result);expect(readCapitalReplayRuns('main',restored).runs[0]?.recordedAtMs).toBe(1);
   const target=randomUUID(),name=`wallet-${target}.db`;expect((await createFileProfileDatabaseDuplicator(folder).duplicate({sourceProfileId:'main',sourceDbFilename:'main.db',targetProfileId:target,targetDbFilename:name})).ok).toBe(true);
   const copied=openDatabase(join(folder,name));dbs.push(copied);expect(readReplayResult(hash,copied)).toEqual(result);expect(readCapitalReplayRuns(target,copied).runs[0]?.archived).toBe(true);
   expect(Number(copied.prepare('SELECT COUNT(*) AS n FROM capital_scopes_v1').get()?.['n'])).toBe(0);expect(()=>copied.prepare("UPDATE research_integrity_events SET at_ms=2 WHERE kind='capital_replay_spec'").run()).toThrow('immutable');
  }finally{for(const d of dbs)d.close();rmSync(folder,{recursive:true,force:true});}
 });
 it('links corrected calculations to old immutable reports and rejects unproved lineage',async()=>{
  const db=openDatabase(':memory:'),{spec,tape}=replayFixture();try{const input={spec,loadTape:async()=>tape,context:{profileId:spec.originProfileId,workspaceId:spec.workspaceId,assertCurrent(){}},runtime:{codeRevision:spec.codeRevision,sourceManifestHash:spec.sourceManifestHash,lockfileHash:spec.lockfileHash},now:()=>1,retry:false};
   const before=await runCapitalReplay(input,db),corrected={...variantChange(spec,{externalExpenses:[{atMs:spec.toMs,amountUsd:'2'}]}),supersedesSpecHash:capitalHash(spec)};
   const after=await runCapitalReplay({...input,spec:corrected},db);expect(after.id).not.toBe(before.id);expect(readReplayResult(capitalHash(spec),db)).toEqual(before);expect(replayRecords(capitalHash(corrected),'capital_replay_spec',db)[0]?.body).toHaveProperty('supersedesSpecHash',capitalHash(spec));
   await expect(runCapitalReplay({...input,spec:{...corrected,supersedesSpecHash:'a'.repeat(64)}},db)).rejects.toThrow('lineage');
  }finally{db.close();}
 });
});
