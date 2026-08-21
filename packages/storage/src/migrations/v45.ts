import type { Migration } from './types.js';

/**
 * Admit `conservative-upper-bound` as a trial-registry completeness state.
 *
 * Migration 35 pinned the column to `complete` or `known-lower-bound`, on the
 * assumption that a search budget is either exact or unusable. Recovering the
 * predecessor's Obsidian vault produced a third case: a budget that is not
 * exact but is provably not an under-count. That is safe to deflate against,
 * because over-counting trials can only understate an edge.
 *
 * SQLite cannot alter a CHECK constraint, so the single-row table is rebuilt
 * and its value carried across. The registry records table is untouched.
 */
export const migrations45: readonly Migration[] = [{
  version: 45,
  name: 'trial_registry_conservative_upper_bound',
  up: (db) => {
    db.exec(`
      CREATE TABLE trial_registry_meta_v45 (
        singleton     INTEGER PRIMARY KEY CHECK (singleton = 1),
        completeness  TEXT NOT NULL CHECK (completeness IN
          ('complete', 'known-lower-bound', 'conservative-upper-bound'))
      );

      INSERT INTO trial_registry_meta_v45 (singleton, completeness)
      SELECT singleton, completeness FROM trial_registry_meta;

      DROP TABLE trial_registry_meta;

      ALTER TABLE trial_registry_meta_v45 RENAME TO trial_registry_meta;
    `);
  },
}];
