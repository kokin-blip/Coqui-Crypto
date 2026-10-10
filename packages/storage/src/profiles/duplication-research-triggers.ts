import { DatabaseSync } from 'node:sqlite';

export function dropResearchDuplicationTriggers(database:DatabaseSync, sourceProfileId: string):number {
  if (database.prepare('SELECT 1 FROM wider_universe_records_v1 WHERE profile_id<>? LIMIT 1').get(sourceProfileId)) {
    throw new RangeError('Foreign profile identity detected.');
  }
  if (database.prepare('SELECT 1 FROM breakout_research_records_v1 WHERE profile_id<>? LIMIT 1').get(sourceProfileId) ||
      database.prepare('SELECT 1 FROM breakout_hourly_bars_v1 WHERE profile_id<>? LIMIT 1').get(sourceProfileId)) {
    throw new RangeError('Foreign profile identity detected.');
  }
  if (database.prepare('SELECT 1 FROM range_rotation_records_v1 WHERE profile_id<>? LIMIT 1').get(sourceProfileId)) {
    throw new RangeError('Foreign profile identity detected.');
  }
  if (database.prepare('SELECT 1 FROM market_selector_records_v1 WHERE profile_id<>? LIMIT 1').get(sourceProfileId)) {
    throw new RangeError('Foreign profile identity detected.');
  }
  if (database.prepare('SELECT 1 FROM hourly_execution_records_v1 WHERE profile_id<>? LIMIT 1').get(sourceProfileId)) {
    throw new RangeError('Foreign profile identity detected.');
  }
  if (database.prepare("SELECT 1 FROM remediation_evidence_v1 WHERE profile_id NOT IN (?, 'market') LIMIT 1").get(sourceProfileId))
    throw new RangeError('Foreign profile identity detected.');
  const excluded = Number((database.prepare(`SELECT
    (SELECT COUNT(*) FROM wider_universe_records_v1 WHERE kind!='policy') +
    (SELECT COUNT(*) FROM breakout_research_records_v1) +
    (SELECT COUNT(*) FROM breakout_hourly_bars_v1) +
    (SELECT COUNT(*) FROM range_rotation_records_v1) +
    (SELECT COUNT(*) FROM market_selector_records_v1) +
    (SELECT COUNT(*) FROM hourly_execution_records_v1) +
    (SELECT COUNT(*) FROM remediation_evidence_v1) +
    (SELECT COUNT(*) FROM research_integrity_events WHERE kind IN
      ('binding','health_review','health_policy','health_requalification',
       'shadow_refusal','shadow_binding','shadow_setting','shadow_pending','shadow_settlement','shadow_book')) AS count`).get() as { count: number }).count);
  if (!Number.isSafeInteger(excluded)) throw new RangeError('Invalid universe duplication count.');
  database.exec(`
    DROP TRIGGER research_trigger_job_links_v1_no_update;
    DROP TRIGGER research_trigger_job_links_v1_no_delete;
    DROP TRIGGER research_job_candidate_links_v1_no_update;
    DROP TRIGGER research_job_candidate_links_v1_no_delete;
    DROP TRIGGER research_candidate_review_events_v1_no_update;
    DROP TRIGGER research_candidate_review_events_v1_no_delete;
    DROP TRIGGER ml_signal_study_guard;
    DROP TRIGGER wider_universe_no_update;
    DROP TRIGGER wider_universe_no_delete;
    DROP TRIGGER breakout_hourly_no_update;
    DROP TRIGGER breakout_hourly_no_delete;
    DROP TRIGGER breakout_records_no_update;
    DROP TRIGGER breakout_records_no_delete;
    DROP TRIGGER range_rotation_no_update;
    DROP TRIGGER range_rotation_no_delete;
    DROP TRIGGER market_selector_no_update;
    DROP TRIGGER market_selector_no_delete;
    DROP TRIGGER hourly_execution_no_update;
    DROP TRIGGER hourly_execution_no_delete;
    DELETE FROM wider_universe_records_v1 WHERE kind != 'policy';
    DELETE FROM breakout_research_records_v1;
    DELETE FROM breakout_hourly_bars_v1;
    DELETE FROM range_rotation_records_v1;
    DELETE FROM market_selector_records_v1;
    DELETE FROM hourly_execution_records_v1;
    DROP TRIGGER remediation_evidence_no_update;
    DROP TRIGGER remediation_evidence_no_delete;
    DELETE FROM remediation_evidence_v1;
    DROP TRIGGER research_integrity_no_update;
    DROP TRIGGER research_integrity_no_delete;
    DELETE FROM research_integrity_events WHERE kind IN
      ('binding','health_review','health_policy','health_requalification',
       'shadow_refusal','shadow_binding','shadow_setting','shadow_pending','shadow_settlement','shadow_book');
  `);
  return excluded;
}

export function restoreResearchDuplicationTriggers(database:DatabaseSync):void {
  database.exec(`
    CREATE TRIGGER research_trigger_job_links_v1_no_update BEFORE UPDATE ON research_trigger_job_links_v1
      BEGIN SELECT RAISE(ABORT,'research trigger/job links are immutable'); END;
    CREATE TRIGGER research_trigger_job_links_v1_no_delete BEFORE DELETE ON research_trigger_job_links_v1
      BEGIN SELECT RAISE(ABORT,'research trigger/job links are immutable'); END;
    CREATE TRIGGER research_job_candidate_links_v1_no_update BEFORE UPDATE ON research_job_candidate_links_v1
      BEGIN SELECT RAISE(ABORT,'research job/candidate links are immutable'); END;
    CREATE TRIGGER research_job_candidate_links_v1_no_delete BEFORE DELETE ON research_job_candidate_links_v1
      BEGIN SELECT RAISE(ABORT,'research job/candidate links are immutable'); END;
    CREATE TRIGGER research_candidate_review_events_v1_no_update BEFORE UPDATE ON research_candidate_review_events_v1
      BEGIN SELECT RAISE(ABORT,'research candidate reviews are append-only'); END;
    CREATE TRIGGER research_candidate_review_events_v1_no_delete BEFORE DELETE ON research_candidate_review_events_v1
      BEGIN SELECT RAISE(ABORT,'research candidate reviews are append-only'); END;
    CREATE TRIGGER wider_universe_no_update BEFORE UPDATE ON wider_universe_records_v1
      BEGIN SELECT RAISE(ABORT,'universe evidence is immutable'); END;
    CREATE TRIGGER wider_universe_no_delete BEFORE DELETE ON wider_universe_records_v1
      BEGIN SELECT RAISE(ABORT,'universe evidence is immutable'); END;
    CREATE TRIGGER breakout_hourly_no_update BEFORE UPDATE ON breakout_hourly_bars_v1
      BEGIN SELECT RAISE(ABORT,'breakout hourly evidence is immutable'); END;
    CREATE TRIGGER breakout_hourly_no_delete BEFORE DELETE ON breakout_hourly_bars_v1
      BEGIN SELECT RAISE(ABORT,'breakout hourly evidence is immutable'); END;
    CREATE TRIGGER breakout_records_no_update BEFORE UPDATE ON breakout_research_records_v1
      BEGIN SELECT RAISE(ABORT,'breakout research evidence is immutable'); END;
    CREATE TRIGGER breakout_records_no_delete BEFORE DELETE ON breakout_research_records_v1
      BEGIN SELECT RAISE(ABORT,'breakout research evidence is immutable'); END;
    CREATE TRIGGER range_rotation_no_update BEFORE UPDATE ON range_rotation_records_v1
      BEGIN SELECT RAISE(ABORT,'range rotation evidence is immutable'); END;
    CREATE TRIGGER range_rotation_no_delete BEFORE DELETE ON range_rotation_records_v1
      BEGIN SELECT RAISE(ABORT,'range rotation evidence is immutable'); END;
    CREATE TRIGGER market_selector_no_update BEFORE UPDATE ON market_selector_records_v1
      BEGIN SELECT RAISE(ABORT,'market selector evidence is immutable'); END;
    CREATE TRIGGER market_selector_no_delete BEFORE DELETE ON market_selector_records_v1
      BEGIN SELECT RAISE(ABORT,'market selector evidence is immutable'); END;
    CREATE TRIGGER hourly_execution_no_update BEFORE UPDATE ON hourly_execution_records_v1
      BEGIN SELECT RAISE(ABORT,'hourly execution evidence is immutable'); END;
    CREATE TRIGGER hourly_execution_no_delete BEFORE DELETE ON hourly_execution_records_v1
      BEGIN SELECT RAISE(ABORT,'hourly execution evidence is immutable'); END;
    CREATE TRIGGER research_integrity_no_update BEFORE UPDATE ON research_integrity_events
      BEGIN SELECT RAISE(ABORT,'research integrity evidence is immutable'); END;
    CREATE TRIGGER research_integrity_no_delete BEFORE DELETE ON research_integrity_events
      BEGIN SELECT RAISE(ABORT,'research integrity evidence is immutable'); END;
    CREATE TRIGGER remediation_evidence_no_update BEFORE UPDATE ON remediation_evidence_v1
      BEGIN SELECT RAISE(ABORT,'remediation evidence is immutable'); END;
    CREATE TRIGGER remediation_evidence_no_delete BEFORE DELETE ON remediation_evidence_v1
      BEGIN SELECT RAISE(ABORT,'remediation evidence is immutable'); END;
    CREATE TRIGGER ml_signal_study_guard BEFORE UPDATE ON ml_signal_studies_v1
      WHEN OLD.result_json IS NOT NULL OR NEW.profile_id != OLD.profile_id OR
        NEW.candidate_version != OLD.candidate_version OR NEW.registered_at_ms != OLD.registered_at_ms OR
        NEW.study_end_ms != OLD.study_end_ms OR NEW.dataset_hash != OLD.dataset_hash OR
        NEW.plan_hash != OLD.plan_hash OR NEW.plan_json != OLD.plan_json OR NEW.result_json IS NULL
        BEGIN SELECT RAISE(ABORT,'ML study registration and result are immutable'); END;
  `);
}

/** A clone needs its own explicit report association; original report files/history stay untouched. */
export function excludeNewsReportAssociations(db: DatabaseSync): number {
  let count=0;
  for(const table of ['news_report_associations_v1','news_export_permissions_v1']) {
    if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    count+=db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!['n'] as number;
    db.exec(`DROP TRIGGER ${table}_no_delete; DELETE FROM ${table};
      CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT,'news evidence is immutable'); END;`);
  }
  return count;
}
