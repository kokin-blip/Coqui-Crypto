import type { ChannelName } from '@coqui/contracts';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/**
 * Every refetch interval in the application, in one table.
 *
 * `CLAUDE.md` §4 forbids a component from owning a `setInterval`, and
 * `docs/PLAN.md` §6 names the reason: the predecessor had 19 independent
 * component timers and no shared cache, which is the specific problem this
 * repository exists to avoid. A per-component timer is invisible — you cannot
 * see the polling load of a screen by reading it. A single table can be read,
 * reviewed, and totalled.
 *
 * Intervals are matched to each feed's publication cadence, not to how fresh a
 * screen would like to look. Polling a daily index every thirty seconds does not
 * make it fresher; it just spends a free-tier budget.
 */
export interface ChannelPolicy {
  /** How often to refetch while the query is mounted and the window focused. */
  readonly refetchIntervalMs: number | false;
  /** How long a cached value is served without a background refetch. */
  readonly staleTimeMs: number;
}

export const CHANNEL_POLICIES: Readonly<Record<ChannelName, ChannelPolicy>> = {
  // Reference prices move continuously, and this is the figure a user watches.
  'market-data.prices': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  'market-data.markets': { refetchIntervalMs: 5 * MINUTE, staleTimeMs: 2 * MINUTE },
  // alternative.me publishes once a day; polling faster returns the same row.
  'market-data.fear-greed': { refetchIntervalMs: 30 * MINUTE, staleTimeMs: 15 * MINUTE },
  'market-data.trending': { refetchIntervalMs: 15 * MINUTE, staleTimeMs: 10 * MINUTE },
  // DefiLlama's pool payload is large and its APYs move slowly.
  'market-data.yields': { refetchIntervalMs: 6 * 60 * MINUTE, staleTimeMs: 60 * MINUTE },
  'market-data.news': { refetchIntervalMs: 30 * MINUTE, staleTimeMs: 15 * MINUTE },
  // Daily bars only change when a day closes. Polling is pointless; the user
  // refetches by changing the range, which changes the query key.
  'market-data.candles': { refetchIntervalMs: false, staleTimeMs: 60 * MINUTE },
  // Research runs are immutable once written.
  'research.runs': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'research.jobs': { refetchIntervalMs: 30 * SECOND, staleTimeMs: 10 * SECOND },
  // A study run is immutable once written; a new one arrives only when a study
  // is executed, which is a deliberate operator action.
  'research.scoreboard': { refetchIntervalMs: false, staleTimeMs: 5 * MINUTE },
  // Compiled-in data. It changes when the application does, never at runtime.
  'research.negative-findings': {
    refetchIntervalMs: false,
    staleTimeMs: Number.POSITIVE_INFINITY,
  },
  'research.job': { refetchIntervalMs: 30 * SECOND, staleTimeMs: 10 * SECOND },
  // The gate moves when a new evidence snapshot is written, which happens at
  // most daily. It is polled at all only so a long-running window notices.
  'risk.evidence-gate': { refetchIntervalMs: 5 * MINUTE, staleTimeMs: 2 * MINUTE },
  // The rail is the "is anything wrong right now" surface, so it is the one
  // thing polled briskly — a kill switch that engaged four minutes ago must not
  // still read as armed.
  // Holdings reprice with the market; the user watches this figure.
  'portfolio.view': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  // Exceptions change only when a sync runs.
  'portfolio.reconciliation': { refetchIntervalMs: 5 * MINUTE, staleTimeMs: 2 * MINUTE },
  // Drift moves with prices, so allocation follows the portfolio cadence.
  'portfolio.allocation': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  // Disposals change only when the user records a sale.
  'portfolio.tax': { refetchIntervalMs: false, staleTimeMs: 5 * MINUTE },
  // A write. It is never polled — it runs when the user decides — but the
  // registry requires a policy for every channel, and stating "never" here is
  // better than exempting writes and losing the completeness check.
  'portfolio.reconciliation.resolve': { refetchIntervalMs: false, staleTimeMs: 0 },
  // Reprices with the market, alongside the real portfolio it sits next to.
  'paper.portfolio': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  // Preferences change only when the user changes them.
  'accounts.settings': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'app.status-rail': { refetchIntervalMs: 30 * SECOND, staleTimeMs: 10 * SECOND },
};

/** Total polls per hour across every channel, for the review in UI-UX §5. */
export function pollsPerHour(): number {
  return Object.values(CHANNEL_POLICIES).reduce((total, policy) => {
    if (policy.refetchIntervalMs === false) return total;
    return total + Math.round((60 * MINUTE) / policy.refetchIntervalMs);
  }, 0);
}
