export type WorkspaceShellState = 'wide' | 'standard' | 'compact';

export function shellStateForWidth(width: number): WorkspaceShellState {
  if (width >= 1480) return 'wide';
  if (width >= 760) return 'standard';
  return 'compact';
}

interface StatusSummaryInput {
  readonly killSwitchEngaged: boolean;
  readonly riskAssessmentState: 'assessed' | 'unassessed';
  readonly riskStage: string | null;
  readonly portfolioState: 'complete' | 'incomplete' | 'unavailable';
  readonly paperAdmissionMode?: 'validated' | 'exploratory';
  readonly exploratoryCampaignStatus?: 'active' | 'paused' | 'stopping' | 'stopped' | null;
  readonly reconciliation: { readonly unresolvedCount: number; readonly neverRun: boolean };
}

export function statusSummary(rail: StatusSummaryInput): { readonly tone: string; readonly text: string } {
  if (rail.killSwitchEngaged) return { tone: 'negative', text: 'Safety stop engaged' };
  if (rail.riskStage === 'hard_stop') return { tone: 'negative', text: 'Risk hard stop' };
  if (rail.portfolioState === 'unavailable') return { tone: 'warning', text: 'Portfolio not connected' };
  if (rail.portfolioState === 'incomplete') return { tone: 'warning', text: 'Portfolio valuation incomplete' };
  if (rail.riskAssessmentState === 'unassessed') return { tone: 'warning', text: 'Risk unassessed' };
  if (rail.paperAdmissionMode === 'exploratory') {
    return { tone: 'warning', text: rail.exploratoryCampaignStatus === 'paused'
      ? 'Exploratory paper paused' : 'Exploratory paper mode active' };
  }
  if (rail.reconciliation.unresolvedCount > 0) {
    const noun = rail.reconciliation.unresolvedCount === 1 ? 'item' : 'items';
    return { tone: 'warning', text: `${rail.reconciliation.unresolvedCount} unresolved reconciliation ${noun}` };
  }
  if (rail.riskStage !== null && rail.riskStage !== 'normal') {
    return { tone: 'warning', text: `Risk stage ${rail.riskStage.replaceAll('_', ' ')}` };
  }
  if (rail.reconciliation.neverRun) return { tone: 'warning', text: 'Reconciliation not run' };
  return { tone: 'positive', text: 'Safety controls nominal' };
}
