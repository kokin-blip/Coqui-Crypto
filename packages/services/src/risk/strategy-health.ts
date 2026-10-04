import { evaluateStrategyHealth, OBSERVATION_HEALTH_POLICY, type StrategyHealthPolicy, type StrategyHealthInput,
  type StrategyHealthReport, type CanonicalJsonValue } from '@coqui/core';
import { appendIntegrityEvent, listIntegrityEvents, listForwardEdgeObservations, listRuntimeIncidents, inTransaction, type Db } from '@coqui/storage';
import { NOOP_METRICS, type OperationalMetrics } from '@coqui/observability';
function namespace(profile: string, strategy: string) { return `health:${JSON.stringify([profile, strategy])}`; }
export function readStrategyHealth(profile: string, strategy: string, db: Db): StrategyHealthReport | null {
  const ns = namespace(profile, strategy);
  const review = listIntegrityEvents(ns, 'health_review', db).at(-1);
  if (!review) return null;
  const reset = listIntegrityEvents(ns, 'health_requalification', db).at(-1);
  if (reset && reset.atMs > review.atMs) return null;
  return review.body as unknown as StrategyHealthReport;
}
export function recordMonthlyStrategyHealth(profile: string, strategy: string, atMs: number,
  input: StrategyHealthInput, db: Db, metrics: OperationalMetrics = NOOP_METRICS): StrategyHealthReport {
  const ns = namespace(profile, strategy), key = new Date(atMs).toISOString().slice(0, 7);
  const existing = listIntegrityEvents(ns, 'health_review', db).find((event) => event.key === key);
  if (existing) return existing.body as unknown as StrategyHealthReport;
  const latest = listIntegrityEvents(ns, 'health_review', db).at(-1);
  if (latest && atMs <= latest.atMs) throw new Error('Health reviews must be chronological');
  const policyEvent = listIntegrityEvents(ns, 'health_policy', db).at(-1);
  const policy = policyEvent?.body as unknown as StrategyHealthPolicy | undefined;
  const prior = readStrategyHealth(profile, strategy, db);
  // Gaps between scheduled reviews break the two-consecutive-review rule.
  const previousMonth = new Date(atMs); previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1, 1);
  const expectedKey = previousMonth.toISOString().slice(0, 7);
  const previous = prior?.state === 'paused' || latest?.key === expectedKey ? prior : null;
  const report = evaluateStrategyHealth(input, policy ?? OBSERVATION_HEALTH_POLICY, previous);
  appendIntegrityEvent({ namespace: ns, kind: 'health_review', key, atMs, body: report as unknown as CanonicalJsonValue }, db);
  metrics.counter('strategy_health_reviews_total', 1, { outcome: report.state });
  metrics.gauge('strategy_health_missing_observations', report.missingObservations);
  return report;
}
/** Qualified enforcement and restart both require an immutable passing final result. */
export function qualifyStrategyHealth(profile: string, strategy: string, planHash: string,
  policy: StrategyHealthPolicy, atMs: number, db: Db): void {
  const resultEvent = listIntegrityEvents(planHash, 'final_result', db)[0];
  const result = resultEvent?.body as { adopted?: boolean; candidateId?: string } | undefined;
  if (!resultEvent || result?.adopted !== true || strategy !== result.candidateId || atMs <= resultEvent.atMs || policy.mode !== 'qualified') {
    throw new Error('Passing strategy evidence required for health qualification');
  }
  evaluateStrategyHealth({ days: [], netReturns: [], benchmarkReturns: [], missingObservations: 0,
    observedModeledCostUsd: null, observedActualCostUsd: null, observedFillCount: 0,
    reconciliationExceptions: 0, hardSafetyStop: false }, policy);
  inTransaction(db, () => {
    appendIntegrityEvent({ namespace: namespace(profile, strategy), kind: 'health_policy', key: `${planHash}:${atMs}`,
      atMs, body: policy as unknown as CanonicalJsonValue }, db);
    appendIntegrityEvent({ namespace: namespace(profile, strategy), kind: 'health_requalification', key: `${planHash}:${atMs}`,
      atMs, body: { planHash, resultHash: resultEvent.hash } }, db);
  });
}

/** Captured paper evidence supplies performance observations, never empirical venue-cost validation. */
export function capturePersistedStrategyHealth(profile: string, strategy: string, planHash: string,
  atMs: number, db: Db): StrategyHealthReport {
  const day = 86_400_000, cutoff = Math.floor(atMs / day) * day;
  const rows = listForwardEdgeObservations(planHash, profile, db)
    .filter((row) => row.dayUtc < cutoff && row.dayUtc >= cutoff - 91 * day);
  const days: number[] = [], netReturns: number[] = [], benchmarkReturns: number[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const prior = rows[index - 1]!, row = rows[index]!;
    if (!prior.valuationComplete || !row.valuationComplete || row.dayUtc - prior.dayUtc !== day ||
        prior.actualEquityUsd === null || row.actualEquityUsd === null ||
        prior.holdEquityUsd === null || row.holdEquityUsd === null) continue;
    const actual = Number(prior.actualEquityUsd), hold = Number(prior.holdEquityUsd);
    if (!(actual > 0) || !(hold > 0)) continue;
    days.push(row.dayUtc); netReturns.push(Number(row.actualEquityUsd) / actual - 1);
    benchmarkReturns.push(Number(row.holdEquityUsd) / hold - 1);
  }
  const reconciliationExceptions = listRuntimeIncidents(profile, true, 500, db)
    .filter((incident) => incident.kind === 'reconciliation').length;
  return recordMonthlyStrategyHealth(profile, strategy, atMs, { days, netReturns, benchmarkReturns,
    missingObservations: Math.max(0, 90 - days.length), observedModeledCostUsd: null,
    observedActualCostUsd: null, observedFillCount: 0, reconciliationExceptions, hardSafetyStop: false }, db);
}
