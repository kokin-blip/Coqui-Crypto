import type { Migration } from './types.js';

export const migrations89: readonly Migration[] = [{ version: 89, name: 'news_provider_quota_v1', up(db) {
  db.exec(`
    CREATE TABLE news_api_usage_v1 (
      provider TEXT NOT NULL CHECK(provider IN ('marketaux','currents','gdelt')),
      scope TEXT NOT NULL CHECK(length(scope)=64 AND scope NOT GLOB '*[^a-f0-9]*'), quota_day TEXT NOT NULL CHECK(quota_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      budget INTEGER NOT NULL CHECK(typeof(budget)='integer' AND budget BETWEEN 1 AND CASE provider WHEN 'marketaux' THEN 100 WHEN 'currents' THEN 250 ELSE 144 END),
      reserved INTEGER NOT NULL DEFAULT 0 CHECK(typeof(reserved)='integer' AND reserved BETWEEN 0 AND 9007199254740991),
      succeeded INTEGER NOT NULL DEFAULT 0 CHECK(typeof(succeeded)='integer' AND succeeded BETWEEN 0 AND 9007199254740991),
      failed INTEGER NOT NULL DEFAULT 0 CHECK(typeof(failed)='integer' AND failed BETWEEN 0 AND 9007199254740991),
      PRIMARY KEY(provider,scope,quota_day), CHECK(succeeded+failed<=reserved)
    );
    CREATE TABLE news_api_controls_v1 (
      provider TEXT NOT NULL CHECK(provider IN ('marketaux','currents','gdelt')),
      scope TEXT NOT NULL CHECK(length(scope)=64 AND scope NOT GLOB '*[^a-f0-9]*'),
      blocked_until INTEGER NOT NULL DEFAULT 0 CHECK(typeof(blocked_until)='integer' AND blocked_until BETWEEN 0 AND 9007199254740991),
      next_dispatch_at INTEGER NOT NULL DEFAULT 0 CHECK(typeof(next_dispatch_at)='integer' AND next_dispatch_at BETWEEN 0 AND 9007199254740991),
      PRIMARY KEY(provider,scope)
    );
    CREATE TABLE news_request_attempts_v1 (
      id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, scope TEXT NOT NULL,
      quota_day TEXT NOT NULL CHECK(quota_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), reserved_at INTEGER NOT NULL CHECK(typeof(reserved_at)='integer' AND reserved_at BETWEEN 0 AND 9007199254740991),
      outcome TEXT NOT NULL DEFAULT 'reserved' CHECK(outcome IN ('reserved','succeeded','failed')),
      completed_at INTEGER, http_status INTEGER, reason TEXT,
      FOREIGN KEY(provider,scope,quota_day) REFERENCES news_api_usage_v1(provider,scope,quota_day),
      CHECK((outcome='reserved' AND completed_at IS NULL AND http_status IS NULL AND reason IS NULL)
        OR (outcome<>'reserved' AND completed_at IS NOT NULL AND http_status IS NOT NULL AND typeof(completed_at)='integer' AND completed_at BETWEEN reserved_at AND 9007199254740991 AND typeof(http_status)='integer' AND http_status BETWEEN 0 AND 599 AND reason IS NOT NULL))
    );
    CREATE INDEX news_attempts_scope_day ON news_request_attempts_v1(provider,scope,quota_day);
    CREATE TRIGGER news_attempts_no_delete BEFORE DELETE ON news_request_attempts_v1
      BEGIN SELECT RAISE(ABORT, 'news request attempts cannot be deleted'); END;
    CREATE TRIGGER news_attempts_finalize_once BEFORE UPDATE ON news_request_attempts_v1
      WHEN OLD.outcome<>'reserved' OR NEW.outcome='reserved' OR NEW.id<>OLD.id OR NEW.provider<>OLD.provider
        OR NEW.scope<>OLD.scope OR NEW.quota_day<>OLD.quota_day OR NEW.reserved_at<>OLD.reserved_at
      BEGIN SELECT RAISE(ABORT, 'news request reservations are immutable'); END;
  `);
} }];
