import { withAdvisorAuditContext,type AdvisorAuditContext,type Db,type OperationsFacts } from '@coqui/storage';
import { startOperationsActivity } from './activity.js';

export async function observeAdvisorActivity<T>(input:{database:Db;profileId:string;workId:string;now:()=>number;
  onUnexpectedError?:((context:string,error:unknown)=>void)|undefined;provider:string|null;operation:'facts'|'chat';facts?:OperationsFacts},run:()=>Promise<T>):Promise<T> {
  const context:AdvisorAuditContext={lastRecord:null,lastOutcome:null};
  const activity=startOperationsActivity({...input,worker:'advisor',source:'advisor',phase:'explanation_started',
    facts:{...input.facts,provider:input.provider??'local',operation:input.operation}});
  try {
    const result=await withAdvisorAuditContext(context,run);
    activity.finish('explanation_finished','completed',{sourceRecord:context.lastRecord,
      ...(context.lastOutcome==='failed'?{reasonCode:'provider_failed'}:{})});return result;
  } catch(error) {activity.finish('explanation_finished','failed',{sourceRecord:context.lastRecord});throw error;}
}
