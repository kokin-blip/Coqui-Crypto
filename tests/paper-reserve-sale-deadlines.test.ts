import {describe,it,expect} from 'vitest';
import {createRequestDeadline,createIsolatedRequestDeadline,createResearchDeadline,withinDeadline} from '@coqui/adapters';
describe('P6-G independent observation deadline',()=>{
 it('does not preempt an existing execution or research budget',()=>{const execution=createRequestDeadline(()=>1000),research=createResearchDeadline(()=>1000),read=createIsolatedRequestDeadline(()=>1000);try{
  execution.check();research.check();read.dispose();execution.check();research.check();expect(execution.signal.aborted).toBe(false);expect(research.signal.aborted).toBe(false);
 }finally{read.dispose();research.dispose();execution.dispose();}});
 it('expires at the earlier wall or monotonic bound without extending another lane',()=>{let wall=1000,elapsed=0;const read=createIsolatedRequestDeadline(()=>wall,100,Number.MAX_SAFE_INTEGER,()=>elapsed),other=createIsolatedRequestDeadline(()=>1000,1000);try{
  wall=900;elapsed=101;expect(()=>read.check()).toThrow('deadline_exceeded');expect(read.signal.aborted).toBe(true);other.check();expect(other.signal.aborted).toBe(false);
 }finally{read.dispose();other.dispose();}});
 it('refuses an aborted noncancellable read even if its underlying result arrives later',async()=>{let complete!:(value:string)=>void;const read=createIsolatedRequestDeadline(()=>1000),operation=new Promise<string>(resolve=>{complete=resolve;}),bounded=withinDeadline(operation,read);read.dispose();await expect(bounded).rejects.toThrow('deadline_exceeded');complete('late');await operation;});
});
