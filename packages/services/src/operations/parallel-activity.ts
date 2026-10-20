import { appendOperationsActivity,type Db,type ParallelPaperEvent,type OperationsActivityStatus,
  type OperationsFacts,type OperationsWorker } from '@coqui/storage';

const phases=new Set(['decision','external_intent','submit_attempt','external_order','external_fill','local_fill',
  'external_complete','intraday_complete','intraday_skipped','paused','resumed','stopped','started','reconciliation_error','pass_deferred']);
/** Supplement native outcomes with explicit pass/order correlation, never change the native journal. */
export function recordParallelOperationsActivity(event:ParallelPaperEvent,workId:string|null,db:Db,onUnexpectedError?: (context:string,error:unknown)=>void):void {
  if(!phases.has(event.kind))return;
  try {
    const d=event.detail;
    const orderId=typeof d['orderId']==='string'?d['orderId']:null;
    const clientOrderId=typeof d['clientOrderId']==='string'?d['clientOrderId']:null;
    const prior=orderId===null&&clientOrderId===null?undefined:db.prepare(`SELECT work_id FROM operations_activity_events_v1
      WHERE profile_id=? AND source='parallel' AND
      ((? IS NOT NULL AND json_extract(facts_json,'$.orderId')=?) OR
       (? IS NOT NULL AND json_extract(facts_json,'$.clientOrderId')=?)) ORDER BY at_ms,id LIMIT 1`)
      .get(event.profileId,orderId,orderId,clientOrderId,clientOrderId) as {work_id:string}|undefined;
    const worker:OperationsWorker=event.kind==='decision'?'market':event.kind==='intraday_skipped'?'risk':
      ['paused','resumed','stopped','started','pass_deferred'].includes(event.kind)?'host':'execution';
    const status:OperationsActivityStatus=['paused','intraday_skipped'].includes(event.kind)?'blocked':
      event.kind==='reconciliation_error'?'failed':['external_intent','external_order','external_fill','submit_attempt','pass_deferred'].includes(event.kind)?'waiting':'completed';
    const facts:OperationsFacts={campaignId:event.experimentId,orderId,clientOrderId,sourceRecord:`parallel:${event.id}`,
      ...(typeof d['symbol']==='string'?{instruments:d['symbol']}:{}),
      ...(typeof d['reason']==='string'&&/^[a-z][a-z0-9_]{0,79}$/u.test(d['reason'])?{reasonCode:d['reason']}:{}),
      operation:event.kind};
    appendOperationsActivity({profileId:event.profileId,workId:prior?.work_id??workId??`parallel:${event.experimentId}:${event.id}`,
      attemptId:`parallel-event:${event.id}`,worker,source:'parallel',phase:event.kind,status,atMs:event.at,
      deadlineAtMs:null,facts},db);
  } catch {try {onUnexpectedError?.('operations_observation',new Error('Parallel operations evidence could not be recorded.'));}catch {/* Reporting cannot affect execution. */}}
}
