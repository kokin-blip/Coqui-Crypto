import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { dependencyManifest } from './build-study-manifests.mjs';
import { capitalReplaySpecSchema } from '../packages/contracts/dist/index.js';
import { capitalHash } from '../packages/core/dist/index.js';
import { openDatabase, migrations, readReplayResult } from '../packages/storage/dist/index.js';
import { runCapitalReplay, offlineReplayContext, loadCapitalReplayTape, exportCapitalReplay, assertOfflineReplayProfile } from '../packages/services/dist/index.js';
const help=`Usage: pnpm research:capital-replay -- <validate|replay|report> [options]
--spec=<JSON> --profile-manifest=<existing manifest> --profile-id=<inactive empty profile>
--database=<that profile DB> --input-manifest=<separate development input manifest>
--output-root=<existing directory> --retry (explicit new attempt after failure)
--governance-database=<read-only original study metadata DB; required for exposed development>
--identity prints current runtime identity without opening data or a database.
Offline simulated evidence only. No profile creation/switch, migration, provider, register/freeze/final or trading command.`;
const args=process.argv.slice(2);if(args[0]==='--')args.shift();
const option=name=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const runtime={codeRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceManifestHash:dependencyManifest(resolve('.'),'packages/services/src/research/capital-replay.ts').hash,lockfileHash:createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex')};
if(args.includes('--identity')){console.log(JSON.stringify(runtime,null,2));process.exit(0);}
const command=args[0];if(!command||args.includes('--help')){console.log(help);process.exit(0);}
if(!['validate','replay','report'].includes(command))throw new Error('replay_command_refused');
for(const name of ['spec','profile-manifest','profile-id','database'])if(!option(name))throw new Error(`Missing explicit ${name}`);
const specFile=realpathSync(option('spec'));if(statSync(specFile).size>1_000_000)throw new Error('replay_spec_bound');
const spec=capitalReplaySpecSchema.parse(JSON.parse(readFileSync(specFile,'utf8')));
const context=offlineReplayContext(resolve(option('profile-manifest')),option('profile-id'),resolve(option('database')),spec.workspaceId);
if(Object.entries(runtime).some(([k,v])=>spec[k]!==v)&&command!=='report')throw new Error('replay_runtime_mismatch_use_identity');
const databasePath=realpathSync(option('database')),checkDb=new DatabaseSync(databasePath,{readOnly:true,allowExtension:false});
try{if(checkDb.prepare('PRAGMA user_version').get()?.user_version!==migrations.at(-1).version)throw new Error('replay_existing_current_schema_required');}finally{checkDb.close();}
const db=openDatabase(databasePath,{skipMigrations:true});let governance;
try{
 assertOfflineReplayProfile(db,context);
 if(command==='validate'){console.log(JSON.stringify({status:'spec_valid',specHash:capitalHash(spec),cells:spec.cells.length,runtime,dataBodiesRead:false}));}
 else{
  if(!option('output-root'))throw new Error('Explicit output root required');
  const abort=new globalThis.AbortController(),cancel=()=>abort.abort();process.once('SIGINT',cancel);
  try{
   if(spec.exposure==='exposed_development'&&command==='replay'){
    if(!option('governance-database'))throw new Error('replay_governance_metadata_required');
    governance=new DatabaseSync(realpathSync(option('governance-database')),{readOnly:true,allowExtension:false});
   }
   const result=command==='report'?readReplayResult(capitalHash(spec),db):await runCapitalReplay({spec,context,runtime,now:()=>Date.now(),retry:args.includes('--retry'),signal:abort.signal,
    ...(governance?{governanceDb:governance}:{}),loadTape:async()=>{if(!option('input-manifest'))throw new Error('Explicit development input manifest required');return loadCapitalReplayTape(spec,resolve(option('input-manifest')));}},db);
   if(!result)throw new Error('replay_completed_result_required');context.assertCurrent();console.log(JSON.stringify({id:result.id,specHash:result.specHash,cells:result.cells.length,directory:exportCapitalReplay(result,spec,resolve(option('output-root'))),mode:result.mode}));
  }finally{process.removeListener('SIGINT',cancel);}
 }
}finally{governance?.close();db.close();}
