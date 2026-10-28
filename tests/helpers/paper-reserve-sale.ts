import { capitalHash, decimal, instrumentKey, strategyDecisionId, type AssetRef, type PaperReserveSaleInput, type ProductRuleSnapshot, type MarketBar,type PaperReserveSaleConsequence } from '@coqui/core';
import { createPaperReserveSaleService, createPaperCapitalBudgetPort, PaperExecutionService, capturePaperCapitalEvidence, paperCostModelHash } from '@coqui/services';
import { setPaperExecutionPolicy, saveStrategyDecision } from '@coqui/storage';
import { reserveServiceFixture } from './paper-profit-reserve.js';
import { settings } from './profit-reserve.js';
import { feasibility } from './feasibility.js';
const instrument = { venue:'coinbase', productType:'spot', productId:'BTC-USD' } as const, key = instrumentKey(instrument);
const asset: AssetRef = { instrument, symbol:'BTC', baseAsset:'BTC', quoteAsset:'USD', name:'Bitcoin', coingeckoId:null };
export function saleServiceFixture(understateCosts = false) {
  const f = reserveServiceFixture();
  setPaperExecutionPolicy({profileId:'main',commandId:f.uuid(800),mode:'review_required',confirmedAt:f.now(),explicitUnattendedConfirmation:false},f.db);
  f.service.savePolicy({...f.request(),settings:settings()}); f.service.authorize(f.request());
  const at=f.now()+1;
  f.db.prepare('INSERT INTO paper_orders_v3 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('buy','main','buy-run','BTC-USD',key,'buy','10','500','filled','fixture-rules','fixture-decision',null,at,at);
  f.db.prepare('INSERT INTO paper_fills_v3 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('buy-fill','buy','main','10','50','500','0','0','0','0',at,'fixture-mark');
  for(const [account,id,quantity,amount] of [['cash',null,'0','-500'],['asset',key,'10','500'],['venue_fee',null,'0','0']] as const)
    f.db.prepare('INSERT INTO paper_ledger_entries_v3 VALUES(?,?,?,?,?,?,?,?,?,?)').run(`buy-fill:${account}`,'main','buy-run','buy','buy-fill',account,id,amount,quantity,at);
  f.db.prepare("UPDATE paper_balances_v3 SET quantity_text='0',updated_at=? WHERE profile_id='main' AND asset_id='USD'").run(at);
  f.db.prepare('INSERT INTO paper_balances_v3 VALUES(?,?,?,?)').run('main',key,'10',at); f.advance(2);
  const marks=()=>({[key]:{priceUsd:'55',atMs:f.now(),ref:'fixture-current-mark'}});
  capturePaperCapitalEvidence('main',f.now(),marks(),f.db);
  const current=():PaperReserveSaleInput=>{
    const binding=f.service.view().binding,base=feasibility('550'),budget=f.getBudget();
    return {policyId:binding.policy_id!,stateId:binding.state_id!,frame:{...base,budget,expectedRevision:budget.revision,nowMs:f.now(),fees:{...base.fees,rate:understateCosts?'0':'0.0061',slippageBps:understateCosts?'0':'25'},assets:[{...base.assets[0]!,markUsd:'55',quote:{bid:'55',ask:'55',atMs:at+1}}]},
      lots:[{id:'buy-fill',assetId:key,quantity:'10',basisUsd:'500',acquiredAtMs:at,sequence:0,evidenceRef:'buy-fill'}],
      objective:{reserveUsd:'12',economicBackingUsd:'50',realizedBackingUsd:'0',freshProfitUsd:'50',shareBps:2500,additionalTaxUsd:'0',profitBackedTaxUsd:'0',retainedFloorUsd:'400',maxCostUsd:'2',maxNotionalUsd:'200',maxExposureReductionUsd:'200',eligibleAssetIds:[key],reviewRef:'synthetic-reviewed-sacrifice'}};
  };
  const rule:ProductRuleSnapshot={id:capitalHash('sale-rules'),instrument,status:'online',tradingDisabled:false,cancelOnly:false,limitOnly:false,postOnly:false,viewOnly:false,baseIncrement:'0.01',baseMinSize:'0.01',baseMaxSize:null,quoteIncrement:'0.01',quoteMinSize:'1',quoteMaxSize:null,priceIncrement:'0.01',source:'coinbase',retrievedAt:f.now(),responseHash:capitalHash('sale-rule-response')};
  const next=f.now()+1000,bar=(start:number,end:number,retrieved:number):MarketBar=>({assetId:key,source:'coinbase',interval:'1d',startTimeMs:start,endTimeMs:end,open:55,close:55,high:55,low:55,volume:1000,isComplete:true,retrievedAtMs:retrieved});
  const market={rules:()=>rule,bars:()=>[bar(f.now()-1000,f.now(),f.now()),bar(next,next+1000,next)]};
  const scope=f.service.view().binding.scope_id;
  const port=createPaperCapitalBudgetPort({profileId:'main',scopeId:scope,database:f.db,now:f.now,version:'paper-reserve-cash-v1',marks,guardAuthority:()=>{const b=f.service.view().binding;f.authority.check(b.policy_id!,b.generation);return true;}});
  const execution=(guard?: (id:string)=>boolean)=>new PaperExecutionService({database:f.db,profileId:'main',nowMs:f.now,market,executionOwnerId:'p6-host',capitalBudget:port,capitalPreviewModel:{assets:()=>current().frame.assets,fees:()=>current().frame.fees,policy:()=>current().frame.policy},...(guard?{proposalPurposeGuard:guard}:{}),state:()=>{
    const b=f.service.view().binding,p=f.authority.check(b.policy_id!,b.generation);
    return {holdings:[{asset,quantity:decimal('10'),priceUsd:decimal('55'),valueUsd:decimal('550'),avgCostUsd:decimal('50'),unrealizedPnlUsd:null,unrealizedPnlPct:null}],killSwitchEngaged:false,evidenceVerified:true,historicalGrossEdgeLowerBoundPct:p.grossEdgeLowerBoundPct};}});
  let reviewed:string|null=null,reassessments=0;
  const pending=(_consequence:PaperReserveSaleConsequence,runId:string)=>{const decisionId=strategyDecisionId('main',f.now());saveStrategyDecision({schemaVersion:1,decisionId,profileId:'main',runId,scheduledForMs:f.now(),strategy:{id:'synthetic-p6',version:'paper-reserve-cash-v1',configHash:capitalHash('fixture')},market:{snapshotHash:capitalHash('tape'),asOfMs:f.now(),expectedAsOfMs:f.now(),freshness:'fresh',refreshResult:'succeeded',ruleSnapshotHash:rule.id,rulesFresh:true},portfolio:{snapshotHash:f.getBudget().id,version:'paper-reserve-cash-v1',source:'paper_ledger'},targets:[{assetId:key,weight:0.75}],cashWeight:0.25,exposure:0.75,historyStatus:'complete',facts:null,createdAtMs:f.now()},f.db);return {decisionId,requiredExecutionBarStartMs:next,costModelHash:paperCostModelHash()};};
  const service=createPaperReserveSaleService({profileId:'main',database:f.db,now:f.now,authority:f.authority,execution,model:{current,asset:()=>asset,reviewed:id=>reviewed===id?{consequenceId:id,objectiveHash:capitalHash(current().objective),cashCapabilityReviewRef:'synthetic-F-review',policyEvidenceReviewRef:'synthetic-G-review'}:null,
    pending},reassess:()=>{reassessments++;return {state:'unavailable',reason:'new_operating_request_required'};}});
  return {...f,reserveService:f.service,service,execution,scope,next,pending,current,marks,asset,rule,market,port,allow:(id:string)=>{reviewed=id;},reassessments:()=>reassessments};
}
