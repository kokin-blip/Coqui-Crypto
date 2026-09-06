import { fetchCoinbaseProductRules, type HttpClient } from '@coqui/adapters';
import {
  canonicalJson,
  instrumentKey,
  sha256Hex,
  trendVolMinimumHistory,
  type CanonicalJsonValue,
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
  readonly http: HttpClient;
  /** The instruments the engine may trade — the policy's targets. */
  readonly instruments: () => readonly InstrumentIdentity[];
  readonly bars: (
    instrument: InstrumentIdentity,
    lookbackDays: number,
    nowMs: number,
  ) => Promise<{ readonly ok: true; readonly bars: readonly MarketBar[] } | { readonly ok: false }>;
  readonly onUnexpectedError?: (context: string, error: unknown) => void;
}

export interface PaperMarketFeed {
  readonly view: PaperMarketData;
  /** Last completed all-or-nothing refresh result consumed by the decision loop. */
  preparation(): PaperDecisionPreparation;
  /** Fetch and persist bars and venue rules. Returns a typed stand-down on failure. */
  refresh(nowMs: number): Promise<PaperDecisionPreparation>;
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

  async function refreshRules(
    nowMs: number,
    instruments: readonly InstrumentIdentity[],
  ): Promise<string | null> {
    const result = await fetchCoinbaseProductRules(dependencies.http, { nowMs });
    if (!result.ok) return null;
    const wanted = new Set(instruments.map((instrument) => instrument.productId));
    for (const rule of result.rules) {
      // Only the products the engine may trade. The venue lists hundreds; the
      // rest are rows nothing would ever read.
      if (!wanted.has(rule.instrument.productId)) continue;
      // Insert-only and keyed by content hash, so an unchanged rule set is a
      // no-op rather than a duplicate.
      saveProductRuleSnapshot(rule, dependencies.database);
    }
    const snapshots = instruments
      .map((instrument) => latestProductRuleSnapshot(instrument.productId, dependencies.database))
      .sort((left, right) => {
        const leftId = left?.instrument.productId ?? '';
        const rightId = right?.instrument.productId ?? '';
        return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
      });
    if (snapshots.some((snapshot) => snapshot === null || snapshot.retrievedAt !== nowMs)) return null;
    return sha256Hex(canonicalJson(snapshots.map((snapshot) => ({
      id: snapshot!.id,
      productId: snapshot!.instrument.productId,
      retrievedAt: snapshot!.retrievedAt,
    })) as unknown as CanonicalJsonValue));
  }

  return {
    view,
    preparation: () => latestPreparation,
    async refresh(nowMs) {
      let instruments: readonly InstrumentIdentity[];
      try {
        instruments = dependencies.instruments();
      } catch (error) {
        report('paper_market_instruments', error);
        latestPreparation = { ok: false, code: 'market_fetch_failed' };
        return latestPreparation;
      }
      if (instruments.length === 0) return latestPreparation;

      try {
        const [rulesHash, dataset] = await Promise.all([
          refreshRules(nowMs, instruments),
          syncCoinbaseDecisionDataset({
            database: dependencies.database,
            instruments,
            maxDays: LOOKBACK_DAYS,
            minAlignedDays: trendVolMinimumHistory(),
            nowMs,
            fetchDailyBars: async (instrument) => {
              const result = await dependencies.bars(instrument, LOOKBACK_DAYS, nowMs);
              return result.ok
                ? { ok: true, status: 200, data: [...result.bars] }
                : { ok: false, status: 0, reason: 'network', retried: 0 };
            },
          }),
        ]);
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
    },
  };
}
