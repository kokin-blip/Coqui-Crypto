import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request correlation survives awaits without mixing concurrent provider requests. */
export interface AdvisorAuditContext { lastRecord:string|null; lastOutcome:string|null }
const current=new AsyncLocalStorage<AdvisorAuditContext>();
export function withAdvisorAuditContext<T>(context:AdvisorAuditContext,run:()=>Promise<T>):Promise<T> {
  return current.run(context,run);
}
export function correlateAdvisorAudit(sequence:string,outcome:string):void {
  const context=current.getStore();
  if(context!==undefined){context.lastRecord=`advisor-audit:${sequence}`;context.lastOutcome=outcome;}
}
