import { instrumentKey } from '../types/instrument.js';
import { tradeCostConfigHash, type TradeCostConfig } from '../costs/index.js';
import { modeledFill } from '../paper/modeled-fill.js';
import { solve } from '../research/overlay/models.js';
import { newsEvidenceHash } from './intelligence.js';
import { NEWS_DAY_MS, NEWS_HOUR_MS } from './features.js';
import type { NewsFeatureSnapshot } from './intelligence-types.js';
export interface NewsStudyBar {
  readonly instrumentKey: string; readonly interval: '1h' | '1d'; readonly startTimeMs: number;
  readonly endTimeMs: number; readonly open: number; readonly close: number; readonly availableAtMs: number;
}
export interface NewsStudyRow {
  readonly instrumentKey: string; readonly decisionAtMs: number; readonly featureId: string | null;
  readonly baseline: readonly number[]; readonly augmented: readonly number[];
  readonly outcome: number; readonly labelAvailableAtMs: number; readonly entryPrice: number; readonly exitPrice: number;
}
export const NEWS_STUDY_SPEC = Object.freeze({ version: 'news-study-v1', ridge: 1, trainDays: 120,
  calibrationDays: 60, testDays: 30, purgeHours: 24, embargoHours: 24, replayNotionalUsd: 1000,
  baselineFeatures: ['return_1_interval', 'return_24h', 'return_7d', 'volatility_24h', 'volatility_7d'],
  newsFeatures: ['log_groups_1h', 'log_groups_24h', 'tone_1h', 'tone_24h', 'tone_missing_1h', 'tone_missing_24h',
    'log_publishers_24h', 'news_missing', 'log_security', 'log_regulatory', 'log_exchange', 'log_macro', 'log_protocol', 'log_market_structure', 'log_other'],
});
const avg = (a: readonly number[]) => a.reduce((s, v) => s + v, 0) / a.length;
function featureVector(f: NewsFeatureSnapshot | undefined): number[] {
  const h = f?.windows[0], d = f?.windows[1];
  return [Math.log1p(h?.groupCount ?? 0), Math.log1p(d?.groupCount ?? 0), h?.sentimentMean ?? 0, d?.sentimentMean ?? 0,
    h?.sentimentMean === null || !h ? 1 : 0, d?.sentimentMean === null || !d ? 1 : 0, Math.log1p(d?.publisherCount ?? 0), f ? 0 : 1,
    ...(['security', 'regulatory', 'exchange', 'macro', 'protocol', 'market_structure', 'other'] as const).map(k => Math.log1p(d?.eventCounts[k] ?? 0))];
}
/** Each predictor input must exist at the decision. Outcomes are future labels with separate availability. */
export function buildNewsStudyRows(bars: readonly NewsStudyBar[], features: readonly NewsFeatureSnapshot[],
  cadence: 'hourly' | 'daily', horizonHours: 1 | 4 | 24): readonly NewsStudyRow[] {
  const interval = cadence === 'hourly' ? '1h' : '1d', width = cadence === 'hourly' ? NEWS_HOUR_MS : NEWS_DAY_MS;
  if (cadence === 'daily' && horizonHours !== 24 || bars.length > 100_000 || features.length > 100_000) throw new TypeError('Invalid news study bounds.');
  const rows: NewsStudyRow[] = [];
  const instruments = [...new Set(bars.filter(b => b.interval === interval).map(b => b.instrumentKey))].sort();
  for (const key of instruments) {
    const series = bars.filter(b => b.instrumentKey === key && b.interval === interval).sort((a, b) => a.startTimeMs - b.startTimeMs);
    const starts = new Map<number, NewsStudyBar>();
    for (const b of series) {
      if (![b.startTimeMs, b.endTimeMs, b.availableAtMs].every(Number.isSafeInteger) || b.startTimeMs < 0 || b.startTimeMs % width || b.endTimeMs !== b.startTimeMs + width || b.availableAtMs < b.endTimeMs || !Number.isFinite(b.open) || !Number.isFinite(b.close) || b.open <= 0 || b.close <= 0 || starts.has(b.startTimeMs)) throw new TypeError('Invalid or duplicate news-study market interval.');
      starts.set(b.startTimeMs, b);
    }
    const evidence = features.filter(f => !f.reconstruction && f.cadence === cadence && instrumentKey(f.instrument) === key)
      .sort((a, b) => b.decisionAtMs - a.decisionAtMs || b.availableAtMs - a.availableAtMs || a.id.localeCompare(b.id));
    let historyStart = 0;
    for (const entry of series) {
      const at = entry.startTimeMs, label = starts.get(at + horizonHours * NEWS_HOUR_MS - width);
      while (historyStart < series.length && series[historyStart]!.endTimeMs < at - 8 * NEWS_DAY_MS) historyStart++;
      const history = series.slice(historyStart, historyStart + 8 * NEWS_DAY_MS / width + 1).filter(b => b.endTimeMs <= at && b.availableAtMs <= at && b.endTimeMs >= at - 8 * NEWS_DAY_MS);
      const last = history.at(-1);
      const horizonBars = Array.from({ length: horizonHours * NEWS_HOUR_MS / width }, (_, i) => starts.get(at + i * width));
      if (horizonBars.some(b => !b) || !label || !last || history.length < 7 * NEWS_DAY_MS / width || history.some((b, i) => i > 0 && b.startTimeMs !== history[i - 1]!.startTimeMs + width)) continue;
      const returns = history.slice(1).map((b, i) => Math.log(b.close / history[i]!.close));
      const trailing = (duration: number) => returns.slice(-Math.max(1, duration / width));
      const volatility = (a: readonly number[]) => { const mean = avg(a); return Math.sqrt(avg(a.map(v => (v - mean) ** 2))); };
      const daily = history.find(b => b.endTimeMs === last.endTimeMs - NEWS_DAY_MS), weekly = history.find(b => b.endTimeMs === last.endTimeMs - 7 * NEWS_DAY_MS);
      if (!daily || !weekly) continue;
      const baseline = [returns.at(-1)!, Math.log(last.close / daily.close), Math.log(last.close / weekly.close), volatility(trailing(NEWS_DAY_MS)), volatility(trailing(7 * NEWS_DAY_MS))];
      const f = evidence.find(f => f.decisionAtMs <= at && f.availableAtMs <= at && at - f.decisionAtMs <= 2 * width);
      rows.push({ instrumentKey: key, decisionAtMs: at, featureId: f?.id ?? null, baseline, augmented: [...baseline, ...featureVector(f)],
        outcome: Math.log(label.close / entry.open), labelAvailableAtMs: Math.max(...horizonBars.map(b => b!.availableAtMs)), entryPrice: entry.open, exitPrice: label.close });
    }
  }
  return rows.sort((a, b) => a.decisionAtMs - b.decisionAtMs || a.instrumentKey.localeCompare(b.instrumentKey));
}
function fit(rows: readonly NewsStudyRow[], augmented: boolean) {
  const x = rows.map(r => [...(augmented ? r.augmented : r.baseline)]), y = rows.map(r => r.outcome), size = x[0]!.length;
  const means = Array.from({ length: size }, (_, f) => avg(x.map(row => row[f]!)));
  const scales = means.map((m, f) => Math.max(1e-8, Math.sqrt(avg(x.map(row => (row[f]! - m) ** 2)))));
  const gram = Array.from({ length: size + 1 }, () => Array<number>(size + 1).fill(0)), target = Array<number>(size + 1).fill(0);
  x.forEach((row, n) => {
    const values = [1, ...row.map((v, f) => (v - means[f]!) / scales[f]!)];
    for (let i = 0; i <= size; i++) { target[i] = target[i]! + values[i]! * y[n]!;
      for (let j = 0; j <= size; j++) gram[i]![j] = gram[i]![j]! + values[i]! * values[j]!; }
  });
  for (let i = 1; i <= size; i++) gram[i]![i] = gram[i]![i]! + 1;
  return { means, scales, coefficients: solve(gram, target) };
}
function predict(model: ReturnType<typeof fit>, row: NewsStudyRow, augmented: boolean): number {
  return model.coefficients[0]! + (augmented ? row.augmented : row.baseline).reduce((s, v, f) => s + (v - model.means[f]!) / model.scales[f]! * model.coefficients[f + 1]!, 0);
}
export function runNewsStudy(input: { readonly bars: readonly NewsStudyBar[]; readonly features: readonly NewsFeatureSnapshot[];
  readonly cadence: 'hourly' | 'daily'; readonly horizonHours: 1 | 4 | 24; readonly cost: TradeCostConfig;
  readonly sourceManifestHashes: readonly string[]; readonly codeRevision: string; readonly completedAtMs: number }) {
  const rows = buildNewsStudyRows(input.bars, input.features, input.cadence, input.horizonHours);
  const spec = { ...NEWS_STUDY_SPEC, cadence: input.cadence, horizonHours: input.horizonHours, costHash: tradeCostConfigHash(input.cost) };
  if (!input.codeRevision || !Number.isSafeInteger(input.completedAtMs) || input.completedAtMs < 0 || input.sourceManifestHashes.some(h => !/^[a-f0-9]{64}$/u.test(h))) throw new TypeError('Invalid study provenance.');
  const manifest = { spec, codeRevision: input.codeRevision, sourceManifestHashes: [...input.sourceManifestHashes].sort(),
    datasetHash: newsEvidenceHash(rows), featureIds: [...new Set(rows.flatMap(r => r.featureId ? [r.featureId] : []))].sort() };
  const manifestHash = newsEvidenceHash(manifest);
  const eligible = rows.filter(r => r.featureId !== null), start = eligible[0]?.decisionAtMs ?? null;
  const insufficient = (reasons: readonly string[]) => ({ status: 'insufficient_evidence' as const, manifest, manifestHash,
    completedAtMs: input.completedAtMs, reasons, rowCount: rows.length, prospectiveRowCount: eligible.length, evaluations: [] });
  if (start === null) return insufficient(['no_eligible_prospective_news']);
  const trainEnd = start + 120 * NEWS_DAY_MS, calibrationStart = trainEnd + NEWS_DAY_MS,
    calibrationEnd = calibrationStart + 60 * NEWS_DAY_MS, testStart = calibrationEnd + NEWS_DAY_MS, testEnd = testStart + 30 * NEWS_DAY_MS;
  const width = input.cadence === 'hourly' ? NEWS_HOUR_MS : NEWS_DAY_MS;
  // Explicit assets prevent silently reporting a subset.
  const evaluations = [];
  for (const asset of ['BTC', 'ETH', 'SOL']) {
    const key = instrumentKey({ venue: 'coinbase', productType: 'spot', productId: `${asset}-USD` });
    const samples = eligible.filter(r => r.instrumentKey === key);
    const train = samples.filter(r => r.decisionAtMs < trainEnd - NEWS_DAY_MS && r.labelAvailableAtMs < trainEnd && r.labelAvailableAtMs <= input.completedAtMs);
    const calibration = samples.filter(r => r.decisionAtMs >= calibrationStart && r.decisionAtMs < calibrationEnd - NEWS_DAY_MS && r.labelAvailableAtMs < calibrationEnd && r.labelAvailableAtMs <= input.completedAtMs);
    const test = samples.filter(r => r.decisionAtMs >= testStart && r.decisionAtMs < testEnd && r.labelAvailableAtMs <= input.completedAtMs);
    if (train.length < 119 * NEWS_DAY_MS / width || calibration.length < 59 * NEWS_DAY_MS / width || test.length < 30 * NEWS_DAY_MS / width) return insufficient([`${asset.toLowerCase()}_prospective_or_market_coverage_insufficient`]);
    for (const augmented of [false, true]) {
      const model = fit(train, augmented), frozenModelHash = newsEvidenceHash(model);
      const forecasts = test.map(r => predict(model, r, augmented));
      let netPnl = 0, cost = 0, trades = 0, nextEntry = 0;
      test.forEach((r, i) => {
        if (r.decisionAtMs < nextEntry || forecasts[i]! <= 0) return;
        const quantity = String(1000 / r.entryPrice), buy = modeledFill('buy', quantity, String(r.entryPrice), input.cost), sell = modeledFill('sell', quantity, String(r.exitPrice), input.cost);
        netPnl += Number(buy.cashChange) + Number(sell.cashChange); cost += Number(buy.totalCost) + Number(sell.totalCost); trades++;
        nextEntry = r.decisionAtMs + input.horizonHours * NEWS_HOUR_MS;
      });
      evaluations.push({ asset, model: augmented ? 'market_plus_news' : 'market_only', frozenModelHash, modelEvidence: model,
        trainRows: train.length, calibrationRows: calibration.length, testRows: test.length,
        calibrationMse: avg(calibration.map(r => (predict(model, r, augmented) - r.outcome) ** 2)),
        predictive: { mse: avg(test.map((r, i) => (forecasts[i]! - r.outcome) ** 2)), directionalAccuracy: avg(test.map((r, i) => Math.sign(forecasts[i]!) === Math.sign(r.outcome) ? 1 : 0)) },
        replay: { convention: 'nonoverlapping_long_or_cash_fixed_notional', netPnlUsd: netPnl, modeledCostUsd: cost, trades } });
    }
  }
  return { status: 'evaluated' as const, manifest, manifestHash, completedAtMs: input.completedAtMs,
    reasons: [] as readonly string[], rowCount: rows.length, prospectiveRowCount: eligible.length, evaluations };
}
