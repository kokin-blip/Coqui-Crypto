import {describe,expect,it} from 'vitest';
import {projectBrokerEquity,type BrokerCashEvidence} from '../packages/core/src/portfolio/index.js';
const evidence:BrokerCashEvidence={openingCashUsd:'1000',cashUsd:'1055.06',startedAtMs:1000,complete:true,
  activities:[{id:'fund',activity_type:'JNLC',net_amount:'1000',currency:'USD',status:'executed',created_at:'1970-01-01T00:00:00Z'},
    {id:'buy',activity_type:'FILL',order_id:'buy-order',symbol:'BTC/USD',side:'buy',qty:'3',price:'33.335',transaction_time:'1970-01-01T00:00:02Z'},
    {id:'sell',activity_type:'FILL',order_id:'sell-order',symbol:'BTC/USD',side:'sell',qty:'1',price:'34.567',transaction_time:'1970-01-01T00:00:03Z'},
    {id:'fee',activity_type:'CFEE',net_amount:'-0.10',currency:'USD',status:'executed',created_at:'1970-01-01T00:00:04Z'},
    {id:'asset-fee',activity_type:'CFEE',net_amount:'0',qty:'-0.0075',symbol:'BTCUSD',currency:'USD',status:'executed',created_at:'1970-01-01T00:00:04Z'}],
  orders:[{id:'buy-order',filled_qty:'3',symbol:'BTC/USD',side:'buy'},{id:'sell-order',filled_qty:'1',symbol:'BTC/USD',side:'sell'}]};
const input={equityUsd:'1200',openingEquityUsd:'1000',history:{points:[{atMs:500,equityUsd:'1000'},{atMs:5000,equityUsd:'1200'}],cashflows:{JNLC:['1000','120.60'],CFEE:['0','-0.10']}}};
const project=(cashEvidence:BrokerCashEvidence=evidence)=>projectBrokerEquity({...input,cashEvidence});
describe('broker cashflow reconciliation',()=>{
  it('ties each cent-rounded fill and posted cash fees to cash without allocating asset fees or inventing a journal',()=>{
    expect(project()).toMatchObject({netPnlUsd:'79.40',netPnlReason:'cash_reconciled',cashReconciliation:{reconciled:true,residualUsd:'0.00',journalDetailsComplete:false,fillCount:2}});
    expect(evidence.activities).toHaveLength(5);
  });
  it('does not subtract cash or asset fees twice from broker equity',()=>{
    expect(project().netPnlUsd).toBe('79.40');
    expect(project({...evidence,activities:evidence.activities.filter(a=>a.id!=='asset-fee')}).netPnlUsd).toBe('79.40');
  });
  it('distinguishes a missing journal description from a contradictory recorded journal',()=>{
    const journal={id:'journal',activity_type:'JNLC',net_amount:'120.60',currency:'USD',status:'executed',created_at:'1970-01-01T00:00:04Z'};
    expect(project({...evidence,activities:[...evidence.activities,journal]}).cashReconciliation?.journalDetailsComplete).toBe(true);
    expect(project({...evidence,activities:[...evidence.activities,{...journal,net_amount:'110.60'}]}).netPnlUsd).toBeNull();
  });
  it('retains a one-cent mismatch rather than using a tolerance to force reconciliation',()=>{
    expect(project({...evidence,cashUsd:'1055.07'})).toMatchObject({netPnlUsd:null,cashReconciliation:{reconciled:false,residualUsd:'0.01'}});
  });
  it.each([
    {...evidence,complete:false},
    {...evidence,activities:[...evidence.activities,evidence.activities[1]!] },
    {...evidence,activities:evidence.activities.filter(a=>a.id!=='buy')},
    {...evidence,orders:evidence.orders.map(a=>({...a,filled_qty:'2'}))},
    {...evidence,orders:[]},
    {...evidence,activities:evidence.activities.map(a=>a.id==='buy'?{...a,side:'other'}:a)},
    {...evidence,activities:evidence.activities.map(a=>a.id==='fee'?{...a,currency:'EUR'}:a)},
    {...evidence,activities:evidence.activities.map(a=>a.id==='fee'?{...a,status:'pending'}:a)},
    {...evidence,activities:evidence.activities.map(a=>a.id==='fee'?{...a,net_amount:'NaN'}:a)},
    {...evidence,activities:evidence.activities.map(a=>a.id==='buy'?{...a,transaction_time:'bad'}:a)},
    {...evidence,activities:[...evidence.activities,{id:'unknown',activity_type:'DIV',net_amount:'0',currency:'USD',status:'executed',created_at:'1970-01-01T00:00:04Z'}]},
  ])('withholds net P/L for incomplete or contradictory activity/order evidence (%#)',cash=>{expect(project(cash).netPnlUsd).toBeNull();});
  it('requires a proved all-cash opening and supported complete cashflows',()=>{
    expect(project({...evidence,openingCashUsd:'999'}).netPnlUsd).toBeNull();
    for(const history of [{...input.history,cashflows:null},{...input.history,cashflows:{JNLC:['1000',null]}},
      {...input.history,cashflows:{...input.history.cashflows,JNLS:['0','10']}},
      {...input.history,points:[{atMs:500,equityUsd:'999'},{atMs:5000,equityUsd:'1200'}]}]){
      expect(projectBrokerEquity({...input,history,cashEvidence:evidence}).netPnlUsd).toBeNull();
    }
  });
});
