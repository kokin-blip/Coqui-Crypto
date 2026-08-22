import { describe, expect, it } from 'vitest';

import type {
  AssetYield,
  NewsItem,
  PolicyItem,
  ProviderMarketSnapshot,
  TrendingCoin,
} from '../packages/adapters/src/index.js';
import { CHANNEL_SCHEMAS } from '../packages/contracts/src/index.js';
import {
  FixedClock,
  gridCandidateCount,
  instrumentKey,
  tradeCostConfigHash,
  DEFAULT_TRADE_COST_CONFIG,
  type InstrumentIdentity,
  type InstrumentKey,
  type MarketBar,
  type ResearchPreRegistration,
} from '../packages/core/src/index.js';
import {
  PortfolioReadModelService,
  PortfolioTaxService,
  MarketDisplayQueryService,
  registerResearchPreRegistration,
  ResearchReadModelService,
  type CandleSource,
  type ReferenceSources,
} from '../packages/services/src/index.js';
import {
  openDatabase,
  researchStudyRunHash,
  saveResearchJob,
  saveResearchStudyRun,
  type Db,
} from '../packages/storage/src/index.js';

/**
 * The channel schemas were written by hand to mirror the service view types.
 * Nothing but a test keeps the two from drifting, and drift here means a screen
 * that renders in development and fails validation in a packaged build. These
 * tests run the real services and validate their real output against the wire
 * contract.
 */

const NOW = 1_724_000_000_000;
const BTC: InstrumentIdentity = { venue: 'coinbase', productId: 'BTC-USD', productType: 'spot' };
const BTC_KEY = instrumentKey(BTC);
const DAY_MS = 86_400_000;
const START_MS = Date.UTC(2020, 0, 1);
const HASH_B = 'b'.repeat(64);

function marketService(overrides: Partial<ReferenceSources>, candles?: CandleSource) {
  const empty = new Map<InstrumentKey, ProviderMarketSnapshot>();
  const sources: ReferenceSources = {
    prices: async () => ({ ok: true, value: empty, observedAtMs: null }),
    markets: async () => ({ ok: true, value: empty, observedAtMs: null }),
    fearGreed: async () => ({ ok: false, code: 'network' }),
    trending: async () => ({ ok: true, value: [], observedAtMs: null }),
    yields: async () => ({ ok: true, value: new Map(), observedAtMs: null }),
    headlines: async () => ({ ok: true, value: [], observedAtMs: null }),
    policy: async () => ({ ok: true, value: [], observedAtMs: null }),
    ...overrides,
  };
  return new MarketDisplayQueryService({
    clock: new FixedClock(NOW),
    sources,
    candles: candles ?? { dailyBars: async () => ({ ok: false }) },
  });
}

function snapshot(): ProviderMarketSnapshot {
  return {
    provider: 'coingecko',
    providerId: 'bitcoin',
    instrument: BTC,
    priceUsd: '64000.12' as ProviderMarketSnapshot['priceUsd'],
    marketCapUsd: '1265000000000' as ProviderMarketSnapshot['marketCapUsd'],
    volume24hUsd: '31000000000' as ProviderMarketSnapshot['volume24hUsd'],
    marketCapRank: 1,
    change24hPct: 1.5,
    providerUpdatedAtMs: NOW - 60_000,
  };
}

describe('market-data views satisfy their channel schemas', () => {
  it('accepts a fully populated prices and markets view', async () => {
    const populated = new Map<InstrumentKey, ProviderMarketSnapshot>([[BTC_KEY, snapshot()]]);
    const service = marketService({
      prices: async () => ({ ok: true, value: populated, observedAtMs: NOW - 30_000 }),
      markets: async () => ({ ok: true, value: populated, observedAtMs: NOW - 30_000 }),
    });

    const prices = await service.prices();
    expect(prices.ok).toBe(true);
    if (!prices.ok) return;
    expect(CHANNEL_SCHEMAS['market-data.prices'].response.safeParse(prices.value)).toMatchObject({
      success: true,
    });

    const markets = await service.markets();
    expect(markets.ok).toBe(true);
    if (!markets.ok) return;
    expect(CHANNEL_SCHEMAS['market-data.markets'].response.safeParse(markets.value)).toMatchObject({
      success: true,
    });
  });

  it('accepts the fear & greed, trending and yields views', async () => {
    const service = marketService({
      fearGreed: async () => ({
        ok: true,
        value: { value: 31, classification: 'Fear' },
        observedAtMs: NOW - 3_600_000,
      }),
      trending: async () => ({
        ok: true,
        value: [
          {
            coingeckoId: 'solana',
            symbol: 'SOL',
            name: 'Solana',
            marketCapRank: 5,
            thumbnailUrl: 'https://assets.coingecko.com/coins/images/4128/thumb/solana.png',
          },
        ] satisfies TrendingCoin[],
        observedAtMs: null,
      }),
      yields: async () => ({
        ok: true,
        value: new Map<string, AssetYield>([
          ['SOL', { symbol: 'SOL', apyPct: 9.4, project: 'marinade', chain: 'Solana', tvlUsd: 12_000_000 }],
        ]),
        observedAtMs: null,
      }),
    });

    const fearGreed = await service.fearGreed();
    expect(fearGreed.ok).toBe(true);
    if (!fearGreed.ok) return;
    expect(
      CHANNEL_SCHEMAS['market-data.fear-greed'].response.safeParse(fearGreed.value),
    ).toMatchObject({ success: true });

    const trending = await service.trending();
    expect(trending.ok).toBe(true);
    if (!trending.ok) return;
    expect(
      CHANNEL_SCHEMAS['market-data.trending'].response.safeParse(trending.value),
    ).toMatchObject({ success: true });

    const yields = await service.yields();
    expect(yields.ok).toBe(true);
    if (!yields.ok) return;
    expect(CHANNEL_SCHEMAS['market-data.yields'].response.safeParse(yields.value)).toMatchObject({
      success: true,
    });
  });

  it('accepts a news view carrying both headlines and policy items', async () => {
    const headline: NewsItem = {
      title: 'A headline',
      url: 'https://www.coindesk.com/story',
      source: 'CoinDesk',
      publishedAtMs: NOW - 7_200_000,
    };
    const policy: PolicyItem = {
      title: '[Rule] Digital asset reporting rule',
      url: 'https://www.federalregister.gov/documents/1',
      source: 'Federal Register',
      publishedAtMs: NOW - 86_400_000,
      matched: ['digital asset'],
    };
    const service = marketService({
      headlines: async () => ({ ok: true, value: [headline], observedAtMs: headline.publishedAtMs }),
      policy: async () => ({ ok: true, value: [policy], observedAtMs: policy.publishedAtMs }),
    });

    const news = await service.news(12);
    expect(news.ok).toBe(true);
    if (!news.ok) return;
    expect(CHANNEL_SCHEMAS['market-data.news'].response.safeParse(news.value)).toMatchObject({
      success: true,
    });
  });

  it('accepts a candle view and still refuses an in-progress bar on the wire', async () => {
    const complete: MarketBar = {
      assetId: BTC_KEY,
      source: 'coinbase',
      interval: '1d',
      startTimeMs: NOW - DAY_MS,
      endTimeMs: NOW,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 12,
      isComplete: true,
      retrievedAtMs: NOW,
    };
    const service = marketService({}, { dailyBars: async () => ({ ok: true, bars: [complete] }) });

    const candles = await service.candles(BTC, 30);
    expect(candles.ok).toBe(true);
    if (!candles.ok) return;
    expect(CHANNEL_SCHEMAS['market-data.candles'].response.safeParse(candles.value)).toMatchObject({
      success: true,
    });

    // The service already filters incomplete bars; the schema is the second lock.
    const smuggled = { ...candles.value, bars: [{ ...complete, isComplete: false }] };
    expect(
      CHANNEL_SCHEMAS['market-data.candles'].response.safeParse(smuggled).success,
    ).toBe(false);
  });
});

const PARAMETER_SPACE = {
  lookbackDays: [90, 180],
  volatilityDays: [30],
  maxRelativeTilt: [0.35],
  defensiveScale: [0.2],
  targetVolatilityPct: [55],
  targetVolPct: [50],
  volLookbackDays: [30],
  minExposure: [0.1],
  maxExposure: [1],
  trendGateDays: [100],
  belowTrendMaxExposure: [0.7],
  rebalanceEveryDays: [30],
} as const;

function registerPlan(db: Db): string {
  const plan: ResearchPreRegistration = {
    schemaVersion: 1,
    id: 'conformance-plan',
    registeredAt: '2026-08-09T00:00:00.000Z',
    family: 'trendvol',
    hypothesis: 'Trend-vol produces positive excess returns on untouched data.',
    parameterSpace: PARAMETER_SPACE,
    candidateCount: gridCandidateCount(PARAMETER_SPACE),
    datasetHash: HASH_B,
    costProfileHash: tradeCostConfigHash(DEFAULT_TRADE_COST_CONFIG),
    codeRevision: 'conformance-revision',
    execution: {
      baseTargets: [{ assetId: BTC_KEY, weight: 1 }],
      warmupBars: 10,
      cashAprPct: 0,
    },
    validation: {
      development: { startMs: START_MS, endExclusiveMs: START_MS + 90 * DAY_MS },
      holdout: { startMs: START_MS + 90 * DAY_MS, endExclusiveMs: START_MS + 122 * DAY_MS },
      nestedFoldCount: 3,
      embargoDays: 2,
      minimumDevelopmentBars: 90,
      minimumHoldoutBars: 30,
      cscvPartitionCount: 4,
      bootstrapResamples: 500,
      bootstrapMeanBlockLength: 5,
      bootstrapConfidenceLevel: 0.95,
      bootstrapSeed: 7,
    },
    primaryMetric: 'after-cost-excess-return-vs-hold',
    adoptionRules: {
      minimumDeflatedSharpeProbability: 0.95,
      requirePositiveExcessReturnVsHold: true,
      requirePositiveExcessReturnVsPassive: true,
      rejectIfSignificanceUnavailable: true,
      maximumDrawdownPct: 35,
      maximumProbabilityOfBacktestOverfitting: 0.05,
    },
    studyRef: 'docs/studies/trendvol-replacement-v1-2026-08-09.md',
  };
  return registerResearchPreRegistration(plan, db);
}

describe('portfolio views satisfy their channel schemas', () => {
  const emptyPrices = { name: 'test', async spot() { return new Map(); } };

  it('accepts a portfolio view with nothing priced', async () => {
    const db = openDatabase(':memory:');
    const service = new PortfolioReadModelService({
      database: db,
      clock: new FixedClock(NOW),
      priceSource: emptyPrices,
    });
    const view = await service.portfolioView();
    expect(CHANNEL_SCHEMAS['portfolio.view'].response.safeParse(view)).toMatchObject({
      success: true,
    });
    db.close();
  });

  it('accepts an allocation view once the embedded portfolio is stripped', async () => {
    const db = openDatabase(':memory:');
    const service = new PortfolioReadModelService({
      database: db,
      clock: new FixedClock(NOW),
      priceSource: emptyPrices,
    });
    // The composition root drops `portfolio` because portfolio.view already
    // carries it; this pins that the rest conforms.
    const view = await service.allocationView();
    const allocation = {
      policy: view.policy,
      allocation: view.allocation,
      plan: view.plan,
      planStatus: view.planStatus,
    };
    expect(CHANNEL_SCHEMAS['portfolio.allocation'].response.safeParse(allocation)).toMatchObject({
      success: true,
    });
    db.close();
  });

  it('accepts a tax view with no disposals', () => {
    const db = openDatabase(':memory:');
    const view = new PortfolioTaxService({ database: db, clock: new FixedClock(NOW) }).view();
    expect(CHANNEL_SCHEMAS['portfolio.tax'].response.safeParse(view)).toMatchObject({
      success: true,
    });
    db.close();
  });
});

describe('research views satisfy their channel schemas', () => {
  it('accepts real run, job-list and job-detail output', () => {
    const db = openDatabase(':memory:');
    const run = {
      id: 'trendvol-replacement-v1',
      preRegistrationHash: registerPlan(db),
      completedAtMs: 1_723_000_000_000,
      datasetHash: HASH_B,
      costProfileHash: 'c'.repeat(64),
      codeRevision: '037927e6b876a86b53f6a9977d35fd0df1a37873',
      selectedCandidateId: 'e'.repeat(64),
      adopted: false,
      resultJson: '{"pbo":0.286}',
    };
    saveResearchStudyRun({ ...run, runHash: researchStudyRunHash(run) }, db);
    saveResearchJob(
      {
        id: 'job-1',
        kind: 'matrix',
        status: 'completed',
        createdAt: 1_723_000_000_000,
        startedAt: 1_723_000_001_000,
        completedAt: 1_723_000_002_000,
        requestJson: '{"kind":"matrix"}',
        snapshotJson: '{"rows":[]}',
        progressJson: '{"done":1}',
        resultJson: '{"score":1}',
        error: null,
      },
      db,
    );

    const service = new ResearchReadModelService({ database: db });

    const runs = service.runs();
    expect(runs.ok).toBe(true);
    if (!runs.ok) return;
    expect(CHANNEL_SCHEMAS['research.runs'].response.safeParse(runs.value)).toMatchObject({
      success: true,
    });

    const jobs = service.jobs(10);
    expect(jobs.ok).toBe(true);
    if (!jobs.ok) return;
    expect(CHANNEL_SCHEMAS['research.jobs'].response.safeParse(jobs.value)).toMatchObject({
      success: true,
    });

    const detail = service.job('job-1');
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(CHANNEL_SCHEMAS['research.job'].response.safeParse(detail.value)).toMatchObject({
      success: true,
    });

    db.close();
  });
});
