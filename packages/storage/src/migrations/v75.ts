import type { Migration } from './types.js';

export const migrations75: readonly Migration[] = [{
  version: 75,
  name: 'research_trigger_jobs_and_human_reviews_v1',
  up(db) {
    db.exec(`
      CREATE TABLE research_trigger_job_links_v1 (
        id TEXT PRIMARY KEY CHECK(length(id)=64),
        profile_id TEXT NOT NULL,
        trigger_id TEXT NOT NULL REFERENCES research_triggers_v1(id),
        job_id TEXT NOT NULL UNIQUE REFERENCES research_jobs(id),
        definition_id TEXT NOT NULL,
        input_hash TEXT NOT NULL CHECK(length(input_hash)=64),
        created_at INTEGER NOT NULL CHECK(created_at>=0)
      );
      CREATE INDEX research_trigger_job_links_v1_profile_time
        ON research_trigger_job_links_v1(profile_id,created_at DESC);

      CREATE TABLE research_job_candidate_links_v1 (
        id TEXT PRIMARY KEY CHECK(length(id)=64),
        profile_id TEXT NOT NULL,
        job_id TEXT NOT NULL UNIQUE REFERENCES research_jobs(id),
        candidate_id TEXT NOT NULL UNIQUE REFERENCES research_candidates_v1(id),
        result_hash TEXT NOT NULL CHECK(length(result_hash)=64),
        created_at INTEGER NOT NULL CHECK(created_at>=0)
      );
      CREATE INDEX research_job_candidate_links_v1_profile_time
        ON research_job_candidate_links_v1(profile_id,created_at DESC);

      CREATE TABLE research_candidate_review_events_v1 (
        id TEXT PRIMARY KEY CHECK(length(id)=64),
        profile_id TEXT NOT NULL,
        candidate_id TEXT NOT NULL REFERENCES research_candidates_v1(id),
        action TEXT NOT NULL CHECK(action IN ('reviewed','approved','rejected','rollback')),
        note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 3 AND 1000),
        actor TEXT NOT NULL CHECK(length(trim(actor)) BETWEEN 1 AND 120),
        at INTEGER NOT NULL CHECK(at>=0),
        content_hash TEXT NOT NULL CHECK(length(content_hash)=64)
      );
      CREATE INDEX research_candidate_review_events_v1_profile_time
        ON research_candidate_review_events_v1(profile_id,at DESC);

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
  },
}];
