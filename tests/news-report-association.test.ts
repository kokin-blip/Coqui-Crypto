import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,it,expect } from 'vitest';
import { newsEvidenceHash,runNewsStudy,DEFAULT_TRADE_COST_CONFIG } from '../packages/core/src/index.js';
import { openDatabase,associateNewsReport,latestAssociatedNewsReport } from '../packages/storage/src/index.js';
import { buildEvidenceBundle } from '../apps/desktop/src/main/evidence-export.js';
function report() {
  const reports = ([['daily',24],['hourly',1],['hourly',4],['hourly',24]] as const).map(([cadence,horizonHours])=>
    runNewsStudy({cadence,horizonHours,bars:[],features:[],cost:DEFAULT_TRADE_COST_CONFIG,sourceManifestHashes:[],codeRevision:'a'.repeat(40),completedAtMs:10}));
  const body={version:'news-study-report-v1',completedAtMs:10,reports};
  return {...body,reportHash:newsEvidenceHash(body)};
}
describe('explicit news report identity',()=>{
  it('validates four insufficient horizons, isolates profiles and detects later corruption',()=>{
    const dir=mkdtempSync(join(tmpdir(),'coqui-report-')),path=join(dir,'report.json'),db=openDatabase(':memory:');
    try {
      writeFileSync(path,JSON.stringify(report()));
      expect(latestAssociatedNewsReport('main',20,db).association).toBe('unverified');
      associateNewsReport({path,profileId:'main',atMs:20},db);
      expect(latestAssociatedNewsReport('main',20,db).report?.horizons).toHaveLength(4);
      expect(latestAssociatedNewsReport('other',20,db).report).toBeNull();
      const bundle=buildEvidenceBundle('main',20,db),json=JSON.stringify(bundle);
      expect(json).not.toContain(dir);expect(json).not.toContain('account-123');
      expect(bundle.newsReport?.horizons.every(h=>h.status==='insufficient_evidence')).toBe(true);
      writeFileSync(path,JSON.stringify({...report(),completedAtMs:999}));
      expect(latestAssociatedNewsReport('main',20,db).association).toBe('unavailable');
      expect(()=>associateNewsReport({path,profileId:'main',atMs:1000},db)).toThrow();
    } finally {db.close();rmSync(dir,{recursive:true,force:true});}
  });
});
