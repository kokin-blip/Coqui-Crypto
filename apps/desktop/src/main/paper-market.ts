import { fetchCoinbaseProductRules, type HttpClient } from '@coqui/adapters';
import { instrumentKey, type InstrumentIdentity, type MarketBar } from '@coqui/core';
import type { PaperMarketData } from '@coqui/services';
import {
  latestProductRuleSnapshot,
  listMarketBars,
  saveProductRuleSnapshot,
  upsertMarketBars,
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
  /** Fetch and persist bars and venue rules. Never throws. */
  refresh(nowMs: number): Promise<void>;
}

export function createPaperMarketFeed(
  dependencies: PaperMarketFeedDependencies,
): PaperMarketFeed {
  const report = dependencies.onUnexpectedError ?? (() => {});

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
      return listMarketBars(instrument, dependencies.database).map((record) => ({
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

  async function refreshRules(nowMs: number, wanted: ReadonlySet<string>): Promise<void> {
    const result = await fetchCoinbaseProductRules(dependencies.http, { nowMs });
    if (!result.ok) return;
    for (const rule of result.rules) {
      // Only the products the engine may trade. The venue lists hundreds; the
      // rest are rows nothing would ever read.
      if (!wanted.has(rule.instrument.productId)) continue;
      // Insert-only and keyed by content hash, so an unchanged rule set is a
      // no-op rather than a duplicate.
      saveProductRuleSnapshot(rule, dependencies.database);
    }
  }

  async function refreshBars(nowMs: number, instruments: readonly InstrumentIdentity[]): Promise<void> {
    for (const instrument of instruments) {
      const result = await dependencies.bars(instrument, LOOKBACK_DAYS, nowMs);
      if (!result.ok) continue;
      // Incomplete bars are dropped rather than stored. Invariant 6: a signal
      // may only observe completed bars, and the cheapest way to guarantee that
      // is never to persist a partial one.
      const rows = result.bars
        .filter((bar) => bar.isComplete)
        .map((bar) => ({
          source: bar.source,
          instrument,
          providerAssetId: instrument.productId,
          interval: bar.interval,
          startTimeMs: bar.startTimeMs,
          endTimeMs: bar.endTimeMs,
          open: String(bar.open),
          high: String(bar.high),
          low: String(bar.low),
          close: String(bar.close),
          volume: bar.volume === null ? null : String(bar.volume),
          isComplete: true,
          quality: bar.quality ?? ('reported_ohlc' as const),
          retrievedAtMs: bar.retrievedAtMs,
        }));
      if (rows.length > 0) upsertMarketBars(rows, dependencies.database);
    }
  }

  return {
    view,
    async refresh(nowMs) {
      let instruments: readonly InstrumentIdentity[];
      try {
        instruments = dependencies.instruments();
      } catch (error) {
        report('paper_market_instruments', error);
        return;
      }
      if (instruments.length === 0) return;

      const wanted = new Set(instruments.map((instrument) => instrument.productId));
      // A failing refresh leaves the engine on the bars it already has; it must
      // never take down the tick that follows it.
      try {
        await refreshRules(nowMs, wanted);
      } catch (error) {
        report('paper_market_rules', error);
      }
      try {
        await refreshBars(nowMs, instruments);
      } catch (error) {
        report('paper_market_bars', error);
      }
    },
  };
}
