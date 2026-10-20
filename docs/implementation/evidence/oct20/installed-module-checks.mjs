// Execute only modules extracted from the installed ASAR. All broker inputs are synthetic.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]);
const moduleAt = path => import(pathToFileURL(join(root, path)));
const { createAlpacaPaperClient } = await moduleAt('node_modules/@coqui/adapters/dist/http/alpaca-paper.js');
const { reconcilePaperPositionEvidence } = await moduleAt('node_modules/@coqui/services/dist/paper/parallel-paper-minor-recovery.js');
const { parallelPaperFailureDetail } = await moduleAt('node_modules/@coqui/services/dist/paper/parallel-paper-utils.js');
const { parallelReconciliationAttention } = await moduleAt('node_modules/@coqui/services/dist/paper/parallel-paper-attention.js');
const { projectParallelPaperActivity } = await moduleAt('node_modules/@coqui/services/dist/paper/parallel-paper-activity.js');
const { observedParallelClient } = await moduleAt('node_modules/@coqui/services/dist/paper/parallel-execution-safety.js');
const { parallelPaperChannelSchemas } = await moduleAt('node_modules/@coqui/contracts/dist/schemas/parallel-paper.js');
const now = Date.parse('2026-10-20T18:00:00Z');
const event = (kind, detail, id) => ({ id: id ?? 'a'.repeat(64), kind, at: now, detail });
const events = [event('external_order', {orderId:'order',symbol:'BTCUSD',side:'buy',status:'filled',filledQty:'1'}),
  event('external_fill', {orderId:'order',symbol:'BTCUSD',quantity:'1',price:'40000',at:new Date(now).toISOString()}),
  event('broker_activity_metadata', {activityType:'CFEE',createdAt:new Date(now-86400000).toISOString()})];
const experiment = {id:'fixture',profileId:'fixture',alpacaAccountId:'fixture-account',startedAt:now};
const client = {positions:async()=>[{symbol:'BTCUSD',qty:'0.9975'}],
  account:async()=>({id:'fixture-account',currency:'USD',status:'PAPER_ONLY',account_blocked:false,trading_blocked:false,equity:'100000'}),
  latestCryptoQuotes:async()=>({quotes:{'BTC/USD':{bp:'40000',ap:'40000',t:new Date(now).toISOString()}}})};
const append = (kind, key, detail) => events.push(event(kind,detail,key));
let auditCount = 0;
const input = {experiment,client,events:()=>events,append,now:()=>now,allowMinorResolution:true,
  fullAudit:async()=>{auditCount++;}};
let failure;
try { await reconcilePaperPositionEvidence(input); assert.fail('Expected recovery limit block'); }
catch(error) { failure=parallelPaperFailureDetail(error,'unexpected'); }
assert.equal(auditCount,1);
assert.equal(failure.reason,'broker_positions_mismatch');
assert.deepEqual(failure.feeReconciliation,{kind:'fee_shaped_limit_exceeded',observedValueUsd:'100',maxAbsoluteValueUsd:'25',maxEquityValueUsd:'50'});
assert.equal(events.some(row=>row.kind==='paper_position_resolution'),false);
assert.equal(projectParallelPaperActivity([event('reconciliation_error',failure)]).activity[0].title,'Alpaca position reconciliation mismatch');

// Exact published asset fees can repair an active pass without an exception.
input.allowMinorResolution=false;
input.fullAudit=async()=>{auditCount++;append('external_fee','synthetic-fee',{symbol:'BTCUSD',quantity:'-0.0025'});};
await reconcilePaperPositionEvidence(input);
assert.equal(events.some(row=>row.kind==='paper_position_resolution'),false);
const networkResults=[];
for(const code of ['ENOTFOUND','ECONNRESET','CERT_HAS_EXPIRED']) {
  const journal=[];
  const http=createAlpacaPaperClient({keyId:'synthetic',secretKey:'synthetic-private-secret'},async()=>{
    throw new TypeError('synthetic-private-secret',{cause:{code}});
  },undefined,attempt=>journal.push(event('broker_read_attempt',{...attempt})));
  const observed=observedParallelClient(http,()=>now,(kind,_key,detail)=>journal.push(event(kind,detail)));
  try {await observed.account();assert.fail('Expected network failure');}
  catch(error) {journal.push(event('reconciliation_error',parallelPaperFailureDetail(error,'unexpected')));}
  const attention=parallelReconciliationAttention(journal,'paused');
  assert.equal(attention.latestFailure.networkCode,code);
  assert.equal(attention.latestFailure.attemptCount,2);
  assert.equal(parallelPaperChannelSchemas['parallel.paper.status'].response.unwrap().shape.reconciliationAttention.safeParse(attention).success,true);
  assert.equal(JSON.stringify(journal).includes('synthetic-private-secret'),false);
  networkResults.push({code,throughStatusContract:true,secretRedactionPassed:true});
}
const assets=join(root,'dist/renderer/assets');
const renderer=readdirSync(assets).filter(name=>name.endsWith('.js')).map(name=>readFileSync(join(assets,name),'utf8')).join('\n');
for(const text of ['Position gap exceeds recovery limits','could not be resolved','secure connection to Alpaca could not be verified'])
  assert.ok(renderer.includes(text),`Installed renderer missing ${text}`);
console.log(JSON.stringify({installedBuild:JSON.parse(readFileSync(join(root,'dist/main/build-info.json'),'utf8')),
  feeLimitBlockPassed:true,exactDelayedFeeRecoveryPassed:true,networkResults,installedRendererMessagesPresent:true,
  profileWrites:0,networkRequests:0},null,2));
