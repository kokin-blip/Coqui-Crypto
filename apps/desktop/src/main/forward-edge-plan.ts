import type { ForwardEdgeStudyPlan } from '@coqui/core';

/**
 * Historical locked plan. The runtime now refuses to append observations when
 * the executable strategy identity differs; preserve this object so prior
 * evidence remains verifiable.
 */
export const SHIPPED_FORWARD_EDGE_PLAN: ForwardEdgeStudyPlan = Object.freeze({
  formatVersion: 1,
  strategyId: 'trendvol-legacy-unvalidated',
  universe: ['BTC-USD', 'ETH-USD', 'LTC-USD'] as const,
  observation: 'completed_daily_forward_only',
  registeredAtMs: 1_787_637_611_000,
  firstEligibleDayUtcMs: 1_787_702_400_000,
  minimumCompletedDays: 365,
  minimumCostBearingRebalances: 30,
  trialUpperBound: 215,
  costProfileHash: 'de6f0bba3537f25c0c63e7ad81bc567a271f6feb0ac43ce9821506ecfcbf65ce',
  codeRevision: 'cd5fb48',
  noParameterSearch: true,
  noHistoricalBackfill: true,
});
