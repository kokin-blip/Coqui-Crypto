import { describe,expect,it } from 'vitest';
import { appendOperationsActivity,listOperationsJournal,openDatabase,readOperationsJournalGroup,
  setOperationsAttemptActive,operationsJournalRevision } from '../packages/storage/src/index.js';

describe('Operations grouped handoffs journal',()=>{
  it('starts empty with honest coverage and does not create evidence on reads',()=>{
    const db=openDatabase(':memory:');const before=operationsJournalRevision(db);
    const view=listOperationsJournal('main',null,5,null,db,100);
    expect(view.groups).toEqual([]);expect(view.coverage).toHaveLength(6);
    expect(view.coverage.every(c=>c.status==='unavailable')).toBe(true);
    expect(operationsJournalRevision(db)).toBe(before);db.close();
  });
  it('groups real workers, retains technical facts and distinguishes active from interrupted work',()=>{
    const db=openDatabase(':memory:');
    const input={profileId:'main',workId:'market:scan',attemptId:'attempt',worker:'market' as const,
      source:'market' as const,phase:'market_refresh_started',status:'running' as const,atMs:100,deadlineAtMs:200,
      facts:{instruments:'BTC-USD'}};
    const stored=appendOperationsActivity(input,db);expect(appendOperationsActivity(input,db).id).toBe(stored.id);
    setOperationsAttemptActive(db,'attempt',true);
    expect(readOperationsJournalGroup('main','market:scan',null,50,null,db,150).entries[0]?.message).toContain('I’m checking BTC-USD');
    setOperationsAttemptActive(db,'attempt',false);
    expect(readOperationsJournalGroup('main','market:scan',null,50,null,db,150).entries[0]?.status).toBe('unknown');
    appendOperationsActivity({...input,phase:'market_refresh_finished',status:'completed',atMs:160,deadlineAtMs:null},db);
    const detail=readOperationsJournalGroup('main','market:scan',null,50,null,db,170);
    expect(detail.entries).toHaveLength(2);expect(detail.group.status).toBe('completed');
    expect(detail.entries[0]?.message).not.toContain('I’m');
    expect(detail.entries[1]?.facts.instruments).toBe('BTC-USD');
    expect(()=>readOperationsJournalGroup('other','market:scan',null,50,null,db,170)).toThrow('journal_group_not_found');
    db.close();
  });
  it('paginates beyond per-source windows with equal timestamps and no duplicate groups or entries',()=>{
    const db=openDatabase(':memory:');
    for(let i=0;i<31;i++)appendOperationsActivity({profileId:'main',workId:`host:work-${String(i).padStart(2,'0')}`,
      attemptId:`a-${i}`,worker:'host',source:'host',phase:'evaluation_finished',status:'completed',atMs:100,
      deadlineAtMs:null,facts:{}},db);
    const ids:string[]=[];let cursor:string|null=null;
    do {const page=listOperationsJournal('main',null,5,cursor,db,200);ids.push(...page.groups.map(g=>g.id));cursor=page.nextCursor;}while(cursor!==null);
    expect(ids).toHaveLength(31);expect(new Set(ids).size).toBe(31);
    expect(listOperationsJournal('main','research',5,null,db,200).groups).toEqual([]);db.close();
  });
  it('rejects unsafe facts and changed identities and keeps the table append-only',()=>{
    const db=openDatabase(':memory:');const input={profileId:'main',workId:'advisor:one',attemptId:'one',worker:'advisor' as const,
      source:'advisor' as const,phase:'explanation_finished',status:'completed' as const,atMs:100,deadlineAtMs:null,facts:{}};
    appendOperationsActivity(input,db);
    expect(()=>appendOperationsActivity({...input,atMs:101},db)).toThrow('operations_activity_conflict');
    expect(()=>appendOperationsActivity({...input,facts:{secret:'CANARY'} as never},db)).toThrow('invalid_operations_fact');
    expect(()=>db.prepare('UPDATE operations_activity_events_v1 SET at_ms=101').run()).toThrow();
    expect(()=>db.prepare('DELETE FROM operations_activity_events_v1').run()).toThrow();db.close();
  });
});
