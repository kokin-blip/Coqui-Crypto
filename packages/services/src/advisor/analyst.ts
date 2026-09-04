import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

import type { HttpClient, SecretKey, SecretStore } from '@coqui/adapters';
import { sha256Hex, type Clock } from '@coqui/core';
import {
  appendAdvisorAuditEvent, deleteAdvisorConversation, listAdvisorConversations,
  listAdvisorMessages, saveAdvisorConversation, saveAdvisorMessage, type Db,
} from '@coqui/storage';

export type AnalystProvider = 'gemini' | 'openai' | 'anthropic';
export type AnalystMode = 'analysis' | 'scenario_ideas';
interface Fact { readonly label: string; readonly value: string; readonly tone: 'neutral' | 'positive' | 'negative' | 'warning' }
interface Scope { readonly chartData: boolean; readonly visibleEvidence: boolean; readonly sanitizedPortfolio: boolean }
interface ContextInput { readonly productId: string; readonly bars: readonly { readonly timeMs: number; readonly open: string; readonly high: string; readonly low: string; readonly close: string; readonly volume: string | null; readonly complete: boolean }[]; readonly evidence: readonly Fact[]; readonly portfolio: readonly Fact[]; readonly scope: Scope }
interface PreparedContext { readonly contextHash: string; readonly dataTimestampMs: number;
  readonly scope: Scope; readonly localFacts: readonly Fact[]; readonly payloadBytes: number;
  readonly providerSummary: string; readonly provenance: readonly string[] }
interface MessageView { readonly id: string; readonly role: 'user' | 'assistant'; readonly text: string; readonly createdAtMs: number }
interface ConversationView { readonly id: string; readonly title: string; readonly retention: 'session' | 'encrypted'; readonly updatedAtMs: number; readonly messages: readonly MessageView[] }
const PROVIDERS: Readonly<Record<AnalystProvider, { readonly key: SecretKey; readonly model: string }>> = {
  gemini: { key: 'gemini-api-key', model: 'gemini-2.5-flash' },
  openai: { key: 'openai-api-key', model: 'gpt-5-mini' },
  anthropic: { key: 'anthropic-api-key', model: 'claude-sonnet-4-5' },
};
const MAX_CONTEXT_BYTES = 65_536;
const MAX_ANSWER_CHARS = 20_000;

function validatedAnswer(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('provider_response_invalid');
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_ANSWER_CHARS) throw new TypeError('provider_response_invalid');
  return text;
}

function localFacts(input: ContextInput): readonly Fact[] {
  const complete = input.bars.filter((bar) => bar.complete);
  if (complete.length === 0) return [{ label: 'Price history', value: 'No completed Coinbase candles are available.', tone: 'warning' }];
  const first = Number(complete[0]!.close), last = Number(complete.at(-1)!.close);
  const highs = complete.map((bar) => Number(bar.high)), lows = complete.map((bar) => Number(bar.low));
  const change = first === 0 ? null : ((last / first) - 1) * 100;
  return [
    { label: 'Completed observations', value: String(complete.length), tone: 'neutral' },
    { label: 'Range', value: `${Math.min(...lows)} – ${Math.max(...highs)}`, tone: 'neutral' },
    { label: 'Period change', value: change === null ? 'Unavailable' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`, tone: change === null ? 'warning' : change >= 0 ? 'positive' : 'negative' },
    { label: 'Candle completeness', value: input.bars.some((bar) => !bar.complete) ? 'Includes a provisional display candle' : 'Completed candles only', tone: input.bars.some((bar) => !bar.complete) ? 'warning' : 'positive' },
  ];
}
function encrypt(key: Buffer, text: string): { readonly nonceBase64: string; readonly ciphertextBase64: string; readonly authTagBase64: string } {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { nonceBase64: nonce.toString('base64'), ciphertextBase64: ciphertext.toString('base64'), authTagBase64: cipher.getAuthTag().toString('base64') };
}
function decrypt(key: Buffer, value: { readonly nonceBase64: string; readonly ciphertextBase64: string; readonly authTagBase64: string }): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.nonceBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(value.authTagBase64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertextBase64, 'base64')), decipher.final()]).toString('utf8');
}

export class AdvisorAnalystService {
  readonly #contexts = new Map<string, PreparedContext>();
  readonly #sessions = new Map<string, ConversationView>();
  constructor(private readonly input: { readonly profileId: string; readonly database: Db;
    readonly clock: Clock; readonly http: HttpClient; readonly secrets: SecretStore }) {}

  async providers() {
    return { providers: await Promise.all((Object.entries(PROVIDERS) as Array<[AnalystProvider, typeof PROVIDERS[AnalystProvider]]>).map(async ([provider, config]) => {
      const secret = await this.input.secrets.read(config.key, this.input.profileId);
      return { provider, credentialState: !secret.ok ? 'unavailable' as const : secret.value === null ? 'disconnected' as const : 'connected' as const, model: config.model };
    })) };
  }

  async connectProvider(provider: AnalystProvider, apiKey: string) {
    if (apiKey.length < 20 || apiKey.length > 512) throw new TypeError('invalid_api_key');
    const result = await this.input.secrets.write(PROVIDERS[provider].key, apiKey, this.input.profileId);
    if (!result.ok) throw new TypeError('secret_store_unavailable');
    return { provider, credentialState: 'connected' as const };
  }
  async disconnectProvider(provider: AnalystProvider) {
    const result = await this.input.secrets.remove(PROVIDERS[provider].key, this.input.profileId);
    if (!result.ok) throw new TypeError('secret_store_unavailable');
    return { provider, credentialState: 'disconnected' as const };
  }

  prepare(value: ContextInput): PreparedContext {
    const facts = localFacts(value), bars = value.scope.chartData ? value.bars.slice(-500) : [];
    const selected = { product: value.productId, bars, evidence: value.scope.visibleEvidence ? value.evidence : [], portfolio: value.scope.sanitizedPortfolio ? value.portfolio : [], facts, scope: value.scope };
    const providerSummary = JSON.stringify(selected), contextHash = sha256Hex(providerSummary);
    const payloadBytes = Buffer.byteLength(providerSummary);
    if (payloadBytes > MAX_CONTEXT_BYTES) throw new TypeError('context_too_large');
    const context = { contextHash, dataTimestampMs: bars.at(-1)?.timeMs ?? this.input.clock.nowMs(),
      scope: value.scope, localFacts: facts, payloadBytes, providerSummary,
      provenance: bars.length === 0 ? [] : ['Coinbase completed display candles'] };
    this.#contexts.set(contextHash, context);
    while (this.#contexts.size > 20) this.#contexts.delete(this.#contexts.keys().next().value as string);
    return context;
  }

  async generate(contextHash: string, provider: AnalystProvider | null) {
    const context = this.#requireContext(contextHash);
    if (provider === null) return this.#answer(context, 'local', 'deterministic-v1', 'analysis', context.localFacts.map((fact) => `${fact.label}: ${fact.value}`).join('\n'));
    try {
      const text = await this.#request(provider, 'analysis', 'Summarize the key facts and caveats in this market context.', context);
      appendAdvisorAuditEvent(this.input.profileId, provider, 'facts', 'succeeded', contextHash, this.input.clock.nowMs(), this.input.database);
      return this.#answer(context, provider, PROVIDERS[provider].model, 'analysis', text);
    } catch (error) {
      appendAdvisorAuditEvent(this.input.profileId, provider, 'facts', 'failed', contextHash, this.input.clock.nowMs(), this.input.database);
      throw error;
    }
  }

  async send(value: { readonly contextHash: string; readonly provider: AnalystProvider; readonly mode: AnalystMode; readonly message: string; readonly conversationId: string | null; readonly retention: 'session' | 'encrypted' }) {
    const context = this.#requireContext(value.contextHash);
    let answerText: string;
    try { answerText = await this.#request(value.provider, value.mode, value.message, context); }
    catch (error) {
      appendAdvisorAuditEvent(this.input.profileId, value.provider, 'chat', 'failed', value.contextHash, this.input.clock.nowMs(), this.input.database);
      throw error;
    }
    const id = value.conversationId ?? randomUUID(), now = this.input.clock.nowMs();
    const answer = this.#answer(context, value.provider, PROVIDERS[value.provider].model, value.mode, answerText);
    const messages: readonly MessageView[] = [{ id: randomUUID(), role: 'user', text: value.message, createdAtMs: now }, { id: randomUUID(), role: 'assistant', text: answer.text, createdAtMs: now }];
    if (value.retention === 'encrypted') await this.#persist(id, value.message.slice(0, 80), messages, value.provider, context.contextHash, now);
    else {
      const prior = this.#sessions.get(id);
      this.#sessions.set(id, { id, title: prior?.title ?? value.message.slice(0, 80), retention: 'session', updatedAtMs: now, messages: [...(prior?.messages ?? []), ...messages] });
    }
    appendAdvisorAuditEvent(this.input.profileId, value.provider, 'chat', 'succeeded', value.contextHash, now, this.input.database);
    return { conversationId: id, answer };
  }

  async history(conversationId: string | null): Promise<{ readonly conversations: readonly ConversationView[] }> {
    const session = [...this.#sessions.values()].filter((item) => conversationId === null || item.id === conversationId);
    const key = await this.#historyKey(false);
    const encrypted = key === null ? [] : listAdvisorConversations(this.input.profileId, this.input.database)
      .filter((item) => conversationId === null || item.id === conversationId).map((item) => ({ id: item.id, title: item.title, retention: item.retention, updatedAtMs: item.updatedAtMs,
        messages: listAdvisorMessages(item.id, this.input.database).map((message) => ({ id: message.id, role: message.role, text: decrypt(key, message), createdAtMs: message.createdAtMs })) }));
    return { conversations: [...session, ...encrypted].sort((a, b) => b.updatedAtMs - a.updatedAtMs) };
  }

  delete(conversationId: string): { readonly outcome: 'deleted' } {
    this.#sessions.delete(conversationId);
    deleteAdvisorConversation(this.input.profileId, conversationId, this.input.database);
    appendAdvisorAuditEvent(this.input.profileId, 'local', 'delete', 'succeeded', '0'.repeat(64), this.input.clock.nowMs(), this.input.database);
    return { outcome: 'deleted' };
  }

  async exportData(conversationId: string): Promise<string> {
    const conversation = (await this.history(conversationId)).conversations[0];
    if (conversation === undefined) throw new TypeError('conversation_unavailable');
    return JSON.stringify({ exportedAtMs: this.input.clock.nowMs(), advisoryOnly: true, executionAuthority: false, conversation }, null, 2);
  }

  auditExport(outcome: 'succeeded' | 'failed' | 'cancelled'): void {
    appendAdvisorAuditEvent(this.input.profileId, 'local', 'export', outcome, '0'.repeat(64), this.input.clock.nowMs(), this.input.database);
  }

  #requireContext(hash: string): PreparedContext { const value = this.#contexts.get(hash); if (value === undefined) throw new TypeError('context_stale'); return value; }
  #answer(context: PreparedContext, provider: AnalystProvider | 'local', model: string, mode: AnalystMode, text: string) { return { text, provider, model, mode, contextHash: context.contextHash, generatedAtMs: this.input.clock.nowMs(), dataTimestampMs: context.dataTimestampMs, scope: context.scope, provenance: context.provenance, advisoryOnly: true as const, executionAuthority: false as const }; }

  async #request(provider: AnalystProvider, mode: AnalystMode, question: string, context: PreparedContext): Promise<string> {
    if (context.payloadBytes > MAX_CONTEXT_BYTES || Buffer.byteLength(context.providerSummary) > MAX_CONTEXT_BYTES) throw new TypeError('context_too_large');
    const config = PROVIDERS[provider], secret = await this.input.secrets.read(config.key, this.input.profileId);
    if (!secret.ok || secret.value === null) throw new TypeError('provider_disconnected');
    const system = `You are Coqui's analytical assistant. Use only the supplied context. ${mode === 'scenario_ideas' ? 'Offer clearly labelled non-binding scenarios.' : 'Do not issue buy, sell, or execution instructions.'} Always state uncertainty. Advisory only; no execution authority.`;
    if (provider === 'openai') {
      const result = await this.input.http.postJson<{ output_text?: string }>('https://api.openai.com/v1/responses', { model: config.model, input: `${system}\nContext: ${context.providerSummary}\nQuestion: ${question}`, max_output_tokens: 1200 }, { headers: { authorization: `Bearer ${secret.value}` } });
      if (!result.ok) throw new TypeError('provider_failed'); return validatedAnswer(result.data.output_text);
    }
    if (provider === 'anthropic') {
      const result = await this.input.http.postJson<{ content?: readonly { type?: string; text?: string }[] }>('https://api.anthropic.com/v1/messages', { model: config.model, max_tokens: 1200, system, messages: [{ role: 'user', content: `Context: ${context.providerSummary}\nQuestion: ${question}` }] }, { headers: { 'x-api-key': secret.value, 'anthropic-version': '2023-06-01' } });
      const text = result.ok ? result.data.content?.find((item) => item.type === 'text')?.text : undefined;
      if (text === undefined) throw new TypeError('provider_failed'); return validatedAnswer(text);
    }
    const result = await this.input.http.postJson<{ candidates?: readonly { content?: { parts?: readonly { text?: string }[] } }[] }>(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, { system_instruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: `Context: ${context.providerSummary}\nQuestion: ${question}` }] }] }, { headers: { 'x-goog-api-key': secret.value } });
    const text = result.ok ? result.data.candidates?.[0]?.content?.parts?.[0]?.text : undefined;
    if (text === undefined) throw new TypeError('provider_failed'); return validatedAnswer(text);
  }

  async #historyKey(create: boolean): Promise<Buffer | null> {
    const read = await this.input.secrets.read('advisor-history-key', this.input.profileId);
    if (!read.ok) throw new TypeError('secret_store_unavailable');
    if (read.value !== null) { const key = Buffer.from(read.value, 'base64'); if (key.byteLength !== 32) throw new TypeError('history_key_invalid'); return key; }
    if (!create) return null;
    const key = randomBytes(32), write = await this.input.secrets.write('advisor-history-key', key.toString('base64'), this.input.profileId);
    if (!write.ok) throw new TypeError('secret_store_unavailable'); return key;
  }
  async #persist(conversationId: string, title: string, messages: readonly MessageView[], provider: AnalystProvider, contextHash: string, now: number): Promise<void> {
    const key = await this.#historyKey(true), prior = listAdvisorConversations(this.input.profileId, this.input.database).find((item) => item.id === conversationId);
    if (key === null) throw new TypeError('history_key_unavailable');
    saveAdvisorConversation({ id: conversationId, profileId: this.input.profileId, title: prior?.title ?? title, retention: 'encrypted', createdAtMs: prior?.createdAtMs ?? now, updatedAtMs: now }, this.input.database);
    const sequence = listAdvisorMessages(conversationId, this.input.database).length;
    messages.forEach((message, index) => saveAdvisorMessage({ id: message.id, conversationId, sequence: sequence + index, role: message.role, provider: message.role === 'assistant' ? provider : null, modelPolicy: message.role === 'assistant' ? PROVIDERS[provider].model : null, contextHash, ...encrypt(key, message.text), createdAtMs: message.createdAtMs }, this.input.database));
  }
}
