import { nonNegativeDecimal } from '@coqui/core';

import type { Db } from '../sqlite/index.js';

export interface PaperDailyValuationEvidence {
  readonly id: string;
  readonly profileId: string;
  readonly dayUtc: number;
  readonly capturedAt: number;
  readonly cashUsd: string;
  readonly equityUsd: string | null;
  readonly benchmarkUsd: string | null;
  readonly unpricedCount: number;
  readonly positionsJson: string;
  readonly provenanceJson: string;
  readonly evidenceHash: string;
}

export interface PaperFillPerformanceFact {
  readonly orderId: string;
  readonly productId: string;
  readonly side: 'buy' | 'sell';
  readonly quantity: string;
  readonly executionPrice: string;
  readonly notionalUsd: string;
  readonly venueFeeUsd: string;
  readonly spreadUsd: string;
  readonly slippageUsd: string;
  readonly impactUsd: string;
  readonly filledAt: number;
  readonly marketSnapshotHash: string;
}

export interface PaperOrderTransitionFact {
  readonly orderId: string;
  readonly sequence: number;
  readonly state: string;
  readonly at: number;
  readonly detailJson: string;
}

interface Row {
  id: string;
  profile_id: string;
  day_utc: number;
  captured_at: number;
  cash_usd_text: string;
  equity_usd_text: string | null;
  benchmark_usd_text: string | null;
  unpriced_count: number;
  positions_json: string;
  provenance_json: string;
  evidence_hash: string;
}

function fromRow(row: Row): PaperDailyValuationEvidence {
  return Object.freeze({
    id: row.id,
    profileId: row.profile_id,
    dayUtc: row.day_utc,
    capturedAt: row.captured_at,
    cashUsd: row.cash_usd_text,
    equityUsd: row.equity_usd_text,
    benchmarkUsd: row.benchmark_usd_text,
    unpricedCount: row.unpriced_count,
    positionsJson: row.positions_json,
    provenanceJson: row.provenance_json,
    evidenceHash: row.evidence_hash,
  });
}

export function savePaperDailyValuationEvidence(
  evidence: PaperDailyValuationEvidence,
  database: Db,
): boolean {
  nonNegativeDecimal(evidence.cashUsd);
  if (evidence.equityUsd !== null) nonNegativeDecimal(evidence.equityUsd);
  if (evidence.benchmarkUsd !== null) nonNegativeDecimal(evidence.benchmarkUsd);
  JSON.parse(evidence.positionsJson) as unknown;
  JSON.parse(evidence.provenanceJson) as unknown;
  const prior = database.prepare(
    'SELECT * FROM paper_daily_valuation_evidence_v1 WHERE profile_id = ? AND day_utc = ?',
  ).get(evidence.profileId, evidence.dayUtc) as unknown as Row | undefined;
  if (prior !== undefined) {
    const same = JSON.stringify(fromRow(prior)) === JSON.stringify(evidence);
    if (!same) throw new Error('Daily paper valuation evidence cannot be replaced.');
    return false;
  }
  return database.prepare(`
    INSERT INTO paper_daily_valuation_evidence_v1
      (id, profile_id, day_utc, captured_at, cash_usd_text, equity_usd_text,
       benchmark_usd_text, unpriced_count, positions_json, provenance_json, evidence_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    evidence.id, evidence.profileId, evidence.dayUtc, evidence.capturedAt,
    evidence.cashUsd, evidence.equityUsd, evidence.benchmarkUsd,
    evidence.unpricedCount, evidence.positionsJson, evidence.provenanceJson,
    evidence.evidenceHash,
  ).changes === 1;
}

export function listPaperDailyValuationEvidence(
  profileId: string,
  database: Db,
): readonly PaperDailyValuationEvidence[] {
  const rows = database.prepare(`
    SELECT * FROM paper_daily_valuation_evidence_v1
    WHERE profile_id = ?
    ORDER BY day_utc, id
  `).all(profileId) as unknown as Row[];
  return Object.freeze(rows.map(fromRow));
}

export function getPaperDailyValuationEvidence(
  profileId: string,
  dayUtc: number,
  database: Db,
): PaperDailyValuationEvidence | null {
  const row = database.prepare(`
    SELECT * FROM paper_daily_valuation_evidence_v1
    WHERE profile_id = ? AND day_utc = ?
  `).get(profileId, dayUtc) as unknown as Row | undefined;
  return row === undefined ? null : fromRow(row);
}

export function listPaperFillPerformanceFacts(
  profileId: string,
  database: Db,
): readonly PaperFillPerformanceFact[] {
  const rows = database.prepare(`
    SELECT f.order_id, o.product_id, o.side, f.quantity_text, f.execution_price_text,
           f.notional_text, f.venue_fee_text, f.spread_cost_text,
           f.slippage_cost_text, f.impact_cost_text, f.filled_at, f.market_snapshot_hash
    FROM paper_fills_v3 f
    JOIN paper_orders_v3 o ON o.id = f.order_id
    WHERE f.profile_id = ?
    ORDER BY f.filled_at, f.id
  `).all(profileId) as unknown as Array<Record<string, unknown>>;
  return Object.freeze(rows.map((row) => Object.freeze({
    orderId: String(row['order_id']),
    productId: String(row['product_id']),
    side: row['side'] as 'buy' | 'sell',
    quantity: String(row['quantity_text']),
    executionPrice: String(row['execution_price_text']),
    notionalUsd: String(row['notional_text']),
    venueFeeUsd: String(row['venue_fee_text']),
    spreadUsd: String(row['spread_cost_text']),
    slippageUsd: String(row['slippage_cost_text']),
    impactUsd: String(row['impact_cost_text']),
    filledAt: Number(row['filled_at']),
    marketSnapshotHash: String(row['market_snapshot_hash']),
  })));
}

export function listPaperPerformanceDayFacts(
  profileId: string,
  dayUtc: number,
  database: Db,
): {
  readonly fills: readonly PaperFillPerformanceFact[];
  readonly transitions: readonly PaperOrderTransitionFact[];
} {
  const until = dayUtc + 86_400_000;
  const fills = listPaperFillPerformanceFacts(profileId, database)
    .filter((fill) => fill.filledAt >= dayUtc && fill.filledAt < until);
  const rows = database.prepare(`
    SELECT e.order_id, e.sequence, e.state, e.at, e.detail_json
    FROM paper_order_events_v3 e
    WHERE e.profile_id = ? AND e.at >= ? AND e.at < ?
    ORDER BY e.at, e.order_id, e.sequence
  `).all(profileId, dayUtc, until) as unknown as Array<Record<string, unknown>>;
  return Object.freeze({
    fills: Object.freeze(fills),
    transitions: Object.freeze(rows.map((row) => Object.freeze({
      orderId: String(row['order_id']),
      sequence: Number(row['sequence']),
      state: String(row['state']),
      at: Number(row['at']),
      detailJson: String(row['detail_json']),
    }))),
  });
}
