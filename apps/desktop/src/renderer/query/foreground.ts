import { useSyncExternalStore } from 'react';

const listeners=new Set<()=>void>();
const current=()=>document.visibilityState==='visible'&&document.hasFocus();
const always=()=>true;
const noop=()=>()=>{};
const notify=()=>{for(const listener of listeners)listener();};
function subscribe(listener:()=>void):()=>void {
  if(listeners.size===0){window.addEventListener('focus',notify);window.addEventListener('blur',notify);document.addEventListener('visibilitychange',notify);}
  listeners.add(listener);
  return ()=>{
    listeners.delete(listener);
    if(listeners.size===0){window.removeEventListener('focus',notify);window.removeEventListener('blur',notify);document.removeEventListener('visibilitychange',notify);}
  };
}
/** Native windows can be visible while another application owns keyboard focus. */
export function useForeground(required:boolean):boolean {
  return useSyncExternalStore(required?subscribe:noop,required?current:always,always);
}
