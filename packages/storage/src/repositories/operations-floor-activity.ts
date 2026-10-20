import { operationsActivityFromRow,operationsAttemptActive,type OperationsWorker } from './operations-activity.js';
import { operationsMessage } from './operations-journal-copy.js';
import type { OperationsFloorItem } from './operations-floor.js';
import type { Db } from '../sqlite/index.js';

/** Shared copy/status interpretation for the floor and grouped journal. */
export function operationsFloorActivity(items:readonly OperationsFloorItem[],profileId:string,db:Db,nowMs:number):readonly OperationsFloorItem[] {
  return items.map(item=>{
    const row=db.prepare(`SELECT * FROM operations_activity_events_v1 WHERE profile_id=? AND worker=?
      ORDER BY at_ms DESC,CASE WHEN phase LIKE '%_started' THEN 0 ELSE 1 END DESC,id DESC LIMIT 1`)
      .get(profileId,item.subsystem) as Record<string,unknown>|undefined;
    if(row===undefined||Number(row['at_ms'])<(item.evidenceAtMs??0))return item;
    try {
      const event=operationsActivityFromRow(row);
      const status=event.status==='running'&&(!operationsAttemptActive(db,event.attemptId)||(event.deadlineAtMs!==null&&event.deadlineAtMs<=nowMs))?'unknown':event.status;
      return {...item,state:status==='unknown'?'unavailable':status==='running'||status==='waiting'?'active':
        status==='failed'||status==='blocked'||status==='cancelled'?'attention':'nominal',
        detail:operationsMessage(event.worker as OperationsWorker,event.phase,status,event.facts).slice(0,320),
        evidenceAtMs:event.atMs,evidenceId:event.id,
        decisionId:typeof event.facts.decisionId==='string'?event.facts.decisionId:null,scope:'profile'};
    } catch {return {...item,state:'attention',detail:'Latest operations evidence failed integrity verification.'};}
  });
}
