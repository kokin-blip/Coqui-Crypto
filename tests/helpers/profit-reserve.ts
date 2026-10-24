import { capitalHash, evaluateProfitReserve, reserveBaseline, reserveCapitalWitness, reservePolicy, reserveValue,
  type ReserveSettings, type ReserveFinancialInput, type ReserveState, type ReserveCapitalWitness } from '@coqui/core';
import { NOW, SCOPE, feasibility } from './feasibility.js';
export const settings = (changes: Partial<ReserveSettings> = {}): ReserveSettings => ({ goal: 'preview', trigger: { kind: 'profit_usd', value: '50' }, shareBps: 2500,
  retainedCapitalUsd: '0', minimumBatchUsd: '0.01', cadence: 'manual', reviewWinCount: null, taxHold: { amountUsd: '0', backing: 'principal' }, ...changes });
export function financial(changes: Partial<ReserveFinancialInput> = {}): ReserveFinancialInput {
  const v = reserveValue, frame = feasibility('550');
  return { scopeId: SCOPE, epochId: capitalHash('epoch'), fromMs: 0, toMs: NOW, assurance: 'scenario', observedAtMs: NOW, expiresAtMs: NOW + 30_000,
    openingEquityUsd: v('500'), observedCashUsd:v('550'), riskAssetValueUsd:v('0'), sourceCutHash: null, trackingLimitations: [], economicPnlUsd: v('50'), realizedPnlUsd: v('50'), unrealizedPnlUsd: v('0'), equityUsd: v('550'), activeEquityUsd: v('550'), spendableUsd: v('550'),
    contributionsUsd: v('0'), netOutflowsUsd: v('0'), confirmedReceiptsUsd: v('0'), incomeUsd: v('0'), feesUsd: v('0'), completedWins: v('1'),
    actualReservedUsd: v('0'), actualTaxHoldUsd: v('0'), actualPendingUsd: v('0'), priorProfitBackedUsd: v('0'), reasonCodes: [], evidenceRefs: ['synthetic'],
    budgetRevision: frame.budget.revision, generation: 0, ...changes };
}
export function fixture(changes: Partial<ReserveSettings> = {}) {
  const policy = reservePolicy({ scopeId: SCOPE, originProfileId: 'main', previousId: null, createdAtMs: NOW, settings: settings(changes) });
  const state = reserveBaseline(policy, null, financial({ economicPnlUsd: reserveValue('0'), activeEquityUsd: reserveValue('500') }), 'initial', NOW);
  const frame = { ...feasibility('550'), intents: [] };
  const floor = reserveCapitalWitness(frame, 'cash_only');
  return { policy, state, floor, evaluate: (f = financial(), s: ReserveState = state, w: ReserveCapitalWitness = floor) => evaluateProfitReserve(policy, s, f, w, NOW) };
}
