import { describe, expect, it } from 'vitest';

import { createRuntime } from '../apps/desktop/src/main/composition.js';
import { createDispatcher } from '../apps/desktop/src/main/dispatch.js';
import { sha256Hex, strategyDecisionId, type StrategyDecisionV1 } from '../packages/core/src/index.js';
import { appendDecisionEvidenceEvent, saveStrategyDecision } from '../packages/storage/src/index.js';

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

  it('explains a decision from storage and accepts only typed navigation', async () => {
    const now = 1_800_000_000_000, runtime = createRuntime({ databasePath: ':memory:',
      profileId: 'main', disableScheduler: true, readSystemTime: () => now });
    const decisionId = strategyDecisionId('main', now), decision: StrategyDecisionV1 = {
      schemaVersion: 1, decisionId, profileId: 'main', runId: sha256Hex('advisor-handler-run'),
      scheduledForMs: now, strategy: { id: 'trendvol', version: 'trendvol-paper-v1-unvalidated',
        configHash: sha256Hex('config') }, market: { snapshotHash: sha256Hex('market'),
        asOfMs: now, expectedAsOfMs: now, freshness: 'fresh', refreshResult: 'succeeded',
        ruleSnapshotHash: sha256Hex('rules'), rulesFresh: true }, portfolio: {
        snapshotHash: sha256Hex('portfolio'), version: 'paper-v1', source: 'paper_ledger' },
      targets: [], cashWeight: 1, exposure: 0, historyStatus: 'complete', facts: null,
      createdAtMs: now };
    const stored = saveStrategyDecision(decision, runtime.database);
    appendDecisionEvidenceEvent({ schemaVersion: 1, decisionId, profileId: 'main', sequence: 0,
      kind: 'strategy_evaluated', atMs: now, detail: { decisionHash: stored.contentHash } }, runtime.database);
    const dispatch = createDispatcher({ handlers: runtime.handlers });
    const explained = await dispatch('advisor.decision.explain', { commandId: COMMAND,
      decisionId, provider: null });
    expect(explained).toMatchObject({ status: 'ok', value: { decisionId, provider: 'local',
      executionAuthority: false } });
    const navigated = await dispatch('advisor.navigation', { commandId: 'ca9dd645-2de6-4dba-a4c8-9f22ab9c68d3',
      target: 'activity', decisionId });
    expect(navigated).toMatchObject({ status: 'ok', value: { target: 'activity', decisionId } });
    runtime.dispose();
  });
});
