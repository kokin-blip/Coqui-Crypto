import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {capitalHash} from '@coqui/core';
import {openDatabase,backupDatabase,createFileProfileDatabaseDuplicator,readContestResult,readProfileDeletionImpact,appendContestRecord} from '@coqui/storage';
import {runCapitalContest,readCapitalContestRuns} from '@coqui/services';
import {contestFixture} from './helpers/capital-contest.js';
it('keeps populated reports unchanged across backup/restore/copy, archives origin, and counts each durable fact once',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'coqui-p5-lifecycle-')),db=openDatabase(join(folder,'main.db')),dbs=[db],{manifest:base,data}=contestFixture(1),m={...base,replay:{...base.replay,originProfileId:'main'}};
 try{const runtime={codeRevision:m.replay.codeRevision,sourceManifestHash:m.replay.sourceManifestHash,lockfileHash:m.replay.lockfileHash},result=await runCapitalContest({manifest:m,loadData:async()=>data,context:{profileId:'main',workspaceId:m.replay.workspaceId,assertCurrent(){}},runtime,now:()=>1,resume:false},db),id=capitalHash(m);
  const count=Number(db.prepare("SELECT COUNT(*) AS n FROM research_integrity_events WHERE namespace LIKE 'capital-contest:%'").get()?.['n']);expect(readProfileDeletionImpact('main',db).researchEvidenceRecords).toBe(count);
  backupDatabase(db,join(folder,'restore.db'));const restored=openDatabase(join(folder,'restore.db'));dbs.push(restored);expect(readContestResult(id,restored)).toEqual(result);expect(readCapitalContestRuns('main',restored).runs[0]?.atMs).toBe(1);
  const target=randomUUID(),name=`wallet-${target}.db`;expect((await createFileProfileDatabaseDuplicator(folder).duplicate({sourceProfileId:'main',sourceDbFilename:'main.db',targetProfileId:target,targetDbFilename:name})).ok).toBe(true);
  const copy=openDatabase(join(folder,name));dbs.push(copy);expect(readContestResult(id,copy)).toEqual(result);expect(readCapitalContestRuns(target,copy).runs[0]?.archived).toBe(true);
  expect(()=>copy.prepare("UPDATE research_integrity_events SET at_ms=2 WHERE kind='contest_spec'").run()).toThrow('immutable');
  appendContestRecord(id,'contest_failure','conflict',{reason:'one'},1,db);expect(()=>appendContestRecord(id,'contest_failure','conflict',{reason:'two'},2,db)).toThrow('conflict');
 }finally{for(const d of dbs)d.close();rmSync(folder,{recursive:true,force:true});}
});
