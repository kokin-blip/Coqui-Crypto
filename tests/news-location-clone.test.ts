import { describe,it,expect } from 'vitest';
import { copyFileSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_TRADE_COST_CONFIG,newsEvidenceHash,runNewsStudy } from '@coqui/core';
import { newsExportFields } from '@coqui/contracts';
import { appendNewsExportPermission,associateNewsReport,createFileProfileDatabaseDuplicator,latestAssociatedNewsReport,openDatabase,selectNewsReportLocation } from '@coqui/storage';
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
describe('report locations at the clone permission boundary',()=>{
 it('excludes location authority before associations without changing original history',async()=>{
  const root=mkdtempSync(join(tmpdir(),'coqui-location-clone-')),source=join(root,'source.db'),path=join(root,'report.json'),copy=join(root,'copied.json');
  const targetId='11111111-1111-4111-8111-111111111111';
  try{
   const reports=([['daily',24],['hourly',1],['hourly',4],['hourly',24]] as const).map(([cadence,horizonHours])=>runNewsStudy({cadence,horizonHours,bars:[],features:[],cost:DEFAULT_TRADE_COST_CONFIG,sourceManifestHashes:[],codeRevision:'a'.repeat(40),completedAtMs:10}));
   const body={version:'news-study-report-v1',completedAtMs:10,reports},reportHash=newsEvidenceHash(body);
   writeFileSync(path,JSON.stringify({...body,reportHash}));copyFileSync(path,copy);
   const original=openDatabase(source);try{
    associateNewsReport({profileId:'main',path,atMs:20},original);
    selectNewsReportLocation({profileId:'main',reportHash,path:copy,atMs:30},original);
    appendNewsExportPermission({version:'news-export-permission-v1',profileId:'main',artifactHash:reportHash,decision:'allow',fields:[...newsExportFields],reviewedAtMs:20,expiresAtMs:100,termsUrl:'https://example.invalid/fixture',termsVersion:'fixture',termsEvidenceHash:'a'.repeat(64),ownerApprovalEvidenceHash:'b'.repeat(64),accountAuthorityEvidenceHash:null},original);
   }finally{original.close();}
   const before=hash(source);
   const result=await createFileProfileDatabaseDuplicator(root).duplicate({sourceProfileId:'main',sourceDbFilename:'source.db',targetProfileId:targetId,targetDbFilename:`wallet-${targetId}.db`});
   expect(result).toMatchObject({ok:true,evidence:{integrityVerified:true}});expect(hash(source)).toBe(before);
   const cloned=openDatabase(join(root,`wallet-${targetId}.db`)),retained=openDatabase(source);try{
    for(const table of ['news_report_locations_v1','news_report_associations_v1','news_export_permissions_v1']){
     expect(cloned.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n']).toBe(0);
     expect(retained.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n']).toBe(1);
    }
    expect(latestAssociatedNewsReport(targetId,40,cloned).association).toBe('unverified');
    expect(()=>selectNewsReportLocation({profileId:targetId,reportHash,path:copy,atMs:40},cloned)).toThrow('report_profile_association_missing');
    associateNewsReport({profileId:targetId,path,atMs:40},cloned);
    expect(selectNewsReportLocation({profileId:targetId,reportHash,path:copy,atMs:50},cloned).status).toBe('recorded');
    expect(()=>cloned.exec('DELETE FROM news_report_locations_v1')).toThrow('immutable');
    expect(cloned.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(cloned.prepare('SELECT count(*) AS n FROM paper_orders_v3').get()?.['n']).toBe(0);
   }finally{cloned.close();retained.close();}
  }finally{rmSync(root,{recursive:true,force:true});}
 });
});
