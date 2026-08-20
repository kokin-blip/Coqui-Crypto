import {
  computeAllocation,
  computeRebalancePlan,
  decimal,
  holdingsFromLots,
  instrumentKey,
  nonNegativeDecimal,
  summarizePortfolioValuation,
  type Allocation,
  type AllocationPolicy,
  type Clock,
  type Holding,
  type InstrumentIdentity,
  type InstrumentKey,
  type PortfolioValuationSummary,
  type PriceSource,
  type RebalancePlan,
  type SpotPriceObservation,
  type SpotPriceQuality,
  type UsdAmount,
} from '@coqui/core';
import {
  getAllocationPolicy,
  listTaxLots,
  type Db,
} from '@coqui/storage';
import { freezeValue } from './immutable.js';

const ZERO_DECIMAL = /^0(?:\.0+)?$/u;

export type PricingStatus =
  | 'not_required'
  | 'complete'
  | 'partial'
  | 'unavailable'
  | 'failed';

export interface PricingProvenance {
  readonly requestedSource: string;
  readonly requestedAtMs: number;
  readonly receivedAtMs: number;
  readonly requestedCount: number;
  readonly pricedCount: number;
  readonly unpricedCount: number;
  readonly sources: readonly PricingSourceSummary[];
  readonly status: PricingStatus;
}

export interface PricingSourceSummary {
  readonly source: string;
  readonly quality: SpotPriceQuality;
  readonly pricedCount: number;
}

export interface HoldingPriceProvenance {
  readonly source: string;
  readonly quality: SpotPriceQuality;
  readonly observedAtMs: number | null;
}

export interface PricedHolding extends Holding {
  readonly priceProvenance: HoldingPriceProvenance | null;
}

export interface PricedPortfolioView {
  /** Application receipt time, not a provider-supplied observation timestamp. */
  readonly asOfMs: number;
  readonly holdings: readonly PricedHolding[];
  readonly valuation: PortfolioValuationSummary;
  readonly pricing: PricingProvenance;
}

export type RebalancePlanStatus =
  | 'available'
  | 'no_policy'
  | 'blocked_incomplete_pricing'
  | 'blocked_non_venue_pricing'
  | 'blocked_target_coverage';

export interface PortfolioAllocationView {
  readonly portfolio: PricedPortfolioView;
  readonly policy: AllocationPolicy;
  readonly allocation: Allocation;
  readonly plan: RebalancePlan;
  readonly planStatus: RebalancePlanStatus;
}

export interface PortfolioReadModelDependencies {
  readonly database: Db;
  readonly clock: Clock;
  readonly priceSource: PriceSource;
}

function validatedObservation(value: unknown): SpotPriceObservation | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as Partial<SpotPriceObservation>;
  if (typeof candidate.priceUsd !== 'string') return null;
  const source = typeof candidate.source === 'string' ? candidate.source.trim() : '';
  if (source.length === 0) return null;
  if (
    candidate.quality !== 'venue_reported_last' &&
    candidate.quality !== 'reference_market'
  ) return null;
  const observedAtMs = candidate.observedAtMs;
  if (
    observedAtMs !== null &&
    (!Number.isSafeInteger(observedAtMs) || observedAtMs === undefined || observedAtMs < 0)
  ) return null;
  try {
    const priceUsd = nonNegativeDecimal(candidate.priceUsd);
    if (ZERO_DECIMAL.test(priceUsd)) return null;
    return Object.freeze({
      priceUsd,
      source,
      quality: candidate.quality,
      observedAtMs,
    });
  } catch {
    return null;
  }
}

function priceSourceSummaries(
  observations: ReadonlyMap<InstrumentKey, SpotPriceObservation>,
): PricingSourceSummary[] {
  const counts = new Map<string, PricingSourceSummary>();
  for (const observation of observations.values()) {
    const key = `${observation.source}\u0000${observation.quality}`;
    const current = counts.get(key);
    counts.set(key, {
      source: observation.source,
      quality: observation.quality,
      pricedCount: (current?.pricedCount ?? 0) + 1,
    });
  }
  return [...counts.values()].sort((left, right) =>
    left.source.localeCompare(right.source) || left.quality.localeCompare(right.quality),
  );
}

function emptyPlan(asOf: number): RebalancePlan {
  return {
    trades: [],
    turnoverUsd: decimal('0'),
    maxDriftPct: 0,
    asOf,
    estimateOnly: true,
  };
}

/** Read-only portfolio valuation with bounded, injected price access. */
export class PortfolioReadModelService {
  readonly #database: Db;
  readonly #clock: Clock;
  readonly #priceSource: PriceSource;
  readonly #sourceName: string;

  constructor(dependencies: PortfolioReadModelDependencies) {
    const sourceName = dependencies.priceSource.name.trim();
    if (sourceName.length === 0) throw new TypeError('Price source must have a name.');
    this.#database = dependencies.database;
    this.#clock = dependencies.clock;
    this.#priceSource = dependencies.priceSource;
    this.#sourceName = sourceName;
  }

  async #loadPortfolio(): Promise<PricedPortfolioView> {
    const lots = listTaxLots(this.#database, true);
    const instrumentByKey = new Map<InstrumentKey, InstrumentIdentity>();
    for (const lot of lots) {
      const key = instrumentKey(lot.asset.instrument);
      if (!instrumentByKey.has(key)) instrumentByKey.set(key, lot.asset.instrument);
    }
    const instruments = [...instrumentByKey.values()].map((instrument) => ({ ...instrument }));
    const requestedAtMs = this.#clock.nowMs();
    let receivedAtMs = requestedAtMs;
    let failed = false;
    const prices: Partial<Record<InstrumentKey, UsdAmount>> = Object.create(null) as Partial<
      Record<InstrumentKey, UsdAmount>
    >;
    const observations = new Map<InstrumentKey, SpotPriceObservation>();

    if (instruments.length > 0) {
      try {
        const returned = await this.#priceSource.spot(instruments);
        receivedAtMs = this.#clock.nowMs();
        for (const key of instrumentByKey.keys()) {
          const observation = validatedObservation(returned.get(key));
          if (observation !== null) {
            observations.set(key, observation);
            prices[key] = observation.priceUsd;
          }
        }
      } catch {
        receivedAtMs = this.#clock.nowMs();
        failed = true;
      }
    }

    const holdings: PricedHolding[] = holdingsFromLots(lots, prices).map((holding) => {
      const observation = observations.get(instrumentKey(holding.asset.instrument));
      return {
        ...holding,
        priceProvenance: observation === undefined
          ? null
          : {
              source: observation.source,
              quality: observation.quality,
              observedAtMs: observation.observedAtMs,
            },
      };
    });
    const valuation = summarizePortfolioValuation(holdings);
    const requestedCount = instruments.length;
    const pricedCount = valuation.pricedCount;
    const status: PricingStatus = requestedCount === 0
      ? 'not_required'
      : failed
        ? 'failed'
        : pricedCount === requestedCount
          ? 'complete'
          : pricedCount === 0
            ? 'unavailable'
            : 'partial';

    return freezeValue({
      asOfMs: receivedAtMs,
      holdings,
      valuation,
      pricing: {
        requestedSource: this.#sourceName,
        requestedAtMs,
        receivedAtMs,
        requestedCount,
        pricedCount,
        unpricedCount: requestedCount - pricedCount,
        sources: priceSourceSummaries(observations),
        status,
      },
    });
  }

  async portfolioView(): Promise<PricedPortfolioView> {
    return this.#loadPortfolio();
  }

  async allocationView(): Promise<PortfolioAllocationView> {
    const portfolio = await this.#loadPortfolio();
    const policy = getAllocationPolicy(this.#database);
    const allocation = computeAllocation(portfolio.holdings, portfolio.asOfMs, policy);
    const holdingKeys = new Set(
      portfolio.holdings.map((holding) => instrumentKey(holding.asset.instrument)),
    );
    const missingTarget = policy.targets.some(
      (target) => !holdingKeys.has(instrumentKey(target.instrument)),
    );
    const hasNonVenuePricing = portfolio.holdings.some((holding) =>
      holding.priceProvenance !== null &&
      (
        holding.priceProvenance.source !== 'coinbase' ||
        holding.priceProvenance.quality !== 'venue_reported_last'
      ),
    );

    let planStatus: RebalancePlanStatus;
    let plan: RebalancePlan;
    if (policy.targets.length === 0) {
      planStatus = 'no_policy';
      plan = emptyPlan(portfolio.asOfMs);
    } else if (portfolio.pricing.status !== 'complete') {
      planStatus = 'blocked_incomplete_pricing';
      plan = emptyPlan(portfolio.asOfMs);
    } else if (hasNonVenuePricing) {
      planStatus = 'blocked_non_venue_pricing';
      plan = emptyPlan(portfolio.asOfMs);
    } else if (missingTarget) {
      planStatus = 'blocked_target_coverage';
      plan = emptyPlan(portfolio.asOfMs);
    } else {
      planStatus = 'available';
      plan = computeRebalancePlan(portfolio.holdings, policy, portfolio.asOfMs);
    }

    return freezeValue({ portfolio, policy, allocation, plan, planStatus });
  }
}
