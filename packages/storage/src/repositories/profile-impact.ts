import type { Db } from '../sqlite/index.js';

export interface StoredProfileDeletionImpact {
  readonly openTaxLots: number;
  readonly disposals: number;
  readonly portfolioEvidenceRecords: number;
  readonly paperEvidenceRecords: number;
  readonly researchEvidenceRecords: number;
  readonly alertEvidenceRecords: number;
  readonly importEvidenceRecords: number;
  readonly operationalEvidenceRecords: number;
}

function safeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('SQLite returned an invalid profile impact count.');
  }
  return value;
}

/** Count durable facts without returning their content or mutating acknowledgement state. */
export function readProfileDeletionImpact(
  profileId: string,
  database: Db,
): StoredProfileDeletionImpact {
  const row = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tax_lots_v2
        WHERE CAST(remaining_text AS REAL) <> 0) AS open_tax_lots,
      (SELECT COUNT(*) FROM disposals_v2) AS disposals,
      ((SELECT COUNT(*) FROM portfolio_snapshot_evidence_v3) +
        (SELECT COUNT(*) FROM allocation_targets_v2) +
        (SELECT COUNT(*) FROM display_universe_items_v1 WHERE profile_id = ?) +
        (SELECT COUNT(*) FROM display_universe_events_v1 WHERE origin_profile_id = ?))
        AS portfolio_evidence_records,
      ((SELECT COUNT(*) FROM paper_orders_v3 WHERE profile_id = ?) +
        (SELECT COUNT(*) FROM paper_order_events_v3 WHERE profile_id = ?) +
        (SELECT COUNT(*) FROM paper_fills_v3 WHERE profile_id = ?) +
        (SELECT COUNT(*) FROM paper_ledger_entries_v3 WHERE profile_id = ?))
        AS paper_evidence_records,
      ((SELECT COUNT(*) FROM research_jobs) +
        (SELECT COUNT(*) FROM research_preregistrations) +
        (SELECT COUNT(*) FROM research_study_runs) +
        (SELECT COUNT(*) FROM research_evidence_snapshots_v2) +
        (SELECT COUNT(*) FROM trial_registry_records)) AS research_evidence_records,
      ((SELECT COUNT(*) FROM alert_events_v2 WHERE profile_id = ?) +
        (SELECT COUNT(*) FROM alert_price_targets_v2 WHERE profile_id = ?))
        AS alert_evidence_records,
      ((SELECT COUNT(*) FROM coinbase_import_jobs WHERE profile_id = ?) +
        (SELECT COUNT(*) FROM coinbase_import_stage_lots
          WHERE job_id IN (SELECT id FROM coinbase_import_jobs WHERE profile_id = ?)) +
        (SELECT COUNT(*) FROM coinbase_import_stage_disposals
          WHERE job_id IN (SELECT id FROM coinbase_import_jobs WHERE profile_id = ?)) +
        (SELECT COUNT(*) FROM coinbase_import_discrepancies
          WHERE job_id IN (SELECT id FROM coinbase_import_jobs WHERE profile_id = ?)) +
        (SELECT COUNT(*) FROM coinbase_sync_runs_v2) +
        (SELECT COUNT(*) FROM coinbase_account_evidence_v2) +
        (SELECT COUNT(*) FROM coinbase_fill_evidence_v2) +
        (SELECT COUNT(*) FROM coinbase_balance_discrepancies_v2))
        AS import_evidence_records,
      ((SELECT COUNT(*) FROM wallet_execution_journal WHERE profile_id = ?) +
        (SELECT COUNT(*) FROM runtime_incidents WHERE profile_id = ?) +
        (SELECT COUNT(*) FROM wallet_safety_stop_events WHERE profile_id = ?) +
        (SELECT COUNT(*) FROM wallet_decision_runs WHERE profile_id = ?))
        AS operational_evidence_records
  `).get(
    profileId, profileId,
    profileId, profileId, profileId, profileId,
    profileId, profileId,
    profileId, profileId, profileId, profileId,
    profileId, profileId, profileId, profileId,
  ) as Record<string, unknown>;
  return {
    openTaxLots: safeCount(row['open_tax_lots']),
    disposals: safeCount(row['disposals']),
    portfolioEvidenceRecords: safeCount(row['portfolio_evidence_records']),
    paperEvidenceRecords: safeCount(row['paper_evidence_records']),
    researchEvidenceRecords: safeCount(row['research_evidence_records']),
    alertEvidenceRecords: safeCount(row['alert_evidence_records']),
    importEvidenceRecords: safeCount(row['import_evidence_records']),
    operationalEvidenceRecords: safeCount(row['operational_evidence_records']),
  };
}
