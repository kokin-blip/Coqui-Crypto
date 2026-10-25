import { describe, it, expect } from 'vitest';
import { openDatabase, getPaperCapitalBook, paperReserveBinding, listPaperBalances, getPaperBookOrigin, currentBudget } from '@coqui/storage';
import { createPaperCapitalBook, capturePaperCapitalEvidence } from '@coqui/services';
const input={profileId:'main',bookId:'31fda7d7-2a8c-4ef4-9e07-8b731c9dad3d',commandId:'5f3efaa1-f8a9-4118-b9a0-cdb59797703a',openingUsd:'500',atMs:1000};
describe('P6 explicit cash origin and additive migration',()=>{
  it('starts empty, atomically creates $500 in the existing ledger and P1/P2; exact retry returns original',()=>{
    const db=openDatabase(':memory:');try {
      expect(db.prepare('PRAGMA user_version').get()?.['user_version']).toBe(99);expect(getPaperCapitalBook('main',db)).toBeNull();
      const book=createPaperCapitalBook(input,db),binding=paperReserveBinding('main',db)!;
      expect(binding).toMatchObject({disabled:1,archived:0,policy_id:null,state_id:null});expect(getPaperBookOrigin('main',db)).toBeNull();
      expect(listPaperBalances('main',db)).toMatchObject([{assetId:'USD',quantity:'500'}]);
      expect(currentBudget(binding.scope_id,1000,db)).toMatchObject({equityUsd:'500',activeEquityUsd:'500',spendableUsd:'500'});
      expect(createPaperCapitalBook(input,db)).toEqual(book);expect(()=>createPaperCapitalBook({...input,openingUsd:'500.00'},db)).toThrow('conflict');expect(()=>createPaperCapitalBook({...input,openingUsd:'600'},db)).toThrow('conflict');
      const f=capturePaperCapitalEvidence('main',1001,{},db).financial;expect(f.economicPnlUsd).toMatchObject({state:'available',value:'0'});
      expect(()=>db.exec('DELETE FROM paper_capital_book_origins_v1')).toThrow('immutable');
    } finally {db.close();}
  });
  it('rolls funding and P1 back when origin insert fails',()=>{
    const db=openDatabase(':memory:');try {db.exec("CREATE TEMP TRIGGER fail_origin BEFORE INSERT ON paper_capital_book_origins_v1 BEGIN SELECT RAISE(ABORT,'injected'); END;");
      expect(()=>createPaperCapitalBook(input,db)).toThrow('injected');expect(listPaperBalances('main',db)).toEqual([]);
      expect(db.prepare('SELECT COUNT(*) n FROM capital_scopes_v1').get()?.['n']).toBe(0);
    }finally{db.close();}
  });
});
