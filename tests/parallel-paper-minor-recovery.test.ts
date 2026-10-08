import { describe, expect, it, vi } from 'vitest';
import type { ParallelPaperEvent, ParallelPaperExperiment } from '../packages/storage/src/index.js';
import { reconcilePaperPositionEvidence } from '../packages/services/src/paper/parallel-paper-minor-recovery.js';
import { validateParallelPositions } from '../packages/services/src/paper/parallel-paper-recovery.js';
import { currentPaperPositionResolution } from '../packages/services/src/paper/parallel-paper-resolution.js';

const now=Date.parse('2026-10-05T00:00:00Z');
const experiment={id:'experiment',profileId:'main',alpacaAccountId:'account',startedAt:now} as ParallelPaperExperiment;
function fixture(qty='0.9975',price='100',atMs=now) {
  const events: ParallelPaperEvent[]=[];
  const append=(kind:string,_key:string,detail:Record<string,unknown>)=>events.push({id:String(events.length),
    experimentId:'experiment',profileId:'main',kind,at:now,detail});
  append('external_order','',{orderId:'order',symbol:'BTCUSD',side:'buy',status:'filled',filledQty:'1'});
  append('external_fill','',{orderId:'order',symbol:'BTCUSD',quantity:'1',price:'100',at:new Date(now).toISOString()});
  append('broker_activity_metadata','',{activityType:'CFEE',createdAt:new Date(now-86400000).toISOString()});
  const client={positions:vi.fn(async()=>[{symbol:'BTCUSD',qty,market_value:'100'}]),
    account:async()=>({id:'account',currency:'USD',status:'PAPER_ONLY',account_blocked:false,trading_blocked:false,equity:'100000'}),
    latestCryptoQuotes:async()=>({quotes:Object.fromEntries(['BTC','ETH','LTC'].map(symbol=>[`${symbol}/USD`,
      {bp:price,ap:price,t:new Date(atMs).toISOString()}]))})};
  return {events,append,client,input:{allowMinorResolution:true,experiment,events:()=>events,append,client:client as never,now:()=>now,fullAudit:vi.fn(async()=>{})}};
}
describe('bounded paper-only recovery',()=>{
  it('accepts a fee-shaped minor residual without booking fees, and avoids double deduction when fees arrive',async()=>{
    const f=fixture(); await reconcilePaperPositionEvidence(f.input);
    expect(f.input.fullAudit).toHaveBeenCalledOnce();
    expect(currentPaperPositionResolution(f.events)?.detail).toMatchObject({scope:'paper_only',observedValueUsd:'0.25',feeAttribution:'unconfirmed'});
    expect(f.events.filter(e=>e.kind==='external_fee')).toHaveLength(0);
    expect(f.events.find(e=>e.kind==='external_fill')!.detail['quantity']).toBe('1');
    await validateParallelPositions(f.client as never,f.events);
    await reconcilePaperPositionEvidence(f.input);
    expect(f.events.filter(e=>e.kind==='paper_position_resolution')).toHaveLength(1);
    f.append('external_fee','',{symbol:'BTCUSD',quantity:'-0.0025'});
    expect(currentPaperPositionResolution(f.events)).toBeUndefined();
    await reconcilePaperPositionEvidence(f.input);
  });
  it('requires a pause before accepting a new exception',async()=>{
    const f=fixture();f.input.allowMinorResolution=false;
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toThrow('broker_positions_mismatch');
    expect(currentPaperPositionResolution(f.events)).toBeUndefined();
    expect(f.input.fullAudit).not.toHaveBeenCalled();
  });
  it('does not price unrelated assets when valuing a minor discrepancy',async()=>{
    const f=fixture(), read=f.client.latestCryptoQuotes;
    const requested=vi.fn(async(_symbols?:readonly string[])=>{void _symbols;const raw=await read();raw.quotes['LTC/USD']!.t=new Date(now-600000).toISOString();return raw;});
    f.client.latestCryptoQuotes=requested;
    await reconcilePaperPositionEvidence(f.input);
    expect(requested).toHaveBeenCalledWith(['BTC/USD']);
    expect(currentPaperPositionResolution(f.events)).toBeDefined();
  });
  it('reconciles matching positions without requesting market prices',async()=>{
    const f=fixture('1');f.client.latestCryptoQuotes=vi.fn(async()=>{throw new Error('stale_alpaca_quote');});
    await reconcilePaperPositionEvidence(f.input);
    expect(f.client.latestCryptoQuotes).not.toHaveBeenCalled();
  });
  it.each([['1.001','100',now],['0.9976','100',now],['0.9975','20000',now],['0.9975','100',now-60001]])(
    'blocks unexplained, positive, excessive or stale cases (%s)',async(qty,price,at)=>{
      const f=fixture(qty,price,at);await expect(reconcilePaperPositionEvidence(f.input)).rejects.toThrow();
      expect(currentPaperPositionResolution(f.events)).toBeUndefined();
    });
  it('does not accept a changed account or a racing position snapshot',async()=>{
    const f=fixture();f.client.positions.mockResolvedValueOnce([{symbol:'BTCUSD',qty:'0.9975',market_value:'100'}])
      .mockResolvedValueOnce([{symbol:'BTCUSD',qty:'0.9975',market_value:'100'}])
      .mockResolvedValueOnce([{symbol:'BTCUSD',qty:'0.9974',market_value:'100'}]);
    await expect(reconcilePaperPositionEvidence(f.input)).rejects.toThrow('broker_positions_mismatch');
    const other=fixture();other.client.account=async()=>({id:'foreign',currency:'USD',status:'PAPER_ONLY',account_blocked:false,trading_blocked:false,equity:'100000'});
    await expect(reconcilePaperPositionEvidence(other.input)).rejects.toThrow('broker_positions_mismatch');
    expect(currentPaperPositionResolution(other.events)).toBeUndefined();
  });
});
