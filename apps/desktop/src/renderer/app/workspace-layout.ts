export type WorkspaceShellState = 'wide' | 'standard' | 'compact';

export function shellStateForWidth(width: number): WorkspaceShellState {
  if (width >= 1480) return 'wide';
  if (width >= 760) return 'standard';
  return 'compact';
}

interface StatusSummaryInput {
  readonly killSwitchEngaged: boolean;
  readonly riskStage: string | null;
  readonly reconciliation: { readonly unresolvedCount: number };
}

export function statusSummary(rail: StatusSummaryInput): { readonly tone: string; readonly text: string } {
  if (rail.killSwitchEngaged) return { tone: 'negative', text: 'Safety stop engaged' };
  if (rail.riskStage === 'hard_stop') return { tone: 'negative', text: 'Risk hard stop' };
  if (rail.reconciliation.unresolvedCount > 0) {
    const noun = rail.reconciliation.unresolvedCount === 1 ? 'item' : 'items';
    return { tone: 'warning', text: `${rail.reconciliation.unresolvedCount} unresolved reconciliation ${noun}` };
  }
  if (rail.riskStage !== null && rail.riskStage !== 'normal') {
    return { tone: 'warning', text: `Risk stage ${rail.riskStage.replaceAll('_', ' ')}` };
  }
  return { tone: 'positive', text: 'Safety controls nominal' };
}
