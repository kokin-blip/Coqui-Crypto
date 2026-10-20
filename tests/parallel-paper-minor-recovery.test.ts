import { describe, expect, it, vi } from 'vitest';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '../packages/storage/src/index.js';
import { reconcilePaperPositionEvidence } from '../packages/services/src/paper/parallel-paper-minor-recovery.js';
import { validateParallelPositions } from '../packages/services/src/paper/parallel-paper-recovery.js';
import { paperPositionFingerprint } from '../packages/services/src/paper/parallel-paper-resolution.js';

const start=Date.parse('2026-10-20T12:00:00Z'), DAY=86_400_000;
function fixture(qty='0.9975') {
  let now=start;
  const experiment={id:'experiment',profileId:'main',alpacaAccountId:'account',startedAt:start} as ParallelPaperExperiment;
  const events:ParallelPaperEvent[]=[];
  const append=(kind:string,_key:string,detail:Record<string,unknown>)=>events.push({id:String(events.length),
    experimentId:'experiment',profileId:'main',kind,at:now,detail});
  append('external_order','',{orderId:'order',symbol:'BTCUSD',side:'buy',status:'filled',filledQty:'1'});
  append('external_fill','',{orderId:'order',symbol:'BTCUSD',quantity:'1',price:'40000',at:new Date(start).toISOString()});
  const client={positions:vi.fn(async()=>[{symbol:'BTCUSD',qty,market_value:'40000'}]),
    latestCryptoQuotes:vi.fn(async()=>{throw new Error('stale_alpaca_quote');})};
  return {events,append,client,setNow:(value:number)=>{now=value;},
    input:{experiment,events:()=>events,append,client:client as never,now:()=>now,fullAudit:vi.fn(async()=>{})}};
}
describe('exact delayed-fee recovery',()=>{
  it.each(['0.9975','0.9999999975'])('never accepts fee estimates at any size (%s)',async qty=>{
    const f=fixture(qty);
    if(qty==='0.9999999975'){
      f.events.find(e=>e.kind==='external_fill')!.detail['quantity']='0.000001';
      // A tiny fill against a zero opening balance still must reconcile exactly.
      f.client.positions.mockResolvedValue([{symbol:'BTCUSD',qty:'0.0000009975',market_value:'0.04'}]);
    }
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toMatchObject({message:'broker_positions_mismatch',
      pendingFeeEvidence:{status:'awaiting',oldestFillAtMs:start,latestFillAtMs:start,reviewAfterMs:Date.parse('2026-10-22T00:00:00Z')}});
    expect(f.input.fullAudit).toHaveBeenCalledOnce();expect(f.client.latestCryptoQuotes).not.toHaveBeenCalled();
    expect(f.events.some(e=>['external_fee','paper_position_resolution'].includes(e.kind))).toBe(false);
  });
  it('clears on actual asset fees after the full audit, with no double deduction on replay',async()=>{
    const f=fixture();
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toThrow('broker_positions_mismatch');
    f.input.fullAudit.mockImplementationOnce(async()=>{f.append('external_fee','',{symbol:'BTCUSD',quantity:'-0.0025'});});
    await reconcilePaperPositionEvidence(f.input);await reconcilePaperPositionEvidence(f.input);
    await validateParallelPositions(f.client as never,f.events);
    expect(f.events.filter(e=>e.kind==='external_fee')).toHaveLength(1);
    expect(f.events.filter(e=>e.kind==='paper_position_resolution')).toHaveLength(0);
    expect(f.events.find(e=>e.kind==='external_fill')!.detail['quantity']).toBe('1');
  });
  it('keeps missing asset evidence blocked after cash-only and partial fee reports',async()=>{
    const f=fixture();
    f.append('external_fee','',{symbol:null,quantity:null,netAmount:'-100'});
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toMatchObject({pendingFeeEvidence:{status:'awaiting'}});
    f.append('external_fee','',{symbol:'BTCUSD',quantity:'-0.001'});
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toMatchObject({message:'broker_positions_mismatch',pendingFeeEvidence:undefined});
    f.append('external_fee','',{symbol:'BTCUSD',quantity:'-0.0015'});
    await reconcilePaperPositionEvidence(f.input);
  });
  it('keeps another asset pending when one asset fee arrives, independent of its publication date',async()=>{
    const f=fixture();
    f.append('external_order','',{orderId:'eth-order',symbol:'ETHUSD',side:'buy'});
    f.append('external_fill','',{orderId:'eth-order',symbol:'ETHUSD',quantity:'2',at:new Date(start).toISOString()});
    f.append('external_fee','',{symbol:'BTCUSD',quantity:'-0.0025'});
    f.append('broker_activity_metadata','',{activityType:'CFEE',createdAt:new Date(start+1000).toISOString()});
    f.client.positions.mockResolvedValue([{symbol:'BTCUSD',qty:'0.9975',market_value:'40000'},{symbol:'ETHUSD',qty:'1.995',market_value:'4000'}]);
    f.setNow(start+2000);
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toMatchObject({pendingFeeEvidence:{status:'awaiting'},
      positionDifferences:[{symbol:'ETHUSD',differenceQty:'-0.005'}]});
  });
  it('persists the same review threshold through restart, midnight and overdue checks, never granting permission',async()=>{
    const f=fixture();
    for(const [now,status] of [[start+DAY,'awaiting'],[Date.parse('2026-10-22T00:00:00Z'),'overdue'],[start+30*DAY,'overdue']] as const){
      f.setNow(now);
      const restarted={...f.input,events:()=>f.events.map(e=>({...e,detail:{...e.detail}}))};
      await expect(reconcilePaperPositionEvidence(restarted)).rejects.toMatchObject({pendingFeeEvidence:{status,
        oldestFillAtMs:start,reviewAfterMs:Date.parse('2026-10-22T00:00:00Z')}});
    }
    expect(f.events.some(e=>e.kind==='paper_position_resolution')).toBe(false);
  });
  it('rejects a legacy allowance even when its fingerprint and broker quantity still match',async()=>{
    const f=fixture();
    f.append('paper_position_resolution','',{scope:'paper_only',ledgerFingerprint:paperPositionFingerprint(f.events),
      positionDifferences:[{symbol:'BTCUSD',observedQty:'0.9975'}],observedValueUsd:'0.25'});
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toMatchObject({pendingFeeEvidence:{status:'awaiting'}});
    await expect(validateParallelPositions(f.client as never,f.events)).rejects.toThrow('broker_positions_mismatch');
  });
  it.each(['1.001','0.9976','0.99'])('keeps nonmatching credits or deficits unexplained (%s)',async qty=>{
    const f=fixture(qty);
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toMatchObject({message:'broker_positions_mismatch',pendingFeeEvidence:undefined});
  });
  it.each(['future','invalid','sell','unknown'])('does not classify invalid or unsupported evidence (%s)',async kind=>{
    const f=fixture();
    if(kind==='future'||kind==='invalid')f.events.find(e=>e.kind==='external_fill')!.detail['at']=kind==='future'?new Date(start+1).toISOString():'invalid';
    if(kind==='sell')f.events.find(e=>e.kind==='external_order')!.detail['side']='sell';
    if(kind==='unknown')f.client.positions.mockResolvedValue([{symbol:'DOGEUSD',qty:'0.9975',market_value:'1'}]);
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toMatchObject({message:'broker_positions_mismatch',pendingFeeEvidence:undefined});
  });
  it('does not turn an audit or positions network failure into a delayed-fee state',async()=>{
    const f=fixture();f.input.fullAudit.mockRejectedValue(new Error('deadline_exceeded'));
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toThrow('deadline_exceeded');
    const other=fixture();other.client.positions.mockRejectedValue(new Error('network_failed'));
    await expect(reconcilePaperPositionEvidence(other.input)).rejects.toThrow('network_failed');
    expect(other.input.fullAudit).not.toHaveBeenCalled();
  });
});
