// Read-only diagnostic: installed adapter + native keyring; no app runtime/scheduler.
// Only pinned Alpaca paper GET requests. Credentials and provider IDs never leave memory.
import { app } from 'electron';
import { URL, URLSearchParams } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const installed='/Applications/Coqui.app/Contents/Resources/app.asar';
const output=new URL('./rea-broker-fee-probe.json',import.meta.url);
app.setPath('userData',mkdtempSync(join(tmpdir(),'coqui-rea-fees-')));
const guard=setTimeout(()=>{console.log('{"failure":"probe_deadline"}');app.exit(1);},55000);
let stage='loading_installed_modules';
async function run(){
  const load=p=>import(pathToFileURL(join(installed,p)));
  const {createOsKeyringSecretStore,createAlpacaPaperClient}=await load('node_modules/@coqui/adapters/dist/index.js');
  const {validateParallelPositions}=await load('node_modules/@coqui/services/dist/paper/parallel-paper-recovery.js');
  stage='loading_database_driver';
  const require=createRequire(join(installed,'package.json'));
  const {Decimal}=require('decimal.js');
  stage='reading_profile';
  const db=new DatabaseSync(join(app.getPath('appData'),'@coqui/desktop/coqui.db'),{readOnly:true,allowExtension:false});
  let experiment,events;
  try {
    db.exec('BEGIN');
    experiment=db.prepare('SELECT * FROM parallel_paper_experiments_v1 ORDER BY started_at DESC LIMIT 1').get();
    events=db.prepare('SELECT id,kind,at,detail_json FROM parallel_paper_events_v1 WHERE experiment_id=? ORDER BY at,rowid').all(experiment.id)
      .map(e=>({id:e.id,kind:e.kind,at:e.at,detail:JSON.parse(e.detail_json)}));
  }finally{db.close();}
  stage='reading_paper_credentials';
  const secret=await createOsKeyringSecretStore().read('alpaca-paper-credentials',experiment.profile_id);
  if(!secret.ok||!secret.value)throw new Error('credentials_unavailable');
  const credentials=JSON.parse(secret.value);
  const client=createAlpacaPaperClient(credentials);
  const after=new Date(new Date(experiment.started_at).toISOString().slice(0,10)).toISOString();
  let requestCount=0;
  async function pages(read){
    let cursor;const all=[];
    for(let page=0;page<5;page++){
      requestCount++;const rows=await read(cursor);
      if(!Array.isArray(rows))throw new Error('invalid_array');
      all.push(...rows);if(rows.length<100)return all;
      const next=rows.at(-1).id;if(next===cursor)throw new Error('repeated_cursor');cursor=next;
    }
    throw new Error('probe_page_limit');
  }
  async function alternate(types,cursor,includeAfter=true){
    const url=new URL('https://paper-api.alpaca.markets/v2/account/activities');
    url.search=new URLSearchParams({direction:'asc',page_size:'100',...(includeAfter?{after}:{}),...(types?{activity_types:types}:{}),...(cursor?{page_token:cursor}:{})}).toString();
    const response=await globalThis.fetch(url,{method:'GET',redirect:'error',signal:globalThis.AbortSignal.timeout(10000),headers:{'APCA-API-KEY-ID':credentials.keyId,'APCA-API-SECRET-KEY':credentials.secretKey}});
    if(!response.ok)throw new Error('provider_http_'+response.status);
    return await response.json();
  }
  stage='reading_standard_activities';
  const standard=await pages(cursor=>client.activities(after,cursor));
  stage='reading_alternate_activities';
  const feeOnly=await pages(cursor=>alternate('CFEE,FEE',cursor));
  const unfiltered=await pages(cursor=>alternate(null,cursor));
  const feeNoAfter=await pages(cursor=>alternate('CFEE,FEE',cursor,false));
  stage='reading_account_and_positions';
  requestCount++;const account=await client.account();
  if(account.id!==experiment.alpaca_account_id)throw new Error('account_identity_mismatch');
  requestCount++;const positions=await client.positions();
  const ledgerFees=events.filter(e=>e.kind==='external_fee');
  const ledgerFills=events.filter(e=>e.kind==='external_fill');
  const feeIds=new Set(ledgerFees.map(e=>e.detail.activityId));
  const fillIds=new Set(ledgerFills.map(e=>e.detail.activityId));
  const fees=standard.filter(a=>['CFEE','FEE'].includes(a.activity_type));
  const fills=standard.filter(a=>a.activity_type==='FILL');
  const standardIds=new Set(standard.map(a=>a.id));
  const changes=fees.filter(a=>{const e=ledgerFees.find(e=>e.detail.activityId===a.id);return e&&['symbol','qty','price','net_amount','date','transaction_time','status'].some((key,i)=>(a[key]??null)!==(e.detail[['symbol','quantity','price','netAmount','date','at','status'][i]]??null));});
  let differences=[],validationResult='matched';
  try{await validateParallelPositions({positions:async()=>positions},events);}
  catch(e){if(e.message!=='broker_positions_mismatch')throw new Error('position_validation_failed',{cause:e});differences=e.positionDifferences??[];validationResult=differences.length?'quantity_mismatch':'ledger_validation_failed';}
  // Error fields differ across versions: latest recorded differences also retained as historical evidence.
  const historical=events.findLast(e=>e.kind==='reconciliation_error'&&e.detail.positionDifferences?.length)?.detail.positionDifferences??[];
  const today=new Date().toISOString().slice(0,10);
  const todayBuys=fills.filter(a=>a.side==='buy'&&a.transaction_time?.startsWith(today));
  const expectedFees={};
  for(const f of todayBuys){const s=f.symbol.replaceAll('/','');expectedFees[s]=new Decimal(expectedFees[s]??0).plus(new Decimal(f.qty).times('.0025')).toString();}
  const grouped={};for(const a of unfiltered)grouped[a.activity_type]=(grouped[a.activity_type]??0)+1;
  const state=events.findLast(e=>['paused','resumed','started','stopped'].includes(e.kind));
  const build=JSON.parse(require('node:fs').readFileSync(join(installed,'package.json'),'utf8'));
  const result={observedAt:new Date().toISOString(),installedVersion:build.version,probeElectronVersion:app.getVersion(),profileWrites:0,orderMutations:0,requestCount,accountIdentityMatches:true,after,
    journal:{feeCount:ledgerFees.length,fillCount:ledgerFills.length,submissionAttempts:events.filter(e=>e.kind==='submit_attempt').length,lastState:state?.kind},
    provider:{standardCount:standard.length,feeCount:fees.length,fillCount:fills.length,feeOnlyCount:feeOnly.length,feeWithoutAfterCount:feeNoAfter.length,
      feeWithoutAfterMissingFromStandard:feeNoAfter.filter(a=>!standardIds.has(a.id)).length,unfilteredCount:unfiltered.length,unfilteredTypes:grouped,
      feeOnlyMissingFromStandard:feeOnly.filter(a=>!standardIds.has(a.id)).length,unfilteredFeesMissingFromStandard:unfiltered.filter(a=>['CFEE','FEE'].includes(a.activity_type)&&!standardIds.has(a.id)).length,
      feesAbsentFromJournal:fees.filter(a=>!feeIds.has(a.id)).length,fillsAbsentFromJournal:fills.filter(a=>!fillIds.has(a.id)).length,changedBookedFees:changes.length,
      latestFeeCreatedAt:fees.map(a=>a.created_at).filter(Boolean).sort().at(-1)??null,
      currentDayFeeCount:fees.filter(a=>a.created_at?.startsWith(today)||a.transaction_time?.startsWith(today)||a.date===today).length,
      feeShapes:fees.reduce((counts,a)=>{const key=(a.symbol??'no_symbol')+':'+(a.qty==null?'no_quantity':'asset_quantity');counts[key]=(counts[key]??0)+1;return counts;},{})},
    currentDayBuyFillCount:todayBuys.length,currentDayBuyFeeAt25Bps:expectedFees,
    validationResult,currentDifferences:differences,historicalDifferences:historical,
    positions:positions.map(p=>({symbol:p.symbol,qty:p.qty})),
    limitations:['Separate GET snapshots are not an atomic provider transaction.','Fee percentage is a diagnostic hypothesis, never booked as a financial fact.','No provider internal settlement diagnostics are available.']};
  writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
app.whenReady().then(run).then(()=>{clearTimeout(guard);app.exit(0);}).catch(error=>{
  const allowed=/^(credentials_unavailable|account_identity_mismatch|invalid_array|repeated_cursor|probe_page_limit|provider_http_\d+|position_validation_failed)$/;
  console.log(JSON.stringify({stage,failure:allowed.test(error?.message)?error.message:'redacted_probe_failure',code:['ENOTFOUND','ECONNRESET','ETIMEDOUT','MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','SQLITE_ERROR','ERR_DLOPEN_FAILED'].includes(error?.code)?error.code:null}));
  clearTimeout(guard);app.exit(1);
});
