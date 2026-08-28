import {
  calculateStartingPortfolioHoldBenchmark,
  sha256Hex,
  type Clock,
  type PriceSource,
} from '@coqui/core';
import { paperPortfolioView } from '@coqui/services';
import {
  getPaperDailyValuationEvidence,
  listPaperDailyValuationEvidence,
  savePaperDailyValuationEvidence,
  type Db,
  type PaperDailyValuationEvidence,
} from '@coqui/storage';

interface EvidencePosition {
  readonly productId: string;
  readonly quantity: string;
  readonly valueUsd: string | null;
}

function evidencePositions(value: string): EvidencePosition[] | null {
  try {
    const parsed = JSON.parse(value) as Array<{
      instrument: { productId: string }; quantity: string; valueUsd: string | null;
    }>;
    return parsed.map((position) => ({
      productId: position.instrument.productId,
      quantity: position.quantity,
      valueUsd: position.valueUsd,
    }));
  } catch {
    return null;
  }
}

/** Append one post-decision valuation; absence is never reconstructed later. */
export async function capturePaperPerformanceEvidence(input: {
  readonly profileId: string;
  readonly runId: string;
  readonly scheduledForMs: number;
  readonly database: Db;
  readonly clock: Clock;
  readonly priceSource: PriceSource;
}): Promise<PaperDailyValuationEvidence> {
  const dayUtc = Math.floor(input.scheduledForMs / 86_400_000) * 86_400_000;
  const existing = getPaperDailyValuationEvidence(input.profileId, dayUtc, input.database);
  if (existing !== null) return existing;
  const view = await paperPortfolioView(
    { database: input.database, clock: input.clock, priceSource: input.priceSource },
    input.profileId,
  );
  const first = listPaperDailyValuationEvidence(input.profileId, input.database)[0] ?? null;
  const positionsJson = JSON.stringify(view.positions);
  const startingPositions = evidencePositions(first?.positionsJson ?? positionsJson);
  const benchmarkUsd = startingPositions === null || view.totalValueUsd === null
    ? null
    : calculateStartingPortfolioHoldBenchmark({
        startingCashUsd: first?.cashUsd ?? view.cashUsd,
        startingPositions,
        currentPositions: view.positions.map((position) => ({
          productId: position.instrument.productId,
          quantity: position.quantity,
          valueUsd: position.valueUsd,
        })),
      });
  const provenanceJson = JSON.stringify({
    paperOnly: true,
    capturedAfterRunId: input.runId,
    priceSource: input.priceSource.name,
    benchmark: benchmarkUsd === null
      ? 'unavailable_incomplete_starting_or_current_valuation'
      : 'starting_quantities_at_current_observed_prices',
    startingEvidenceHash: first?.evidenceHash ?? 'captured_in_this_row',
  });
  const evidenceHash = sha256Hex(JSON.stringify({
    profileId: input.profileId, dayUtc, capturedAt: view.asOfMs,
    cashUsd: view.cashUsd, equityUsd: view.totalValueUsd, benchmarkUsd,
    unpricedCount: view.unpricedCount, positionsJson, provenanceJson,
  }));
  const evidence = {
    id: sha256Hex(`paper-daily:${input.profileId}:${dayUtc}`),
    profileId: input.profileId, dayUtc, capturedAt: view.asOfMs,
    cashUsd: view.cashUsd, equityUsd: view.totalValueUsd, benchmarkUsd,
    unpricedCount: view.unpricedCount, positionsJson, provenanceJson, evidenceHash,
  } satisfies PaperDailyValuationEvidence;
  savePaperDailyValuationEvidence(evidence, input.database);
  return evidence;
}
