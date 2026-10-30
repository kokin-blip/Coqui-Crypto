import { describe,expect,it } from 'vitest';
import { profileConnectionV2,sha256Hex } from '../packages/core/src/index.js';
import { appendParallelEvent,listOperationsJournal,openDatabase,readOperationsJournalGroup,
  saveParallelExperiment,saveProfileConnectionV2,type Db } from '../packages/storage/src/index.js';

function experiment(db:Db,profileId:string) {
  const connection=profileConnectionV2(profileId,'coinbase',sha256Hex(profileId),1);
  saveProfileConnectionV2(connection,db);
  const snapshot=sha256Hex(`snapshot:${profileId}`),id=sha256Hex(`experiment:${profileId}`);
  db.prepare('INSERT INTO connection_account_snapshots_v2 VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(snapshot,profileId,connection.id,'coinbase',1,1,'healthy','{}',sha256Hex(`content:${profileId}`),1);
  saveParallelExperiment({id,profileId,sourceConnectionSnapshotId:snapshot,alpacaAccountId:'fixture',
    openingCoquiCash:'1000',openingAlpacaCash:'1000',openingAlpacaEquity:'1000',anchor:{},startedAt:1,configVersion:'fixture'},db);
  let sequence=0;
  return {id,append:(kind:string,detail:Record<string,unknown>)=>appendParallelEvent({experimentId:id,
    profileId,kind,detail,key:String(sequence++),at:100+sequence},db)};
}

describe('Operations journal accumulated parallel history',()=>{
  it('bounds identity lookups while preserving delayed-fill grouping, unmatched events and profile isolation',()=>{
    const db=openDatabase(':memory:');
    try {
      const main=experiment(db,'main'),other=experiment(db,'other');
      other.append('external_intent',{clientOrderId:'shared-client',day:'other-day'});
      other.append('external_order',{clientOrderId:'shared-client',orderId:'shared-order'});
      main.append('external_intent',{clientOrderId:'shared-client',day:'main-day'});
      main.append('external_order',{clientOrderId:'shared-client',orderId:'shared-order'});
      db.exec('BEGIN');
      for(let i=0;i<12000;i++)main.append('reconciliation_error',{reason:'broker_positions_mismatch'});
      db.exec('COMMIT');
      const delayed=main.append('external_fill',{orderId:'shared-order',symbol:'BTCUSD',quantity:'0.1'});
      const unmatched=main.append('external_fill',{orderId:'unmatched-order',symbol:'ETHUSD',quantity:'0.1'});
      const explicit=main.append('external_complete',{day:'explicit-day',orderId:'shared-order'});
      const before=db.prepare('SELECT total_changes() AS n').get(),started=performance.now();
      const view=listOperationsJournal('main',null,5,null,db,20000);
      const detail=readOperationsJournalGroup('main',`parallel:${main.id}:main-day`,null,50,null,db,20000);
      expect(performance.now()-started).toBeLessThan(2000);
      expect(view.groups.map(group=>group.id)).toContain(`parallel:${main.id}:${unmatched.id}`);
      expect(view.groups.map(group=>group.id)).toContain(`parallel:${main.id}:explicit-day`);
      expect(detail.entries.map(entry=>entry.id)).toContain(`parallel:${delayed.id}`);
      expect(detail.entries).toHaveLength(3);
      expect(detail.entries.map(entry=>entry.id)).not.toContain(`parallel:${explicit.id}`);
      expect(JSON.stringify(view)).not.toContain(other.id);
      expect(listOperationsJournal('other',null,5,null,db,20000).groups[0]?.id).toBe(`parallel:${other.id}:other-day`);
      expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(before);
    } finally {db.close();}
  });
});
