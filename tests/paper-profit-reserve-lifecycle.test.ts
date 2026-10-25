import { describe,it,expect } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';import { tmpdir } from 'node:os';import { join } from 'node:path';
import { backupDatabase,openDatabase,createFileProfileDatabaseDuplicator,readProfileDeletionImpact,paperReserveBinding } from '@coqui/storage';
import { createPaperCapitalBook } from '@coqui/services';
import { reserveServiceFixture } from './helpers/paper-profit-reserve.js';import { settings } from './helpers/profit-reserve.js';
describe('P6 durable facts through copy/restore',()=>{
  it('keeps origin, H and claims in backups; copied access is archived and grants no new economic identity',async()=>{
    const f=reserveServiceFixture(),root=mkdtempSync(join(tmpdir(),'coqui-p6-copy-'));try{
      f.service.savePolicy({...f.request(),settings:settings()});f.service.authorize(f.request());f.roundTrip();const p=f.service.preview();const value=f.service.review({...f.request(),proposalId:p.id});
      backupDatabase(f.db,join(root,'main.db'));const restored=openDatabase(join(root,'main.db'));
      try{expect(paperReserveBinding('main',restored)?.state_id).toBe(value.state!.id);expect(readProfileDeletionImpact('main',restored).portfolioEvidenceRecords).toBeGreaterThan(10);}finally{restored.close();}
      const target=f.uuid(700),name=`wallet-${target}.db`,result=await createFileProfileDatabaseDuplicator(root).duplicate({sourceProfileId:'main',sourceDbFilename:'main.db',targetProfileId:target,targetDbFilename:name});expect(result.ok).toBe(true);
      const copy=openDatabase(join(root,name));try{
        expect(paperReserveBinding(target,copy)).toMatchObject({archived:1,disabled:1,state_id:value.state!.id});
        expect(()=>createPaperCapitalBook({profileId:target,bookId:f.uuid(800),commandId:f.uuid(801),openingUsd:'500',atMs:f.now()+1},copy)).toThrow();
        expect(copy.prepare('SELECT content_json FROM paper_capital_book_origins_v1').get()!['content_json']).toContain('"originProfileId":"main"');
      }finally{copy.close();}
    }finally{f.db.close();rmSync(root,{recursive:true,force:true});}
  });
});
