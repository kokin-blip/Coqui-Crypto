import { randomUUID } from 'node:crypto';
import { appendOperationsActivity,setOperationsAttemptActive,type Db,type OperationsActivitySource,
  type OperationsActivityStatus,type OperationsFacts,type OperationsWorker } from '@coqui/storage';

/** Observations never change a task's return value, refusal, or exception path. */
export function startOperationsActivity(input:{database:Db;profileId:string;workId:string;worker:OperationsWorker;
  source:OperationsActivitySource;phase:string;now:()=>number;facts?:OperationsFacts;
  deadlineAtMs?:number;recordStart?:boolean;onUnexpectedError?:((context:string,error:unknown)=>void)|undefined}) {
  const attemptId=randomUUID();
  const record=(phase:string,status:OperationsActivityStatus,facts:OperationsFacts={})=>{
    try { appendOperationsActivity({profileId:input.profileId,workId:input.workId,attemptId,worker:input.worker,
      source:input.source,phase,status,atMs:input.now(),deadlineAtMs:status==='running'?input.deadlineAtMs??null:null,
      facts:{...input.facts,...facts}},input.database); }
    catch { try { input.onUnexpectedError?.('operations_observation',new Error('Operations evidence could not be recorded.')); } catch { return; } }
  };
  if(input.recordStart!==false){setOperationsAttemptActive(input.database,attemptId,true);record(input.phase,'running');}
  return {attemptId,workId:input.workId,finish(phase:string,status:OperationsActivityStatus='completed',facts:OperationsFacts={}) {
    setOperationsAttemptActive(input.database,attemptId,false);record(phase,status,facts);
  }};
}
