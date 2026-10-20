// Read-only installed-adapter network check. Credentials and account data stay in memory.
import { app } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
const installed='/Applications/Coqui.app/Contents/Resources/app.asar';
app.setPath('userData',mkdtempSync(join(tmpdir(),'coqui-network-check-')));
const guard=setTimeout(()=>{console.log('{"failure":"probe_deadline"}');app.exit(1);},50000);
async function run(){
  const load=path=>import(pathToFileURL(join(installed,path)));
  const {createOsKeyringSecretStore,createAlpacaPaperClient}=await load('node_modules/@coqui/adapters/dist/index.js');
  const {parallelPaperFailureDetail}=await load('node_modules/@coqui/services/dist/paper/parallel-paper-utils.js');
  const {parallelQuotes}=await load('node_modules/@coqui/services/dist/paper/parallel-paper-intraday.js');
  const db=new DatabaseSync(join(app.getPath('appData'),'@coqui/desktop/coqui.db'),{readOnly:true,allowExtension:false});
  let experiment;
  try{experiment=db.prepare('SELECT profile_id,alpaca_account_id,started_at FROM parallel_paper_experiments_v1 ORDER BY started_at DESC LIMIT 1').get();}
  finally{db.close();}
  if(!experiment)throw new Error('no_paper_experiment');
  const secret=await createOsKeyringSecretStore().read('alpaca-paper-credentials',experiment.profile_id);
  if(!secret.ok||!secret.value)throw new Error('credentials_unavailable');
  const credentials=JSON.parse(secret.value), attempts=[];
  const client=createAlpacaPaperClient(credentials,globalThis.fetch,undefined,attempt=>attempts.push(attempt));
  const results=[];
  for(const [operation,read] of [
    ['account',async()=>{const result=await client.account();if(result.id!==experiment.alpaca_account_id)throw new Error('alpaca_account_changed');}],
    ['orders',async()=>{await client.orders();}],
    ['positions',async()=>{await client.positions();}],
    ['activities',async()=>{await client.activities(new Date(experiment.started_at).toISOString());}],
    ['quote',async()=>{const raw=await client.latestCryptoQuotes(['BTC/USD','ETH/USD','LTC/USD']);
      try{parallelQuotes(raw,Date.now(),['BTCUSD','ETHUSD','LTCUSD']);return 'fresh';}
      catch(error){return parallelPaperFailureDetail(error,'quote_validation_unavailable').reason;}}],
  ]){
    const started=Date.now();
    try{const quoteValidation=await read();results.push({operation,received:true,elapsedMs:Date.now()-started,...(quoteValidation?{quoteValidation}:{})});}
    catch(error){results.push({operation,received:false,...parallelPaperFailureDetail(error,'probe_unavailable')});}
  }
  const build=JSON.parse(readFileSync(join(installed,'dist/main/build-info.json'),'utf8'));
  const result={observedAtUtc:new Date().toISOString(),installedVersion:build.version,sourceHash:build.sourceHash,
    results,attempts:attempts.map(a=>({operation:a.operation,status:a.status,attemptCount:a.attemptCount,
      elapsedMs:a.elapsedMs,reason:a.reason,httpStatus:a.httpStatus,networkCode:a.networkCode??null})),
    orderMutations:0,profileWrites:0,limitations:['This bounded probe uses the installed adapter under matching Electron; it is separate from the running app connection.','Success now does not rule out intermittent failures later.']};
  writeFileSync(new URL('./network-followup-probe.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}
app.whenReady().then(run).then(()=>{clearTimeout(guard);app.exit(0);}).catch(()=>{
  console.log('{"failure":"redacted_probe_failure"}');clearTimeout(guard);app.exit(1);
});
