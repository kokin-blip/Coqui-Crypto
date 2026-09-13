import { Decimal } from 'decimal.js';

import {
  exploratoryValuationHash,
  sha256Hex,
  type ExploratoryPaperValuationV1,
} from '@coqui/core';
import {
  currentExploratoryPaperCampaign,
  exploratoryPaperExecutionFacts,
  getLatestUnifiedPortfolioSnapshotV2,
  listExploratoryPaperBalances,
  listExploratoryPaperValuations,
  saveExploratoryPaperValuation,
  type Db,
} from '@coqui/storage';

import type { PaperMarketData } from './oms.js';

export interface ExploratoryPaperPortfolioView {
  readonly campaign: NonNullable<ReturnType<typeof currentExploratoryPaperCampaign>>['campaign'];
  readonly status: NonNullable<ReturnType<typeof currentExploratoryPaperCampaign>>['status'];
  readonly asOfMs: number;
  readonly simulation: true;
  readonly primary: boolean;
  readonly simulationVenue: 'Coinbase reference';
  readonly balances: readonly Readonly<{
    exposureKey: string; assetId: string | null; quantity: string;
    valueUsd: string | null; managed: boolean;
  }>[];
  readonly openingEquityUsd: string;
  readonly currentEquityUsd: string | null;
  readonly connectedReferenceEquityUsd: string | null;
  readonly buyAndHoldBenchmarkUsd: string | null;
  readonly estimatedCostsUsd: string;
  readonly valuationStatus: 'complete' | 'incomplete' | 'stale';
  readonly paperReturnPct: number | null;
  readonly benchmarkDifferencePct: number | null;
  readonly drawdownPct: number | null;
  readonly counts: Readonly<{ submitted: number; filled: number; pending: number; expired: number;
    refused: number; noTrade: number }>;
}

function priceFor(
  exposureKey: string,
  assetId: string | null,
  market: PaperMarketData,
  connected: ReturnType<typeof getLatestUnifiedPortfolioSnapshotV2>,
): Decimal | null {
  if (exposureKey === 'USD') return new Decimal(1);
  if (assetId !== null) {
    const close = market.bars(assetId).at(-1)?.close;
    if (Number.isFinite(close) && close! > 0) return new Decimal(close!);
  }
  const exposure = connected?.exposures.find((item) => item.exposureKey === exposureKey);
  if (exposure?.valueUsd === null || exposure === undefined || new Decimal(exposure.quantity).isZero()) return null;
  return new Decimal(exposure.valueUsd).div(exposure.quantity);
}

export function exploratoryPaperPortfolioView(input: {
  readonly profileId: string;
  readonly database: Db;
  readonly market: PaperMarketData;
  readonly nowMs: number;
  readonly persistValuation?: boolean;
}): ExploratoryPaperPortfolioView | null {
  const current = currentExploratoryPaperCampaign(input.profileId, input.database);
  if (current === null) return null;
  const connected = getLatestUnifiedPortfolioSnapshotV2(input.profileId, false, input.database);
  const balances = listExploratoryPaperBalances(current.campaign.campaignId, input.profileId, input.database);
  let equity = new Decimal(0), benchmark = new Decimal(0), unpricedCount = 0;
  const rows = balances.map((balance) => {
    const price = priceFor(balance.exposureKey, balance.assetId, input.market, connected);
    if (price === null) unpricedCount += 1;
    const value = price?.mul(balance.quantity) ?? null;
    if (value !== null) equity = equity.add(value);
    const opening = balance.exposureKey === 'USD'
      ? current.campaign.openingCashUsd
      : current.campaign.openingBalances.find((item) => item.exposureKey === balance.exposureKey)?.quantity ?? '0';
    if (price !== null) benchmark = benchmark.add(price.mul(opening));
    return Object.freeze({ exposureKey: balance.exposureKey, assetId: balance.assetId,
      quantity: balance.quantity, valueUsd: value?.toFixed() ?? null, managed: balance.managed });
  });
  const facts = exploratoryPaperExecutionFacts(current.campaign.campaignId, input.profileId, input.database);
  const complete = unpricedCount === 0;
  const currentEquity = complete ? equity : null;
  const openingEquity = new Decimal(current.campaign.openingEquityUsd);
  const benchmarkEquity = complete ? benchmark : null;
  const prior = listExploratoryPaperValuations(current.campaign.campaignId, input.profileId, input.database)
    .flatMap((point) => point.equityUsd === null ? [] : [new Decimal(point.equityUsd)]);
  const peak = currentEquity === null ? null : prior.reduce(
    (highest, value) => Decimal.max(highest, value), currentEquity,
  );
  const view: ExploratoryPaperPortfolioView = Object.freeze({
    campaign: current.campaign, status: current.status, asOfMs: input.nowMs,
    simulation: true, primary: current.status !== 'stopped', simulationVenue: 'Coinbase reference',
    balances: Object.freeze(rows), openingEquityUsd: current.campaign.openingEquityUsd,
    currentEquityUsd: currentEquity?.toFixed() ?? null,
    connectedReferenceEquityUsd: connected?.complete === true ? connected.totalValueUsd : null,
    buyAndHoldBenchmarkUsd: benchmarkEquity?.toFixed() ?? null,
    estimatedCostsUsd: facts.estimatedCostsUsd,
    valuationStatus: complete ? 'complete' : 'incomplete',
    paperReturnPct: currentEquity === null || openingEquity.isZero() ? null
      : currentEquity.div(openingEquity).minus(1).mul(100).toNumber(),
    benchmarkDifferencePct: currentEquity === null || benchmarkEquity === null || benchmarkEquity.isZero()
      ? null : currentEquity.div(benchmarkEquity).minus(1).mul(100).toNumber(),
    drawdownPct: currentEquity === null || peak === null || peak.isZero() ? null
      : Decimal.max(0, peak.minus(currentEquity).div(peak).mul(100)).toNumber(),
    counts: Object.freeze({ submitted: facts.submitted, filled: facts.filled,
      pending: facts.pending, expired: facts.expired, refused: facts.refused, noTrade: facts.noTrade }),
  });
  if (input.persistValuation === true) {
    const material = { schemaVersion: 1 as const, campaignId: current.campaign.campaignId,
      profileId: input.profileId, asOfMs: input.nowMs, equityUsd: view.currentEquityUsd,
      buyAndHoldBenchmarkUsd: view.buyAndHoldBenchmarkUsd, estimatedCostsUsd: view.estimatedCostsUsd,
      unpricedCount };
    const contentHash = exploratoryValuationHash(material);
    const valuation: ExploratoryPaperValuationV1 = Object.freeze({ ...material,
      id: sha256Hex(`exploratory-valuation:${contentHash}`), contentHash });
    saveExploratoryPaperValuation(valuation, input.database);
  }
  return view;
}

export function exploratoryPaperPerformance(
  profileId: string,
  database: Db,
): Readonly<{ points: readonly ExploratoryPaperValuationV1[] }> {
  const current = currentExploratoryPaperCampaign(profileId, database);
  return Object.freeze({ points: current === null ? []
    : listExploratoryPaperValuations(current.campaign.campaignId, profileId, database) });
}
