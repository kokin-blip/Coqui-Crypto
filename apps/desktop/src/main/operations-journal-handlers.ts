import type { ChannelRequest } from '@coqui/contracts';
import { listOperationsJournal,operationsJournalRevision,readOperationsJournalGroup,type Db } from '@coqui/storage';
import type { ChannelHandlers } from './dispatch.js';

/** Cache only bounded read projections. A DB revision notices detached writers too. */
export function createOperationsJournalHandlers(input:{profileId:string;database:Db;now:()=>number}):ChannelHandlers {
  const cache=new Map<string,{revision:string;value:unknown;atMs:number}>();
  const read=<T>(key:string,load:()=>T):T=>{
    const revision=operationsJournalRevision(input.database),prior=cache.get(key);
    if(prior?.revision===revision&&(!JSON.stringify(prior.value).includes('running')||input.now()-prior.atMs<2000))return {...prior.value as T,asOfMs:input.now()};
    const value=load();
    if(cache.size>=24)cache.delete(cache.keys().next().value!);
    cache.set(key,{revision,value,atMs:input.now()});return value;
  };
  return {
    'operations.journal':(payload:ChannelRequest<'operations.journal'>)=>({ok:true,value:read(`groups:${JSON.stringify(payload)}`,
      ()=>listOperationsJournal(input.profileId,payload.worker,payload.limit,payload.cursor,input.database,input.now()))}),
    'operations.journal.group':(payload:ChannelRequest<'operations.journal.group'>)=>({ok:true,value:read(`group:${JSON.stringify(payload)}`,
      ()=>readOperationsJournalGroup(input.profileId,payload.groupId,payload.worker,payload.limit,payload.cursor,input.database,input.now()))}),
  };
}
