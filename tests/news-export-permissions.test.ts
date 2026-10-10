import { describe,it,expect } from 'vitest';
import { openDatabase,appendNewsExportPermission,newsEvidenceExportPermissionHash } from '../packages/storage/src/index.js';
const hash='a'.repeat(64);
const fixture={version:'news-export-permission-v1',profileId:'main',artifactHash:hash,decision:'allow',fields:['decision_hash','decision_time'],
  reviewedAtMs:10,expiresAtMs:30,termsUrl:'https://example.invalid/fixture-license',termsVersion:'fixture-only',
  termsEvidenceHash:'b'.repeat(64),ownerApprovalEvidenceHash:'c'.repeat(64),accountAuthorityEvidenceHash:null};
describe('explicit export authority fixtures, never provider rights evidence',()=>{
  it('denies absent, wrong-artifact/profile, partial fields, future/expired and missing account authority',()=>{
    const db=openDatabase(':memory:');
    try {
      const scope={profileId:'main',artifactHash:hash,atMs:20,fields:['decision_hash'] as const,accountEvidenceRequired:true};
      expect(newsEvidenceExportPermissionHash(scope,db)).toBeNull();
      appendNewsExportPermission(fixture,db);
      expect(newsEvidenceExportPermissionHash(scope,db)).toBeNull();
      const approval=appendNewsExportPermission({...fixture,reviewedAtMs:11,accountAuthorityEvidenceHash:'d'.repeat(64)},db);
      expect(newsEvidenceExportPermissionHash(scope,db)).toBe(approval);
      expect(newsEvidenceExportPermissionHash({...scope,atMs:10,accountEvidenceRequired:false},db)).toBeNull();
      for(const change of [{profileId:'00000000-0000-4000-8000-000000000001'},{artifactHash:'e'.repeat(64)},{atMs:9},{atMs:30},{fields:['outcome_hash'] as const}])
        expect(newsEvidenceExportPermissionHash({...scope,...change},db)).toBeNull();
      appendNewsExportPermission({...fixture,decision:'deny',reviewedAtMs:12},db);
      expect(newsEvidenceExportPermissionHash(scope,db)).toBeNull();
      expect(()=>db.exec('DELETE FROM news_export_permissions_v1')).toThrow('immutable');
    }finally{db.close();}
  });
  it('refuses unknown fields and detects stored permission corruption',()=>{
    const db=openDatabase(':memory:');
    try {
      expect(()=>appendNewsExportPermission({...fixture,fields:['raw_article_body']},db)).toThrow();
      appendNewsExportPermission(fixture,db);
      db.exec("DROP TRIGGER news_export_permissions_v1_no_update; UPDATE news_export_permissions_v1 SET body_json='{}'");
      expect(()=>newsEvidenceExportPermissionHash({profileId:'main',artifactHash:hash,atMs:20,fields:['decision_hash']},db)).toThrow('export_permission_integrity');
    }finally{db.close();}
  });
});
