import { openDatabase, savePaperExecutionProposal } from '@coqui/storage';
import { createTradingActivityHandlers } from '../dist/main/trading-activity-handlers.js';
import { createDispatcher } from '../dist/main/dispatch.js';

/** Recorded synthetic facts only in the benchmark's disposable profile. */
export function activityFixture(path) {
  const database=openDatabase(path);const now=Date.now();
  for(const [id,side,price,fee,at] of [['fixture-buy','buy','84200','2',now-600000],['fixture-close','sell','84208','1',now-300000]]) {
    const quantity=side==='buy'?'2':'1';
    database.prepare('INSERT INTO paper_orders_v3 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'main',id,'BTC-USD','coinbase|spot|BTC-USD',side,quantity,side==='buy'?'168400':'84208','filled','fixture-rules','fixture-evidence',null,at,at);
    database.prepare('INSERT INTO paper_fills_v3 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(`fill-${id}`,id,'main',quantity,price,side==='buy'?'168400':'84208',fee,'1','1','0',at,'fixture-market');
    database.prepare('INSERT INTO paper_order_events_v3 VALUES (?,?,?,?,?,?,?)').run(`state-${id}`,id,'main',0,'filled',at,'{}');
  }
  savePaperExecutionProposal({id:'fixture-pending',profileId:'main',runId:'fixture-pending-run',revision:1,proposalHash:'f'.repeat(64),intentsJson:JSON.stringify([{asset:{instrument:{productId:'BTC-USD'}},side:'sell',amountUsd:'100',referencePriceUsd:'84210'}]),status:'pending_review',createdAt:now,updatedAt:now},database);
  const dispatch=createDispatcher({handlers:createTradingActivityHandlers({profileId:'main',database,now:()=>Date.now(),mark:()=>({priceUsd:'84210',source:'Isolated benchmark quote',atMs:Date.now()})})});
  return {dispatch,dispose:()=>database.close()};
}
