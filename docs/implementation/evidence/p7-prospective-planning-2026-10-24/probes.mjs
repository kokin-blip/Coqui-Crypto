// Planning probes only: disposable in-memory DB, no account/provider/registration ports.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const buildRoot=process.argv[2];if(!buildRoot)throw new Error('Pass the validated isolated build directory.');
const load=p=>import(pathToFileURL(resolve(buildRoot,p)).href);
const core=await load('packages/core/dist/index.js'),storage=await load('packages/storage/dist/index.js'),services=await load('packages/services/dist/index.js');
const checks=[],check=(name,fn)=>{fn();checks.push({name,passed:true});};
const DAY=86_400_000,hash='a'.repeat(64);
const definition={version:1,profileId:'synthetic-p7',experimentId:'planning-only',candidateId:'synthetic',signalVersion:'1',policyVersion:'1',executionVersion:'1',costVersion:'1',dataVersion:'1',behaviorHash:hash,opening:'common_cash_100000',startMs:DAY*20,foldEndsMs:[DAY*21],holdoutEndMs:DAY*22};
check('legacy study instance accepts its frozen100000 opening',()=>assert.equal(core.createStudyInstance(definition,0,hash).definition.opening,'common_cash_100000'));
check('legacy study instance refuses small-capital identity instead of adapting it',()=>assert.throws(()=>core.createStudyInstance({...definition,opening:'common_cash_500'},0,hash),/invalid_study_instance/));
const db=storage.openDatabase(':memory:');try{
  const claim={planHash:'planning-synthetic-1',startMs:DAY*20,endExclusiveMs:DAY*22,assets:['coinbase|spot|BTC-USD'],dataLineage:'synthetic-lineage',freezeHash:hash,atMs:DAY*30};
  check('final claim is durable before any result is available',()=>{storage.claimIntegrityHoldout(claim,db);assert.equal(storage.listIntegrityEvents(claim.planHash,'final_claim',db).length,1);assert.equal(storage.listIntegrityEvents(claim.planHash,'final_result',db).length,0);});
  check('changing plan and lineage aliases cannot reopen overlapping consumed instruments/time',()=>assert.throws(()=>storage.claimIntegrityHoldout({...claim,planHash:'planning-synthetic-2',dataLineage:'renamed'},db),/already consumed/));
  check('missing exact operational profitability binding remains unavailable',()=>assert.equal(storage.readBoundProfitabilityEvidence('synthetic-p7',db,{profileId:'synthetic-p7',strategyId:'new-p7',codeRevision:hash,costProfileHash:hash,horizonMs:DAY,normalization:'gross_pct_per_turnover'},DAY),null));
  check('legacy collection construction can append failure evidence; it is not a pure read facade',()=>{let writes=0;const facade=services.studyCollection({profileId:'synthetic-p7',experimentId:'none',candidateId:'none',db,nowMs:DAY,legacyHash:hash,legacyList:()=>[],legacyAppend:()=>{writes++;}});assert.equal(facade.ready,false);assert.equal(writes,1);});
}finally{db.close();}
console.log(JSON.stringify({planningOnly:true,synthetic:true,installedAccountAccess:false,checks},null,2));
