const lastIds = new Map<string,string>();
function enabled(): boolean { return window.coqui?.traceEnabled === true; }
function mark(stage:string,identity:string,started:number,count=0): void {
  if (!enabled()) return;
  performance.mark(`coqui:${stage}:${identity}`,{detail:{stage,identity,atMs:Date.now(),durationMs:performance.now()-started,count}});
  const old=performance.getEntriesByType('mark').filter(e=>e.name.startsWith('coqui:'));
  for(const entry of old.slice(0,Math.max(0,old.length-2000)))performance.clearMarks(entry.name);
}
export function beginQueryTrace(channel:string): {id:string;started:number}|null {
  if(!enabled()||!channel.startsWith('market-data.'))return null;
  return {id:crypto.randomUUID(),started:performance.now()};
}
export function finishQueryTrace(channel:string,trace:{id:string;started:number}|null,payloadBytes:number):void {
  if(!trace)return;lastIds.set(channel,trace.id);mark('renderer.receive',trace.id,trace.started,payloadBytes);
}
export function traceChannelCommit(channel:string,stage='renderer.commit'):void {
  const id=lastIds.get(channel);if(!enabled()||!id)return;
  const started=performance.now();mark(stage,id,started);
  requestAnimationFrame(()=>mark('renderer.paint',id,started));
}
/** Two-frame paint approximation, explicitly distinct from a DevTools input event trace. */
export function installInputTracing():()=>void {
  if(!enabled())return ()=>{};
  const listener=()=>{const id=crypto.randomUUID(),started=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>mark('input.two_frame_paint',id,started)));};
  document.addEventListener('pointerdown',listener,{passive:true});document.addEventListener('keydown',listener,{passive:true});
  return ()=>{document.removeEventListener('pointerdown',listener);document.removeEventListener('keydown',listener);};
}
