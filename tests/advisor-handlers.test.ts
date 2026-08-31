import { describe, expect, it } from 'vitest';

import { createRuntime } from '../apps/desktop/src/main/composition.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';

const COMMAND = 'ba9dd645-2de6-4dba-a4c8-9f22ab9c68d3';

describe('advisor IPC boundary', () => {
  it('prepares bounded context and deduplicates explicit local generation', async () => {
    const runtime = createRuntime({ databasePath: ':memory:', profileId: 'main',
      disableScheduler: true, readSystemTime: () => 1_800_000_000_000 });
    const dispatch = createDispatcher({ handlers: runtime.handlers });
    const prepared = await dispatch('advisor.context.prepare', { productId: 'BTC-USD',
      bars: [{ timeMs: 1_800_000_000_000, open: '100', high: '110', low: '90', close: '105', volume: '8', complete: true }],
      evidence: [], portfolio: [], scope: { chartData: true, visibleEvidence: false, sanitizedPortfolio: false } });
    expect(prepared.status).toBe('ok');
    if (prepared.status !== 'ok') throw new Error('Context was not prepared.');
    const context = prepared.value as { readonly contextHash: string };
    const payload = { commandId: COMMAND, contextHash: context.contextHash, provider: null } as const;
    const first = await dispatch('advisor.facts.generate', payload), duplicate = await dispatch('advisor.facts.generate', payload);
    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({ status: 'ok', value: { provider: 'local', executionAuthority: false } });
    runtime.dispose();
  });

  it('reports three provider states without returning secret fields', async () => {
    const runtime = createRuntime({ databasePath: ':memory:', profileId: 'main', disableScheduler: true });
    const outcome = await createDispatcher({ handlers: runtime.handlers })('advisor.providers', {});
    expect(outcome).toMatchObject({ status: 'ok', value: { providers: [
      { provider: 'gemini' }, { provider: 'openai' }, { provider: 'anthropic' },
    ] } });
    expect(JSON.stringify(outcome)).not.toMatch(/apiKey|secret|credential-value/u);
    runtime.dispose();
  });
});
