import { useQueryClient } from '@tanstack/react-query';
import { useEffect,useState } from 'react';
import type { ChannelResponse,CoquiClient } from '@coqui/contracts';
import { useChannel } from '../query/use-channel.js';

type Index=ChannelResponse<'operations.journal'>;
type Detail=ChannelResponse<'operations.journal.group'>;
export type JournalWorker=Index['coverage'][number]['worker'];
function merge<T extends {readonly id:string}>(prior:readonly T[],next:readonly T[],max:number):readonly T[] {
  const values=new Map(prior.map(item=>[item.id,item]));next.forEach(item=>values.set(item.id,item));
  return [...values.values()].slice(0,max);
}
export function useOperationsJournal(client:CoquiClient,profileId:string) {
  const queries=useQueryClient();
  const [worker,setWorker]=useState<JournalWorker|null>(null);
  const [collapsed,setCollapsed]=useState(false),[paused,setPaused]=useState(false),[held,setHeld]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  const [cursor,setCursor]=useState<string|null>(null),[entryCursor,setEntryCursor]=useState<string|null>(null);
  const [view,setView]=useState<Index|null>(null),[detail,setDetail]=useState<Detail|null>(null);
  const feed=useChannel(client,'operations.journal',{worker,limit:5,cursor},!collapsed,profileId);
  // Keep the newest page observed while browsing older pages, without another polling timer.
  const latest=useChannel(client,'operations.journal',{worker,limit:5,cursor:null},!collapsed&&cursor!==null,profileId);
  const chosen=selected===''?null:selected??view?.groups[0]?.id??null;
  const group=useChannel(client,'operations.journal.group',{groupId:chosen??'unselected',worker,limit:50,cursor:entryCursor},
    !collapsed&&chosen!==null,profileId);
  const incoming=feed.kind==='ready'?feed.value:null,head=cursor===null?incoming:latest.kind==='ready'?latest.value:null;
  const incomingDetail=group.kind==='ready'?group.value:null;
  useEffect(()=>{if(head!==null)void queries.invalidateQueries({queryKey:['operations.floor']});},[queries,head?.revision]);
  useEffect(()=>{
    if(incoming===null||paused||held&&cursor===null)return;
    setView(prior=>cursor===null?incoming:{...incoming,groups:merge(prior?.groups??[],incoming.groups,20)});
  },[incoming,paused,held,cursor]);
  useEffect(()=>{
    if(incomingDetail===null||incomingDetail.group.id!==chosen||paused)return;
    setDetail(prior=>{
      if(held&&entryCursor===null&&prior?.group.id===chosen)return prior;
      return entryCursor===null||prior?.group.id!==chosen?incomingDetail:
        {...incomingDetail,entries:merge(incomingDetail.entries,prior.entries,200).slice(-200)};
    });
  },[incomingDetail,chosen,paused,held,entryCursor]);
  const changeWorker=(value:JournalWorker|null)=>{
    setWorker(value);setView(null);setDetail(null);setSelected(null);setCursor(null);
    setEntryCursor(null);setHeld(false);setPaused(false);
  };
  const jump=()=>{
    setPaused(false);setHeld(false);setCursor(null);setEntryCursor(null);setSelected(null);setDetail(null);
    if(head!==null)setView(head);
  };
  const select=(id:string)=>{
    setHeld(true);setEntryCursor(null);setDetail(null);setSelected(id===chosen?'':id);
  };
  const newActivity=head!==null&&view!==null&&(head.revision!==view.revision||
    incomingDetail!==null&&detail!==null&&incomingDetail.revision!==detail.revision);
  return {worker,changeWorker,collapsed,setCollapsed,paused,setPaused,held,setHeld,view,detail,
    feed,group,chosen,newActivity,jump,select,
    olderGroups(){if(view?.nextCursor!==null&&view!==null){setHeld(true);setCursor(view.nextCursor);}},
    olderEntries(){if(detail?.nextCursor!==null&&detail!==null){setHeld(true);setEntryCursor(detail.nextCursor);}},
  };
}
