import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '../packages/core/src/index.js';
import {
  RiskRealityCheckService,
  type RiskRealityCheckInput,
} from '../packages/services/src/index.js';

function input(overrides: Partial<RiskRealityCheckInput> = {}): RiskRealityCheckInput {
  return {
    sourceEvidenceHash: 'a'.repeat(64),
    portfolioValueUsd: 34,
    minTradeUsd: 25,
    roundTripCostBps: 40,
    rebalanceEveryDays: 7,
    topAssetWeight: 0.8,
    topAssetSymbol: 'BTC',
    significanceVerdict: 'inconclusive',
    backtestDays: 100,
    paperArmed: true,
    ...overrides,
  };
}

describe('risk reality-check service', () => {
  it('returns stable advisory codes bound to evidence and injected time', () => {
    const clock = new FixedClock(123);
    const service = new RiskRealityCheckService({ clock });
    const callerInput = input();
    const result = service.assess(callerInput);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a valid report');

    expect(result.report).toEqual(expect.objectContaining({
      schemaVersion: 1,
      assessedAtMs: 123,
      sourceEvidenceHash: 'a'.repeat(64),
      status: 'attention_required',
      liveExecutionPermitted: false,
      assessmentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(result.report.notices).toEqual([
      { code: 'portfolio_too_small', severity: 'warn' },
      { code: 'edge_unproven', severity: 'warn' },
      { code: 'short_history', severity: 'info' },
      { code: 'concentration', severity: 'info' },
      { code: 'paper_vs_live', severity: 'info' },
    ]);
    expect(result.report.notices[0]).not.toHaveProperty('title');
    expect(result.report.notices[0]).not.toHaveProperty('body');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.report)).toBe(true);
    expect(Object.isFrozen(result.report.notices)).toBe(true);
    expect(result.report.notices.every((notice) => Object.isFrozen(notice))).toBe(true);

    const originalHash = result.report.assessmentHash;
    callerInput.portfolioValueUsd = 999_999;
    expect(result.report.assessmentHash).toBe(originalHash);
    expect(service.assess(input({ portfolioValueUsd: 35 }))).not.toEqual(result);
  });

  it('keeps a clear advisory report conversation-only and deterministic', () => {
    const clock = new FixedClock(1_000);
    const service = new RiskRealityCheckService({ clock });
    const clear = input({
      portfolioValueUsd: 0,
      topAssetWeight: null,
      topAssetSymbol: null,
      significanceVerdict: null,
      backtestDays: null,
      paperArmed: false,
    });
    const first = service.assess(clear);
    const second = service.assess(clear);
    expect(first).toEqual(second);
    expect(first).toEqual({
      ok: true,
      report: expect.objectContaining({
        status: 'clear', notices: [], liveExecutionPermitted: false,
      }),
    });
    clock.advanceBy(1);
    const later = service.assess(clear);
    expect(later).not.toEqual(first);
  });

  it('collects every validation failure in stable path order without reading the clock', () => {
    const nowMs = vi.fn(() => 999);
    const service = new RiskRealityCheckService({ clock: { nowMs } });
    const invalid = {
      ...input(),
      sourceEvidenceHash: 'not-a-hash',
      portfolioValueUsd: -1,
      minTradeUsd: 0,
      roundTripCostBps: Number.POSITIVE_INFINITY,
      rebalanceEveryDays: 0,
      topAssetWeight: 2,
      topAssetSymbol: 'BTC wallet secret',
      significanceVerdict: 'probably',
      backtestDays: -1,
      paperArmed: 'true',
      diagnostic: 'secret-bearing raw value',
    } as unknown as RiskRealityCheckInput;
    const result = service.assess(invalid);
    if (result.ok) throw new Error('expected validation failure');

    expect(result).toEqual({
      ok: false,
      issues: [
        { path: [], code: 'unknown_field' },
        { path: ['sourceEvidenceHash'], code: 'invalid_evidence_hash' },
        { path: ['portfolioValueUsd'], code: 'invalid_portfolio_value' },
        { path: ['minTradeUsd'], code: 'invalid_min_trade' },
        { path: ['roundTripCostBps'], code: 'invalid_round_trip_cost' },
        { path: ['rebalanceEveryDays'], code: 'invalid_rebalance_cadence' },
        { path: ['topAssetWeight'], code: 'invalid_top_asset_weight' },
        { path: ['topAssetSymbol'], code: 'invalid_top_asset_symbol' },
        { path: ['significanceVerdict'], code: 'invalid_significance_verdict' },
        { path: ['backtestDays'], code: 'invalid_backtest_days' },
        { path: ['paperArmed'], code: 'invalid_paper_state' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('secret-bearing');
    expect(JSON.stringify(result)).not.toContain('not-a-hash');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
    expect(result.issues.every((entry) =>
      Object.isFrozen(entry) && Object.isFrozen(entry.path),
    )).toBe(true);
    expect(nowMs).not.toHaveBeenCalled();
  });

  it('rejects inconsistent asset facts independently of numeric validation', () => {
    const service = new RiskRealityCheckService({ clock: new FixedClock(0) });
    expect(service.assess(input({ topAssetWeight: 0.5, topAssetSymbol: null }))).toEqual({
      ok: false,
      issues: [{ path: ['topAssetWeight'], code: 'inconsistent_top_asset' }],
    });
  });
});
