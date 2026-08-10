/** Execution modes understood by the pure decision engine. */
import type { InstrumentKey } from '../types/index.js';

export type AutoTradeMode = 'off' | 'paper' | 'live';

export interface SkippedAutoTrade {
  assetId: InstrumentKey;
  symbol: string;
  side: 'buy' | 'sell';
  amountUsd: number;
  reason: string;
}

// Live execution requires four independently reviewed gates in a future phase.
// They remain compile-time false; there is no order-submission adapter in this build.
export const LIVE_TRADING_COMPILED = false as const;
export const LIVE_TRADING_ENVIRONMENT_ENABLED = false as const;
export const LIVE_TRADING_USER_ENABLED = false as const;
export const LIVE_TRADING_EVIDENCE_APPROVED = false as const;

export function liveTradingUnlocked(): boolean {
  return [
    LIVE_TRADING_COMPILED,
    LIVE_TRADING_ENVIRONMENT_ENABLED,
    LIVE_TRADING_USER_ENABLED,
    LIVE_TRADING_EVIDENCE_APPROVED,
  ].every(Boolean);
}

/**
 * Only paper automation can act, and the kill switch always wins. Live remains
 * fail-closed even if a caller supplies an unexpected truthy value for `killed`.
 */
export function canExecute(mode: AutoTradeMode, killed: boolean): boolean {
  return mode === 'paper' && !killed;
}
