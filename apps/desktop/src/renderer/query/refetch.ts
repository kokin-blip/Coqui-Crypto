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
  'alpaca.paper.status': { refetchIntervalMs: false, staleTimeMs: 30 * SECOND },
  'alpaca.paper.connect': { refetchIntervalMs: false, staleTimeMs: 0 },
  'alpaca.paper.refresh': { refetchIntervalMs: false, staleTimeMs: 0 },
  'alpaca.paper.disconnect': { refetchIntervalMs: false, staleTimeMs: 0 },
  'parallel.paper.status': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  'parallel.paper.start': { refetchIntervalMs: false, staleTimeMs: 0 },
  'parallel.paper.pause': { refetchIntervalMs: false, staleTimeMs: 0 },
  'parallel.paper.resume': { refetchIntervalMs: false, staleTimeMs: 0 },
  'parallel.paper.stop': { refetchIntervalMs: false, staleTimeMs: 0 },
  'decision.timeline': { refetchIntervalMs: 30_000, staleTimeMs: 15_000 },
  'decision.detail': { refetchIntervalMs: false, staleTimeMs: Infinity },
  'accounts.coinbase.status': { refetchIntervalMs: false, staleTimeMs: 30 * SECOND },
  'accounts.coinbase.connect': { refetchIntervalMs: false, staleTimeMs: 0 },
  'accounts.coinbase.connect-json': { refetchIntervalMs: false, staleTimeMs: 0 },
  'accounts.coinbase.disconnect': { refetchIntervalMs: false, staleTimeMs: 0 },
  'accounts.coinbase.sync': { refetchIntervalMs: false, staleTimeMs: 0 },
  'connections.list': { refetchIntervalMs: false, staleTimeMs: 30 * SECOND },
  'connections.status': { refetchIntervalMs: false, staleTimeMs: 30 * SECOND },
  'connections.connect-file': { refetchIntervalMs: false, staleTimeMs: 0 },
  'connections.robinhood.keypair.begin': { refetchIntervalMs: false, staleTimeMs: 0 },
  'connections.robinhood.keypair.status': { refetchIntervalMs: false, staleTimeMs: 0 },
  'connections.robinhood.keypair.complete': { refetchIntervalMs: false, staleTimeMs: 0 },
  'connections.robinhood.keypair.cancel': { refetchIntervalMs: false, staleTimeMs: 0 },
  'connections.rename': { refetchIntervalMs: false, staleTimeMs: 0 },
  'connections.disconnect': { refetchIntervalMs: false, staleTimeMs: 0 },
  'connections.sync': { refetchIntervalMs: false, staleTimeMs: 0 },
  'portfolio.current': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  'portfolio.history': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  'app.chart.snapshot.save': { refetchIntervalMs: false, staleTimeMs: 0 },
  'app.chart.workspace': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'app.chart.workspace.set': { refetchIntervalMs: false, staleTimeMs: 0 },
  'advisor.providers': { refetchIntervalMs: false, staleTimeMs: 30 * SECOND },
  'advisor.provider.connect': { refetchIntervalMs: false, staleTimeMs: 0 },
  'advisor.provider.connect-copied': { refetchIntervalMs: false, staleTimeMs: 0 },
  'advisor.provider.verify': { refetchIntervalMs: false, staleTimeMs: 0 },
  'advisor.provider.disconnect': { refetchIntervalMs: false, staleTimeMs: 0 },
  'advisor.context.prepare': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'advisor.facts.generate': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'advisor.chat.send': { refetchIntervalMs: false, staleTimeMs: 0 },
  'advisor.chat.history': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'advisor.chat.history.delete': { refetchIntervalMs: false, staleTimeMs: 0 },
  'advisor.chat.history.export': { refetchIntervalMs: false, staleTimeMs: 0 },
  'advisor.decision.explain': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'advisor.evidence.explain': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'advisor.navigation': { refetchIntervalMs: false, staleTimeMs: 0 },
  'chart-extensions.catalog': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'chart-extensions.signer.trust': { refetchIntervalMs: false, staleTimeMs: 0 },
  'chart-extensions.signer.remove': { refetchIntervalMs: false, staleTimeMs: 0 },
  'chart-extensions.install': { refetchIntervalMs: false, staleTimeMs: 0 },
  'chart-extensions.install.pick': { refetchIntervalMs: false, staleTimeMs: 0 },
  'chart-extensions.set': { refetchIntervalMs: false, staleTimeMs: 0 },
  'chart-extensions.remove': { refetchIntervalMs: false, staleTimeMs: 0 },
  'chart-extensions.evaluate': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'paper.campaign': { refetchIntervalMs: 60_000, staleTimeMs: 30_000 },
  'paper.campaign.kill-switch': { refetchIntervalMs: false, staleTimeMs: Infinity },
  'paper.campaign.connections': { refetchIntervalMs: false, staleTimeMs: 30_000 },
  'paper.campaign.connections.start': { refetchIntervalMs: false, staleTimeMs: 0 },
  'activity.feed': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  'operations.floor': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  // Profile metadata changes only through explicit account commands.
  'accounts.profiles': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'accounts.profile.switch': { refetchIntervalMs: false, staleTimeMs: 0 },
  'paper.execution.policy': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'paper.execution.policy.set': { refetchIntervalMs: false, staleTimeMs: 0 },
  'paper.execution.proposals': { refetchIntervalMs: 30 * SECOND, staleTimeMs: 10 * SECOND },
  'paper.execution.proposal': { refetchIntervalMs: 30 * SECOND, staleTimeMs: 10 * SECOND },
  'paper.execution.prepare': { refetchIntervalMs: false, staleTimeMs: 0 },
  'paper.execution.review': { refetchIntervalMs: false, staleTimeMs: 0 },
  'paper.performance': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  'paper.performance-day': { refetchIntervalMs: false, staleTimeMs: 30 * SECOND },
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
  // The renderer reads a bounded main-process cache. It never owns the socket.
  'market-data.live': { refetchIntervalMs: SECOND, staleTimeMs: SECOND },
  'market-data.products': { refetchIntervalMs: false, staleTimeMs: 30 * MINUTE },
  'market-data.coinbase-diagnostics': { refetchIntervalMs: 30 * SECOND, staleTimeMs: 30 * SECOND },
  'market-data.display-bars': { refetchIntervalMs: false, staleTimeMs: MINUTE },
  'market-data.live-candles': { refetchIntervalMs: SECOND, staleTimeMs: SECOND },
  'market-events.ingest-local': { refetchIntervalMs: false, staleTimeMs: 0 },
  'market-events.ingest-file': { refetchIntervalMs: false, staleTimeMs: 0 },
  'market-events.timeline': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  // Research runs are immutable once written.
  'research.runs': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'research.lineage': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'research.trigger-status': { refetchIntervalMs: 30 * SECOND, staleTimeMs: 10 * SECOND },
  'research.candidate.review': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'research.candidate.rollback': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'research.edge-study': { refetchIntervalMs: 5 * MINUTE, staleTimeMs: 2 * MINUTE },
  'research.performance': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
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
  // Derived from the same snapshots the portfolio reads, so it moves when they
  // do and no faster.
  'risk.dashboard': { refetchIntervalMs: 5 * MINUTE, staleTimeMs: 2 * MINUTE },
  // Written by the same background work the alerts come from.
  'app.incidents': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  // Alerts are produced by the scheduler, which wakes at most once a minute.
  'alerts.view': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  // A write. It is never polled — it runs when the user decides — but the
  // registry requires a policy for every channel, and stating "never" here is
  // better than exempting writes and losing the completeness check.
  'portfolio.reconciliation.resolve': { refetchIntervalMs: false, staleTimeMs: 0 },
  // Reprices with the market, alongside the real portfolio it sits next to.
  'paper.portfolio': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  'paper.exploratory.status': { refetchIntervalMs: 30 * SECOND, staleTimeMs: 10 * SECOND },
  'paper.exploratory.start': { refetchIntervalMs: false, staleTimeMs: 0 },
  'paper.exploratory.pause': { refetchIntervalMs: false, staleTimeMs: 0 },
  'paper.exploratory.resume': { refetchIntervalMs: false, staleTimeMs: 0 },
  'paper.exploratory.stop': { refetchIntervalMs: false, staleTimeMs: 0 },
  'paper.exploratory.evaluate-now': { refetchIntervalMs: false, staleTimeMs: 0 },
  'paper.exploratory.portfolio': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  'paper.exploratory.performance': { refetchIntervalMs: 60 * SECOND, staleTimeMs: 30 * SECOND },
  // Preferences change only when the user changes them.
  'accounts.settings': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'accounts.settings.set': { refetchIntervalMs: false, staleTimeMs: 0 },
  'accounts.workspace': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'accounts.workspace.set': { refetchIntervalMs: false, staleTimeMs: 0 },
  'app.status-rail': { refetchIntervalMs: 30 * SECOND, staleTimeMs: 10 * SECOND },
  'app.person': { refetchIntervalMs: false, staleTimeMs: Number.POSITIVE_INFINITY },
  'app.person.set': { refetchIntervalMs: false, staleTimeMs: 0 },
  'app.onboarding.status': { refetchIntervalMs: false, staleTimeMs: 15 * SECOND },
  'app.onboarding.skip': { refetchIntervalMs: false, staleTimeMs: 0 },
  'app.onboarding.restart': { refetchIntervalMs: false, staleTimeMs: 0 },
  'app.onboarding.complete': { refetchIntervalMs: false, staleTimeMs: 0 },
  'app.profile-readiness': { refetchIntervalMs: 30 * SECOND, staleTimeMs: 10 * SECOND },
};

/** Total polls per hour across every channel, for the review in UI-UX §5. */
export function pollsPerHour(): number {
  return Object.values(CHANNEL_POLICIES).reduce((total, policy) => {
    if (policy.refetchIntervalMs === false) return total;
    return total + Math.round((60 * MINUTE) / policy.refetchIntervalMs);
  }, 0);
}
