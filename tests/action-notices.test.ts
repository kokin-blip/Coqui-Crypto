import { describe, expect, it } from 'vitest';
import {
  actionNotice,
  reasonCodeForSkippedTrade,
  reasonCodeForTrade,
  reasonLabel,
} from '../packages/core/src/index.js';

describe('action notices', () => {
  it('keeps every algorithm action honest about uncertainty', () => {
    expect(actionNotice('BUY')).toContain('does not guarantee profit');
    expect(actionNotice('SELL')).toContain('may lock in a gain or a loss');
    expect(actionNotice('HOLD')).toContain('does not mean the asset is safe');
  });

  it('maps trade and skipped-trade reasons to stable codes', () => {
    expect(reasonCodeForTrade('buy', 'candidate passed')).toBe('BUY_CANDIDATE_SCORE_CONFIRMED');
    expect(reasonCodeForTrade('sell', 'stop loss')).toBe('SELL_STOP_LOSS_TRIGGERED');
    expect(reasonCodeForSkippedTrade('minimum trade size not met')).toBe(
      'HOLD_GUARDRAIL_MIN_TRADE_SIZE',
    );
    expect(reasonCodeForSkippedTrade('unknown reason')).toBe('HOLD_GUARDRAIL_BLOCKED');
  });

  it('provides readable labels for known, absent, and unknown codes', () => {
    expect(reasonLabel('HOLD_MOMENTUM_WEAK')).toBe('Momentum too weak');
    expect(reasonLabel(null)).toBe('Strategy rule evaluated');
    expect(reasonLabel('CUSTOM_REASON')).toBe('custom reason');
  });
});
