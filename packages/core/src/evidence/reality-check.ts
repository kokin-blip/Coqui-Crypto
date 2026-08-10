/** Situation-aware risk notices. Advisory only; execution guards remain authoritative. */

export type RealityNoticeKind =
  | 'portfolio_too_small'
  | 'fee_drag'
  | 'edge_unproven'
  | 'short_history'
  | 'concentration'
  | 'paper_vs_live'
  | 'tax_friction';

export type RealityNoticeSeverity = 'warn' | 'info';

export interface RealityNotice {
  kind: RealityNoticeKind;
  severity: RealityNoticeSeverity;
  title: string;
  body: string;
}

export interface RealityCheckInput {
  /** Live value of the real portfolio (not the paper wallet), USD. */
  portfolioValueUsd: number;
  /** Guardrail minimum useful trade size, USD. */
  minTradeUsd: number;
  /** Round-trip cost assumption in basis points. */
  roundTripCostBps: number;
  /** Rebalance cadence in days. */
  rebalanceEveryDays: number;
  /** Largest single-asset weight, 0-1; null if unknown or empty. */
  topAssetWeight: number | null;
  /** Symbol of the largest asset, for display only. */
  topAssetSymbol: string | null;
  significanceVerdict: 'significant' | 'inconclusive' | 'no_edge' | 'insufficient_data' | null;
  /** Tradeable days judged; null when unknown. */
  backtestDays: number | null;
  /** Whether auto/paper trading is armed. */
  paperArmed: boolean;
}

/** A typical rebalance leg is approximately 5% of the portfolio. */
export function smallPortfolioFloorUsd(minTradeUsd: number): number {
  return minTradeUsd / 0.05;
}

const CONCENTRATION_WARN_WEIGHT = 0.7;
const SHORT_HISTORY_DAYS = 365;
const round = (value: number): number => Math.round(value);

/** Build notices for the user's current situation, most severe first. */
export function realityCheckNotices(input: RealityCheckInput): RealityNotice[] {
  const notices: RealityNotice[] = [];
  const value = Math.max(0, input.portfolioValueUsd);
  const floor = smallPortfolioFloorUsd(Math.max(1, input.minTradeUsd));

  if (value > 0 && value < floor) {
    notices.push({
      kind: 'portfolio_too_small',
      severity: 'warn',
      title: `At $${round(value)}, no strategy can make real money here yet`,
      body:
        `A typical rebalance trade on this portfolio is under the $${round(input.minTradeUsd)} minimum useful size, ` +
        `so most moves get skipped - and the ones that fire lose ~${(input.roundTripCostBps / 100).toFixed(1)}% to fees/spread each way. ` +
        `Below roughly $${round(floor)}, regular contributions (DCA) grow the account far more than any strategy choice. ` +
        `The paper wallet is still great for learning which strategy you'd trust later.`,
    });
  } else if (value > 0) {
    const eventsPerYear = 365 / Math.max(1, input.rebalanceEveryDays);
    const estimatedAnnualDragPct = (0.1 * eventsPerYear * input.roundTripCostBps) / 100;
    if (estimatedAnnualDragPct >= 2) {
      notices.push({
        kind: 'fee_drag',
        severity: 'info',
        title: `Trading costs could eat ~${estimatedAnnualDragPct.toFixed(1)}%/yr at this cadence`,
        body:
          `Rebalancing every ${input.rebalanceEveryDays}d at ~${(input.roundTripCostBps / 100).toFixed(1)}% per trade adds up. ` +
          `The backtests charge these costs, but a live edge has to beat them first - slower cadences and the drift band exist to keep this down.`,
      });
    }
  }

  if (input.significanceVerdict && input.significanceVerdict !== 'significant') {
    notices.push({
      kind: 'edge_unproven',
      severity: 'warn',
      title: 'The leading strategy is not yet proven to be a real edge',
      body:
        'The scoreboard leader has not cleared the deflated-Sharpe bar (>=95%), so its lead could still be luck from racing several strategies. ' +
        'That is exactly why live trading stays off: paper results accumulate evidence, they do not promise profit.',
    });
  }

  if (input.backtestDays !== null && input.backtestDays > 0 && input.backtestDays < SHORT_HISTORY_DAYS) {
    notices.push({
      kind: 'short_history',
      severity: 'info',
      title: `Only ${input.backtestDays} days of aligned history for your mix`,
      body:
        'One of your coins has a short Coinbase price history, so every strategy is judged on a window that may not include both a bull and a bear market. ' +
        'Treat the rankings as provisional until the window spans a full cycle.',
    });
  }

  if (
    input.topAssetWeight !== null &&
    input.topAssetWeight >= CONCENTRATION_WARN_WEIGHT &&
    input.topAssetSymbol
  ) {
    notices.push({
      kind: 'concentration',
      severity: 'info',
      title: `${input.topAssetSymbol} is ${Math.round(input.topAssetWeight * 100)}% of your portfolio`,
      body:
        `With one asset dominating, your results are mostly that coin's results - diversification and the strategy overlays can only do so much. ` +
        `The Allocation tab's risk-parity/HRP suggestions spread risk more evenly if that's what you want.`,
    });
  }

  if (input.paperArmed) {
    notices.push({
      kind: 'paper_vs_live',
      severity: 'info',
      title: 'Paper fills are estimates - live results would differ',
      body:
        'The simulator charges conservative fees, spread, and slippage, but real orders face real order books, partial fills, and timing gaps. ' +
        'A strategy that wins on paper by less than its cost assumptions might not win live.',
    });
  }

  if (value >= smallPortfolioFloorUsd(Math.max(1, input.minTradeUsd))) {
    notices.push({
      kind: 'tax_friction',
      severity: 'info',
      title: 'Every live sell would be a taxable event',
      body:
        'Tactical strategies trade more than buy-and-hold, and gains on positions held under a year are taxed at the higher short-term rate. ' +
        'What matters is after-tax return - the Tax tab tracks lots and harvestable losses for exactly this reason.',
    });
  }

  return notices.sort((left, right) =>
    left.severity === right.severity ? 0 : left.severity === 'warn' ? -1 : 1,
  );
}
