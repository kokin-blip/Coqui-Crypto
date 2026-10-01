import { money } from '../packages/services/src/paper/parallel-paper-utils.js';
import { describe,expect,it } from 'vitest';
import { createStudyInstance, STUDY_BEHAVIOR_HASHES, EXECUTION_ARMS, evaluateMatchedArm,
  pairedReturnUncertainty, declaredExecutionTrials } from '../packages/core/src/index.js';
import { openDatabase, registerStudyInstance, listRemediationEvidence } from '../packages/storage/src/index.js';
import { collectExecutionRemediationShadow, advanceRemediationBook, REMEDIATION_CANDIDATE,
  type RemediationFrame } from '../packages/services/src/paper/execution-remediation-shadow.js';
import { remediationDevelopmentReport } from '../packages/services/src/research/remediation-report.js';
const START=Date.parse('2026-10-15T00:00:00Z'),STEP=14_400_000;
const ids=['BTC','ETH','LTC'].map((base)=>`coinbase|spot|${base}-USD`);
function frame(at=START):RemediationFrame {
  return {slotMs:at,capturedAtMs:at+1000,target:{id:`target-${Math.floor(at/86_400_000)}`,completedDay:new Date(at-86_400_000).toISOString().slice(0,10),
    datasetHash:'a'.repeat(64),weights:Object.fromEntries(ids.map((id)=>[id,'0.2']))},assets:ids.map((id,index)=>({id,
      symbol:['BTCUSD','ETHUSD','LTCUSD'][index]!,held:'0',marketValue:'0',bid:'99.9',ask:'100.1',quoteAtMs:at,rulesAtMs:at,
      tradable:true,status:'active',increment:'0.00001',minimum:'0.00001',completedClose:'100'}))};
}
function instance() {return createStudyInstance({version:1,profileId:'main',experimentId:'e',candidateId:REMEDIATION_CANDIDATE,
  signalVersion:'TrendVol-v4.2',policyVersion:'ABCD-v1',executionVersion:'market-v1',costVersion:'alpaca-market-shadow-v1',
  dataVersion:'completed-daily-v1',behaviorHash:STUDY_BEHAVIOR_HASHES[REMEDIATION_CANDIDATE]!,opening:'common_cash_100000',
  startMs:START,foldEndsMs:[START+86_400_000],holdoutEndMs:START+2*86_400_000},START-1000,'a'.repeat(64));}
describe('matched prospective evidence',()=>{
  it('declares seven arms and two scenarios without counting stress as a new selected policy',()=>{
    expect(declaredExecutionTrials()).toHaveLength(7);expect(declaredExecutionTrials().filter((row)=>row.selectionCandidate)).toHaveLength(3);
  });
  it('requires the terminal mark and every slot; never rescues an incomplete fold',()=>{
    const rows=[];let previous=null;
    for(let i=0;i<6;i++) {const f=frame(START+i*STEP);previous=advanceRemediationBook(f,'cash',1,previous,'cash');rows.push({slotMs:f.slotMs,frame:f,book:previous});}
    expect(evaluateMatchedArm(START,START+86_400_000,'cash',1,rows,null).status).toBe('incomplete_coverage');
    expect(evaluateMatchedArm(START,START+86_400_000,'cash',1,rows.slice(1),frame(START+86_400_000)).status).toBe('incomplete_coverage');
    expect(evaluateMatchedArm(START,START+86_400_000,'cash',1,rows,frame(START+86_400_000)).metrics).toMatchObject({netReturn:'0',maxDrawdown:'0',turnoverUsd:'0',dailyReturns:[0]});
  });
  it('reconciles per-coin modeled P&L to book equity and retains stress differences',()=>{
    for(const multiplier of [1,2] as const) {
      let previous=null;const rows=[];
      for(let i=0;i<6;i++) {const f=frame(START+i*STEP);previous=advanceRemediationBook(f,'B',multiplier,previous,`B:${multiplier}`);rows.push({slotMs:f.slotMs,frame:f,book:previous});}
      const metrics=evaluateMatchedArm(START,START+86_400_000,'B',multiplier,rows,frame(START+86_400_000)).metrics!;
      expect(Object.values(metrics.perCoinNetPnl).reduce((sum,value)=>sum.plus(value),money('0')).plus(100000).toString()).toBe(metrics.endingEquity);
      expect(money(metrics.modeledFeesUsd).gt(0)).toBe(true);expect(money(metrics.netReturn).lt(0)).toBe(true);
    }
  });
  it('reports insufficient uncertainty and deterministic simultaneous bounds',()=>{
    expect(pairedReturnUncertainty(Array(20).fill(0.001)).status).toBe('insufficient_evidence');
    const values=Array.from({length:60},(_,i)=>i%2?0.001:0.002);
    const result=pairedReturnUncertainty(values);expect(result).toEqual(pairedReturnUncertainty(values));expect(result.lower).toBeGreaterThan(0);
  });
  it('collects all arms in one namespace, cannot submit, is idempotent, and refuses a missing predecessor',async()=>{
    const db=openDatabase(':memory:'),study=instance();registerStudyInstance(study,db);let now=START+1000;
    const read={latestCryptoQuotes:async()=>({quotes:Object.fromEntries(['BTC','ETH','LTC'].map((base)=>[`${base}/USD`,{bp:99.9,ap:100.1,t:new Date(now).toISOString()}]))}),
      asset:async(symbol:string)=>({symbol,tradable:true,status:'active',min_order_size:'0.00001',min_trade_increment:'0.00001'})};
    const collect=()=>collectExecutionRemediationShadow({profileId:'main',experimentId:'e',db,now:()=>now,target:frame(Math.floor(now/STEP)*STEP).target,
      completedCloses:Object.fromEntries(ids.map((id)=>[id,'100'])),read});
    await collect();await collect();expect(listRemediationEvidence('main',study.id,'frame',db)).toHaveLength(1);
    for(const arm of EXECUTION_ARMS) for(const multiplier of [1,2]) expect(listRemediationEvidence('main',study.id,`book:${START}:${arm}:${multiplier}`,db)).toHaveLength(1);
    now+=2*STEP;await collect();expect(listRemediationEvidence('main',study.id,'failure',db).at(-1)?.body).toMatchObject({reason:'missing_prospective_predecessor'});
    expect(remediationDevelopmentReport('main',study.id,db,START+86_400_000).status).toBe('insufficient_evidence');db.close();
  });
  it('does not register or synthesize frames with no owner registration',async()=>{
    const db=openDatabase(':memory:');await collectExecutionRemediationShadow({profileId:'main',experimentId:'e',db,now:()=>START,
      target:frame().target,completedCloses:{},read:{latestCryptoQuotes:async()=>{throw new Error('must not fetch');},asset:async()=>{throw new Error('must not fetch');}}});
    expect(db.prepare('SELECT COUNT(*) AS n FROM remediation_evidence_v1').get()).toMatchObject({n:0});db.close();
  });
});
