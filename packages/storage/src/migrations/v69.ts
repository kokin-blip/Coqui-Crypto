import type { Migration } from './types.js';

export const migrations69: readonly Migration[] = [{
  version: 69,
  name: 'immutable_market_events_v1',
  up(db) {
    db.exec(`
      CREATE TABLE market_events_v1 (
        id TEXT PRIMARY KEY CHECK (length(id)=64),
        profile_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_event_id TEXT NOT NULL,
        published_at INTEGER NOT NULL CHECK (published_at>=0),
        first_seen_at INTEGER NOT NULL CHECK (first_seen_at>=published_at),
        content_json TEXT NOT NULL CHECK (json_valid(content_json) AND json_type(content_json)='object'),
        content_hash TEXT NOT NULL UNIQUE CHECK (length(content_hash)=64),
        provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json) AND json_type(provenance_json)='object'),
        provenance_hash TEXT NOT NULL CHECK (length(provenance_hash)=64),
        UNIQUE(profile_id, source_id, source_event_id),
        UNIQUE(id, profile_id)
      );
      CREATE INDEX market_events_v1_profile_available
        ON market_events_v1(profile_id, first_seen_at DESC, id);

      CREATE TABLE market_event_classifications_v1 (
        id TEXT PRIMARY KEY CHECK (length(id)=64),
        event_id TEXT NOT NULL REFERENCES market_events_v1(id),
        classifier TEXT NOT NULL CHECK (classifier IN ('deterministic','llm')),
        classifier_version TEXT NOT NULL,
        classified_at INTEGER NOT NULL CHECK (classified_at>=0),
        result_json TEXT NOT NULL CHECK (json_valid(result_json) AND json_type(result_json)='object'),
        result_hash TEXT NOT NULL UNIQUE CHECK (length(result_hash)=64),
        UNIQUE(event_id, classifier, classifier_version)
      );
      CREATE INDEX market_event_classifications_v1_event_time
        ON market_event_classifications_v1(event_id, classified_at DESC, id);

      CREATE TRIGGER market_events_v1_no_update BEFORE UPDATE ON market_events_v1
        BEGIN SELECT RAISE(ABORT, 'market events are immutable'); END;
      CREATE TRIGGER market_events_v1_no_delete BEFORE DELETE ON market_events_v1
        BEGIN SELECT RAISE(ABORT, 'market events are immutable'); END;
      CREATE TRIGGER market_event_classifications_v1_no_update BEFORE UPDATE ON market_event_classifications_v1
        BEGIN SELECT RAISE(ABORT, 'market event classifications are immutable'); END;
      CREATE TRIGGER market_event_classifications_v1_no_delete BEFORE DELETE ON market_event_classifications_v1
        BEGIN SELECT RAISE(ABORT, 'market event classifications are immutable'); END;
      CREATE TRIGGER market_event_classification_time_guard BEFORE INSERT ON market_event_classifications_v1
        WHEN NEW.classified_at < (SELECT first_seen_at FROM market_events_v1 WHERE id=NEW.event_id)
        BEGIN SELECT RAISE(ABORT, 'classification predates event availability'); END;
    `);
  },
}];
