import {
  createPortfolioEvidenceSnapshot,
  instrumentKey,
  portfolioUtcDayKey,
  summarizeDisposals,
  summarizePortfolioEvidence,
  type Clock,
  type PortfolioEvidenceSnapshot,
  type VerifiedPortfolioPerformance,
} from '@coqui/core';
import {
  listDisposals,
  listPortfolioEvidenceSnapshots,
  savePortfolioEvidenceSnapshot,
  type Db,
  type PortfolioEvidenceQuery,
} from '@coqui/storage';

import { freezeValue } from './immutable.js';
import { PortfolioReadModelService } from './read-models.js';

export interface PortfolioSnapshotEvidenceDependencies {
  readonly database: Db;
  readonly clock: Clock;
  readonly portfolioReads: PortfolioReadModelService;
}

export interface CapturePortfolioEvidenceResult {
  readonly created: boolean;
  readonly snapshot: PortfolioEvidenceSnapshot;
}

/**
 * Append-only daily portfolio evidence. Scheduling stays outside this service;
 * callers supply the intended time and no carried price is ever synthesized.
 */
export class PortfolioSnapshotEvidenceService {
  readonly #database: Db;
  readonly #clock: Clock;
  readonly #portfolioReads: PortfolioReadModelService;

  constructor(dependencies: PortfolioSnapshotEvidenceDependencies) {
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
    this.#portfolioReads = dependencies.portfolioReads;
  }

  async capture(scheduledForMs: number): Promise<CapturePortfolioEvidenceResult> {
    portfolioUtcDayKey(scheduledForMs);
    const portfolio = await this.#portfolioReads.portfolioView();
    const recordedAtMs = this.#clock.nowMs();
    const unpricedInstrumentKeys = portfolio.holdings
      .filter((holding) => holding.valueUsd === null)
      .map((holding) => instrumentKey(holding.asset.instrument));
    const valuationStatus = portfolio.pricing.status === 'complete' ||
      portfolio.pricing.status === 'not_required'
      ? 'complete'
      : portfolio.pricing.status === 'partial'
        ? 'partial'
        : 'unavailable';
    const realizedPnlUsd = summarizeDisposals(
      listDisposals(this.#database),
      recordedAtMs,
    ).allTimeRealizedUsd;
    const snapshot = createPortfolioEvidenceSnapshot({
      scheduledForMs,
      observedAtMs: portfolio.asOfMs,
      recordedAtMs,
      valuationStatus,
      equityUsd: valuationStatus === 'complete' ? portfolio.valuation.totalValueUsd : null,
      pricedSubtotalUsd: portfolio.valuation.totalValueUsd,
      openCostUsd: portfolio.valuation.totalCostUsd,
      realizedPnlUsd,
      unpricedInstrumentKeys,
    });
    const result = savePortfolioEvidenceSnapshot(snapshot, this.#database);
    return freezeValue({ created: result.created, snapshot });
  }

  history(query: PortfolioEvidenceQuery = {}): readonly PortfolioEvidenceSnapshot[] {
    return freezeValue(listPortfolioEvidenceSnapshots(this.#database, query));
  }

  performance(query: PortfolioEvidenceQuery = {}): VerifiedPortfolioPerformance {
    return freezeValue(summarizePortfolioEvidence(
      listPortfolioEvidenceSnapshots(this.#database, query),
    ));
  }
}
