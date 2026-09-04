import { describe, expect, it } from 'vitest';

import { createMemorySecretStore, type HttpClient } from '../packages/adapters/src/index.js';
import { FixedClock } from '../packages/core/src/index.js';
import { AdvisorAnalystService } from '../packages/services/src/index.js';
import { openDatabase } from '../packages/storage/src/index.js';

const T0 = 1_800_000_000_000;
function context(service: AdvisorAnalystService) {
  return service.prepare({ productId: 'BTC-USD', bars: [
    { timeMs: T0 - 1_000, open: '100', high: '110', low: '90', close: '100', volume: '5', complete: true },
    { timeMs: T0, open: '100', high: '125', low: '98', close: '120', volume: '8', complete: true },
  ], evidence: [{ label: 'Hidden evidence', value: 'not selected', tone: 'warning' }],
  portfolio: [{ label: 'Hidden holding', value: 'not selected', tone: 'neutral' }],
  scope: { chartData: true, visibleEvidence: false, sanitizedPortfolio: false } });
}
function fakeHttp(captured: Array<{ url: string; body: unknown; headers: HeadersInit | undefined }>): HttpClient {
  return { getJson: async () => ({ ok: false, status: 500, reason: 'http', retried: 0 }),
    getText: async () => ({ ok: false, status: 500, reason: 'http', retried: 0 }),
    postJson: async <T>(url: string, body: unknown, init?: RequestInit) => {
      captured.push({ url, body, headers: init?.headers });
      return { ok: true, status: 200, data: { output_text: 'Bounded analysis with uncertainty.' } as T };
    }, destroy() {} };
}

describe('provider-neutral advisor analyst', () => {
  it('stores provider credentials only in the secret adapter', async () => {
    const database = openDatabase(':memory:'), secrets = createMemorySecretStore();
    const service = new AdvisorAnalystService({ profileId: 'main', database,
      clock: new FixedClock(T0), http: fakeHttp([]), secrets });
    await service.connectProvider('anthropic', 'credential-value-that-must-not-enter-sqlite');
    expect((await service.providers()).providers.find((item) => item.provider === 'anthropic')?.credentialState).toBe('connected');
    const databaseText = JSON.stringify(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all());
    expect(databaseText).not.toContain('credential-value');
    await service.disconnectProvider('anthropic');
    expect((await service.providers()).providers.find((item) => item.provider === 'anthropic')?.credentialState).toBe('disconnected');
    database.close();
  });

  it('generates deterministic facts without a provider or network call', async () => {
    const database = openDatabase(':memory:'), captured: Array<{ url: string; body: unknown; headers: HeadersInit | undefined }> = [];
    const service = new AdvisorAnalystService({ profileId: 'main', database,
      clock: new FixedClock(T0), http: fakeHttp(captured), secrets: createMemorySecretStore() });
    const prepared = context(service), answer = await service.generate(prepared.contextHash, null);
    expect(answer).toMatchObject({ provider: 'local', advisoryOnly: true, executionAuthority: false });
    expect(answer.text).toContain('Period change: +20.00%');
    expect(captured).toHaveLength(0);
    database.close();
  });

  it('sends only explicitly selected, bounded context to the selected provider', async () => {
    const database = openDatabase(':memory:'), captured: Array<{ url: string; body: unknown; headers: HeadersInit | undefined }> = [];
    const service = new AdvisorAnalystService({ profileId: 'main', database,
      clock: new FixedClock(T0), http: fakeHttp(captured),
      secrets: createMemorySecretStore({ 'openai-api-key': 'secret-test-key-that-never-leaves-header' }) });
    const prepared = context(service), answer = await service.generate(prepared.contextHash, 'openai');
    expect(answer.provider).toBe('openai');
    expect(JSON.stringify(captured[0]?.body)).not.toContain('Hidden evidence');
    expect(JSON.stringify(captured[0]?.body)).not.toContain('Hidden holding');
    expect(JSON.stringify(captured[0]?.body)).not.toContain('secret-test-key');
    expect(captured[0]?.headers).toMatchObject({ authorization: expect.stringContaining('secret-test-key') });
    database.close();
  });

  it('encrypts opted-in history and never stores plaintext messages', async () => {
    const database = openDatabase(':memory:'), captured: Array<{ url: string; body: unknown; headers: HeadersInit | undefined }> = [];
    const service = new AdvisorAnalystService({ profileId: 'main', database,
      clock: new FixedClock(T0), http: fakeHttp(captured),
      secrets: createMemorySecretStore({ 'openai-api-key': 'secret-test-key-that-never-leaves-header' }) });
    const prepared = context(service);
    const sent = await service.send({ contextHash: prepared.contextHash, provider: 'openai',
      mode: 'analysis', message: 'private portfolio question', conversationId: null, retention: 'encrypted' });
    const stored = JSON.stringify(database.prepare('SELECT * FROM advisor_messages_v1').all());
    expect(stored).not.toContain('private portfolio question');
    const history = await service.history(sent.conversationId);
    expect(history.conversations[0]?.messages[0]?.text).toBe('private portfolio question');
    database.close();
  });

  it('keeps session history out of SQLite by default', async () => {
    const database = openDatabase(':memory:'), service = new AdvisorAnalystService({ profileId: 'main',
      database, clock: new FixedClock(T0), http: fakeHttp([]),
      secrets: createMemorySecretStore({ 'openai-api-key': 'secret-test-key-that-never-leaves-header' }) });
    const prepared = context(service);
    await service.send({ contextHash: prepared.contextHash, provider: 'openai', mode: 'analysis',
      message: 'session only', conversationId: null, retention: 'session' });
    expect(database.prepare('SELECT COUNT(*) AS count FROM advisor_messages_v1').get()).toEqual({ count: 0 });
    database.close();
  });

  it('rejects oversized prepared context before it can reach a provider', () => {
    const database = openDatabase(':memory:'), service = new AdvisorAnalystService({ profileId: 'main',
      database, clock: new FixedClock(T0), http: fakeHttp([]), secrets: createMemorySecretStore() });
    expect(() => service.prepare({ productId: 'BTC-USD', bars: [],
      evidence: Array.from({ length: 700 }, (_, index) => ({ label: `Evidence ${index}`, value: 'x'.repeat(100), tone: 'neutral' as const })),
      portfolio: [], scope: { chartData: false, visibleEvidence: true, sanitizedPortfolio: false } })).toThrow('context_too_large');
    database.close();
  });

  it('rejects malformed provider output and records only a sanitized failure audit', async () => {
    const database = openDatabase(':memory:'), http = fakeHttp([]);
    http.postJson = async <T>() => ({ ok: true, status: 200, data: { output_text: '   ' } as T });
    const service = new AdvisorAnalystService({ profileId: 'main', database,
      clock: new FixedClock(T0), http,
      secrets: createMemorySecretStore({ 'openai-api-key': 'secret-test-key-that-never-leaves-header' }) });
    const prepared = context(service);
    await expect(service.generate(prepared.contextHash, 'openai')).rejects.toThrow('provider_response_invalid');
    const events = database.prepare('SELECT provider, operation, outcome, context_hash FROM advisor_audit_events_v1').all();
    expect(events).toEqual([{ provider: 'openai', operation: 'facts', outcome: 'failed', context_hash: prepared.contextHash }]);
    expect(JSON.stringify(events)).not.toContain('secret-test-key');
    database.close();
  });
});
