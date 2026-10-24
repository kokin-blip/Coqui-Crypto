/** Read-only synthetic planning probes; no database, market acquisition or study. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import {Buffer} from 'node:buffer';
const source=resolve(process.argv.find(a=>a.startsWith('--source-root='))?.slice(14)??'.');
const out=dirname(fileURLToPath(import.meta.url)),core=await import(pathToFileURL(join(source,'packages/core/dist/index.js')).href);
const helper=stripTypeScriptTypes(readFileSync(join(source,'tests/helpers/capital-replay.ts'),'utf8'),{mode:'strip'}).replace("'@coqui/core'",JSON.stringify(pathToFileURL(join(source,'packages/core/dist/index.js')).href));
const {replayFixture,variantChange,rehash,REPLAY_START:T,REPLAY_DAY:DAY,REPLAY_ASSET:A}=await import('data:text/javascript;base64,'+Buffer.from(helper).toString('base64'));
const B='coinbase|spot|ETH-USD',C='coinbase|spot|LTC-USD',series={[A]:[1,1.01,1.0201,1.030301],[B]:[1,1.1,1.21,1.331],[C]:[1,1.2,1.44,1.728]};
const config={...core.DEFAULT_ROTATION_CONFIG,topN:1,lookbackDays:3,volatilityDays:3,weighting:'equal',holdBufferMultiple:2};
const two=core.rotationTargets({[A]:series[A],[B]:series[B]},config,[A]),three=core.rotationTargets(series,config,[A]);
if(two.picks[0]?.assetId!==A||three.picks[0]?.assetId===A)throw new Error('synthetic rank-buffer witness failed');
const frozen=[];
for(const kind of ['flat','contribution','received-fee','partial-fill','unknown-flow','reserve']){
 const {spec:initial,tape:raw}=replayFixture(4);let spec=initial,tape=raw;
 const flow={id:'funding',atMs:T+DAY,sequence:0,kind:'contribution',amountUsd:'20',feeUsd:'0',userReceiptUsd:'0',purpose:'principal',linkedId:null,fromReserve:false,evidenceComplete:true};
 if(kind==='contribution')spec=variantChange(spec,{flows:[flow]});
 if(kind==='received-fee')spec=variantChange(spec,{cost:{...spec.variants[0].cost,feeCurrency:'received',feeRate:'0.0025'}});
 if(kind==='partial-fill'){tape={...tape,decisions:tape.decisions.map(d=>({...d,fill:{fraction:'0.5',delayFrames:0}}))};spec=rehash(spec,tape);}
 if(kind==='unknown-flow')spec=variantChange(spec,{flows:[{...flow,kind:'withdrawal',userReceiptUsd:'20',evidenceComplete:false}]});
 if(kind==='reserve'){
  tape={...tape,decisions:tape.decisions.map(d=>({...d,status:'abstain',targets:{}}))};spec=variantChange(rehash(spec,tape),{reserve:{...spec.variants[0].reserve,goal:'preview',shareBps:2500},operatingObjective:'cash_only',reviewAtMs:[T+DAY,T+2*DAY,T+3*DAY],flows:[{...flow,id:'gain',kind:'income',amountUsd:'50',purpose:'other'}]});
  spec={...spec,cells:[...spec.cells,...core.CAPITAL_REPLAY_GRID.map(capitalUsd=>({id:`base:reinvest:${capitalUsd}`,capitalUsd,variantId:'base',arm:'reinvest'}))]};
 }
 const result=core.replayCapitalPath(spec,tape),cell=result.cells.find(c=>c.cell.id==='base:policy:500');
 frozen.push({kind,specHash:core.capitalHash(spec),tapeHash:core.capitalHash(tape),resultId:result.id,cells:result.cells.length,example500:cell.summary,metric500:cell.metrics.economicPnlUsd});
}
const invalidPrices=core.jointDailyReturns({A:[1,0,1],B:[1,1.1,1.2]});
if(invalidPrices.returns[0][0]!==0)throw new Error('legacy invalid-price behavior changed');
const tinyBootstrap=core.bootstrapExcessPValue(Array(29).fill(0),Array(29).fill(0));
writeFileSync(join(out,'probes.json'),JSON.stringify({synthetic:true,marketRun:false,accountAccess:false,rotation:{twoAssetIncumbent:two.picks[0].assetId,threeAssetReplacement:three.picks[0].assetId,rawTopOneWeight:three.picks[0].weight,meaning:'Buffer two/top one degenerates in two assets; cap targets without renormalizing leftover cash.'},legacyBootstrap:{invalidPriceReturns:invalidPrices.returns,missingDateIdentity:true,tinyBootstrap,meaning:'Do not use tail-length alignment, invalid-price zeroes or tiny-sample placeholders as verified P5 inference.'},frozenP4:frozen},null,2)+'\n');
console.log(JSON.stringify({rotationWitness:true,frozenP4Cases:frozen.length,legacyAlignmentWitness:true,synthetic:true}));
