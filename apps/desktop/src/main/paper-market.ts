import { fetchCoinbaseProductRules, deadlineHttp, type RequestDeadline, type HttpClient } from '@coqui/adapters';
import {
  canonicalJson,
  instrumentKey,
  sha256Hex,
  trendVolMinimumHistory,
  type InstrumentIdentity,
  type MarketBar,
} from '@coqui/core';
import {
  latestExpectedCoinbaseCompleteStart,
  syncCoinbaseDecisionDataset,
  type PaperDecisionPreparation,
  type PaperMarketData,
} from '@coqui/services';
import {
  latestProductRuleSnapshot,
  appendRemediationEvidence,
  listRemediationEvidence,
  listMarketBars,
  saveProductRuleSnapshot,
  type Db,
} from '@coqui/storage';

/**
 * The paper engine's view of the market, and the refresh that fills it.
 *
 * `PaperMarketData` is deliberately **synchronous**: the OMS reads bars while
 * deciding, and an await inside a decision would let the market move between
 * two intents of the same run. So reads come from the local database — the same
 * persisted bars a backtest reads, which is also what makes the reconciliation
 * comparison meaningful — and the network happens beforehand, in `refresh`.
 *
 * A refresh that fails is not fatal. The engine then decides against the bars it
 * already has, and the venue refuses any product whose rules are missing rather
 * than assuming them (invariant 4).
 */

/**
 * Enough history for the longest lookback a shipped default uses (120 bars),
 * with room for the warm-up the trend features need before their first signal.
 */
const LOOKBACK_DAYS = 400;

export interface PaperMarketFeedDependencies {
  readonly database: Db;
  readonly now?: () => number;
  readonly http: HttpClient;
  /** The instruments the engine may trade — the policy's targets. */
  readonly instruments: () => readonly InstrumentIdentity[];
  readonly bars: (
    instrument: InstrumentIdentity,
    lookbackDays: number,
    nowMs: number,
    deadline?: RequestDeadline,
  ) => Promise<{ readonly ok: true; readonly bars: readonly MarketBar[] } | { readonly ok: false }>;
  readonly onUnexpectedError?: (context: string, error: unknown) => void;
}

export interface PaperMarketFeed {
  readonly view: PaperMarketData;
  /** Last completed all-or-nothing refresh result consumed by the decision loop. */
  preparation(): PaperDecisionPreparation;
  /** Fetch and persist bars and venue rules. Returns a typed stand-down on failure. */
  refresh(nowMs: number, deadline?: RequestDeadline): Promise<PaperDecisionPreparation>;
  /** Explicit-universe refresh used only while validating a new campaign. */
  refreshFor(instruments: readonly InstrumentIdentity[], nowMs: number, deadline?: RequestDeadline): Promise<PaperDecisionPreparation>;
}

export function createPaperMarketFeed(
  dependencies: PaperMarketFeedDependencies,
): PaperMarketFeed {
  const report = dependencies.onUnexpectedError ?? (() => {});
  let latestPreparation: PaperDecisionPreparation = { ok: false, code: 'market_fetch_failed' };

  const instrumentFor = (key: string): InstrumentIdentity | null => {
    const [venue, productType, productId] = key.split('|');
    return venue === 'coinbase' && productType === 'spot' && productId !== undefined
      ? { venue, productId, productType }
      : null;
  };

  const view: PaperMarketData = {
    bars(key) {
      const instrument = instrumentFor(key);
      if (instrument === null) return [];
      return listMarketBars(instrument, dependencies.database)
        .filter((record) => record.isComplete)
        .map((record) => ({
        assetId: instrumentKey(record.instrument),
        source: record.source,
        interval: record.interval,
        startTimeMs: record.startTimeMs,
        endTimeMs: record.endTimeMs,
        open: Number(record.open),
        high: Number(record.high),
        low: Number(record.low),
        close: Number(record.close),
        volume: record.volume === null ? null : Number(record.volume),
        isComplete: record.isComplete,
        retrievedAtMs: record.retrievedAtMs,
        quality: record.quality,
        }));
    },
    rules(key) {
      const instrument = instrumentFor(key);
      return instrument === null
        ? null
        : latestProductRuleSnapshot(instrument.productId, dependencies.database);
    },
  };

  async function refreshRules(nowMs: number, instruments: readonly InstrumentIdentity[], deadline?: RequestDeadline): Promise<string | null> {
    const namespace = 'coinbase-rule-verification-v1';
    const wanted = instruments.map(instrumentKey).sort();
    const latest = listRemediationEvidence('market', namespace, 'verification', dependencies.database).at(-1);
    if (latest && nowMs >= latest.atMs && nowMs - latest.atMs <= 30_000) {
      const body = latest.body as { identities: string[]; rulesHash: string; eligible: boolean };
      if (body.eligible && canonicalJson(body.identities) === canonicalJson(wanted)) return body.rulesHash;
    }
    const result = await fetchCoinbaseProductRules(deadline ? deadlineHttp(dependencies.http, deadline) : dependencies.http, {
      nowMs, productIds: instruments.map((instrument) => instrument.productId),
      ...(deadline ? { signal: deadline.signal } : {}) });
    deadline?.check();
    if (!result.ok || result.rules.length !== instruments.length ||
        result.rules.some((rule) => !wanted.includes(instrumentKey(rule.instrument)))) return null;
    const verifiedAtMs = dependencies.now?.() ?? nowMs;
    for (const rule of result.rules) saveProductRuleSnapshot(rule, dependencies.database);
    const rulesHash = sha256Hex(canonicalJson(result.rules.map((rule) => ({
      id: rule.id, identity: instrumentKey(rule.instrument) })).sort((a,b) => a.identity.localeCompare(b.identity))));
    const eligible = result.rules.every((rule) => rule.status === 'online' && !rule.tradingDisabled &&
      !rule.cancelOnly && !rule.limitOnly && !rule.postOnly && !rule.viewOnly);
    appendRemediationEvidence({ profileId: 'market', namespace, kind: 'verification',
      key: `${verifiedAtMs}:${rulesHash}`, atMs: verifiedAtMs,
      body: { identities: wanted, rulesHash, eligible, ruleIds: result.rules.map((rule) => rule.id) } }, dependencies.database);
    return eligible ? rulesHash : null;
  }

  let observationSequence = listRemediationEvidence('market', 'paper-readiness-v1', 'operation', dependencies.database).length;
  const observe = async <T>(operation: string, promise: Promise<T>, valid: (result: T) => boolean, startedAtMs: number): Promise<T> => {
    const started = performance.now();
    try {
      const result = await promise;
      appendRemediationEvidence({ profileId: 'market', namespace: 'paper-readiness-v1', kind: 'operation',
        key: `${startedAtMs}:${operation}:${observationSequence++}`, atMs: dependencies.now?.() ?? startedAtMs,
        body: { operation, startedAtMs, observedAtMs: dependencies.now?.() ?? startedAtMs, durationMs: performance.now()-started,
          status: valid(result) ? 'validated' : 'unavailable', reason: valid(result) ? null : 'invalid_stale_or_halted_evidence' } }, dependencies.database);
      return result;
    } catch (error) {
      appendRemediationEvidence({ profileId: 'market', namespace: 'paper-readiness-v1', kind: 'operation',
        key: `${startedAtMs}:${operation}:${observationSequence++}`, atMs: dependencies.now?.() ?? startedAtMs,
        body: { operation, startedAtMs, observedAtMs: dependencies.now?.() ?? startedAtMs, durationMs: performance.now()-started,
          status: 'unavailable', reason: error instanceof Error && /^[a-z_]+$/u.test(error.message) ? error.message : 'readiness_failed' } }, dependencies.database);
      throw error;
    }
  };

  const refreshFor = async (
    instruments: readonly InstrumentIdentity[],
    nowMs: number,
    deadline?: RequestDeadline,
  ): Promise<PaperDecisionPreparation> => {
      if (instruments.length === 0) return latestPreparation;

      try {
        const [rulesHash, dataset] = await Promise.all([
          observe('coinbase_rules', refreshRules(nowMs, instruments, deadline), (result) => result !== null, nowMs),
          observe('completed_bars', syncCoinbaseDecisionDataset({
            database: dependencies.database,
            instruments,
            maxDays: LOOKBACK_DAYS,
            minAlignedDays: trendVolMinimumHistory(),
            allowFreshCacheOnFetchFailure: true,
            preferCurrentCache: true,
            nowMs,
            fetchDailyBars: async (instrument) => {
              const result = await dependencies.bars(instrument, LOOKBACK_DAYS, nowMs, deadline);
              return result.ok
                ? { ok: true, status: 200, data: [...result.bars] }
                : { ok: false, status: 0, reason: 'network', retried: 0 };
            },
          }), (result) => result.ok, nowMs),
        ]);
        deadline?.check();
        if (!dataset.ok) {
          const code: Extract<PaperDecisionPreparation, { ok: false }>['code'] = ({
            fetch_failed: 'market_fetch_failed',
            invalid_provider_data: 'invalid_market_data',
            alignment_failed: 'market_alignment_failed',
            insufficient_history: 'insufficient_history',
            stale_data: 'stale_market_data',
          } as const)[dataset.code];
          const candidate = dataset.dataset;
          const latestCompletedStartMs = candidate?.barsById[candidate.assets[0]!]?.at(-1)
            ?.startTimeMs;
          latestPreparation = {
            ok: false,
            code,
            ...(candidate === undefined ? {} : { datasetHash: candidate.report.datasetHash }),
            ...(latestCompletedStartMs === undefined ? {} : { latestCompletedStartMs }),
            expectedCompletedStartMs: latestExpectedCoinbaseCompleteStart(nowMs),
            ...(rulesHash === null ? {} : { ruleSnapshotHash: rulesHash }),
            rulesFresh: rulesHash !== null,
          };
        } else if (rulesHash === null) {
          const latestCompletedStartMs = dataset.dataset.barsById[dataset.dataset.assets[0]!]!
            .at(-1)!.startTimeMs;
          latestPreparation = {
            ok: false,
            code: 'stale_product_rules',
            datasetHash: dataset.dataset.report.datasetHash,
            latestCompletedStartMs,
            expectedCompletedStartMs: latestExpectedCoinbaseCompleteStart(nowMs),
            rulesFresh: false,
          };
        } else {
          const latestCompletedStartMs = dataset.dataset.barsById[dataset.dataset.assets[0]!]!
            .at(-1)!.startTimeMs;
          latestPreparation = {
            ok: true,
            dataset: dataset.dataset,
            datasetHash: dataset.dataset.report.datasetHash,
            latestCompletedStartMs,
            expectedCompletedStartMs: latestExpectedCoinbaseCompleteStart(nowMs),
            ruleSnapshotHash: rulesHash,
          };
        }
      } catch (error) {
        report('paper_market_refresh', error);
        latestPreparation = { ok: false, code: 'market_fetch_failed' };
      }
      return latestPreparation;
  };

  return {
    view,
    preparation: () => latestPreparation,
    refreshFor,
    async refresh(nowMs, deadline) {
      let instruments: readonly InstrumentIdentity[];
      try {
        instruments = dependencies.instruments();
      } catch (error) {
        report('paper_market_instruments', error);
        latestPreparation = { ok: false, code: 'market_fetch_failed' };
        return latestPreparation;
      }
      return refreshFor(instruments, nowMs, deadline);
    },
  };
}
