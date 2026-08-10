export type AlgorithmAction = 'BUY' | 'SELL' | 'HOLD';

export const ALGORITHM_ACTION_NOTICES: Record<AlgorithmAction, string> = {
  BUY:
    'The algorithm is attempting to buy this asset based on the current strategy settings, available market data, and configured risk limits. This buy action does not guarantee profit and may result in loss. The final execution price may differ from the displayed price because of volatility, spread, liquidity, fees, slippage, API delay, or market movement.',
  SELL:
    'The algorithm is attempting to sell this asset based on the current strategy settings, available market data, and configured risk limits. This sell action may lock in a gain or a loss and does not guarantee the best possible exit price. The final execution price may differ from the displayed price because of volatility, spread, liquidity, fees, slippage, API delay, or market movement.',
  HOLD:
    'The algorithm is currently holding and has not submitted a buy or sell order. A hold decision does not mean the asset is safe, undervalued, profitable, or expected to rise. It only means the current strategy rules and risk checks have not triggered a trade at this time.',
};

export const ACTION_REASON_TEXT: Record<string, string> = {
  HOLD_NO_CONFIRMED_ENTRY_SIGNAL: 'No confirmed entry signal',
  HOLD_MARKET_DATA_INSUFFICIENT: 'Market data insufficient',
  HOLD_TREND_NOT_CONFIRMED: 'Trend not confirmed',
  HOLD_MOMENTUM_WEAK: 'Momentum too weak',
  HOLD_OVEREXTENDED: 'Entry looks overextended',
  HOLD_VOLATILITY_TOO_HIGH: 'Volatility above limit',
  HOLD_POSITION_ALREADY_HELD: 'Position already held',
  HOLD_LIQUIDITY_BELOW_MINIMUM: 'Liquidity below minimum',
  HOLD_SPREAD_TOO_WIDE: 'Spread too wide',
  HOLD_DAILY_LOSS_LIMIT_REACHED: 'Daily loss limit reached',
  HOLD_KILL_SWITCH_ENABLED: 'Kill switch enabled',
  HOLD_GUARDRAIL_MIN_TRADE_SIZE: 'Trade below minimum size',
  HOLD_GUARDRAIL_COST_TOO_HIGH: 'Estimated cost too high',
  HOLD_GUARDRAIL_TURNOVER_LIMIT: 'Turnover limit reached',
  HOLD_GUARDRAIL_MAX_TRADES: 'Trade count limit reached',
  HOLD_GUARDRAIL_BLOCKED: 'Risk guardrail blocked the move',
  BUY_ENTRY_SIGNAL_CONFIRMED: 'Entry signal confirmed and risk checks passed',
  BUY_CANDIDATE_SCORE_CONFIRMED: 'Buy candidate score confirmed and risk checks passed',
  SELL_REBALANCE_SIGNAL_CONFIRMED: 'Sell signal confirmed and risk checks passed',
  SELL_STOP_LOSS_TRIGGERED: 'Stop loss triggered',
  SELL_TAKE_PROFIT_REACHED: 'Take-profit target reached',
  SELL_RISK_LIMIT_TRIGGERED: 'Risk limit triggered',
};

export function actionNotice(action: AlgorithmAction): string {
  return ALGORITHM_ACTION_NOTICES[action];
}

export function reasonLabel(reasonCode: string | null | undefined): string {
  if (!reasonCode) return 'Strategy rule evaluated';
  return ACTION_REASON_TEXT[reasonCode] ?? reasonCode.replaceAll('_', ' ').toLowerCase();
}

export function reasonCodeForTrade(side: 'buy' | 'sell', reason: string | null | undefined): string {
  const text = (reason ?? '').toLowerCase();
  if (side === 'buy' && (text.includes('candidate passed') || text.includes('entry score'))) {
    return 'BUY_CANDIDATE_SCORE_CONFIRMED';
  }
  if (side === 'buy') return 'BUY_ENTRY_SIGNAL_CONFIRMED';
  if (text.includes('stop')) return 'SELL_STOP_LOSS_TRIGGERED';
  if (text.includes('profit') || text.includes('take')) return 'SELL_TAKE_PROFIT_REACHED';
  if (text.includes('risk') || text.includes('guardrail') || text.includes('limit')) {
    return 'SELL_RISK_LIMIT_TRIGGERED';
  }
  return 'SELL_REBALANCE_SIGNAL_CONFIRMED';
}

export function reasonCodeForSkippedTrade(reason: string): string {
  const text = reason.toLowerCase();
  if (text.includes('minimum trade size')) return 'HOLD_GUARDRAIL_MIN_TRADE_SIZE';
  if (text.includes('cost') || text.includes('too high')) return 'HOLD_GUARDRAIL_COST_TOO_HIGH';
  if (text.includes('turnover')) return 'HOLD_GUARDRAIL_TURNOVER_LIMIT';
  if (text.includes('trades per run')) return 'HOLD_GUARDRAIL_MAX_TRADES';
  if (text.includes('liquidity')) return 'HOLD_LIQUIDITY_BELOW_MINIMUM';
  if (text.includes('spread')) return 'HOLD_SPREAD_TOO_WIDE';
  if (text.includes('history') || text.includes('data')) return 'HOLD_MARKET_DATA_INSUFFICIENT';
  if (text.includes('trend')) return 'HOLD_TREND_NOT_CONFIRMED';
  if (text.includes('momentum')) return 'HOLD_MOMENTUM_WEAK';
  if (text.includes('overextended') || text.includes('overbought')) return 'HOLD_OVEREXTENDED';
  if (text.includes('volatility')) return 'HOLD_VOLATILITY_TOO_HIGH';
  if (text.includes('loss limit')) return 'HOLD_DAILY_LOSS_LIMIT_REACHED';
  if (text.includes('kill switch')) return 'HOLD_KILL_SWITCH_ENABLED';
  return 'HOLD_GUARDRAIL_BLOCKED';
}
