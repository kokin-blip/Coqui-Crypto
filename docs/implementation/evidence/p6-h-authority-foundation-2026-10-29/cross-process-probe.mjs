// Requires an explicitly supplied, built source closure. Creates disposable synthetic journals only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('explicit_built_source_closure_required');
const root = resolve(process.argv[2]);
const storageUrl = pathToFileURL(join(root,'packages/storage/dist/index.js')).href;
const coreUrl = pathToFileURL(join(root,'packages/core/dist/index.js')).href;
const runtimeUrl = pathToFileURL(join(root,'packages/services/dist/paper/account-capital-runtime.js')).href;
const storage = await import(storageUrl), core = await import(coreUrl), runtime = await import(runtimeUrl);
const directory = mkdtempSync(join(tmpdir(),'coqui-authority-process-'));
const path = join(directory,'journal.sqlite'), registryId = core.sha256Hex('disposable-registry');
const journal = storage.createAccountAuthorityJournal({path,registryId,atMs:0});
const workers = [];
const childCode = `
 const [storageUrl,path,registryId,serialized,crash] = process.argv.slice(1);
 const s = await import(storageUrl), j = s.openAccountAuthorityJournal(path,registryId), command = JSON.parse(serialized);
 const go = new Promise(resolve => process.once('message',resolve));
 process.send({kind:'ready'}); await go;
 let result;
 try { result = {kind:'recorded',head:s.recordAccountAuthorityCommand(j,command)}; }
 catch(error) { result = {kind:'refused',reason:error.message}; }
 j.close();
 if(crash==='yes') process.exit(31);
 await new Promise((resolve,reject) => process.send(result,error => error ? reject(error) : resolve()));
 process.exit(0);
`;
function worker(command, crash = false) {
  const child = spawn(process.execPath,['--input-type=module','-e',childCode,storageUrl,path,registryId,JSON.stringify(command),crash?'yes':'no'],
    {stdio:['ignore','ignore','pipe','ipc']});
  workers.push(child);
  let result, stderr = '';
  child.stderr.on('data',chunk => { stderr += chunk; });
  const ready = new Promise((resolve,reject) => {
    child.on('error',reject);
    child.on('message',message => { if(message.kind==='ready')resolve();else result=message; });
    child.on('exit',code => { if(code!==0&&code!==31)reject(new Error(stderr||`worker_exit_${code}`)); });
  });
  const done = new Promise((resolve,reject) => {
    child.on('error',reject);
    child.on('exit',code => code===0||code===31 ? resolve({code,result}) : reject(new Error(stderr||`worker_exit_${code}`)));
  });
  return {child,ready,done};
}
function command(name,scopeId,expectedHeadId,profileId,action) {
  return {id:core.sha256Hex(name),scopeId,expectedHeadId,profileId,hostIdentityHash:core.sha256Hex(profileId),atMs:10,action};
}
try {
  const accountHash = core.sha256Hex('synthetic-race-account'), scopeId = core.capitalScopeId('alpaca','paper',accountHash);
  const opening = storage.recordAccountAuthorityCommand(journal,command('open',scopeId,null,'profile-a',{kind:'record_scope',accountIdentityHash:accountHash}));
  const clonePath = join(directory,'independent-copy.sqlite'); storage.backupAccountAuthorityJournal(journal,clonePath);
  const requests = ['profile-a','profile-b'].map(profile => command(profile,scopeId,opening.id,profile,{kind:'acquire_preparation',durationMs:1000}));
  const pair = requests.map(request => worker(request));
  await Promise.all(pair.map(item => item.ready)); pair.forEach(item => item.child.send('go'));
  const outcomes = await Promise.all(pair.map(item => item.done));
  assert.equal(outcomes.filter(item => item.result?.kind==='recorded').length,1);
  assert.equal(outcomes.filter(item => item.result?.reason==='account_authority_stale_head').length,1);
  const winner = outcomes.findIndex(item => item.result?.kind==='recorded');
  assert.deepEqual(storage.recordAccountAuthorityCommand(journal,requests[winner]),outcomes[winner].result.head);
  // Another physical copy can still prepare independently. The view must never turn that into ownership.
  const clone = storage.openAccountAuthorityJournal(clonePath,registryId);
  try {
    storage.recordAccountAuthorityCommand(clone,requests[1-winner]);
    assert.equal(runtime.createAccountCapitalAuthorityReadPort(clone).read(scopeId,11).executionPermitted,false);
    assert.equal(runtime.createAccountCapitalAuthorityReadPort(journal).read(scopeId,11).executionPermitted,false);
  } finally { clone.close(); }

  const crashHash = core.sha256Hex('synthetic-lost-ack-account'), crashScope = core.capitalScopeId('alpaca','paper',crashHash);
  const crashOpening = storage.recordAccountAuthorityCommand(journal,command('crash-open',crashScope,null,'profile-a',{kind:'record_scope',accountIdentityHash:crashHash}));
  const request = command('lost-ack',crashScope,crashOpening.id,'profile-a',{kind:'acquire_preparation',durationMs:1000});
  const lost = worker(request,true); await lost.ready; lost.child.send('go');
  const lostResult = await lost.done; assert.equal(lostResult.code,31); assert.equal(lostResult.result,undefined);
  const durable = storage.getAccountAuthorityHead(journal,crashScope);
  assert.equal(durable.generation,1);
  assert.deepEqual(storage.recordAccountAuthorityCommand(journal,request),durable);
  const view = runtime.createAccountCapitalAuthorityReadPort(journal).read(crashScope,11);
  assert.equal(view.executionPermitted,false); assert.equal(view.financialClaimsFunded,false);
  console.log(JSON.stringify({crossProcessSameHeadRace:'pass',lostAcknowledgementRetry:'pass',
    independentCopyCannotGrantAuthority:'pass',
    executionPermitted:false,financialClaimsFunded:false,providerCalls:false,installedProfilesOpened:false}));
} finally {
  for (const worker of workers) if(worker.exitCode===null)worker.kill();
  journal.close(); rmSync(directory,{recursive:true,force:true});
}
