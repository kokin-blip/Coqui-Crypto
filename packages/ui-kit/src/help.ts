/**
 * In-app help copy.
 *
 * Ported from the predecessor's `src/app/renderer/src/help.ts` (335 lines, 74
 * entries) — real explanatory writing worth keeping, so this is a port rather
 * than a rewrite. It is **filtered**, not copied wholesale:
 *
 * - Entries for surfaces Coqui rejected or has not built are dropped, not
 *   stubbed: social consensus, auto-apply-to-paper, chart playback, the bot
 *   tab, mix suggestions, recommendations.
 * - The predecessor's `wallet` entry said on-chain imports "start at $0 cost;
 *   set it manually if you want gain tracking". That describes inventing a
 *   zero-basis lot, which **invariant 12 forbids**. It is removed rather than
 *   reworded, because the feature it documents would itself be a defect.
 * - `paperBacktest` claimed a simulation "ignores fees, slippage, and taxes",
 *   contradicting invariant 4 (cost pessimism is load-bearing) and invariant 10
 *   (no gross return is ever displayed). It returns with the paper engine in
 *   P6, written against what Coqui actually computes.
 * - The evidence-gate copy quoted the predecessor's bar (365 tradeable days).
 *   Coqui's gate is 90 observed days / 50 decisions / 30 fills, so that entry
 *   is rewritten rather than carried.
 * - Product naming is Coqui throughout.
 *
 * This is data, not a component, which is why it lives here: under
 * `apps/desktop/src/renderer` it would breach the 300-line component cap.
 */

export interface HelpEntry {
  readonly title: string;
  readonly body: string;
}

export const HELP: Readonly<Record<string, HelpEntry>> = Object.freeze({
  // ── Allocation ──
  target: {
    title: 'Target weight',
    body: 'The share of your portfolio you want a coin to be. Your targets should add up to 100%.',
  },
  drift: {
    title: 'Drift',
    body:
      'How far a holding is from its target, in percentage points (pp). +5pp means it is 5 ' +
      'points heavier than you intended (overweight); −5pp means lighter (underweight).',
  },
  rebalanceBand: {
    title: 'Rebalance band',
    body:
      'How much drift you tolerate before a holding is flagged to rebalance. A ±5pp band ' +
      'ignores small wiggles and only acts on meaningful drift.',
  },
  turnover: {
    title: 'Turnover',
    body:
      'The total dollar value the suggested plan would buy and sell to get back to target. ' +
      'Lower turnover means fewer and smaller moves — and less cost.',
  },
  maxDrift: {
    title: 'Max drift',
    body: 'The single worst-off holding in the plan — the largest gap from its target.',
  },
  estimateOnly: {
    title: 'Estimate only',
    body:
      'This plan is a suggestion. Coqui does not place trades and cannot move your money — ' +
      'there is no order-submission path in this build. It shows what rebalancing back to ' +
      'your targets would look like, nothing more.',
  },

  // ── Portfolio ──
  lot: {
    title: 'Lot',
    body:
      'One purchase of a coin — a quantity bought at a cost on a date. Tracking lots ' +
      'separately keeps your cost basis and tax accurate. A position is the sum of its open lots.',
  },
  costBasis: {
    title: 'Cost basis',
    body: 'What you paid for what you hold, fees included. Your gain is current value minus this.',
  },
  avgCost: {
    title: 'Average cost',
    body: 'Your blended cost per unit across all open lots of a coin.',
  },
  unrealizedPnl: {
    title: 'Unrealised P&L',
    body:
      'Paper profit or loss on what you still hold — current value minus cost basis. It is ' +
      'not locked in until you sell.',
  },
  allocation: {
    title: 'Allocation',
    body:
      'How your value is split across coins right now. Set targets on the Allocation screen ' +
      'to track drift against a plan.',
  },
  pricedSubtotal: {
    title: 'Priced subtotal',
    body:
      'When a holding has no price, Coqui cannot value it — so the total shown is the sum of ' +
      'the holdings it could price, not your complete equity. It says so rather than quietly ' +
      'leaving the position out, because a total wrong by an unknown amount is worse than one ' +
      'labelled incomplete.',
  },
  reconciliationException: {
    title: 'Reconciliation exception',
    body:
      'The exchange and your ledger disagree about a balance. Coqui will not close the gap by ' +
      'inventing a tax lot or rescaling existing ones — that would fabricate a cost basis and ' +
      'corrupt your tax record. It stays open until you decide what actually happened.',
  },

  // ── Tax ──
  costBasisMethod: {
    title: 'Cost-basis method',
    body:
      'How a sale is matched to what you bought, which changes the reported gain. FIFO sells ' +
      'oldest lots first, LIFO newest first, HIFO highest-cost first (usually the smallest ' +
      'gain), and Average blends one cost across all lots.',
  },
  realizedPnl: {
    title: 'Realised P&L',
    body:
      'Profit or loss you have locked in by selling — proceeds minus the cost basis of what ' +
      'you sold. Unrealised P&L, by contrast, is paper gains on what you still hold.',
  },
  term: {
    title: 'Short- vs long-term',
    body:
      'Lots held over one year are long-term; under a year are short-term. Many jurisdictions ' +
      'tax them differently, so a sale is split across the one-year line.',
  },
  proceeds: {
    title: 'Proceeds',
    body: 'The total dollars you received from the sale, after fees.',
  },
  taxEstimate: {
    title: 'Why these are estimates',
    body:
      'Coqui computes disposals from its own lots using the cost-basis method you chose. It ' +
      'does not know your jurisdiction, your bracket, or your other income, and it does not ' +
      'handle the wash-sale rule. This is a working record, not a tax return.',
  },
  harvest: {
    title: 'Tax-loss harvesting',
    body:
      'Coins worth less than you paid. Selling one realises that loss, which can offset ' +
      'realised gains. Coqui only shows what is down — it does not handle the 30-day ' +
      'wash-sale rule and it is not tax advice.',
  },

  // ── Evidence and risk ──
  maxDrawdown: {
    title: 'Max drawdown',
    body:
      'The deepest drop from a peak to a later low over the tracked window. A read on how ' +
      'rough the ride got.',
  },
  sharpe: {
    title: 'Sharpe ratio',
    body:
      'Return earned per unit of total risk — volatility both up and down. Higher is better. ' +
      'It is the classic risk-adjusted score, and the one the significance test is built on.',
  },
  sortino: {
    title: 'Sortino ratio',
    body:
      'Return earned per unit of downside risk; it ignores upside swings. Higher is better. ' +
      'A blank value means the window had no downside deviation at all, which is not the ' +
      'same as zero.',
  },
  calmar: {
    title: 'Calmar ratio',
    body:
      'Annual return divided by the worst drawdown. How much growth you got for the pain of ' +
      'the deepest dip.',
  },
  walkForward: {
    title: 'Out-of-sample (walk-forward)',
    body:
      'A fair test of the whole idea of picking a leader. History is split into chunks; for ' +
      'each later chunk we pick whichever strategy was best BEFORE it, with no peeking ahead, ' +
      'then bank what that pick actually did. Stitched together, that is what chasing the ' +
      'leader would really have earned.',
  },
  significance: {
    title: 'Significance — is the leader real?',
    body:
      'Race several strategies over a short window and the winner is flattered by luck; ' +
      'someone always looks best. Two statistics push back. PSR is the chance the leader’s ' +
      'true Sharpe is above zero given sample size, skew and fat tails. DSR is stricter: the ' +
      'chance it beats what the luckiest of this many attempts would score by chance alone.',
  },
  trialUpperBound: {
    title: 'Why DSR says “upper bound”',
    body:
      'Deflated Sharpe has to be told how many strategy variants were tried. Coqui recovered ' +
      '215 from the predecessor’s history, but cannot prove that is exactly all of them — ' +
      'so it deflates against 215 as an upper bound. Over-counting can only make a result ' +
      'look worse, never better, so a figure that clears here clears at the true count too.',
  },
  notValidated: {
    title: 'Not validated',
    body:
      'The strategy parameters in this build are legacy defaults. The study run to replace ' +
      'them came back negative on its own pre-declared criteria, so nothing has earned the ' +
      'right to be called validated. The numbers are shown because hiding them would be ' +
      'worse, not because they are proven.',
  },
  negativeFindings: {
    title: 'Negative findings',
    body:
      'Ideas that were tested and did not earn a place in the defaults. Each one is a result, ' +
      'not a gap — knowing that rotation, sentiment overlays and daily-bar machine learning ' +
      'were tried and rejected is worth more than a shorter list of things that seemed to work.',
  },
  evidenceGate: {
    title: 'Evidence gate',
    body:
      'What a strategy would have to show before live trading could even be discussed: ' +
      '90 observed days, 50 decisions and 30 fills of forward paper evidence, beating both ' +
      'hold and passive, and clearing deflated Sharpe. Meeting the gate does not enable live ' +
      'trading — this build has no order-submission path at all. It only makes the ' +
      'conversation reasonable.',
  },
  realityCheck: {
    title: 'Reality check',
    body:
      'Honest caveats the numbers alone will not tell you: whether your portfolio is large ' +
      'enough for a strategy to beat fees and trade minimums, whether the leader has proven ' +
      'itself statistically, how concentrated you are, and what a simulation cannot capture. ' +
      'Nothing here blocks anything — the guardrails in code do that.',
  },
  killSwitch: {
    title: 'Kill switch',
    body: 'Immediately halts all automated activity, including paper. A stop you can hit any time.',
  },
  costModel: {
    title: 'Cost model',
    body:
      'Every backtest, simulated fill and preview charges the same fees, spread and slippage — ' +
      'about 85 basis points round trip. It is deliberately pessimistic. A strategy that only ' +
      'works with cheaper assumptions does not work.',
  },

  // ── Markets and data ──
  fearGreed: {
    title: 'Fear & Greed Index',
    body:
      'A 0–100 read on overall crypto-market sentiment from alternative.me: low is fear, high ' +
      'is greed. A mood gauge for a person reading a screen — it is not a trading signal and ' +
      'nothing in Coqui acts on it.',
  },
  trendingSearches: {
    title: 'Trending searches',
    body:
      'What people are looking up on CoinGecko right now. That is attention, not performance, ' +
      'and the two are frequently unrelated. Informational only.',
  },
  freshness: {
    title: 'Data freshness',
    body:
      'How long ago a figure was observed. Some free sources publish a price with no ' +
      'timestamp at all — those show as “no timestamp” rather than as fresh, because Coqui ' +
      'will not claim a freshness it cannot observe.',
  },
  dataSources: {
    title: 'Data sources',
    body:
      'Prices come from free public sources — Coinbase first as the venue of record, with ' +
      'CoinGecko filling gaps. Reference prices never replace Coinbase bars in a decision. ' +
      'No paid keys are required.',
  },
  coinbaseKey: {
    title: 'Coinbase connection',
    body:
      'A read-only API key lets Coqui import your real balances as evidence. It is stored in ' +
      'your operating system’s credential store and never leaves this machine. Coqui ' +
      'refuses any key carrying trade or transfer permission — it will not hold a credential ' +
      'that could move money.',
  },
  provenance: {
    title: 'Provenance',
    body:
      'Where a number came from: which dataset, which code revision, which cost model, and ' +
      'how many strategy variants were tried. A figure without provenance is an unsourced ' +
      'claim, so Coqui shows it inline rather than hiding it behind a hover.',
  },
});

/** Look up help copy, or `null` when a key has no entry. */
export function helpEntry(key: string): HelpEntry | null {
  return Object.hasOwn(HELP, key) ? (HELP[key] as HelpEntry) : null;
}
