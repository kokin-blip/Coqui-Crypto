import { describe, expect, it } from 'vitest';

import { shellStateForWidth, statusSummary } from '../apps/desktop/src/renderer/app/workspace-layout.js';

function rail(overrides: Partial<Parameters<typeof statusSummary>[0]> = {}): Parameters<typeof statusSummary>[0] {
  return {
    killSwitchEngaged: false,
    riskAssessmentState: 'unassessed',
    riskStage: 'normal',
    portfolioState: 'complete',
    reconciliation: { unresolvedCount: 0, neverRun: false },
    ...overrides,
  };
}

describe('responsive workspace shell', () => {
  it('uses content-width thresholds rather than device labels', () => {
    expect(shellStateForWidth(1_480)).toBe('wide');
    expect(shellStateForWidth(1_479)).toBe('standard');
    expect(shellStateForWidth(760)).toBe('standard');
    expect(shellStateForWidth(759)).toBe('compact');
  });

  it('keeps safety stops above advisory status', () => {
    expect(statusSummary(rail({ killSwitchEngaged: true })).tone).toBe('negative');
    expect(statusSummary(rail({ riskStage: 'hard_stop' })).tone).toBe('negative');
    expect(statusSummary(rail({ riskAssessmentState: 'assessed',
      reconciliation: { unresolvedCount: 2, neverRun: false },
    })).text).toContain('2 unresolved');
    expect(statusSummary(rail()).tone).toBe('warning');
    expect(statusSummary(rail()).text).toBe('Risk unassessed');
  });
});
