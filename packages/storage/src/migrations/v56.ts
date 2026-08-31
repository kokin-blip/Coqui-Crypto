import type { Migration } from './types.js';

/** Encrypted optional advisor history; secrets and plaintext never enter SQLite. */
export const migrations56: readonly Migration[] = [{
  version: 56,
  name: 'advisor_encrypted_history_v1',
  up: (db) => {
    db.exec(`
      CREATE TABLE advisor_conversations_v1 (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
        retention TEXT NOT NULL CHECK (retention IN ('session', 'encrypted')),
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
        updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms)
      );
      CREATE INDEX advisor_conversations_v1_profile_time
        ON advisor_conversations_v1(profile_id, updated_at_ms);
      CREATE TABLE advisor_messages_v1 (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence >= 0),
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        provider TEXT CHECK (provider IN ('gemini', 'openai', 'anthropic')),
        model_policy TEXT,
        context_hash TEXT NOT NULL CHECK (length(context_hash) = 64),
        nonce_base64 TEXT NOT NULL,
        ciphertext_base64 TEXT NOT NULL,
        auth_tag_base64 TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
        UNIQUE (conversation_id, sequence)
      );
      CREATE TABLE advisor_audit_events_v1 (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('gemini', 'openai', 'anthropic', 'local')),
        operation TEXT NOT NULL CHECK (operation IN ('facts', 'chat', 'export', 'delete')),
        outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'cancelled')),
        context_hash TEXT NOT NULL CHECK (length(context_hash) = 64),
        occurred_at_ms INTEGER NOT NULL CHECK (occurred_at_ms >= 0)
      );
      CREATE TRIGGER advisor_audit_events_v1_no_update BEFORE UPDATE ON advisor_audit_events_v1
        BEGIN SELECT RAISE(ABORT, 'advisor audit events are immutable'); END;
      CREATE TRIGGER advisor_audit_events_v1_no_delete BEFORE DELETE ON advisor_audit_events_v1
        BEGIN SELECT RAISE(ABORT, 'advisor audit events are immutable'); END;
    `);
  },
}];
