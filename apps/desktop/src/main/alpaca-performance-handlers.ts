import {createAlpacaPaperClient,AlpacaPaperError,type SecretStore,type AlpacaPaperCredentials} from '@coqui/adapters';
import {projectBrokerEquity,sha256Hex} from '@coqui/core';
import {ingestAlpacaCapital,recordCapitalIngestionFailure} from '@coqui/services';
import {tradingActivityScopes,type Db} from '@coqui/storage';
import type {ChannelRequest,ChannelResponse} from '@coqui/contracts';
import type {ChannelHandlers} from './dispatch.js';
type Client=Pick<ReturnType<typeof createAlpacaPaperClient>,'account'|'portfolioHistory'|'allActivities'|'orders'>;
type Value=ChannelResponse<'alpaca.paper.performance'>;
export function createAlpacaPerformanceHandlers(input:{profileId:string;database:Db;now:()=>number;secrets?:SecretStore;
  clientFactory?:(credentials:AlpacaPaperCredentials)=>Client}):ChannelHandlers {
  let cache:{key:string;value:Value}|null=null;
  let pending:{key:string;value:Promise<Value>}|null=null;
  const fail=(code:string)=>({ok:false as const,issues:[{path:[],code}]});
  return {'alpaca.paper.performance':async(filter:ChannelRequest<'alpaca.paper.performance'>)=>{
    const catalog=tradingActivityScopes(input.profileId,input.database);
    const scope=catalog.scopes.find(scope=>scope.id===filter.scopeId&&scope.source==='alpaca_paper');
    const account=catalog.accounts.find(account=>account.scopeId===scope?.id);
    if(!scope||!account||filter.connectionId!==null&&filter.connectionId!==account.connectionId)return fail('activity_selection_unavailable');
    const experiment=input.database.prepare('SELECT alpaca_account_id,opening_alpaca_equity,opening_alpaca_cash,started_at FROM parallel_paper_experiments_v1 WHERE id=? AND profile_id=?')
      .get(scope.campaignId!,input.profileId) as {alpaca_account_id:string;opening_alpaca_equity:string;opening_alpaca_cash:string;started_at:number}|undefined;
    if(!experiment||!input.secrets)return fail('broker_performance_connection_unavailable');
    try {
      const stored=await input.secrets.read('alpaca-paper-credentials',input.profileId);
      if(!stored.ok||stored.value===null){cache=null;return fail('broker_performance_connection_unavailable');}
      const credentials=JSON.parse(stored.value) as AlpacaPaperCredentials;
      const key=sha256Hex(`${scope.id}:${stored.value}`);
      if(cache?.key===key&&input.now()-cache.value.asOfMs<30000)return {ok:true,value:cache.value};
      const read=async():Promise<Value>=>{
        const client=(input.clientFactory??createAlpacaPaperClient)(credentials);
        const broker=await client.account();
        if(broker.id!==experiment.alpaca_account_id||broker.currency!=='USD')throw new Error('broker_performance_account_mismatch');
        const end=input.now(),history=await client.portfolioHistory(broker.created_at??new Date(experiment.started_at).toISOString(),new Date(end).toISOString());
        const activityRead=async()=>{
          const all:Awaited<ReturnType<Client['allActivities']>>=[];let token:string|undefined;
          for(let page=0;page<20;page++){
            const batch=await client.allActivities(token);if(!Array.isArray(batch))throw new Error('invalid_activity_page');
            all.push(...batch);if(batch.length<100)return all;
            const next=batch.at(-1)?.id;if(!next||next===token)throw new Error('invalid_activity_cursor');token=next;
          }throw new Error('activity_history_capped');
        };
        const [activities,orders]=await Promise.allSettled([activityRead(),client.orders('all')]);
        const latest=await client.account();
        if(latest.id!==broker.id||latest.currency!=='USD')throw new Error('broker_performance_account_mismatch');
        const complete=activities.status==='fulfilled'&&orders.status==='fulfilled'&&Array.isArray(orders.value)&&broker.cash===latest.cash;
        const value={scopeId:scope.id,accountSuffix:broker.id.slice(-6),asOfMs:input.now(),paperOnly:true as const,
          ...projectBrokerEquity({equityUsd:latest.equity,openingEquityUsd:experiment.opening_alpaca_equity,history,
            cashEvidence:{openingCashUsd:experiment.opening_alpaca_cash,cashUsd:latest.cash,startedAtMs:experiment.started_at,complete,
              activities:activities.status==='fulfilled'?activities.value:[],orders:orders.status==='fulfilled'&&Array.isArray(orders.value)?orders.value:[]}})};
        try {
          ingestAlpacaCapital({profileId:input.profileId,connectionId:account.connectionId,expectedAccountId:experiment.alpaca_account_id,
            requestedAtMs:end,observedAtMs:value.asOfMs,account:latest,history,
            activities:activities.status==='fulfilled'?activities.value:[],orders:orders.status==='fulfilled'&&Array.isArray(orders.value)?orders.value:[],
            paginationComplete:activities.status==='fulfilled',ordersComplete:orders.status==='fulfilled'&&Array.isArray(orders.value)&&orders.value.length<500,
            cashReconciled:value.cashReconciliation?.reconciled??false,journalDetailsComplete:value.cashReconciliation?.journalDetailsComplete??false},input.database);
        } catch { recordCapitalIngestionFailure('alpaca',value.asOfMs,input.database); }
        cache={key,value};return value;
      };
      const task=pending?.key===key?pending.value:read();pending={key,value:task};
      try{return {ok:true,value:await task};}finally{if(pending?.value===task)pending=null;}
    }catch(error){cache=null;return fail(error instanceof AlpacaPaperError?`broker_performance_${error.code}`:
      error instanceof Error&&error.message==='broker_performance_account_mismatch'?error.message:'broker_performance_unavailable');}
  }};
}
