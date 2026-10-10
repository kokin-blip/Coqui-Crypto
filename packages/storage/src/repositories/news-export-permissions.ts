import { newsExportPermissionSchema, type newsExportFields } from '@coqui/contracts';
import { canonicalJson,sha256Hex } from '@coqui/core';
import type { Db } from '../sqlite/index.js';
type Field = typeof newsExportFields[number];
/** Administrative CLI only after G02/G07 review; no IPC grant exists. */
export function appendNewsExportPermission(input:unknown,db:Db) {
  const permission=newsExportPermissionSchema.parse(input),body=canonicalJson(permission),hash=sha256Hex(body);
  db.prepare('INSERT OR IGNORE INTO news_export_permissions_v1(id,profile_id,artifact_hash,reviewed_at,body_json,content_hash) VALUES(?,?,?,?,?,?)')
    .run(hash,permission.profileId,permission.artifactHash,permission.reviewedAtMs,body,hash);
  return hash;
}
export function newsEvidenceExportPermissionHash(input:{profileId:string;artifactHash:string;atMs:number;fields:readonly Field[];accountEvidenceRequired?:boolean},db:Db) {
  const row=db.prepare('SELECT body_json,content_hash FROM news_export_permissions_v1 WHERE profile_id=? AND artifact_hash=? ORDER BY reviewed_at DESC,rowid DESC LIMIT 1')
    .get(input.profileId,input.artifactHash) as {body_json:string;content_hash:string}|undefined;
  if(!row)return null;
  if(sha256Hex(row.body_json)!==row.content_hash)throw new Error('export_permission_integrity');
  const p=newsExportPermissionSchema.parse(JSON.parse(row.body_json));
  return p.profileId===input.profileId&&p.artifactHash===input.artifactHash&&p.reviewedAtMs<=input.atMs&&
    p.decision==='allow'&&p.expiresAtMs>input.atMs&&(!input.accountEvidenceRequired||p.accountAuthorityEvidenceHash!==null)&&
    input.fields.every(f=>p.fields.includes(f)) ? row.content_hash : null;
}
