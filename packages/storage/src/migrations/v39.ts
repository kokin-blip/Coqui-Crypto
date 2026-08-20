import type { Migration } from './types.js';

/** Persist UTC cadence policy alongside durable owner-bound wallet leases. */
export const migrations39: readonly Migration[] = [{
  version: 39,
  name: 'wallet_scheduler_utc_cadence_policy',
  up: (db) => {
    db.exec(`
      ALTER TABLE wallet_schedule_lease
        ADD COLUMN cadence_ms INTEGER NOT NULL DEFAULT 86400000 CHECK (cadence_ms > 0);
      ALTER TABLE wallet_schedule_lease
        ADD COLUMN utc_offset_ms INTEGER NOT NULL DEFAULT 0 CHECK (utc_offset_ms >= 0);
      ALTER TABLE wallet_schedule_lease
        ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));

      CREATE INDEX wallet_schedule_due_enabled
        ON wallet_schedule_lease (enabled, next_run_at, profile_id);
    `);
  },
}];
