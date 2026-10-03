import { Decimal } from 'decimal.js';

import { AlpacaPaperError, type AlpacaPaperAsset } from '@coqui/adapters';
import { instrumentKey } from '@coqui/core';
import type { ParallelPaperEvent } from '@coqui/storage';

import { PARALLEL_INSTRUMENTS } from './parallel-signal.js';

export function money(value: string | number | Decimal): Decimal {
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error('invalid_amount');
  return result;
}

const SAFE_FAILURE_REASONS = new Set([
  'deadline_exceeded', 'research_budget_exhausted', 'execution_window_missed', 'execution_lease_unavailable',
  'stale_host_authority', 'host_unavailable', 'host_suspended', 'explicit_pause_preserved', 'kill_switch_engaged',
  'credentials_unavailable', 'credentials_corrupt', 'secret_store_unavailable', 'secret_store_invalid_value', 'secret_store_corrupt',
  'stale_market_data', 'stale_product_rules', 'market_fetch_failed', 'invalid_market_data', 'market_alignment_failed',
  'insufficient_history', 'invalid_amount', 'unknown_asset', 'local_wallet_unavailable', 'invalid_activity_timestamp',
  'unexpected_alpaca_order', 'alpaca_account_changed', 'alpaca_order_failed', 'submission_outcome_unknown',
  'alpaca_activity_page_limit', 'alpaca_equity_unavailable', 'alpaca_asset_rules_unavailable',
  'stale_alpaca_quote', 'invalid_alpaca_quote', 'material_sizing_inputs_changed', 'asset_identity_mismatch',
  'missing_prospective_predecessor', 'hourly_candidate_version_changed', 'hourly_experiment_changed', 'hourly_opening_unavailable',
  'registered_study_source_changed', 'study_not_registered',
]);
export function parallelSafeFailureReason(error: unknown, fallback: string): string {
  return error instanceof Error && SAFE_FAILURE_REASONS.has(error.message) ? error.message : fallback;
}

export function parallelPaperFailureDetail(error: unknown, fallback: string):
  { reason: string; operation?: string; httpStatus?: number; attemptCount?: number; elapsedMs?: number; budgetMs?: number | null; remainingMs?: number | null } {
  if (error instanceof AlpacaPaperError) return {
    reason: error.code === 'deadline_exceeded' ? 'deadline_exceeded' : `alpaca_${error.code}`, operation: error.operation,
    attemptCount: error.attemptCount, elapsedMs: error.elapsedMs, budgetMs: error.budgetMs, remainingMs: error.remainingMs,
    ...(error.httpStatus === null ? {} : { httpStatus: error.httpStatus }),
  };
  return { reason: parallelSafeFailureReason(error, fallback) };
}

export function quantity(value: Decimal): string {
  return value.toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN).toFixed(8);
}

export function alpacaQuantity(value: Decimal, asset: AlpacaPaperAsset): Decimal {
  const increment = money(asset.min_trade_increment ?? '0');
  const minimum = money(asset.min_order_size ?? '0');
  if (!increment.isPositive() || !minimum.isPositive() || !asset.tradable || asset.status !== 'active') {
    throw new Error('alpaca_asset_rules_unavailable');
  }
  const rounded = value.abs().div(increment).floor().mul(increment);
  return rounded.lessThan(minimum) ? new Decimal(0) : rounded;
}

export function symbolFor(id: string): string {
  const found = PARALLEL_INSTRUMENTS.find((item) => instrumentKey(item) === id);
  if (found === undefined) throw new Error('unknown_asset');
  return found.productId.replace('-', '');
}

export function eventFor(events: readonly ParallelPaperEvent[], kind: string, day: string): ParallelPaperEvent | undefined {
  return events.find((event) => event.kind === kind && event.detail['day'] === day);
}
