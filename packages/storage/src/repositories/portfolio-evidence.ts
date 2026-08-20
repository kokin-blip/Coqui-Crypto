import {
  createPortfolioEvidenceSnapshot,
  dayKey,
  type PortfolioEvidenceSnapshot,
  type PortfolioValuationStatus,
} from '@coqui/core';

import type { Db } from '../sqlite/index.js';

interface PortfolioEvidenceRow {
  id: string;
  day_key_ms: number;
  scheduled_for_ms: number;
  observed_at_ms: number;
  recorded_at_ms: number;
  valuation_status: PortfolioValuationStatus;
  equity_usd_text: string | null;
  priced_subtotal_usd_text: string;
  open_cost_usd_text: string;
  realized_pnl_usd_text: string;
  unpriced_instruments_json: string;
}

function portfolioEvidenceFromRow(row: PortfolioEvidenceRow): PortfolioEvidenceSnapshot {
  const unpriced = JSON.parse(row.unpriced_instruments_json) as unknown;
  if (!Array.isArray(unpriced) || unpriced.some((value) => typeof value !== 'string')) {
    throw new Error('Stored portfolio evidence has invalid unpriced-instrument metadata.');
  }
  const snapshot = createPortfolioEvidenceSnapshot({
    scheduledForMs: row.scheduled_for_ms,
    observedAtMs: row.observed_at_ms,
    recordedAtMs: row.recorded_at_ms,
    valuationStatus: row.valuation_status,
    equityUsd: row.equity_usd_text,
    pricedSubtotalUsd: row.priced_subtotal_usd_text,
    openCostUsd: row.open_cost_usd_text,
    realizedPnlUsd: row.realized_pnl_usd_text,
    unpricedInstrumentKeys: unpriced as string[],
  });
  if (snapshot.id !== row.id || snapshot.dayKeyMs !== row.day_key_ms) {
    throw new Error('Stored portfolio evidence identity validation failed.');
  }
  return snapshot;
}

export interface SavePortfolioEvidenceResult {
  readonly created: boolean;
}

/** Append one immutable valuation fact; an exact retry is idempotent. */
export function savePortfolioEvidenceSnapshot(
  snapshot: PortfolioEvidenceSnapshot,
  database: Db,
): SavePortfolioEvidenceResult {
  const validated = createPortfolioEvidenceSnapshot(snapshot);
  if (validated.id !== snapshot.id || validated.dayKeyMs !== snapshot.dayKeyMs) {
    throw new TypeError('Portfolio evidence identity is not canonical.');
  }
  const prior = database.prepare(
    'SELECT * FROM portfolio_snapshot_evidence_v3 WHERE id = ?',
  ).get(validated.id) as unknown as PortfolioEvidenceRow | undefined;
  if (prior) {
    const existing = portfolioEvidenceFromRow(prior);
    if (JSON.stringify(existing) !== JSON.stringify(validated)) {
      throw new Error('Portfolio snapshot evidence identity is immutable.');
    }
    return { created: false };
  }
  database.prepare(`
    INSERT INTO portfolio_snapshot_evidence_v3 (
      id, day_key_ms, scheduled_for_ms, observed_at_ms, recorded_at_ms,
      valuation_status, equity_usd_text, priced_subtotal_usd_text,
      open_cost_usd_text, realized_pnl_usd_text, unpriced_instruments_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    validated.id,
    validated.dayKeyMs,
    validated.scheduledForMs,
    validated.observedAtMs,
    validated.recordedAtMs,
    validated.valuationStatus,
    validated.equityUsd,
    validated.pricedSubtotalUsd,
    validated.openCostUsd,
    validated.realizedPnlUsd,
    JSON.stringify(validated.unpricedInstrumentKeys),
  );
  return { created: true };
}

export interface PortfolioEvidenceQuery {
  readonly sinceDayKeyMs?: number;
  /** Maximum returned observations; stored evidence is never truncated. */
  readonly limit?: number;
}

/** Bounded chronological evidence read; persistence remains append-only and unbounded. */
export function listPortfolioEvidenceSnapshots(
  database: Db,
  query: PortfolioEvidenceQuery = {},
): PortfolioEvidenceSnapshot[] {
  const limit = query.limit ?? 366;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 3_660) {
    throw new RangeError('Portfolio evidence query limit must be in [1, 3660].');
  }
  const since = query.sinceDayKeyMs;
  if (since !== undefined && (!Number.isSafeInteger(since) || since < 0 || dayKey(since) !== since)) {
    throw new RangeError('Portfolio evidence since-day must be a UTC day key.');
  }
  const rows = (since === undefined
    ? database.prepare(`
        SELECT * FROM (
          SELECT * FROM portfolio_snapshot_evidence_v3
          ORDER BY day_key_ms DESC, observed_at_ms DESC, recorded_at_ms DESC, id DESC
          LIMIT ?
        ) ORDER BY day_key_ms, observed_at_ms, recorded_at_ms, id
      `).all(limit)
    : database.prepare(`
        SELECT * FROM (
          SELECT * FROM portfolio_snapshot_evidence_v3 WHERE day_key_ms >= ?
          ORDER BY day_key_ms DESC, observed_at_ms DESC, recorded_at_ms DESC, id DESC
          LIMIT ?
        ) ORDER BY day_key_ms, observed_at_ms, recorded_at_ms, id
      `).all(since, limit)) as unknown as PortfolioEvidenceRow[];
  return rows.map(portfolioEvidenceFromRow);
}
