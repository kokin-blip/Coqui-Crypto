import { readFileSync, realpathSync, statSync, lstatSync, mkdirSync, renameSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { capitalHash, canonicalJson, capitalReplayCsv, validateCapitalReplay, type CapitalReplaySpecV1, type CapitalReplayTapeV1,
 type CapitalReplayResultV1, type CanonicalJsonValue, type ReplayMarketFrame } from '@coqui/core';
import { capitalReplayTapeSchema } from '@coqui/contracts';
import { queryMarketBarArchive, createFileProfileManifestStore, type Db } from '@coqui/storage';
import type { CapitalReplayContext } from './capital-replay.js';
const digest=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
function contained(root:string,path:string):string{
 const full=resolve(root,path),part=relative(root,full);if(!part||part.startsWith('..')||isAbsolute(part)||isAbsolute(path)||lstatSync(full).isSymbolicLink())throw new Error('replay_path_refused');
 const actual=realpathSync(full),actualPart=relative(root,actual);if(!actualPart||actualPart.startsWith('..')||isAbsolute(actualPart))throw new Error('replay_path_refused');return actual;
}
function jsonFile(path:string,max=1_000_000):unknown{if(!statSync(path).isFile()||statSync(path).size>max)throw new Error('replay_file_bound');return JSON.parse(readFileSync(path,'utf8'));}
export interface ReplayInputManifest {
 readonly version:1;readonly exposure:'synthetic'|'exposed_development';readonly provider:'coinbase'|'alpaca';
 readonly fromMs:number;readonly toMs:number;readonly warmupFromMs:number;readonly kind:'json_tape'|'archive_market';
 readonly file:{readonly path:string;readonly sha256:string;readonly bytes:number};readonly archives:readonly string[];
}
/** Manifest bounds are checked before verifier/query/data file reads, including whole-archive verification. */
export async function loadCapitalReplayTape(spec:CapitalReplaySpecV1,manifestPath:string,
 query:typeof queryMarketBarArchive=queryMarketBarArchive):Promise<CapitalReplayTapeV1>{
 const path=realpathSync(manifestPath),root=dirname(path),m=jsonFile(path) as ReplayInputManifest;
 if(m.version!==1||m.exposure!==spec.exposure||m.provider!==spec.provider||m.fromMs!==spec.fromMs||m.toMs!==spec.toMs||m.warmupFromMs!==spec.warmupFromMs||
  !['json_tape','archive_market'].includes(m.kind)||!spec.sourceRefs.includes(capitalHash(m))||!Array.isArray(m.archives)||m.archives.length>100)throw new Error('replay_data_boundary_mismatch');
 const directories=m.archives.map(p=>contained(root,p));
 if(m.kind==='json_tape'&&directories.length||m.kind==='archive_market'&&!directories.length)throw new Error('replay_archive_manifest_invalid');
 // Only metadata is read here. A physically mixed final archive is refused before query verifies any body.
 for(const directory of directories){
  const meta=jsonFile(join(directory,'manifest.json')) as {firstStartTimeMs:number;lastStartTimeMs:number;files:readonly {venue:string;interval:string}[]};
  if(!Number.isSafeInteger(meta.firstStartTimeMs)||!Number.isSafeInteger(meta.lastStartTimeMs)||meta.firstStartTimeMs<spec.warmupFromMs||meta.lastStartTimeMs>=spec.toMs||!Array.isArray(meta.files)||
   meta.files.some(f=>f.venue!==spec.provider||f.interval!=='1d'))throw new Error('replay_archive_outside_development');
 }
 const file=contained(root,m.file.path);if(!Number.isSafeInteger(m.file.bytes)||m.file.bytes<1||m.file.bytes>64*1024*1024||statSync(file).size!==m.file.bytes)throw new Error('replay_file_bound');
 const data=readFileSync(file);if(digest(data)!==m.file.sha256)throw new Error('replay_file_hash_mismatch');
 let tape:CapitalReplayTapeV1;
 if(m.kind==='json_tape')tape=capitalReplayTapeSchema.parse(JSON.parse(data.toString('utf8')));
 else{
  const days=new Map<number,Record<string,ReplayMarketFrame['assets'][string]>>(),seen=new Map<string,string>();
  for(const directory of directories)for(const row of await query(directory,{startTimeMs:spec.fromMs,endTimeMs:spec.toMs,interval:'1d'})){
   const assetId=`${row.venue}|${row.productType}|${row.productId}`;
   if(row.source!==spec.provider||row.venue!==spec.provider||row.quality!=='reported_ohlc'||!row.isComplete||row.startTimeMs<spec.fromMs||row.endTimeMs>spec.toMs)throw new Error('replay_archive_row_invalid');
   if(!spec.assets.includes(assetId))continue;
   const key=`${assetId}:${row.startTimeMs}`,hash=capitalHash(row),prior=seen.get(key);if(prior&&prior!==hash)throw new Error('replay_archive_conflict');if(prior)continue;seen.set(key,hash);
   const assets=days.get(row.startTimeMs)??{};assets[assetId]={openUsd:row.open,closeUsd:row.close,bidUsd:null,askUsd:null,quoteAtMs:null,tradable:true,sourceRef:`archive:${hash}`};days.set(row.startTimeMs,assets);
  }
  tape=capitalReplayTapeSchema.parse({market:[...days].sort(([a],[b])=>a-b).map(([atMs,assets])=>({atMs,endMs:atMs+86_400_000,assets})),decisions:JSON.parse(data.toString('utf8'))});
 }
 validateCapitalReplay(spec,tape);return tape;
}
/** An existing inactive, empty profile is required. No profile creation/switch, migration or authority. */
export function offlineReplayContext(manifestPath:string,profileId:string,databasePath:string,workspaceId:string):CapitalReplayContext{
 const path=realpathSync(manifestPath),database=realpathSync(databasePath),store=createFileProfileManifestStore(path),initial=store.read();
 if(!initial.ok||!initial.value||initial.value.manifest.activeProfileId===profileId)throw new Error('replay_inactive_profile_required');
 const record=initial.value.manifest.profiles.find(p=>p.id===profileId);
 if(!record||record.coinbaseKeyFingerprint||record.coinbasePortfolioFingerprint||realpathSync(resolve(dirname(path),record.dbFilename))!==database)throw new Error('replay_profile_binding_invalid');
 return {profileId,workspaceId,assertCurrent(){const current=store.read();if(!current.ok||!current.value||current.value.revision!==initial.value!.revision||current.value.manifest.activeProfileId===profileId||realpathSync(databasePath)!==database)throw new Error('replay_lifecycle_changed');}};
}
/** Reject protected interval overlap using metadata only; never deserialize final result bodies. */
export function assertReplayDevelopmentBoundary(spec:CapitalReplaySpecV1,db:Db):void{
 if(spec.exposure==='synthetic')return;
 const count=Number(db.prepare("SELECT COUNT(*) AS n FROM research_integrity_events WHERE kind IN ('plan','final_claim')").get()?.['n']);
 if(count>1000||Number(db.prepare('SELECT COUNT(*) AS n FROM research_preregistrations').get()?.['n'])>1000)throw new Error('replay_governance_metadata_bound');
 const claims=db.prepare("SELECT body_json FROM research_integrity_events WHERE kind='final_claim'").all() as {body_json:string}[];
 for(const row of claims){const c=JSON.parse(row.body_json) as {startMs:number;endExclusiveMs:number;assets:readonly string[]};if(c.startMs<spec.toMs&&spec.warmupFromMs<c.endExclusiveMs&&c.assets.some(a=>spec.assets.includes(a)))throw new Error('replay_consumed_holdout_overlap');}
 type Plan={validation:{development:{startMs:number;endExclusiveMs:number};holdout:{startMs:number;endExclusiveMs:number}};execution:{baseTargets:readonly {assetId:string}[]}};
 const legacy=db.prepare('SELECT plan_hash AS id,plan_json AS body FROM research_preregistrations').all() as {id:string;body:string}[];
 const integrity=db.prepare("SELECT namespace AS id,body_json AS body FROM research_integrity_events WHERE kind='plan'").all() as {id:string;body:string}[];
 let allowed=false;
 for(const row of [...legacy,...integrity]){
  const p=JSON.parse(row.body) as Plan;
  if(p.validation.holdout.startMs<spec.toMs&&spec.warmupFromMs<p.validation.holdout.endExclusiveMs&&p.execution.baseTargets.some(a=>spec.assets.includes(a.assetId)))throw new Error('replay_registered_holdout_overlap');
  if(spec.sourceRefs.includes(row.id)&&p.validation.development.startMs<=spec.warmupFromMs&&p.validation.development.endExclusiveMs>=spec.toMs&&spec.assets.every(a=>p.execution.baseTargets.some(t=>t.assetId===a)))allowed=true;
 }
 if(!allowed)throw new Error('replay_development_metadata_missing');
}

export function exportCapitalReplay(result:CapitalReplayResultV1,spec:CapitalReplaySpecV1,outputRoot:string):string{
 if(capitalHash(spec)!==result.specHash)throw new Error('replay_export_spec_mismatch');
 const root=realpathSync(outputRoot);if(!statSync(root).isDirectory())throw new Error('replay_output_root_invalid');
 const target=join(root,result.id),payload=canonicalJson(result as unknown as CanonicalJsonValue)+'\n';
 if(existsSync(target)){if(lstatSync(target).isSymbolicLink()||readFileSync(join(target,'result.json'),'utf8')!==payload||readFileSync(join(target,'spec.json'),'utf8')!==canonicalJson(spec as unknown as CanonicalJsonValue)+'\n')throw new Error('replay_export_conflict');return target;}
 const temporary=join(root,`.replay-${randomUUID()}`);mkdirSync(temporary);
 try{writeFileSync(join(temporary,'spec.json'),canonicalJson(spec as unknown as CanonicalJsonValue)+'\n',{flag:'wx'});writeFileSync(join(temporary,'result.json'),payload,{flag:'wx'});writeFileSync(join(temporary,'summary.csv'),capitalReplayCsv(result),{flag:'wx'});renameSync(temporary,target);return target;}
 catch(error){rmSync(temporary,{recursive:true,force:true});throw error;}
}
