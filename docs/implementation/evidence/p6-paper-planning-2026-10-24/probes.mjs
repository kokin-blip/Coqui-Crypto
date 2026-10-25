/** Synthetic planning probes against the verified P5 source closure; no installed profile/provider. */
import {Buffer} from 'node:buffer';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import assert from 'node:assert/strict';
const candidate=resolve(process.argv.find(value=>value.startsWith('--source-root='))?.slice('--source-root='.length)??'.');
const coreUrl=pathToFileURL(resolve(candidate,'packages/core/dist/index.js')).href;
const core=await import(coreUrl),storage=await import(pathToFileURL(resolve(candidate,'packages/storage/dist/index.js')).href);
const toModule=body=>'data:text/javascript;base64,'+Buffer.from(body).toString('base64');
const feasibility=toModule(stripTypeScriptTypes(readFileSync('tests/helpers/feasibility.ts','utf8'),{mode:'strip'}).replace("'@coqui/core'",JSON.stringify(coreUrl)));
const helper=await import(toModule(stripTypeScriptTypes(readFileSync('tests/helpers/profit-reserve.ts','utf8'),{mode:'strip'}).replace("'@coqui/core'",JSON.stringify(coreUrl)).replace("'./feasibility.js'",JSON.stringify(feasibility))));
const {source,NOW,SCOPE,BOOK}=await import(feasibility),checks=[];
const verify=(name,actual,expected)=>{assert.deepEqual(actual,expected);checks.push({name,actual,expected});};
const db=storage.openDatabase(':memory:');
try{
 let openingError=null;try{storage.initializePaperBook({schemaVersion:1,profileId:'probe',source:'tracked_holdings_opening',asOfMs:NOW,cashUsd:'500',balances:[]},db);}catch(error){openingError=error.message;}
 verify('legacy initializer refuses cash-funded empty book',openingError,'Paper opening snapshot must be complete, priced, and use zero cash.');
 verify('refusal leaves opening and balance tables empty',Number(db.prepare('SELECT COUNT(*) AS n FROM paper_book_origins_v1').get().n)+Number(db.prepare('SELECT COUNT(*) AS n FROM paper_balances_v3').get().n),0);
 storage.saveCapitalScope({id:SCOPE,provider:'local_paper',environment:'simulation',accountIdentityHash:BOOK,currency:'USD',originProfileId:'probe',createdAtMs:NOW},db);
 const claim=core.cashClaim({scopeId:SCOPE,originKey:'p6-probe',replacesId:null,assetId:'USD',amount:'20',purpose:'profit_reserve',state:'committed',reflectedIn:[],reflectionEvidence:[],evidenceRefs:['synthetic']});
 let claimError=null;try{storage.saveCashClaim(claim,db);}catch(error){claimError=error.message;}
 verify('P2 generic writer rejects funded reserve claim',claimError,'p2_funded_reserves_disabled');
 verify('rejected reserve creates no cash claim',storage.listCashClaims(SCOPE,db).length,0);
 const budget=core.projectAccountBudget(source({cashUsd:'700',equityUsd:'700',assurance:'observed'}),[claim],NOW);
 verify('P2 existing claim deducts once from active equity and cash',[budget.activeEquityUsd,budget.spendableUsd],['680','680']);
 const f=helper.fixture(),state=core.identifiedBudgetFact({...f.state,hUsd:'80',allocatedUsd:'20',reservedUsd:'20'});
 const financial=helper.financial({economicPnlUsd:core.reserveValue('200'),realizedPnlUsd:core.reserveValue('200'),equityUsd:core.reserveValue('700'),activeEquityUsd:core.reserveValue('680'),observedCashUsd:core.reserveValue('700'),spendableUsd:core.reserveValue('680'),actualReservedUsd:core.reserveValue('20')});
 const preview=core.evaluateProfitReserve(f.policy,state,financial,f.floor,NOW);
 verify('unsafe direct reuse of modeled P3 with funded budget deducts reserve a second time',[preview.caps.cashUsd.value,preview.retainedActiveUsd.value],['660','630']);
 checks.push({name:'required P6 hand arithmetic for the same funded book',existingCashReserveUsd:'20',accountEquityUsd:'700',newReserveUsd:'30',correctCashCapacityUsd:'680',correctRetainedActiveUsd:'650',note:'P6 specification requirement; no operational P6 implementation exists. Preserve P3 preview semantics.'});
 writeFileSync('docs/implementation/evidence/p6-paper-planning-2026-10-24/probes.json',JSON.stringify({synthetic:true,accountAccess:false,applicationCodeChanged:false,sourceBase:'775950a0f3c539755a626a1fe058b55ef8f5787f',checks},null,2)+'\n');console.log(JSON.stringify({assertions:checks.length-1,passed:true}));
}finally{db.close();}
