import { inTransaction, type Db } from '../sqlite/index.js';

export interface StoredAdvisorConversation { readonly id: string; readonly profileId: string;
  readonly title: string; readonly retention: 'session' | 'encrypted'; readonly createdAtMs: number; readonly updatedAtMs: number }
export interface StoredAdvisorMessage { readonly id: string; readonly conversationId: string;
  readonly sequence: number; readonly role: 'user' | 'assistant'; readonly provider: 'gemini' | 'openai' | 'anthropic' | null;
  readonly modelPolicy: string | null; readonly contextHash: string; readonly nonceBase64: string;
  readonly ciphertextBase64: string; readonly authTagBase64: string; readonly createdAtMs: number }

export function listAdvisorConversations(profileId: string, database: Db): StoredAdvisorConversation[] {
  const rows = database.prepare('SELECT * FROM advisor_conversations_v1 WHERE profile_id = ? ORDER BY updated_at_ms DESC').all(profileId) as unknown as Array<{ id: string; profile_id: string; title: string; retention: 'session' | 'encrypted'; created_at_ms: number; updated_at_ms: number }>;
  return rows.map((row) => ({ id: row.id, profileId: row.profile_id, title: row.title,
    retention: row.retention, createdAtMs: row.created_at_ms, updatedAtMs: row.updated_at_ms }));
}
export function saveAdvisorConversation(value: StoredAdvisorConversation, database: Db): void {
  database.prepare(`INSERT INTO advisor_conversations_v1
    (id, profile_id, title, retention, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at_ms = excluded.updated_at_ms
    WHERE profile_id = excluded.profile_id`).run(value.id, value.profileId, value.title,
      value.retention, value.createdAtMs, value.updatedAtMs);
}
export function listAdvisorMessages(conversationId: string, database: Db): StoredAdvisorMessage[] {
  const rows = database.prepare('SELECT * FROM advisor_messages_v1 WHERE conversation_id = ? ORDER BY sequence').all(conversationId) as unknown as Array<{ id: string; conversation_id: string; sequence: number; role: 'user' | 'assistant'; provider: 'gemini' | 'openai' | 'anthropic' | null; model_policy: string | null; context_hash: string; nonce_base64: string; ciphertext_base64: string; auth_tag_base64: string; created_at_ms: number }>;
  return rows.map((row) => ({ id: row.id, conversationId: row.conversation_id, sequence: row.sequence,
    role: row.role, provider: row.provider, modelPolicy: row.model_policy, contextHash: row.context_hash,
    nonceBase64: row.nonce_base64, ciphertextBase64: row.ciphertext_base64,
    authTagBase64: row.auth_tag_base64, createdAtMs: row.created_at_ms }));
}
export function saveAdvisorMessage(value: StoredAdvisorMessage, database: Db): void {
  database.prepare(`INSERT INTO advisor_messages_v1 (id, conversation_id, sequence, role, provider,
    model_policy, context_hash, nonce_base64, ciphertext_base64, auth_tag_base64, created_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(value.id, value.conversationId, value.sequence,
      value.role, value.provider, value.modelPolicy, value.contextHash, value.nonceBase64,
      value.ciphertextBase64, value.authTagBase64, value.createdAtMs);
}
export function deleteAdvisorConversation(profileId: string, conversationId: string, database: Db): boolean {
  return inTransaction(database, () => {
    const owned = database.prepare('SELECT 1 FROM advisor_conversations_v1 WHERE profile_id = ? AND id = ?').get(profileId, conversationId);
    if (owned === undefined) return false;
    database.prepare('DELETE FROM advisor_messages_v1 WHERE conversation_id = ?').run(conversationId);
    database.prepare('DELETE FROM advisor_conversations_v1 WHERE profile_id = ? AND id = ?').run(profileId, conversationId);
    return true;
  });
}
export function appendAdvisorAuditEvent(profileId: string, provider: string, operation: string,
  outcome: string, contextHash: string, atMs: number, database: Db): void {
  database.prepare(`INSERT INTO advisor_audit_events_v1
    (profile_id, provider, operation, outcome, context_hash, occurred_at_ms) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(profileId, provider, operation, outcome, contextHash, atMs);
}
