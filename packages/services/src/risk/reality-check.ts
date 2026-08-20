import {
  realityCheckNotices,
  sha256Hex,
  type Clock,
  type RealityCheckInput,
  type RealityNoticeKind,
  type RealityNoticeSeverity,
} from '@coqui/core';

import { freezeRiskValue } from './immutable.js';

const HASH = /^[a-f0-9]{64}$/u;
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,19}$/u;
const VERDICTS = new Set<NonNullable<RealityCheckInput['significanceVerdict']>>([
  'significant', 'inconclusive', 'no_edge', 'insufficient_data',
]);
const INPUT_KEYS = new Set([
  'sourceEvidenceHash', 'portfolioValueUsd', 'minTradeUsd', 'roundTripCostBps',
  'rebalanceEveryDays', 'topAssetWeight', 'topAssetSymbol', 'significanceVerdict',
  'backtestDays', 'paperArmed',
]);

export interface RiskRealityCheckInput extends RealityCheckInput {
  readonly sourceEvidenceHash: string;
}

export type RiskRealityValidationCode =
  | 'unknown_field'
  | 'invalid_evidence_hash'
  | 'invalid_portfolio_value'
  | 'invalid_min_trade'
  | 'invalid_round_trip_cost'
  | 'invalid_rebalance_cadence'
  | 'invalid_top_asset_weight'
  | 'invalid_top_asset_symbol'
  | 'inconsistent_top_asset'
  | 'invalid_significance_verdict'
  | 'invalid_backtest_days'
  | 'invalid_paper_state';

export interface RiskRealityValidationIssue {
  readonly path: readonly string[];
  readonly code: RiskRealityValidationCode;
}

export interface RiskRealityNotice {
  readonly code: RealityNoticeKind;
  readonly severity: RealityNoticeSeverity;
}

export type RiskRealityStatus = 'clear' | 'informational' | 'attention_required';

export interface RiskRealityReport {
  readonly schemaVersion: 1;
  readonly assessedAtMs: number;
  readonly sourceEvidenceHash: string;
  readonly status: RiskRealityStatus;
  readonly notices: readonly RiskRealityNotice[];
  readonly liveExecutionPermitted: false;
  readonly assessmentHash: string;
}

export type RiskRealityCheckResult =
  | { readonly ok: true; readonly report: RiskRealityReport }
  | { readonly ok: false; readonly issues: readonly RiskRealityValidationIssue[] };

export interface RiskRealityCheckDependencies {
  readonly clock: Clock;
}

function issue(path: string, code: RiskRealityValidationCode): RiskRealityValidationIssue {
  return freezeRiskValue({ path: [path], code });
}

function validNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validate(input: RiskRealityCheckInput): readonly RiskRealityValidationIssue[] {
  const issues: RiskRealityValidationIssue[] = [];
  if (Object.keys(input).some((key) => !INPUT_KEYS.has(key))) {
    issues.push(freezeRiskValue({ path: [], code: 'unknown_field' }));
  }
  if (typeof input.sourceEvidenceHash !== 'string' || !HASH.test(input.sourceEvidenceHash)) {
    issues.push(issue('sourceEvidenceHash', 'invalid_evidence_hash'));
  }
  if (!validNonNegative(input.portfolioValueUsd)) {
    issues.push(issue('portfolioValueUsd', 'invalid_portfolio_value'));
  }
  if (typeof input.minTradeUsd !== 'number' || !Number.isFinite(input.minTradeUsd) ||
      input.minTradeUsd <= 0) {
    issues.push(issue('minTradeUsd', 'invalid_min_trade'));
  }
  if (!validNonNegative(input.roundTripCostBps) || input.roundTripCostBps > 10_000) {
    issues.push(issue('roundTripCostBps', 'invalid_round_trip_cost'));
  }
  if (!Number.isSafeInteger(input.rebalanceEveryDays) || input.rebalanceEveryDays < 1 ||
      input.rebalanceEveryDays > 3_650) {
    issues.push(issue('rebalanceEveryDays', 'invalid_rebalance_cadence'));
  }
  if (input.topAssetWeight !== null &&
      (!validNonNegative(input.topAssetWeight) || input.topAssetWeight > 1)) {
    issues.push(issue('topAssetWeight', 'invalid_top_asset_weight'));
  }
  if (input.topAssetSymbol !== null &&
      (typeof input.topAssetSymbol !== 'string' || !SYMBOL.test(input.topAssetSymbol))) {
    issues.push(issue('topAssetSymbol', 'invalid_top_asset_symbol'));
  }
  if ((input.topAssetWeight === null) !== (input.topAssetSymbol === null)) {
    issues.push(issue('topAssetWeight', 'inconsistent_top_asset'));
  }
  if (input.significanceVerdict !== null &&
      (typeof input.significanceVerdict !== 'string' ||
       !VERDICTS.has(input.significanceVerdict as NonNullable<RealityCheckInput['significanceVerdict']>))) {
    issues.push(issue('significanceVerdict', 'invalid_significance_verdict'));
  }
  if (input.backtestDays !== null &&
      (!Number.isSafeInteger(input.backtestDays) || input.backtestDays < 0 ||
       input.backtestDays > 10_000_000)) {
    issues.push(issue('backtestDays', 'invalid_backtest_days'));
  }
  if (typeof input.paperArmed !== 'boolean') {
    issues.push(issue('paperArmed', 'invalid_paper_state'));
  }
  return freezeRiskValue(issues);
}

function status(notices: readonly RiskRealityNotice[]): RiskRealityStatus {
  if (notices.some((notice) => notice.severity === 'warn')) return 'attention_required';
  return notices.length === 0 ? 'clear' : 'informational';
}

/** Validated, provenance-bound advisory report with no execution authority. */
export class RiskRealityCheckService {
  readonly #clock: Clock;

  constructor(dependencies: RiskRealityCheckDependencies) {
    this.#clock = dependencies.clock;
  }

  assess(input: RiskRealityCheckInput): RiskRealityCheckResult {
    const issues = validate(input);
    if (issues.length > 0) return freezeRiskValue({ ok: false, issues });

    const facts: RealityCheckInput = {
      portfolioValueUsd: input.portfolioValueUsd,
      minTradeUsd: input.minTradeUsd,
      roundTripCostBps: input.roundTripCostBps,
      rebalanceEveryDays: input.rebalanceEveryDays,
      topAssetWeight: input.topAssetWeight,
      topAssetSymbol: input.topAssetSymbol,
      significanceVerdict: input.significanceVerdict,
      backtestDays: input.backtestDays,
      paperArmed: input.paperArmed,
    };
    const assessedAtMs = this.#clock.nowMs();
    if (!Number.isSafeInteger(assessedAtMs) || assessedAtMs < 0) {
      throw new RangeError('Risk clock must return a non-negative safe epoch millisecond.');
    }
    const notices = freezeRiskValue(realityCheckNotices(facts).map((notice) => ({
      code: notice.kind,
      severity: notice.severity,
    })));
    const reportWithoutHash = {
      schemaVersion: 1 as const,
      assessedAtMs,
      sourceEvidenceHash: input.sourceEvidenceHash,
      status: status(notices),
      notices,
      liveExecutionPermitted: false as const,
    };
    const assessmentHash = sha256Hex(JSON.stringify({ ...reportWithoutHash, facts }));
    return freezeRiskValue({
      ok: true,
      report: { ...reportWithoutHash, assessmentHash },
    });
  }
}
