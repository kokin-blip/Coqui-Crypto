import { DatabaseSync } from 'node:sqlite';

export function dropResearchDuplicationTriggers(database:DatabaseSync):void {
  database.exec(`
    DROP TRIGGER research_trigger_job_links_v1_no_update;
    DROP TRIGGER research_trigger_job_links_v1_no_delete;
    DROP TRIGGER research_job_candidate_links_v1_no_update;
    DROP TRIGGER research_job_candidate_links_v1_no_delete;
    DROP TRIGGER research_candidate_review_events_v1_no_update;
    DROP TRIGGER research_candidate_review_events_v1_no_delete;
  `);
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
  `);
}
