import { getStrategyDecision } from './decision-evidence.js';
import { sha256Hex } from '@coqui/core';
import { OPERATIONS_WORKERS, operationsActivityFromRow, operationsAttemptActive,
  validateOperationsFacts, type OperationsActivitySource, type OperationsActivityStatus,
  type OperationsFacts, type OperationsWorker } from './operations-activity.js';
import { operationsMessage } from './operations-journal-copy.js';
import { OPERATIONS_JOURNAL_SQL,OPERATIONS_OUTCOME_PRIORITY } from './operations-journal-sources.js';
import { getDecisionDetail } from './decision-timeline.js';
import type { Db } from '../sqlite/index.js';

export interface OperationsJournalEntry {
  readonly id:string; readonly groupId:string; readonly attemptId:string; readonly worker:OperationsWorker;
  readonly source:OperationsActivitySource; readonly phase:string; readonly status:OperationsActivityStatus;
  readonly atMs:number; readonly scope:'profile'|'global'; readonly message:string;
  readonly facts:OperationsFacts; readonly contentHash:string|null;
}
export interface OperationsJournalGroup {
  readonly id:string; readonly label:string; readonly source:OperationsActivitySource; readonly scope:'profile'|'global';
  readonly startedAtMs:number; readonly updatedAtMs:number; readonly status:OperationsActivityStatus;
  readonly entryCount:number; readonly revision:string;
}
interface Cursor { atMs:number; id:string; order?:number }
function cursor(value:string|null):Cursor|null {
  if(value===null) return null;
  const parsed=JSON.parse(value) as Cursor;
  if(!Number.isSafeInteger(parsed.atMs)||parsed.atMs<0||typeof parsed.id!=='string'||parsed.id.length>256||parsed.order!==undefined&&!Number.isSafeInteger(parsed.order))throw new TypeError('invalid_journal_cursor');
  return parsed;
}
function safeLimit(value:number,max:number):number {
  if(!Number.isSafeInteger(value)||value<1||value>max)throw new TypeError('invalid_journal_limit');
  return value;
}
function entry(row:Record<string,unknown>,database:Db,nowMs:number):OperationsJournalEntry {
  const facts=JSON.parse(String(row['facts_json'])) as OperationsFacts;
  validateOperationsFacts(facts);
  const id=String(row['id']);
  // Native lifecycle records are integrity checked, including the stored identity.
  if(/^[a-f0-9]{64}$/u.test(id)) {
    const stored=database.prepare('SELECT * FROM operations_activity_events_v1 WHERE id=?').get(id) as Record<string,unknown>|undefined;
    if(stored===undefined)throw new Error('operations_activity_missing');
    operationsActivityFromRow(stored);
  }
  let status=row['status'] as OperationsActivityStatus;
  if(status==='running') {
    const deadline=row['deadline_at_ms']===null?null:Number(row['deadline_at_ms']);
    let terminated=database.prepare(`SELECT 1 FROM operations_activity_events_v1
      WHERE profile_id=(SELECT profile_id FROM operations_activity_events_v1 WHERE id=?)
      AND attempt_id=? AND worker=? AND status<>'running' LIMIT 1`).get(id,String(row['attempt_id']),String(row['worker']));
    if(row['worker']==='research')terminated=database.prepare(`SELECT 1 FROM research_job_events
      WHERE job_id=? AND json_extract(detail_json,'$.attemptId')=? AND event<>'worker_started' LIMIT 1`)
      .get(String(facts.jobId??''),String(row['attempt_id']));
    if(terminated!==undefined)status='completed';
    else if(!operationsAttemptActive(database,String(row['attempt_id']))||deadline!==null&&deadline<=nowMs)status='unknown';
  }
  const worker=row['worker'] as OperationsWorker,phase=String(row['phase']);
  return {id,groupId:String(row['work_id']),attemptId:String(row['attempt_id']),worker,
    source:row['source'] as OperationsActivitySource,phase,status,atMs:Number(row['at_ms']),
    scope:row['scope'] as 'profile'|'global',facts,contentHash:row['content_hash']===null?null:String(row['content_hash']),
    message:operationsMessage(worker,phase,status,facts)};
}
function instrumentsFor(profileId:string,groupId:string,raw:unknown,db:Db):string {
  const values=new Set(typeof raw==='string'?raw.split(/,\s*/u).filter(Boolean):[]);
  if(groupId.startsWith('decision:')){
    const decision=getStrategyDecision(groupId.slice(9),db)?.decision;
    if(decision?.profileId===profileId)for(const target of [...decision.targets,...decision.facts?.momentum??[]]){
      if(target.assetId.startsWith('coinbase|spot|')){
        const product=target.assetId.slice(14);values.delete(product.replace(/-USD$/u,''));values.add(product);
      }
    }
  }
  const ordered=[...values].sort();return ordered.slice(0,6).join(', ')+(ordered.length>6?` +${ordered.length-6} more`:'');
}
function label(id:string,facts:OperationsFacts):string {
  if(id.startsWith('decision:')||id.startsWith('run:'))return `${facts.instruments || 'Portfolio'} · paper evaluation`;
  if(id.startsWith('research:'))return 'Research job';
  if(id.startsWith('parallel:'))return 'Parallel · local + Alpaca paper';
  if(id.startsWith('market:'))return `${facts.instruments || 'Market'} · completed-candle refresh`;
  if(id.startsWith('advisor'))return 'Advisor request';
  return 'Host coordination';
}
export function operationsJournalRevision(database:Db):string {
  const local=database.prepare('SELECT total_changes() AS revision').get() as {revision:number};
  const external=database.prepare('PRAGMA data_version').get() as {data_version:number};
  return `${local.revision}:${external.data_version}`;
}
export function listOperationsJournal(profileId:string,worker:OperationsWorker|null,limit:number,before:string|null,
  database:Db,nowMs:number) {
  safeLimit(limit,20);const boundary=cursor(before);
  if(worker!==null&&!OPERATIONS_WORKERS.includes(worker))throw new TypeError('invalid_journal_worker');
  const rows=database.prepare(`${OPERATIONS_JOURNAL_SQL}, groups AS (
    SELECT work_id,MIN(at_ms) AS started_at,MAX(at_ms) AS updated_at,COUNT(*) AS entry_count,
      group_concat(DISTINCT json_extract(facts_json,'$.instruments')) AS instruments,
      MAX(CASE WHEN source IN('paper_ledger','exploratory','parallel') THEN source ELSE NULL END) AS execution_source
    FROM journal GROUP BY work_id HAVING (? IS NULL OR SUM(worker=?)>0)), ranked AS (
      SELECT r.*,ROW_NUMBER() OVER(PARTITION BY work_id ORDER BY ${OPERATIONS_OUTCOME_PRIORITY} DESC,at_ms DESC,
        event_order DESC,id DESC) AS latest
      FROM journal r)
    SELECT r.*,g.started_at,g.updated_at,g.entry_count,g.instruments,g.execution_source
      FROM groups g JOIN ranked r ON r.work_id=g.work_id AND r.latest=1
      WHERE (? IS NULL OR g.updated_at<? OR (g.updated_at=? AND g.work_id<?))
      ORDER BY g.updated_at DESC,g.work_id DESC LIMIT ?`).all(profileId,worker,worker,boundary?.atMs??null,
        boundary?.atMs??null,boundary?.atMs??null,boundary?.id??null,limit+1) as Record<string,unknown>[];
  const groups:OperationsJournalGroup[]=rows.slice(0,limit).map(row=>{
    const top=entry(row,database,nowMs),groupId=String(row['work_id']);
    return {id:groupId,label:label(groupId,{...top.facts,instruments:instrumentsFor(profileId,groupId,row['instruments'],database)}),
      source:(row['execution_source']??top.source) as OperationsActivitySource,scope:top.scope,
      startedAtMs:Number(row['started_at']),updatedAtMs:Number(row['updated_at']),status:top.status,
      entryCount:Number(row['entry_count']),revision:sha256Hex(`${groupId}:${row['entry_count']}:${row['updated_at']}:${top.status}`)};
  });
  const coverageRows=database.prepare(`${OPERATIONS_JOURNAL_SQL} SELECT worker,MAX(at_ms) AS at_ms FROM journal GROUP BY worker`)
    .all(profileId) as Record<string,unknown>[];
  const coverage=OPERATIONS_WORKERS.map(subsystem=>({worker:subsystem,
    lastAtMs:coverageRows.find(row=>row['worker']===subsystem)?.['at_ms'] as number|undefined ?? null,
    status:coverageRows.some(row=>row['worker']===subsystem)?'available' as const:'unavailable' as const}));
  const last=rows.slice(0,limit).at(-1);
  return {groups,coverage,nextCursor:rows.length>limit&&last!==undefined?
    JSON.stringify({atMs:Number(last['updated_at']),id:String(last['work_id'])}):null,
    revision:sha256Hex(JSON.stringify([groups.map(group=>group.revision),coverage])),asOfMs:nowMs};
}
export function readOperationsJournalGroup(profileId:string,groupId:string,worker:OperationsWorker|null,
  limit:number,before:string|null,database:Db,nowMs:number) {
  safeLimit(limit,50);const boundary=cursor(before);
  const metadata=database.prepare(`${OPERATIONS_JOURNAL_SQL} SELECT COUNT(*) AS count,MIN(at_ms) AS started,
    MAX(at_ms) AS updated FROM journal WHERE work_id=?`).get(profileId,groupId) as {count:number;started:number;updated:number};
  if(metadata.count===0)throw new Error('journal_group_not_found');
  const latest=database.prepare(`${OPERATIONS_JOURNAL_SQL} SELECT * FROM journal WHERE work_id=?
    ORDER BY ${OPERATIONS_OUTCOME_PRIORITY} DESC,at_ms DESC,event_order DESC,id DESC LIMIT 1`).get(profileId,groupId) as Record<string,unknown>;
  const top=entry(latest,database,nowMs);
  const rows=database.prepare(`${OPERATIONS_JOURNAL_SQL} SELECT * FROM journal WHERE work_id=? AND (? IS NULL OR worker=?)
    AND (? IS NULL OR at_ms<? OR (at_ms=? AND (event_order<? OR (event_order=? AND id<?)))) ORDER BY at_ms DESC,event_order DESC,id DESC LIMIT ?`)
    .all(profileId,groupId,worker,worker,boundary?.atMs??null,boundary?.atMs??null,boundary?.atMs??null,boundary?.order??0,boundary?.order??0,boundary?.id??null,limit+1) as Record<string,unknown>[];
  const entries=rows.slice(0,limit).map(row=>entry(row,database,nowMs));
  // Verify immutable decision evidence on detail reads, never return its raw stored JSON.
  if(groupId.startsWith('decision:'))getDecisionDetail(profileId,groupId.slice(9),database);
  const group:OperationsJournalGroup={id:groupId,label:label(groupId,top.facts),source:top.source,scope:top.scope,
    startedAtMs:metadata.started,updatedAtMs:metadata.updated,status:top.status,entryCount:metadata.count,
    revision:sha256Hex(`${groupId}:${metadata.count}:${metadata.updated}:${top.status}`)};
  const last=entries.at(-1);
  return {group,entries:entries.reverse(),nextCursor:rows.length>limit&&last!==undefined?
    JSON.stringify({atMs:last.atMs,id:last.id,order:Number(rows[Math.min(limit,rows.length)-1]?.['event_order']??0)}):null,historyComplete:rows.length<=limit&&before===null,
    revision:group.revision,asOfMs:nowMs};
}
