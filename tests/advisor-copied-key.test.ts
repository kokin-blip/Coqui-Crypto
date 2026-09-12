import { describe, expect, it, vi } from 'vitest';

import { createAdvisorHandlers } from '../apps/desktop/src/main/advisor-handlers.js';
import { createMemorySecretStore, type HttpClient } from '../packages/adapters/src/index.js';
import { FixedClock } from '../packages/core/src/index.js';
import { openDatabase } from '../packages/storage/src/index.js';

const KEY = 'sk-dedicated-onboarding-key-1234567890';
function http(status = 200): HttpClient {
  return {
    async getJson<T>() { return status === 200 ? { ok: true as const, data: {} as T, status } : { ok: false as const, status, reason: 'http' as const, retried: 0 }; },
    async postJson() { return { ok: false as const, status: 500, reason: 'http' as const, retried: 0 }; },
    async getText() { return { ok: false as const, status: 500, reason: 'http' as const, retried: 0 }; },
    destroy() {},
  };
}

describe('copied Advisor credentials', () => {
  it('reads and clears the clipboard in main only after verification', async () => {
    const database = openDatabase(':memory:'), secrets = createMemorySecretStore(), clear = vi.fn();
    const handlers = createAdvisorHandlers({ profileId: 'main', database, clock: new FixedClock(100),
      http: http(), secrets, readClipboardText: () => KEY, clearClipboardIfMatches: clear });
    const connect = handlers['advisor.provider.connect-copied'] as unknown as (payload: unknown) => Promise<unknown>;
    await expect(connect({ commandId: '00000000-0000-4000-8000-000000000001', provider: 'openai', clearClipboard: true, confirmed: true }))
      .resolves.toMatchObject({ ok: true, value: { provider: 'openai', verification: 'verified' } });
    await expect(secrets.read('openai-api-key', 'main')).resolves.toEqual({ ok: true, value: KEY });
    expect(clear).toHaveBeenCalledWith(KEY);
    const command = database.prepare('SELECT outcome_json FROM chart_workspace_commands_v1').get() as { outcome_json: string };
    expect(command.outcome_json).not.toContain(KEY);
    database.close();
  });

  it('does not persist or clear an unauthorized copied key', async () => {
    const database = openDatabase(':memory:'), secrets = createMemorySecretStore(), clear = vi.fn();
    const handlers = createAdvisorHandlers({ profileId: 'main', database, clock: new FixedClock(100),
      http: http(401), secrets, readClipboardText: () => KEY, clearClipboardIfMatches: clear });
    const connect = handlers['advisor.provider.connect-copied'] as unknown as (payload: unknown) => Promise<{ ok: boolean }>;
    await expect(connect({ commandId: '00000000-0000-4000-8000-000000000002', provider: 'openai', clearClipboard: true, confirmed: true }))
      .resolves.toMatchObject({ ok: false, issues: [{ code: 'unauthorized' }] });
    await expect(secrets.read('openai-api-key', 'main')).resolves.toEqual({ ok: true, value: null });
    expect(clear).not.toHaveBeenCalled();
    database.close();
  });
});
