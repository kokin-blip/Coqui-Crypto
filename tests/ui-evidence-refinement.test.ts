import { describe, expect, it } from 'vitest';

import { formatApproxUsd, formatUsd } from '../packages/ui-kit/src/format.js';
import { sha256Hex, strategyDecisionId } from '../packages/core/src/index.js';
import { appendPaperExecutionEvent, getPaperProposalEvidence, openDatabase,
  savePaperExecutionProposal, savePaperProposalPendingContext, saveStrategyDecision } from '../packages/storage/src/index.js';
import { groupChartEvidence } from '../apps/desktop/src/renderer/app/chart-evidence-groups.js';

describe('evidence-first UI read models', () => {
  it('uses persisted proposal reason and decision pointers, with a missing-reason fallback', () => {
    const database = openDatabase(':memory:');
    const proposal = savePaperExecutionProposal({ id: 'proposal-1', profileId: 'main', runId: 'run-1',
      revision: 1, proposalHash: 'a'.repeat(64), intentsJson: '[]', status: 'blocked',
      createdAt: 100, updatedAt: 100 }, database);
    expect(getPaperProposalEvidence(proposal.id, database)).toEqual({ reasonCode: null, decisionId: null, evidenceId: null });
    const decisionId = strategyDecisionId('main', 100);
    saveStrategyDecision({ schemaVersion: 1, decisionId, profileId: 'main', runId: 'run-1', scheduledForMs: 100,
      strategy: { id: 'trendvol', version: 'paper-v1', configHash: sha256Hex('config') },
      market: { snapshotHash: null, asOfMs: null, expectedAsOfMs: null, freshness: 'unavailable',
        refreshResult: 'unavailable', ruleSnapshotHash: null, rulesFresh: false },
      portfolio: { snapshotHash: null, version: null, source: 'unavailable' },
      targets: [], cashWeight: null, exposure: null, historyStatus: 'unavailable', facts: null, createdAtMs: 100 }, database);
    savePaperProposalPendingContext(proposal.id, { decisionId,
      requiredExecutionBarStartMs: 100, costModelHash: 'c'.repeat(64) }, database);
    appendPaperExecutionEvent(proposal.id, 'main', 'prepared', 100, { reasonCode: 'risk_unassessed' }, database);
    appendPaperExecutionEvent(proposal.id, 'main', 'blocked', 101, { reasonCode: null }, database);
    expect(getPaperProposalEvidence(proposal.id, database)).toEqual({
      reasonCode: 'risk_unassessed', decisionId, evidenceId: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    database.close();
  });

  it('makes rounded headlines explicit while retaining exact source formatting', () => {
    expect(formatApproxUsd('47.6875973132')).toBe('≈$47.69');
    expect(formatUsd('47.6875973132')?.text).toBe('$47.6875973132');
    expect(formatApproxUsd('-1.005')).toBe('≈−$1.01');
    expect(formatApproxUsd('999.999')).toBe('≈$1,000.00');
    expect(formatApproxUsd('not-a-number')).toBeNull();
  });

  it('renders one marker per bar without losing individual chart events', () => {
    const bars = [{ startTimeMs: 0, endTimeMs: 100 }, { startTimeMs: 100, endTimeMs: 200 }];
    const groups = groupChartEvidence(bars, [
      { timeMs: 10, label: 'Decision A', tone: 'positive' as const },
      { timeMs: 80, label: 'Decision B', tone: 'negative' as const },
      { timeMs: 120, label: 'Decision C', tone: 'warning' as const },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ timeMs: 0, tone: 'negative', items: [{ label: 'Decision A' }, { label: 'Decision B' }] });
    expect(groups[1]?.items[0]?.label).toBe('Decision C');
  });
});
