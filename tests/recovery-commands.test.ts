import { describe,it,expect } from 'vitest';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase,associateNewsReport } from '@coqui/storage';
import { createProfileOperationGate } from '@coqui/services';
import { newsEvidenceHash, runNewsStudy, DEFAULT_TRADE_COST_CONFIG } from '@coqui/core';
import { createRecoveryHandlers } from '../apps/desktop/src/main/recovery-handlers.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
describe('operator-selected recovery command outcomes',()=>{
 it('reports cancellation, refusal and confirmed duplicate truthfully, and blocks profile changes while selecting',async()=>{
  const root=mkdtempSync(join(tmpdir(),'coqui-command-')),db=openDatabase(':memory:'),gate=createProfileOperationGate();
  try{
   const reports=([['daily',24],['hourly',1],['hourly',4],['hourly',24]] as const).map(([cadence,horizonHours])=>runNewsStudy({cadence,horizonHours,bars:[],features:[],cost:DEFAULT_TRADE_COST_CONFIG,sourceManifestHashes:[],codeRevision:'a'.repeat(40),completedAtMs:10}));
   const body={version:'news-study-report-v1',completedAtMs:10,reports},reportHash=newsEvidenceHash(body),path=join(root,'report.json');
   writeFileSync(path,JSON.stringify({...body,reportHash}));associateNewsReport({profileId:'main',path,atMs:20},db);
   let selected:string|null=null;
   const dispatch=createDispatcher({handlers:createRecoveryHandlers({profileId:'main',database:db,clock:{nowMs:()=>30},operationGate:gate,buildIdentity:'fixture',
    pickReport:async()=>{expect(gate.isBusy()).toBe(true);expect(gate.begin()).toBe(false);return selected;},pickRestore:async()=>null})});
   const command=()=>dispatch('news.report.select-location',{commandId:crypto.randomUUID(),reportHash});
   expect(await command()).toMatchObject({status:'ok',value:{status:'cancelled'}});expect(gate.isBusy()).toBe(false);
   selected=path;expect(await command()).toMatchObject({status:'ok',value:{status:'already_selected'}});
   selected=join(root,'missing.json');expect(await command()).toMatchObject({status:'failed',issues:[{code:'report_artifact_invalid'}]});
   expect(await dispatch('app.recovery.verify',{commandId:crypto.randomUUID(),expectedDatabaseHash:'a'.repeat(64)})).toMatchObject({status:'ok',value:{status:'cancelled',proof:null}});
   expect(gate.isBusy()).toBe(false);expect(db.prepare('SELECT count(*) AS n FROM news_report_locations_v1').get()?.['n']).toBe(0);
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
 });
});
