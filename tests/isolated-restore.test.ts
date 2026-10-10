import { createHash } from 'node:crypto';
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe,it,expect } from 'vitest';
import { openDatabase,backupDatabase,verifyIsolatedRestore,appendIntegrityEvent } from '../packages/storage/src/index.js';
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
describe('isolated disposable restore proof',()=>{
  it('preserves the original snapshot, verifies supplied artifacts and refuses corruption and overwrite',()=>{
    const root=mkdtempSync(join(tmpdir(),'coqui-restore-')),source=join(root,'backup.db'),artifact=join(root,'report.json'),db=openDatabase(':memory:');
    try {
      db.exec("INSERT INTO paper_ledger_entries_v3(id,profile_id,run_id,account,asset_id,amount_usd_text,quantity_text,at) VALUES ('opening','main','fixture','opening','USD','-1000.0000000000001','0',1),('cash','main','fixture','cash','USD','1000.0000000000001','1000.0000000000001',1)");
      appendIntegrityEvent({namespace:'fixture',kind:'negative_result',key:'preserved',atMs:1,body:{fixture:true}},db);
      backupDatabase(db,source);writeFileSync(artifact,'{"fixture":true}');
      const input={sourceDatabase:source,disposableRoot:root,destination:join(root,'restored'),expectedDatabaseHash:hash(source),schemaVersion:92,buildIdentity:'fixture-only',artifacts:[{path:artifact,hash:hash(artifact)}]};
      const proof=verifyIsolatedRestore(input);
      expect(proof).toMatchObject({schemaVersion:92,credentialsIncluded:false,ledgerTotalUsd:'0',scope:'explicit_database_and_supplied_artifacts'});
      expect(proof.ledgerRows).toBe(2);expect(proof.integrityEventKinds).toBe(1);
      expect(hash(source)).toBe(input.expectedDatabaseHash);
      expect(()=>verifyIsolatedRestore(input)).toThrow();
      expect(()=>verifyIsolatedRestore({...input,destination:join(root,'wrong-schema'),schemaVersion:91})).toThrow('restore_database_invalid');
      writeFileSync(artifact,'corrupt');
      expect(()=>verifyIsolatedRestore({...input,destination:join(root,'bad-artifact')})).toThrow('restore_artifact_invalid');
      expect(()=>verifyIsolatedRestore({...input,destination:join(root,'bad-db'),expectedDatabaseHash:'a'.repeat(64)})).toThrow('backup_hash_mismatch');
      const invalid=join(root,'invalid-ledger.db');
      db.prepare("INSERT INTO paper_ledger_entries_v3(id,profile_id,run_id,account,amount_usd_text,quantity_text,at) VALUES('unbalanced','main','fixture','cash','0.01','0',2)").run();
      backupDatabase(db,invalid);
      expect(()=>verifyIsolatedRestore({...input,sourceDatabase:invalid,destination:join(root,'unbalanced'),expectedDatabaseHash:hash(invalid),artifacts:[]})).toThrow('restore_ledger_unbalanced');
      db.exec("CREATE TABLE fixture_parent(id TEXT PRIMARY KEY); CREATE TABLE fixture_child(id TEXT REFERENCES fixture_parent(id)); PRAGMA foreign_keys=OFF; INSERT INTO fixture_child VALUES('missing');");
      const broken=join(root,'broken-fk.db');backupDatabase(db,broken);
      expect(()=>verifyIsolatedRestore({...input,sourceDatabase:broken,destination:join(root,'broken-fk'),expectedDatabaseHash:hash(broken),artifacts:[]})).toThrow('restore_database_invalid');
    }finally{db.close();rmSync(root,{recursive:true,force:true});}
  });
});
