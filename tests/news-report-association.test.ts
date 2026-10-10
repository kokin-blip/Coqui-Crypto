import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,it,expect } from 'vitest';
import { newsEvidenceHash,runNewsStudy,DEFAULT_TRADE_COST_CONFIG } from '../packages/core/src/index.js';
import { openDatabase,associateNewsReport,latestAssociatedNewsReport,appendNewsExportPermission } from '../packages/storage/src/index.js';
import { newsExportFields } from '../packages/contracts/src/index.js';
import { buildEvidenceBundle } from '../apps/desktop/src/main/evidence-export.js';
import { createWorkstationHandlers } from '../apps/desktop/src/main/workstation-handlers.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
function report() {
  const reports = ([['daily',24],['hourly',1],['hourly',4],['hourly',24]] as const).map(([cadence,horizonHours])=>
    runNewsStudy({cadence,horizonHours,bars:[],features:[],cost:DEFAULT_TRADE_COST_CONFIG,sourceManifestHashes:[],codeRevision:'a'.repeat(40),completedAtMs:10}));
  const body={version:'news-study-report-v1',completedAtMs:10,reports};
  return {...body,reportHash:newsEvidenceHash(body)};
}
describe('explicit news report identity',()=>{
  it('withholds arbitrary source strings and rejects unknown report reasons',()=>{
    const dir=mkdtempSync(join(tmpdir(),'coqui-source-redaction-')),path=join(dir,'report.json'),db=openDatabase(':memory:');
    try {
      const original=report(),reports=original.reports.map(r=>{const manifest={...r.manifest,codeRevision:'sk_canary_secret'};return {...r,manifest,manifestHash:newsEvidenceHash(manifest)};});
      const body={version:original.version,completedAtMs:10,reports},safe={...body,reportHash:newsEvidenceHash(body)};
      writeFileSync(path,JSON.stringify(safe));associateNewsReport({path,profileId:'main',atMs:20},db);
      expect(JSON.stringify(latestAssociatedNewsReport('main',20,db))).not.toContain('sk_canary_secret');
      expect(latestAssociatedNewsReport('main',20,db).report?.horizons[0]?.codeRevision).toBe('unverified');
      const unknown={...body,reports:reports.map(r=>({...r,reasons:['sk_canary_secret']}))};
      writeFileSync(path,JSON.stringify({...unknown,reportHash:newsEvidenceHash(unknown)}));
      expect(()=>associateNewsReport({path,profileId:'main',atMs:20},db)).toThrow();
    }finally{db.close();rmSync(dir,{recursive:true,force:true});}
  });
  it('rechecks permission expiry after destination choice before producing file bytes',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'coqui-export-')),path=join(dir,'report.json'),db=openDatabase(':memory:');
    try {
      writeFileSync(path,JSON.stringify(report()));associateNewsReport({path,profileId:'main',atMs:20},db);
      appendNewsExportPermission({version:'news-export-permission-v1',profileId:'main',artifactHash:report().reportHash,
        decision:'allow',fields:[...newsExportFields],reviewedAtMs:19,expiresAtMs:30,termsUrl:'https://example.invalid/fixture-license',
        termsVersion:'fixture-only',termsEvidenceHash:'a'.repeat(64),ownerApprovalEvidenceHash:'b'.repeat(64),accountAuthorityEvidenceHash:null},db);
      let now=20,bytes='';
      const dispatch=createDispatcher({handlers:createWorkstationHandlers({profileId:'main',database:db,clock:{nowMs:()=>now},
        saveEvidence:async(readData)=>{now=31;bytes=readData();return 'saved';}})});
      const result=await dispatch('app.evidence-export',{commandId:crypto.randomUUID()});
      expect(result.status).toBe('ok');expect(JSON.parse(bytes).newsReport).toBeNull();
      expect(JSON.parse(bytes).rightsPermissionHashes).toEqual([]);
      now=20;bytes='';
      db.exec("DROP TRIGGER news_export_permissions_v1_no_update; UPDATE news_export_permissions_v1 SET body_json='{}'");
      const refused=await dispatch('app.evidence-export',{commandId:crypto.randomUUID()});
      expect(refused.status).toBe('failed');expect(bytes).toBe('');
    }finally{db.close();rmSync(dir,{recursive:true,force:true});}
  });
  it('validates four insufficient horizons, isolates profiles and detects later corruption',()=>{
    const dir=mkdtempSync(join(tmpdir(),'coqui-report-')),path=join(dir,'report.json'),db=openDatabase(':memory:');
    try {
      writeFileSync(path,JSON.stringify(report()));
      expect(latestAssociatedNewsReport('main',20,db).association).toBe('unverified');
      associateNewsReport({path,profileId:'main',atMs:20},db);
      expect(latestAssociatedNewsReport('main',20,db).report?.horizons).toHaveLength(4);
      expect(latestAssociatedNewsReport('other',20,db).report).toBeNull();
      expect(buildEvidenceBundle('main',20,db).newsReport).toBeNull();
      appendNewsExportPermission({version:'news-export-permission-v1',profileId:'main',artifactHash:report().reportHash,
        decision:'allow',fields:[...newsExportFields],reviewedAtMs:19,expiresAtMs:30,termsUrl:'https://example.invalid/fixture-license',
        termsVersion:'fixture-only',termsEvidenceHash:'a'.repeat(64),ownerApprovalEvidenceHash:'b'.repeat(64),accountAuthorityEvidenceHash:null},db);
      const bundle=buildEvidenceBundle('main',20,db),json=JSON.stringify(bundle);
      expect(json).not.toContain(dir);expect(json).not.toContain('account-123');
      expect(bundle.newsReport?.horizons.every(h=>h.status==='insufficient_evidence')).toBe(true);
      expect(bundle.simulated).toBeNull();expect(bundle.sourceEvidenceClassification).toBe('unverified');
      expect(buildEvidenceBundle('main',30,db).newsReport).toBeNull();
      writeFileSync(path,JSON.stringify({...report(),completedAtMs:999}));
      expect(latestAssociatedNewsReport('main',20,db).association).toBe('unavailable');
      expect(()=>associateNewsReport({path,profileId:'main',atMs:1000},db)).toThrow();
    } finally {db.close();rmSync(dir,{recursive:true,force:true});}
  });
});
