import { existsSync,readFileSync,statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { appendNewsExportPermission } from '../packages/storage/dist/index.js';
const {values}=parseArgs({options:{database:{type:'string'},manifest:{type:'string'},'confirm-owner-reviewed':{type:'boolean',default:false}}});
let db;
try {
  if(!values['confirm-owner-reviewed']||!values.database||!values.manifest||!existsSync(values.database)||statSync(values.manifest).size>65_536)throw new Error('owner_review_required');
  // Explicit separate owner action only. Never migrate a database or activate a provider.
  db=new DatabaseSync(values.database,{allowExtension:false});
  if(db.prepare('PRAGMA user_version').get()?.user_version!==93)throw new Error('schema_compatibility_required');
  const manifest=JSON.parse(readFileSync(values.manifest,'utf8'));
  if(manifest.reviewedAtMs>Date.now()||manifest.expiresAtMs<=Date.now())throw new Error('permission_time_invalid');
  console.log(JSON.stringify({permissionHash:appendNewsExportPermission(manifest,db),scope:'explicit_export_only',providerActivation:false}));
}catch {console.error('Export permission not recorded. Requires an existing schema-93 profile and separately owner-reviewed G02/G07 manifest with --confirm-owner-reviewed.');process.exitCode=1;}
finally {db?.close();}
