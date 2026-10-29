import {readFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {setTimeout} from 'node:timers';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
const args=process.argv.slice(2);if(args[0]==='--')args.shift();
const option=name=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const action=args[0],reads=['inspect','coverage','development','report','identity','registry'],writes=['register','start','pause','continue','freeze','final','review','revoke','correction','assess-development','inspect-final'];
if(!action||args.includes('--help')){console.log(`P7 prospective shadow evidence (disabled until explicit owner review).
Read: identity | registry | inspect | coverage | development | report
Owner: register | start | pause | continue | assess-development | freeze | final | inspect-final | review | revoke | correction
All data commands require --database=existing --profile-id=ID --workspace=existing.
Owner commands also require --profile-manifest=existing --host-id=authoritative --request=JSON --approval=JSON --owner-reviewed.
start/continue require --source-directory=existing --duration-ms=1..3600000; this invocation owns the collector and releases its in-memory permit on exit. No boot enrollment or historical catch-up.
--prepare prints the exact approval digest without changing evidence. No default installed profile, migration, date change, provider or financial capability.`);process.exit(0);}
if(![...reads,...writes].includes(action))throw new Error('prospective_cli_action_refused');
const workspace=realpathSync(option('workspace')??(()=>{throw new Error('Explicit workspace required');})());
const {currentProspectiveRuntime}=await import(pathToFileURL(join(workspace,'apps/desktop/dist/main/capital-prospective-runtime.js')).href);
const runtime=currentProspectiveRuntime();
if(action==='identity'){console.log(JSON.stringify(runtime,null,2));process.exit(0);}
for(const name of ['database','profile-id'])if(!option(name))throw new Error(`Explicit ${name} required`);
const {createProspectiveReadService,createProspectiveGovernance,createProspectiveCollector,prospectiveRegistryIdentity}=await import('../packages/services/dist/index.js');
const {migrations,createFileProfileManifestStore,requireProspectiveScope}=await import('../packages/storage/dist/index.js');
const {capitalHash}=await import('../packages/core/dist/index.js');
const database=realpathSync(option('database')),profileId=option('profile-id'),mutating=writes.includes(action),db=new DatabaseSync(database,{readOnly:!mutating,allowExtension:false});
const boundedJson=(path,max=4*1024*1024)=>{const actual=realpathSync(path);if(!statSync(actual).isFile()||statSync(actual).size>max)throw new Error('prospective_cli_file_bound');return JSON.parse(readFileSync(actual,'utf8'));};
try{
 if(db.prepare('PRAGMA user_version').get().user_version!==migrations.at(-1).version)throw new Error('prospective_current_schema_required_no_cli_migration');
 if(!mutating){
  const service=createProspectiveReadService(profileId,db,Date.now,()=>runtime),id=option('registration-id');
  if(!['inspect','registry'].includes(action)&&!id)throw new Error('Explicit registration-id required');
  const result=action==='registry'?prospectiveRegistryIdentity(db):action==='inspect'?service.instances(50):action==='coverage'?service.coverage(id):action==='development'?service.development(id):service.report(id,option('report-id')??'');
  console.log(JSON.stringify(result,null,2));
 }else{
  for(const name of ['profile-manifest','host-id','request'])if(!option(name))throw new Error(`Explicit ${name} required`);
  const manifestPath=realpathSync(option('profile-manifest')),store=createFileProfileManifestStore(manifestPath),snapshot=store.read();
  if(!snapshot.ok||!snapshot.value)throw new Error('prospective_profile_manifest_unavailable');
  const record=snapshot.value.manifest.profiles.find(p=>p.id===profileId);
  if(snapshot.value.manifest.activeProfileId!==profileId||!record||realpathSync(resolve(dirname(manifestPath),record.dbFilename))!==database)throw new Error('prospective_active_profile_binding_required');
  const allowed=()=>{const current=store.read();return current.ok&&current.value?.revision===snapshot.value.revision&&realpathSync(option('database'))===database;};
  const request=boundedJson(option('request')),workspaceId=capitalHash({workspace}),hashAction=action==='assess-development'?'assess-development':action;
  const requestHash=capitalHash({profileId,workspaceId,action:hashAction,request}),designId=action==='register'?request.design.id:requireProspectiveScope(profileId,request.registrationId,db).design.id;
  if(option('prepare')!==undefined||args.includes('--prepare')){console.log(JSON.stringify({action:hashAction,requestHash,designId,workspaceId,runtime,...prospectiveRegistryIdentity(db),required:'Exact owner approval, independent reviewer and authoritative custody/exposure references. No command executed.'},null,2));}
  else{
   if(!args.includes('--owner-reviewed')||!option('approval'))throw new Error('prospective_explicit_owner_review_required');
   const approval=boundedJson(option('approval'),65536),governance=createProspectiveGovernance({profileId,workspaceId,hostId:option('host-id'),now:Date.now,runtime:()=>runtime,operationAllowed:allowed,approve:(kind,digest,id)=>approval.action===kind&&approval.requestHash===digest&&approval.designId===id?approval:null},db);
   try{
    if(action==='start'||action==='continue'){
     const duration=Number(option('duration-ms'));if(!Number.isSafeInteger(duration)||duration<1||duration>3600000||!option('source-directory'))throw new Error('prospective_explicit_collector_budget_required');
     const directory=realpathSync(option('source-directory')),started=governance[action](request),design=requireProspectiveScope(profileId,request.registrationId,db).design;
     const collector=createProspectiveCollector({profileId,database:db,now:Date.now,runtime:()=>runtime,permit:governance.permit,assertOperation(){if(!allowed())throw new Error('prospective_host_or_profile_unavailable');},source:{async acquire({slotMs,signal}){if(signal.aborted)throw new Error('prospective_acquisition_deadline');return boundedJson(join(directory,`${slotMs}.json`),design.resources.maxCaptureBytes);}}});
     console.log(JSON.stringify({...started,evidenceClass:'prospective_modeled_shadow',collector:'this_process_only',orders:false}));
     const end=Date.now()+duration;let stopped=false;const stop=()=>{stopped=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
     try{while(!stopped&&Date.now()<end){governance.heartbeat(request.registrationId);const slot=Math.floor(Date.now()/86400000)*86400000;
       if(slot>=design.startMs&&slot<=design.endMs&&Date.now()>=slot+design.protocol.completionDelayMs&&Date.now()<=slot+design.protocol.latenessMs)await collector.capture(request.registrationId,capitalHash({registrationId:request.registrationId,slot,protocol:design.protocol.hash}));
       await new Promise(done=>setTimeout(done,Math.min(1000,Math.max(1,end-Date.now()))));
      }}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
    }else{const method=action==='assess-development'?'assessDevelopment':action==='inspect-final'?'inspectFinalForReview':action;console.log(JSON.stringify(governance[method](request),null,2));}
   }finally{governance.disarm();}
  }
 }
}finally{db.close();}
