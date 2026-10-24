import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {dependencyManifest} from './build-study-manifests.mjs';
import {capitalContestManifestSchema} from '../packages/contracts/dist/index.js';
import {validateCapitalContest,contestWorkload} from '../packages/core/dist/index.js';
import {openDatabase,migrations,readContestResult} from '../packages/storage/dist/index.js';
import {runCapitalContest,offlineReplayContext,assertOfflineReplayProfile,loadContestData,exportCapitalContest,reconstructCapitalContestPath} from '../packages/services/dist/index.js';
const args=process.argv.slice(2);if(args[0]==='--')args.shift();
const option=name=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const runtime={codeRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceManifestHash:dependencyManifest(resolve('.'),'packages/services/src/research/capital-contest.ts').hash,lockfileHash:createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex')};
const command=args[0];
if(command==='identity'){console.log(JSON.stringify(runtime,null,2));process.exit(0);}
if(!command||args.includes('--help')){console.log('Offline capital contest: identity | validate | run | resume | report\nExplicit --manifest=JSON --profile-manifest=existing --profile-id=inactive-empty --database=current-schema\nrun/resume: --input-manifest=dedicated-panel --output-root=existing [--governance-database=read-only-original]\nreport: --output-root=existing. No acquire/register/freeze/final/activate/financial command.');process.exit(0);}
if(!['validate','run','resume','report'].includes(command))throw new Error('contest_command_refused');
for(const key of ['manifest','profile-manifest','profile-id','database'])if(!option(key))throw new Error(`Missing explicit ${key}`);
const manifestPath=realpathSync(option('manifest'));if(statSync(manifestPath).size>4*1024*1024)throw new Error('contest_manifest_bound');
const manifest=capitalContestManifestSchema.parse(JSON.parse(readFileSync(manifestPath,'utf8'))),id=validateCapitalContest(manifest);
const context=offlineReplayContext(resolve(option('profile-manifest')),option('profile-id'),resolve(option('database')),manifest.replay.workspaceId);
if(command!=='report'&&Object.entries(runtime).some(([k,v])=>manifest.replay[k]!==v))throw new Error('contest_runtime_mismatch_use_identity');
const database=realpathSync(option('database')),check=new DatabaseSync(database,{readOnly:true,allowExtension:false});
try{if(check.prepare('PRAGMA user_version').get()?.user_version!==migrations.at(-1).version)throw new Error('contest_existing_current_schema_required');}finally{check.close();}
const db=openDatabase(database,{skipMigrations:true});let governance;
try{
 assertOfflineReplayProfile(db,context);
 if(command==='validate')console.log(JSON.stringify({status:'specification_valid',manifestHash:id,cells:manifest.trials.length,paths:manifest.inference.resamples,cellReplays:manifest.trials.length*(manifest.inference.resamples+1),outputBudgetBytes:manifest.resources.maxOutputBytes,workload:contestWorkload(manifest),dataBodiesRead:false,runtime}));
 else{
  if(!option('output-root'))throw new Error('Explicit output root required');
  if(manifest.replay.exposure==='exposed_development'&&command!=='report'){if(!option('governance-database'))throw new Error('contest_governance_metadata_required');governance=new DatabaseSync(realpathSync(option('governance-database')),{readOnly:true,allowExtension:false});}
  const abort=new globalThis.AbortController(),cancel=()=>abort.abort();process.once('SIGINT',cancel);
  try{const result=command==='report'?readContestResult(id,db):await runCapitalContest({manifest,context,runtime,now:()=>Date.now(),resume:command==='resume',signal:abort.signal,...(governance?{governanceDb:governance}:{}),loadData:async()=>{if(!option('input-manifest'))throw new Error('Explicit input manifest required');return loadContestData(manifest,resolve(option('input-manifest')));}},db);
   if(!result)throw new Error('contest_complete_result_required');if(command==='report'&&option('path-index')){const reconstructed=await reconstructCapitalContestPath({runId:id,index:Number(option('path-index')),trialId:option('cell-id')??null,context,runtime,check(){if(abort.signal.aborted)throw new Error('contest_cancelled');}},db);console.log(JSON.stringify(reconstructed));}context.assertCurrent();console.log(JSON.stringify({id:result.id,manifestHash:id,choice:result.choice.status,candidate:result.choice.candidateId,directory:exportCapitalContest(manifest,result,resolve(option('output-root'))),confirmatoryEligible:false,liveExecutionPermitted:false}));
  }finally{process.removeListener('SIGINT',cancel);}
 }
}finally{governance?.close();db.close();}
