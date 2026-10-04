import { sha256Hex } from '../crypto/sha256.js';
import { sourceCompletionDelayMs, utcDayKey, type DecisionMarketDataset } from '../market/market-bars.js';

export const INTEGRITY_ENGINE_VERSION = 'attainable-decimal-v1' as const;

/** First daily opening strictly after both the observed bar and the decision. */
export function firstAttainableDailyOpen(latestCompletedStartMs: number, decisionAtMs: number): number {
  if (![latestCompletedStartMs, decisionAtMs].every((at) => Number.isSafeInteger(at) && at >= 0)) {
    throw new TypeError('Invalid paper execution time');
  }
  const day = 86_400_000, next = latestCompletedStartMs + day;
  return next + Math.max(0, Math.floor((decisionAtMs - next) / day) + 1) * day;
}
export interface TimedExposure { readonly value: number; readonly availableAtMs: number; readonly observedThroughMs: number }
export interface ValidatedDecisionFrame {
  readonly observedThroughMs: number;
  readonly availableAtMs: number;
  readonly decisionAtMs: number;
  readonly executionAtMs: number;
  readonly executionIndex: number;
  readonly observedEndExclusive: number;
  readonly policy: 'first_attainable_open';
  readonly availabilityBasis: 'assumed_provider_publication';
}

/** Retrieval time describes acquisition, not historical publication or vintage. */
export function validateDecisionDataset(dataset: DecisionMarketDataset): void {
  if (!Number.isSafeInteger(dataset.generatedAtMs) || dataset.generatedAtMs < 0 || dataset.assets.length === 0 || new Set(dataset.assets).size !== dataset.assets.length ||
      dataset.dayKeys.length === 0 || dataset.report.issues.length > 0) {
    throw new TypeError('Research requires a nonempty, issue-free aligned dataset');
  }
  for (const asset of dataset.assets) {
    const bars = dataset.barsById[asset];
    if (!bars || bars.length !== dataset.dayKeys.length ||
        dataset.opensById[asset]?.length !== bars.length || dataset.closesById[asset]?.length !== bars.length) {
      throw new TypeError('Research series are not aligned');
    }
    for (const [index, bar] of bars.entries()) {
      if (bar.assetId !== asset || bar.interval !== '1d' || !bar.isComplete ||
          !Number.isSafeInteger(bar.startTimeMs) || bar.startTimeMs % 86_400_000 !== 0 ||
          bar.endTimeMs !== bar.startTimeMs + 86_400_000 ||
          utcDayKey(bar.startTimeMs) !== dataset.dayKeys[index] ||
          (index > 0 && bar.startTimeMs !== bars[index - 1]!.endTimeMs) ||
          !Number.isSafeInteger(bar.retrievedAtMs) || bar.retrievedAtMs < 0 ||
          bar.endTimeMs + sourceCompletionDelayMs(bar.source) > dataset.generatedAtMs ||
          [bar.open, bar.high, bar.low, bar.close].some((price) => !Number.isFinite(price) || price <= 0) ||
          bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close) ||
          (bar.volume !== null && (!Number.isFinite(bar.volume) || bar.volume < 0)) ||
          bar.open !== dataset.opensById[asset]![index] || bar.close !== dataset.closesById[asset]![index]) {
        throw new TypeError('Invalid research bar or derived series');
      }
      if (index > 0 && bar.startTimeMs !== dataset.barsById[dataset.assets[0]!]![index]!.startTimeMs) {
        throw new TypeError('Cross-asset timestamps differ');
      }
    }
  }
  const rebuilt = sha256Hex(JSON.stringify({
    policy: dataset.report.policy, assets: dataset.assets, keys: dataset.dayKeys,
    bars: dataset.assets.map((asset) => dataset.barsById[asset]!.map((bar) => [
      bar.source, bar.quality ?? 'reported_ohlc', bar.startTimeMs, bar.open, bar.high,
      bar.low, bar.close, bar.volume, bar.retrievedAtMs,
    ])),
  }));
  if (rebuilt !== dataset.report.datasetHash) throw new TypeError('Dataset content hash mismatch');
}

/** Frame for an execution index; only publications strictly before its open are visible. */
export function decisionFrameAt(dataset: DecisionMarketDataset, executionIndex: number): ValidatedDecisionFrame {
  if (!Number.isSafeInteger(executionIndex) || executionIndex < 0 || executionIndex >= dataset.dayKeys.length) {
    throw new RangeError('No execution bar');
  }
  const executionAtMs = dataset.barsById[dataset.assets[0]!]![executionIndex]!.startTimeMs;
  let observedEndExclusive = 0;
  let availableAtMs = 0;
  let observedThroughMs = 0;
  for (let index = 0; index < executionIndex; index += 1) {
    const rows = dataset.assets.map((asset) => dataset.barsById[asset]![index]!);
    const available = Math.max(...rows.map((bar) => bar.endTimeMs + sourceCompletionDelayMs(bar.source)));
    if (available >= executionAtMs) break;
    observedEndExclusive = index + 1;
    availableAtMs = available;
    observedThroughMs = Math.max(...rows.map((bar) => bar.endTimeMs));
  }
  return Object.freeze({ observedThroughMs, availableAtMs, decisionAtMs: availableAtMs,
    executionAtMs, executionIndex, observedEndExclusive, policy: 'first_attainable_open',
    availabilityBasis: 'assumed_provider_publication' });
}

export function validateTimedExposure(frame: ValidatedDecisionFrame, exposure: TimedExposure): number {
  if (!Number.isFinite(exposure.value) || exposure.value < 0 || exposure.value > 1 ||
      !Number.isSafeInteger(exposure.availableAtMs) || !Number.isSafeInteger(exposure.observedThroughMs) ||
      exposure.availableAtMs < 0 || exposure.observedThroughMs < 0 ||
      exposure.observedThroughMs > exposure.availableAtMs ||
      exposure.availableAtMs > frame.decisionAtMs || exposure.observedThroughMs > frame.decisionAtMs) {
    throw new TypeError('Exposure overlay lacks causal availability');
  }
  return exposure.value;
}
