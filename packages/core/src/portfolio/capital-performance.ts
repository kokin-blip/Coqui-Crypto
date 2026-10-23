import type { Decimal } from 'decimal.js';

import {
  CAPITAL_CALCULATION_VERSION, capitalEventHeads, capitalHash,
  type CapitalEventRevision, type CapitalMetric, type CapitalScope, type CapitalSourceBatch,
  type CapitalTrackingEpoch, type CapitalValuation,
} from './capital-ledger.js';
import {
  CapitalDecimal as D, CAPITAL_DAY_MS, CAPITAL_YEAR_MS, capitalDailyStatistics, capitalResult, capitalUnavailable, certifiedCapitalIrr,
} from './capital-return-math.js';

export interface CapitalPerformanceInput {
  readonly scope: CapitalScope;
  readonly epoch: CapitalTrackingEpoch | null;
  readonly batches: readonly CapitalSourceBatch[];
  readonly events: readonly CapitalEventRevision[];
  readonly valuations: readonly CapitalValuation[];
  readonly fromMs?: number | null;
  readonly toMs?: number | null;
}

export interface CapitalPerformanceReport {
  readonly schemaVersion: 1;
  readonly calculationVersion: typeof CAPITAL_CALCULATION_VERSION;
  readonly inputHash: string;
  readonly scopeId: string;
  readonly epochId: string | null;
  readonly fromMs: number | null;
  readonly toMs: number | null;
  readonly inputManifest: {
    readonly batchIds: readonly string[]; readonly eventIds: readonly string[]; readonly valuationIds: readonly string[];
  };
  readonly points: readonly {
    readonly valuationId: string; readonly atMs: number; readonly equityUsd: string | null;
    readonly unitNavUsd: string | null; readonly returnPct: string | null; readonly drawdownPct: string | null;
  }[];
  readonly metrics: Readonly<Record<CapitalMetricName, CapitalMetric>>;
  readonly reasonCodes: readonly string[];
  readonly historicalLimitations: readonly string[];
  readonly annualizationDays: 365;
  readonly riskFreeRatePct: '0';
}

export type CapitalMetricName = 'equityUsd' | 'balanceChangeUsd' | 'economicPnlUsd' | 'contributionsUsd' |
  'netOutflowsUsd' | 'confirmedUserReceiptsUsd' | 'feesUsd' | 'incomeUsd' | 'timeWeightedReturnPct' |
  'annualizedReturnPct' | 'moneyWeightedReturnPct' | 'maxDrawdownPct' | 'volatilityPct' | 'sharpe' |
  'sortino' | 'calmar' | 'timeBelowHighPct' | 'realizedPnlUsd' | 'unrealizedPnlUsd';

function coverageComplete(batches: readonly CapitalSourceBatch[], from: number, to: number): boolean {
  const intervals = batches.filter(({ coverage: c }) => c.complete && c.paginationComplete && c.membershipComplete && c.fromMs !== null)
    .map(({ coverage: c }) => ({ from: c.fromMs!, to: c.toMs })).sort((a, b) => a.from - b.from);
  let cursor = from;
  for (const interval of intervals) {
    if (interval.from > cursor) return false;
    if (interval.to >= cursor) { cursor = interval.to; if (cursor >= to) return true; }
  }
  return false;
}

function periodEvents(events: readonly CapitalEventRevision[], from: number, to: number,
  rows: readonly CapitalValuation[]): { events: CapitalEventRevision[]; reasons: string[] } {
  const selected: CapitalEventRevision[] = [], reasons: string[] = [];
  const ids = new Set(rows.map((row) => row.id));
  for (const event of events) {
    const time = event.effectiveTime;
    if (event.status === 'failed') continue;
    if (time.toMs !== null && time.toMs < from || time.fromMs !== null && time.fromMs > to) continue;
    // Non-capital classifications don't need historical fee timing to prove a zero external flow.
    if (event.status === 'confirmed' && event.effectiveTime.precision === 'unknown' && event.observedAtMs <= from) continue;
    if (event.flowVerified && event.externalFlowUsd !== null && new D(event.externalFlowUsd).isZero()) { selected.push(event); continue; }
    const linkedBoundary = event.afterValuationId !== null && ids.has(event.afterValuationId) && rows[0]?.id !== event.afterValuationId;
    if (time.toMs !== null && time.toMs === from && !linkedBoundary) continue;
    if (event.status !== 'confirmed' || !event.flowVerified || event.externalFlowUsd === null) reasons.push('flow_unverified');
    if (!linkedBoundary && (time.fromMs === null || time.toMs === null || time.fromMs < from || time.toMs > to)) {
      reasons.push('flow_boundary_ambiguous');
    }
    selected.push(event);
  }
  return { events: selected, reasons };
}

function navSeries(rows: readonly CapitalValuation[], events: readonly CapitalEventRevision[]): {
  navs: { atMs: number; nav: Decimal }[]; reasons: string[];
} {
  if (rows.length === 0 || rows[0]!.equityUsd === null) return { navs: [], reasons: ['valuation_missing'] };
  let units = new D(rows[0]!.equityUsd);
  if (!units.gt(0)) return { navs: [], reasons: ['zero_denominator'] };
  const applied = new Set<string>(), navs: { atMs: number; nav: Decimal }[] = [];
  const byAfter = new Map<string, CapitalEventRevision[]>();
  for (const event of events) if (event.afterValuationId !== null && event.externalFlowUsd !== null && !new D(event.externalFlowUsd).isZero()) {
    const group = byAfter.get(event.afterValuationId) ?? []; group.push(event); byAfter.set(event.afterValuationId, group);
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (!row.verified || row.equityUsd === null || row.missingComponents.length > 0) return { navs: [], reasons: ['valuation_missing'] };
    const flows = byAfter.get(row.id) ?? [];
    if (flows.length > 0) {
      const prior = rows[index - 1];
      if (!prior || flows.some((event) => event.beforeValuationId !== prior.id || event.effectiveTime.precision !== 'instant' ||
        event.effectiveTime.fromMs !== row.atMs || event.effectiveTime.toMs !== row.atMs) || prior.atMs !== row.atMs) {
        return { navs: [], reasons: ['flow_time_marks_missing'] };
      }
      const flow = flows.reduce((sum, event) => sum.add(event.externalFlowUsd!), new D(0));
      if (!new D(row.equityUsd).sub(prior.equityUsd!).eq(flow)) return { navs: [], reasons: ['flow_boundary_not_reconciled'] };
      const priorNav = navs.at(-1)!.nav;
      if (priorNav.lte(0)) return { navs: [], reasons: ['zero_denominator'] };
      units = units.add(flow.div(priorNav));
      for (const event of flows) applied.add(event.id);
      if (units.isZero() && new D(row.equityUsd).isZero()) {
        if (index !== rows.length - 1) return { navs: [], reasons: ['zero_denominator'] };
        navs.push({ atMs: row.atMs, nav: priorNav }); continue;
      }
    }
    if (units.lte(0)) return { navs: [], reasons: ['zero_denominator'] };
    navs.push({ atMs: row.atMs, nav: new D(row.equityUsd).div(units) });
  }
  if (events.some((event) => event.externalFlowUsd !== null && !new D(event.externalFlowUsd).isZero() && !applied.has(event.id))) {
    return { navs: [], reasons: ['flow_time_marks_missing'] };
  }
  return { navs, reasons: [] };
}

/** Pure read projection. Legacy helpers and frozen research calculations are intentionally untouched. */
export function calculateCapitalPerformance(input: CapitalPerformanceInput): CapitalPerformanceReport {
  const { scope, epoch } = input;
  if (input.batches.some((row) => row.scopeId !== scope.id) || input.events.some((row) => row.scopeId !== scope.id) ||
    input.valuations.some((row) => row.scopeId !== scope.id) || epoch !== null && epoch.scopeId !== scope.id) {
    throw new TypeError('Capital scope mismatch.');
  }
  const replacedValuations = new Set(input.valuations.map((row) => row.replacesId).filter((id) => id !== null));
  const ordered = [...new Map(input.valuations.map((row) => [row.id, row])).values()].filter((row) => !replacedValuations.has(row.id))
    .sort((a, b) => a.atMs - b.atMs || a.sequence - b.sequence || a.id.localeCompare(b.id));
  let opening = epoch === null ? undefined : input.valuations.find((row) => row.id === epoch.openingValuationId);
  const visitedOpeningIds = new Set<string>();
  while (opening && replacedValuations.has(opening.id) && !visitedOpeningIds.has(opening.id)) {
    visitedOpeningIds.add(opening.id);
    const replacements = input.valuations.filter((row) => row.replacesId === opening!.id);
    opening = replacements.length === 1 ? replacements[0] : undefined;
  }
  const from = input.fromMs ?? opening?.atMs ?? null;
  const to = input.toMs ?? ordered.at(-1)?.atMs ?? null;
  const start = from === null ? undefined : input.fromMs == null && opening ? opening : ordered.find((row) => row.atMs === from);
  const end = to === null ? undefined : ordered.findLast((row) => row.atMs === to);
  const firstIndex = start === undefined ? -1 : ordered.indexOf(start), lastIndex = end === undefined ? -1 : ordered.indexOf(end);
  const rows = firstIndex < 0 || lastIndex < firstIndex ? [] : ordered.slice(firstIndex, lastIndex + 1);
  const manifest = { batchIds: [...new Set(input.batches.map((row) => row.id))].sort(), eventIds: [...new Set(input.events.map((row) => row.id))].sort(), valuationIds: [...new Set(input.valuations.map((row) => row.id))].sort() };
  const inputHash = capitalHash({ version: CAPITAL_CALCULATION_VERSION, scope, epoch, from, to, manifest });
  const refs = [inputHash];
  const selected = from === null || to === null ? { events: [], reasons: [] } : periodEvents(capitalEventHeads(input.events).events, from, to, rows);
  const heads = capitalEventHeads(input.events);
  const reasons: string[] = [];
  const flowReasons: string[] = [];
  if (!opening || from === null || from < opening.atMs) reasons.push('opening_missing');
  if (!start || !end || lastIndex < firstIndex || !start.verified || !end.verified ||
    start.equityUsd === null || end.equityUsd === null || start.missingComponents.length || end.missingComponents.length) reasons.push('valuation_missing');
  if (from === null || to === null || !coverageComplete(input.batches, from, to)) flowReasons.push('history_incomplete');
  if (heads.conflicts.length) flowReasons.push('conflicting_revision');
  if (ordered.some((row, index) => index > 0 && row.atMs === ordered[index - 1]!.atMs && row.sequence === ordered[index - 1]!.sequence)) {
    reasons.push('conflicting_revision');
  }
  flowReasons.push(...selected.reasons);
  reasons.push(...flowReasons);
  const blocked = reasons.length > 0;
  const total = (pick: (row: CapitalEventRevision) => string | null): Decimal => selected.events.reduce((sum, row) => sum.add(pick(row) ?? 0), new D(0));
  const flow = total((row) => row.externalFlowUsd);
  const contributions = total((row) => row.externalFlowUsd !== null && new D(row.externalFlowUsd).gt(0) ? row.externalFlowUsd : '0');
  const outflows = total((row) => row.externalFlowUsd !== null && new D(row.externalFlowUsd).lt(0) ? new D(row.externalFlowUsd).neg().toFixed() : '0');
  const change = start?.equityUsd == null || end?.equityUsd == null ? null : new D(end.equityUsd).sub(start.equityUsd);
  const result = (value: Decimal.Value, method: string): CapitalMetric => flowReasons.length > 0 ? capitalUnavailable(...flowReasons) : capitalResult(value, method, refs);
  const eligibleRows = rows.filter((row) => row.verified && row.equityUsd !== null && row.missingComponents.length === 0);
  const nav = blocked ? { navs: [], reasons } : navSeries(eligibleRows, selected.events);
  if (from === to && nav.reasons.length === 0) nav.reasons.push('insufficient_observations');
  const cumulative = nav.navs.length < 2 || from === to ? null : nav.navs.at(-1)!.nav.sub(1);
  const navById = new Map(eligibleRows.map((row, index) => [row.id, nav.navs[index]]));
  const twr = cumulative === null ? capitalUnavailable(...nav.reasons) : capitalResult(cumulative.mul(100), 'event-valued-unit-nav', refs);
  const elapsed = from === null || to === null ? 0 : to - from;
  const annualized = cumulative === null ? capitalUnavailable(...nav.reasons) : elapsed < CAPITAL_YEAR_MS
    ? capitalUnavailable('less_than_one_year') : capitalResult(cumulative.add(1).pow(new D(CAPITAL_YEAR_MS).div(elapsed)).sub(1).mul(100), 'unit-nav-cagr-act365', refs);
  // Before/after flow marks aren't extra daily observations. Keep the last actual mark at a timestamp.
  const dailyMap = new Map<number, { atMs: number; nav: Decimal }>();
  for (const point of nav.navs) dailyMap.set(point.atMs, point);
  const dailyRows = [...dailyMap.values()].filter((point) => from !== null && (point.atMs - from) % CAPITAL_DAY_MS === 0);
  const daily = capitalDailyStatistics(dailyRows.at(-1)?.atMs === to ? dailyRows : [], refs);
  const drawdownsByTime = new Map(dailyRows.map((point, index) => [point.atMs, daily.drawdowns[index]]));
  const dated = selected.events.filter((row) => row.externalFlowUsd !== null && !new D(row.externalFlowUsd).isZero());
  const irr = blocked ? capitalUnavailable(...reasons) : dated.some((row) => row.effectiveTime.precision !== 'instant')
    ? capitalUnavailable('flow_time_unverified') : certifiedCapitalIrr([
      { atMs: from!, amount: new D(start!.equityUsd!).neg().toFixed() },
      ...dated.map((row) => ({ atMs: row.effectiveTime.fromMs!, amount: new D(row.externalFlowUsd!).neg().toFixed() })),
      { atMs: to!, amount: end!.equityUsd! },
    ], refs);
  const attribute = (key: 'feeUsd' | 'incomeUsd' | 'confirmedUserReceiptUsd', kinds: readonly CapitalEventRevision['kind'][]): CapitalMetric => {
    if (flowReasons.length > 0) return capitalUnavailable(...flowReasons);
    const relevant = selected.events.filter((event) => kinds.includes(event.kind));
    if (relevant.some((event) => event[key] === null || event.effectiveTime.fromMs === null || event.effectiveTime.toMs === null ||
      event.effectiveTime.fromMs < from! || event.effectiveTime.toMs > to!)) return capitalUnavailable('attribution_incomplete');
    return capitalResult(relevant.reduce((sum, event) => sum.add(event[key]!), new D(0)), `posted-${key}`, refs);
  };
  const riskUnavailable = nav.reasons.length > 0 ? capitalUnavailable(...nav.reasons) : null;
  const metrics: Record<CapitalMetricName, CapitalMetric> = {
    equityUsd: end?.equityUsd == null ? capitalUnavailable('valuation_missing') : capitalResult(end.equityUsd, 'observed-account-equity', end.evidenceRefs),
    balanceChangeUsd: change === null ? capitalUnavailable('valuation_missing') : capitalResult(change, 'raw-equity-change-not-investment-profit', refs),
    economicPnlUsd: blocked ? capitalUnavailable(...reasons) : capitalResult(change!.sub(flow), 'equity-minus-external-capital', refs),
    contributionsUsd: result(contributions, 'verified-external-contributions'), netOutflowsUsd: result(outflows, 'verified-net-external-outflows'),
    confirmedUserReceiptsUsd: attribute('confirmedUserReceiptUsd', ['outflow']), feesUsd: attribute('feeUsd', ['fee', 'trade', 'outflow', 'contribution']),
    incomeUsd: attribute('incomeUsd', ['income']), timeWeightedReturnPct: twr, annualizedReturnPct: annualized,
    moneyWeightedReturnPct: irr, maxDrawdownPct: riskUnavailable ?? daily.maxDrawdownPct,
    volatilityPct: riskUnavailable ?? daily.volatilityPct, sharpe: riskUnavailable ?? daily.sharpe,
    sortino: riskUnavailable ?? daily.sortino, timeBelowHighPct: riskUnavailable ?? daily.timeBelowHighPct,
    calmar: annualized.state !== 'available' || daily.maxDrawdownPct.state !== 'available' ? capitalUnavailable(
      ...(annualized.state === 'unavailable' ? annualized.reasonCodes : []),
      ...(daily.maxDrawdownPct.state === 'unavailable' ? daily.maxDrawdownPct.reasonCodes : [])) :
      new D(daily.maxDrawdownPct.value).isZero() ? capitalUnavailable('zero_denominator') :
        capitalResult(new D(annualized.value).div(new D(daily.maxDrawdownPct.value).abs()), 'unit-nav-calmar', refs),
    realizedPnlUsd: capitalUnavailable('unscoped_cost_basis'), unrealizedPnlUsd: capitalUnavailable('unscoped_cost_basis'),
  };
  return {
    schemaVersion: 1, calculationVersion: CAPITAL_CALCULATION_VERSION, inputHash, scopeId: scope.id,
    epochId: epoch?.id ?? null, fromMs: from, toMs: to, inputManifest: manifest,
    points: rows.map((row, i) => ({ valuationId: row.id, atMs: row.atMs, equityUsd: row.equityUsd,
      unitNavUsd: navById.get(row.id)?.nav.toDecimalPlaces(12).toFixed() ?? null,
      returnPct: i === 0 || !navById.get(row.id) || !navById.get(rows[i - 1]!.id) || navById.get(rows[i - 1]!.id)!.nav.isZero() ? null :
        navById.get(row.id)!.nav.div(navById.get(rows[i - 1]!.id)!.nav).sub(1).mul(100).toDecimalPlaces(12).toFixed(),
      drawdownPct: row.verified ? drawdownsByTime.get(row.atMs) ?? null : null })),
    metrics, reasonCodes: [...new Set(reasons)].sort(), historicalLimitations: epoch?.historicalLimitations ?? ['opening_missing'],
    annualizationDays: 365, riskFreeRatePct: '0',
  };
}
