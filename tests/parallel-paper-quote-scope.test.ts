import { describe, expect, it, vi } from 'vitest';
import { executeParallelIntraday, parallelQuotes, recordParallelPreOrder } from '../packages/services/src/paper/parallel-paper-intraday.js';
import { observedParallelClient } from '../packages/services/src/paper/parallel-execution-safety.js';
import { parallelBrokerEvidence } from '../packages/services/src/paper/parallel-broker-evidence.js';
import { instrumentKey } from '../packages/core/src/index.js';
import { PARALLEL_INSTRUMENTS } from '../packages/services/src/paper/parallel-signal.js';
import type { ParallelPaperEvent } from '../packages/storage/src/index.js';
const now=Date.parse('2026-10-05T12:00:00Z');
const quote=(at=now)=>({bp:'100',ap:'101',t:new Date(at).toISOString()});
describe('operation-specific quote evidence',()=>{
  it('requires fresh prices only for the requested assets and keeps the full default strict',()=>{
    const raw={quotes:{'BTC/USD':quote(),'LTC/USD':quote(now-600000)}};
    expect(parallelQuotes(raw,now,['BTCUSD']).sides['BTCUSD']).toBeDefined();
    expect(()=>parallelQuotes(raw,now,['LTCUSD'])).toThrow('stale_alpaca_quote');
    expect(()=>parallelQuotes(raw,now,['ETHUSD'])).toThrow('invalid_alpaca_quote');
    expect(()=>parallelQuotes(raw,now,[])).toThrow('invalid_alpaca_quote');
    expect(()=>parallelQuotes(raw,now,['DOGEUSD'])).toThrow('invalid_alpaca_quote');
    expect(()=>parallelQuotes(raw,now)).toThrow('invalid_alpaca_quote');
  });
  it('checks the submitted asset immediately before an order and rejects its stale quote',async()=>{
    const latestCryptoQuotes=vi.fn(async(_symbols?:readonly string[])=>{void _symbols;return {quotes:{'BTC/USD':quote()}};});
    const client={latestCryptoQuotes,asset:async()=>({symbol:'BTCUSD',tradable:true,status:'active',min_order_size:'0.0001',min_trade_increment:'0.0001'}),
      account:async()=>({id:'paper',status:'PAPER_ONLY',trading_blocked:false,account_blocked:false,cash:'1000'}),positions:async()=>[]};
    const append=vi.fn(),order={clientOrderId:'order',symbol:'BTCUSD',side:'buy' as const,qty:'1'};
    await recordParallelPreOrder(client as never,()=>now,append,order,{},'decision','paper');
    expect(latestCryptoQuotes).toHaveBeenCalledWith(['BTC/USD']);expect(append).toHaveBeenCalledOnce();
    latestCryptoQuotes.mockResolvedValue({quotes:{'BTC/USD':quote(now-60001)}});append.mockClear();
    await expect(recordParallelPreOrder(client as never,()=>now,append,order,{},'decision','paper')).rejects.toThrow('stale_alpaca_quote');
    expect(append).not.toHaveBeenCalled();
  });
  it('plans a BTC-only rebalance without fetching unrelated prices or asset rules',async()=>{
    const events:ParallelPaperEvent[]=[];
    const append=(kind:string,_key:string,detail:Record<string,unknown>)=>events.push({id:String(events.length),experimentId:'e',profileId:'main',kind,at:now,detail});
    const latestCryptoQuotes=vi.fn(async(_symbols?:readonly string[])=>{void _symbols;return {quotes:{'BTC/USD':quote()}};});
    const asset=vi.fn(async(symbol:string)=>({symbol,tradable:true,status:'active',min_order_size:'0.0001',min_trade_increment:'0.0001'}));
    const submit=vi.fn(async(order:{symbol:string;client_order_id:string;qty:string;side:string})=>({...order,id:'broker',status:'filled',filled_qty:order.qty,filled_avg_price:'100'}));
    const client={latestCryptoQuotes,asset,submit,positions:async()=>[],orders:async()=>[],orderByClientId:async()=>({status:'filled'}),
      account:async()=>({id:'paper',status:'PAPER_ONLY',trading_blocked:false,account_blocked:false,cash:'1000',equity:'1000'})};
    const decision={id:'d',experimentId:'e',profileId:'main',kind:'decision',at:now,detail:{day:'2026-10-04',weights:{[instrumentKey(PARALLEL_INSTRUMENTS[0]!)]:0.5}}};
    await executeParallelIntraday({nowMs:now,experimentId:'e',decision,events:()=>events,append,client:client as never,expectedAccountId:'paper'});
    expect(submit).toHaveBeenCalledOnce();
    expect(latestCryptoQuotes.mock.calls.every(([symbols])=>JSON.stringify(symbols)===JSON.stringify(['BTC/USD']))).toBe(true);
    expect(asset.mock.calls.every(([symbol])=>symbol==='BTCUSD')).toBe(true);
  });
  it('preserves other assets when a scoped read refreshes one quote, and scopes failures too',async()=>{
    const events:ParallelPaperEvent[]=[];let clock=now;
    const append=(kind:string,_key:string,detail:Record<string,unknown>)=>events.push({id:String(events.length),experimentId:'e',profileId:'main',kind,at:clock,detail});
    const latestCryptoQuotes=vi.fn(async(_symbols?:readonly string[])=>{void _symbols;return {quotes:{'BTC/USD':quote(),'ETH/USD':quote(),'LTC/USD':quote()}};});
    const client=observedParallelClient({latestCryptoQuotes} as never,()=>clock,append);
    await client.latestCryptoQuotes();clock+=61000;
    latestCryptoQuotes.mockResolvedValue({quotes:{'BTC/USD':quote(clock)}} as never);
    await client.latestCryptoQuotes(['BTC/USD']);
    const evidence=parallelBrokerEvidence(events,clock);
    expect(evidence.quoteStatus).toBe('stale');
    expect(evidence.quoteAssets).toMatchObject([{symbol:'BTC/USD',status:'fresh',ageSeconds:0},{symbol:'ETH/USD',status:'stale',ageSeconds:61},{symbol:'LTC/USD',status:'stale',ageSeconds:61}]);
    latestCryptoQuotes.mockRejectedValue(new Error('unavailable'));await expect(client.latestCryptoQuotes(['BTC/USD'])).rejects.toThrow();
    expect(parallelBrokerEvidence(events,clock).quoteAssets.map(row=>row.status)).toEqual(['unavailable','stale','stale']);
    latestCryptoQuotes.mockResolvedValue({quotes:{}} as never);await client.latestCryptoQuotes(['BTC/USD']);
    expect(parallelBrokerEvidence(events,clock).quoteAssets[0]).toMatchObject({status:'unknown',quoteAtMs:null,ageSeconds:null});
  });
});
