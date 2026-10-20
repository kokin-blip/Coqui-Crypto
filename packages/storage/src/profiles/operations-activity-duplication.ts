import type { DatabaseSync } from 'node:sqlite';

/** Runtime observations retain their original profile/owner identity and are not cloned. */
export function excludeOperationsActivity(db:DatabaseSync):number {
  const count=Number((db.prepare('SELECT COUNT(*) AS count FROM operations_activity_events_v1').get() as {count:number}).count);
  db.exec(`DROP TRIGGER operations_activity_no_update; DROP TRIGGER operations_activity_no_delete;
    DELETE FROM operations_activity_events_v1;
    CREATE TRIGGER operations_activity_no_update BEFORE UPDATE ON operations_activity_events_v1
      BEGIN SELECT RAISE(ABORT,'operations activity is immutable'); END;
    CREATE TRIGGER operations_activity_no_delete BEFORE DELETE ON operations_activity_events_v1
      BEGIN SELECT RAISE(ABORT,'operations activity is immutable'); END;`);
  return count;
}
