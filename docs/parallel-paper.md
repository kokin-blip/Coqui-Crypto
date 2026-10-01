# Parallel TrendVol paper experiment

This is a paper-only experiment. Coinbase remains read-only. Coqui copies a fresh, complete Coinbase portfolio **USD value** into a new cash-only local simulator; it does not copy Coinbase holdings or obtain Coinbase trading authority. Alpaca uses the dedicated paper account's actual USD cash and equity. TrendVol v4.2 still computes targets from completed Coinbase UTC daily bars. The local leg remains a daily-fill baseline; Alpaca can also rebalance toward that same daily target during the day. Their order timing, fills, and balances can differ, so the displayed returns are no longer execution-matched.

The daily dataset requests up to 400 days of historical Coinbase candles on refresh, so its 121-bar minimum does not require 121 days of app uptime. A connected view-only Coinbase key makes the authenticated Advanced Trade candle route primary; a failed or unavailable authenticated request falls back to the public Coinbase Exchange candle route. Both routes retain completed-bar filtering and strict alignment. If both candle requests fail, the paper feed may reuse the locally stored dataset only when it still contains the expected completed bar, at least 121 aligned days, and no gaps. Partial results from a failed refresh are not persisted. Endpoint, product, interval, HTTP status, and failure reason are logged without credentials. Temporary Alpaca read failures now retry on later scheduler checks after order reconciliation; the API must respond before new orders can be submitted.

## Setup

1. Create a dedicated, empty Alpaca paper account and obtain its **paper** API key ID and secret. In Coqui Settings → Connections → Alpaca Paper, enter the pair. Coqui verifies it with `GET /v2/account` on the hardcoded `https://paper-api.alpaca.markets/v2` endpoint before storing it in the OS secret store. The fields are cleared after submission; the values necessarily pass through the form briefly. The app exposes no live Alpaca endpoint.
2. Sync a Coinbase read-only account and confirm its latest snapshot is complete, healthy, and less than 24 hours old. The Alpaca paper account must have USD cash and no positions or open orders. Coqui will not reset, liquidate, or seed that external account.

The Coinbase snapshot sizes only the optional local comparison book; it does not fund Alpaca. Any positive, fully valued Coinbase snapshot can start the experiment. Alpaca orders use only the separate Alpaca paper account's cash and venue limits.
3. Before unattended use, submit a small *paper* test order and verify its order ID, fill/partial-fill activity, position, and cash independently in the Alpaca API and dashboard. This integration's automated tests use mocks; they do not substitute for that live-paper smoke check. If the test leaves a position or open order, use a separate clean paper account for the experiment.
4. In Settings → Paper, attest that the independent smoke check is complete and explicitly start the parallel experiment. The daily scheduler will thereafter send Alpaca **paper** orders; pause or stop from the same panel. Stop requests cancellation of outstanding experiment orders and keeps existing paper holdings. Disconnecting Alpaca removes the stored keys and pauses the experiment without deleting its ledger.

The legacy seven-day campaign exercise is only a research record. It does not stop either paper simulator or the separate Alpaca paper account, and acknowledging its record is not required to start this experiment. Older profiles may still store an active `campaign_exercise` stop; execution and status ignore that historical marker. Explicit operator stops and risk hard stops remain separate controls, as do the Alpaca order and reconciliation safeguards.

## Reading activity and results

Paper Trading → Overview leads with **Alpaca paper activity**. It shows the most recent scheduler check and completed-bar decision, the TrendVol inputs and target weights, and up to 20 recent recorded events. Planned orders, submission attempts, Alpaca-reported order states, fills, no-trade outcomes, daily window misses, intraday checks, and pauses have distinct labels. Alpaca order IDs can be compared with the linked paper dashboard. A planned or submitted order is not presented as a fill. The status distinguishes waiting for a completed daily bar, an in-progress check, pending order activity, an intraday monitoring state, a user pause, and an attention state. A scheduler check more than three minutes old is marked overdue. The check timestamp is runtime-only and starts empty when Coqui opens; the decision and order history comes from the append-only experiment ledger.

The September 28 owner screenshot showed `Alpaca activity unavailable · invalid_response_payload` after reconciliation read failures had entered the ledger. The service projected those failures as `retry` activity, but the response contract omitted that activity kind; the same omission applied to `fee` rows. Beta.11 accepts both and has service-to-contract regression tests. This was a display validation failure, not evidence that the existing Alpaca holdings or ledger were deleted. Coinbase market context has a separate request and its unavailable cards in that screenshot do not establish why the Alpaca status failed.

The September 29 screenshot showed a later `Alpaca reconciliation read failed · alpaca_unavailable` entry. While Coqui remains open, the desktop scheduler retries reconciliation on its next one-minute tick. The current code also retries an idempotent Alpaca GET once immediately after a network failure or HTTP 5xx; it never automatically retries order writes. A successful read can clear a transient pause when its original cause is recoverable and current daily market data is valid. A non-transient or user pause stays in place. Retry activity now includes the safe Alpaca operation and HTTP status, or identifies a network/timeout failure, to distinguish account, order, quote, and activity reads. The screenshot's separate status-rail label `reconcile never run` refers to Coqui's portfolio reconciliation view; it is not the Alpaca broker reconciliation event shown in the activity list.

The experimental beta.12 release is [building](https://github.com/kokin-blip/Coqui-Crypto/releases/tag/experimental-v0.1.0-beta.12). Release CI verifies code, packages macOS Apple Silicon and Windows x64, runs packaged smoke checks, and uploads checksums to a draft release. The packaged-process smoke did not complete on the packaging host: Electron aborted with `SIGABRT` during AppKit application registration, before Coqui's smoke handler ran. The packaged schema/startup check therefore remains unverified on this host. The release is ad-hoc signed, and an actual GUI launch and connected-account checks remain owner checks.

The Overview also shows **Coinbase market context** for BTC-USD, ETH-USD, and
LTC-USD: authenticated best bid/ask, spread, product state, and bounded book
availability with separate timestamps. Markets shows up to ten bid and ask
levels for the selected product. This context is informational only. It does
not affect TrendVol targets or Alpaca paper orders and cannot verify an Alpaca
fill. The adapter includes optional Coinbase product fields (`baseMinSize`,
`auctionMode`, and `isDisabled`); the strict IPC schema now accepts those fields,
which previously could cause a valid snapshot to be rejected as a whole and
render the generic unavailable message. The schema correction passes the compiled verification gates in beta.12; packaged runtime observation remains part of the release workflow.

### Wider-universe breakout research

The `wider-breakout-v1` candidate records independent, long-only shadow targets
at the five intraday slots using the versioned point-in-time Coinbase/Alpaca
universe. It needs 30 consecutive days of completed hourly bars **per asset**
and exact four-hour aggregation; its fixed entry, exit, 15%-per-position and
cost-screen rules are recorded in
[the breakout study](studies/wider-breakout-v1-2026-09-27.md). The hourly
research store is separate from the three-coin ML history. The shadow
portfolio and modeled fills do not change TrendVol's target, Alpaca orders,
or Coqui's existing local comparison book. A separate 60-day development and
90-day untouched holdout will start when the deployed collector first registers
the study. Until complete point-in-time frames accumulate, comparison results
remain unavailable; no backfilled candles are represented as historical
broker eligibility. `pnpm research:breakout-report --database=/path/to/coqui.db`
reads the recorded study and virtual results without placing orders.

### Sideways-market range rotation research

The `wider-range-rotation-v1` candidate uses the same point-in-time eligible
universe and completed hourly research history as the breakout candidate. A
BTC/ETH range gate and frozen lower-range/relative-strength score propose at
most three 10% positions at the five intraday slots. Two-slot confirmation,
modeled costs, and slot/day turnover limits can produce a cash target or no
virtual trade. Its decisions, independent virtual holdings, and blocked exits
are append-only shadow evidence; it has no broker submission authority and
does not alter operational TrendVol orders. A separate prospective 60-day
development and 90-day holdout compare TrendVol, breakout, and range rotation
at matched slots. See `docs/studies/wider-range-rotation-v1-2026-09-27.md` and
the read-only `pnpm research:range-rotation-report --database=/path/to/coqui.db`.

### Shadow market-state selector

`paper-market-selector-v1` now classifies sustained BTC/ETH trend, a fresh
cost-qualified breakout, a stable range, or uncertainty at the five intraday
slots. It chooses one target from unchanged TrendVol, frozen breakout, frozen
range rotation, or cash, with two consecutive slots required to switch. The
00:00 UTC daily record updates TrendVol but carries an eligible intraday target
until 04:00. The selector has its own append-only, profile-scoped virtual book;
neither its targets nor its modeled orders reach Alpaca. Its virtual planner
uses sells before buys and accounts for venue constraints and switching costs.
Pending virtual orders block conflicting replans, and partial virtual fills are
valued by cumulative filled quantity. The normal comparison assumes immediate
virtual fills. See [the frozen selector study](studies/market-selector-v1-2026-09-27.md)
and the read-only `pnpm research:market-selector-report --database=/path/to/coqui.db`.

### Bounded ML signal worker

TrendVol remains the daily baseline. A separate, credential-free worker can
propose a small change to that baseline at the five four-hour Alpaca paper
slots, recorded in shadow only during the execution study. It is **not** an LLM and cannot submit orders. The desktop host obtains
up to 400 days of completed Coinbase hourly BTC-USD, ETH-USD, and LTC-USD
candles through the authenticated view-only candle endpoint, with the public
endpoint as a whole-window fallback. One 300-hour window is fetched per
scheduler check while the experiment is active; completed windows are cached
in a profile-scoped research table. Fetching and model work run in the
background so the daily TrendVol order window is not delayed. The model
process receives only price bars, the UTC time, and a functional-check result.

The frozen `trendvol-ml-ridge-v1` candidate uses four-hour, 24-hour, and
seven-day returns, 24-hour realized volatility, and 24-hour relative return.
It fits a small L2-regularized ridge model and retrains on a trailing 120-day
window at the next UTC weekly boundary. It forecasts the next four-hour
returns, then considers unchanged TrendVol weights, a total-exposure change
of up to 10 percentage points, and a transfer of up to 10 points from the
lowest-scored held asset to the highest. Every asset and aggregate-exposure
change is capped at 10 points. A proposal must have positive predicted
incremental benefit after a modeled **round-trip** cost; otherwise the target
stays unchanged. The model assumes 0.25% taker fees, 0.10% spread, and 0.15%
slippage per side. These are research assumptions, not measured Alpaca paper
fees or the local Coqui simulator's cost settings.

The first sufficiently complete dataset registers one immutable study plan
and a fixed 90-day holdout end date. Historical evaluation requires the
existing 121-day TrendVol warmup plus at least 95% aligned five-slot coverage
in 120 training days, 60 development days, and 90 holdout days. Training uses
only labels known before each historical slot; no missing hourly bars are
filled. Both policies use the same four-hour slots, prices, drift rule, and
cost assumptions. Coqui records holdout net return lift, a two-times-cost
stress, drawdown, turnover, trade count, and a seven-day-block bootstrap
interval. The first complete gate result is frozen. **A positive
cost-adjusted holdout lift together with functional checks qualifies the
research candidate only; this execution study keeps every proposal in shadow.** A changed historical dataset revokes that
qualification until a new candidate is evaluated. Negative or incomplete
evidence leaves ML in shadow mode. Positive historical lift is not a promise
of future returns.

For each intraday slot, the append-only ledger records the model and dataset
hashes, prediction time, gate reason, baseline weights, proposed weights,
combined weights, and whether the proposal was applied. The paper target is always the unchanged TrendVol target, including when an older
slot contains an applied ML proposal. The existing 1% intraday drift, $25 minimum,
asset-quantity, cash, and reconciliation rules still apply. Planned, acknowledged, and
filled Alpaca orders remain distinct. Execution does not wait for the ML worker.
An ML error does not pause the experiment or change the daily TrendVol pass.
Paper Trading → Overview labels the worker's qualification and last slot
separately from confirmed Alpaca activity. The local Coqui comparison book
continues to follow the daily TrendVol baseline.

The evaluation uses completed Coinbase candles and a simplified slot-level
paper simulator. It does not reproduce Alpaca's fill times, partial fills,
quantity increments, or actual fees; those remain separately checked by the
order path and the owner's paper account. The research approach follows the
validation, overfitting, prediction-threshold, and architecture lessons
recorded in [the quant-resources survey](studies/quant-resources-survey-2026-09-26.md).

Verification on 2026-09-26: `pnpm verify` passed after this implementation
(210 test files, 1,327 tests, typecheck, lint, and build). Focused tests cover
deterministic training and prediction, target bounds and no-trade outcomes,
insufficient hourly history, an unqualified holdout, profile-scoped research
storage, frozen study results, authenticated hourly failure followed by public
fallback, and an in-memory ML-to-Alpaca order check with duplicate-slot and
partial-fill behavior. A compiled worker-thread smoke check returned a
well-formed `collecting` result. The earlier isolated Electron Paper Trading Overview
rendered in a throwaway profile with the scheduler disabled; populated ML
states were checked with renderer fixtures. Coinbase and Alpaca endpoint tests
use mocks. No connected owner key was used and no real Alpaca paper order was
submitted in this verification.

Remaining owner checks: confirm the connected view-only Coinbase key serves
hourly history for all three products, let the active desktop app backfill and
register its fixed study, inspect the recorded gate and slot proposal, and
match any resulting Alpaca paper order ID and fill with the Alpaca dashboard.
If the holdout lift is nonpositive or history incomplete, shadow mode is the
expected outcome and TrendVol continues unchanged.

Each new daily decision records whether negative momentum reduced any asset, whether the per-asset volatility scaler reduced any asset, whether portfolio volatility targeting reduced exposure, and whether the trend cap constrained it. The Overview counts days on which each reduction applied across decisions recorded with this evidence. Older ledger decisions do not have filter evidence and are excluded from those counts. These are activation counts, not a measured profit contribution; the existing replacement study did not justify removing a filter merely to increase order frequency.

The scheduler runs while the Coqui desktop host is open and authoritative. A connected account alone does not mean the experiment is running. Coqui normally checks once per minute and records a decision whenever the current completed Coinbase daily bar is available, even if the 00:00–00:15 UTC **daily order** window was missed. A late decision is marked as such and is not backfilled into the local simulator at an earlier open. The Alpaca paper account can then rebalance toward that same daily target at 04:00, 08:00, 12:00, 16:00, and 20:00 UTC, within each slot's first 15 minutes. Those checks use fresh Alpaca US crypto bid/ask quotes for BTC/USD, ETH/USD, and LTC/USD; a quote more than 60 seconds old is rejected. An intraday order requires at least 1% target drift and a $25 minimum trade after Alpaca quantity rules. There can be multiple paper orders in a day, but no order is forced if holdings remain near target. The ledger records when the intraday policy begins for an existing experiment and gives every slot separate order IDs. A daily pass is called reconciled only when it had no Alpaca orders or recorded fill activity matches every completed Alpaca order; a pending intraday order is shown separately. To verify actual paper execution, compare the Alpaca order ID and activity with the Alpaca paper dashboard; the Coqui timeline is a local readout of recorded evidence.

Balances, current marked equity, percentage return, holdings, trades, and modeled costs remain under **Balances, returns, and paper fills**. The local leg is a daily-fill baseline and is not a paired execution simulation for Alpaca's intraday rebalances. Alpaca's records are **externally recorded paper fills** from its simulator, not live exchange executions. The local leg models a 0.60% fee plus 0.10% spread and 0.15% slippage in fill prices. The Alpaca cost envelope shown in Coqui is a comparison estimate; Alpaca account equity is the external account's actual paper value, and no additional modeled charge is deducted from it.

Order intent and a deterministic client order ID are persisted before each Alpaca submission. A lost or ambiguous response is reconciled by client ID, never blindly retried. Intraday slots cannot submit while an earlier experiment order is unresolved or any Alpaca order remains open. Missing market data, changed account, unexpected orders, rejected/partial daily orders that cannot finish in the daily execution window, or unresolved outcomes pause new submissions. A pause caused by missing or stale market data, a transient OS credential-read failure, or an Alpaca `unavailable`/`rate_limited` response is retried on later scheduler checks. It automatically resumes only after the current completed bar is available and Alpaca reconciliation succeeds. The pause record includes a fixed operation name and HTTP status when available, without the request URL, body, headers, or credentials. An ambiguous order outcome or explicit user pause does not auto-resume. Failed OS secret-store reads are no longer cached indefinitely. The first five minutes after 00:00 UTC may still be waiting for Coinbase to finalize the new daily bar; checks continue within the 00:00–00:15 UTC window. Pausing does not cancel existing Alpaca orders; stopping requests cancellation and requires terminal order confirmation before the experiment is marked stopped.

## Execution cost observations

The Overview labels a retryable Alpaca read outage as retrying while the scheduler checks the connection and prior orders.

Every new intraday check records the Alpaca bid and ask, their observation time, and the target weights. Each buy/sell plan records the account and positions before the stage, plus an estimate per planned order: midpoint, target weight, 0.25% assumed taker fee, half-spread cost, and their one-way total. The order and fill events provide Alpaca's actual average fill and partial-fill rows; the linked slot's account mark records the resulting account value and positions. A fixed **shadow** screen flags a proposed order if its fee plus half-spread exceeds 0.5% of notional. This screen does not suppress orders. The fee and threshold are study assumptions, not an assertion about the account's booked fee tier or the order's expected return.

Run `node scripts/analyze-parallel-paper-execution.mjs /path/to/coqui.db` against a local database to review these observations by slot. The script opens the database read-only and omits credentials and account IDs. When a later recorded slot quote exists, it compares each executed order with doing nothing at that same quote using a 0.25% fee assumption. It also reports an optimistic passive-limit price at the observed bid/ask; **no limit order was placed**, and its fill probability is unmeasured. Missing future quotes produce `null`, not a zero return. The comparator is a narrow incremental-order study, not a full portfolio backtest. Wait for several matched slots and compare net outcomes, turnover, drawdown, and missed opportunities before activating a cost gate or changing the strategy.

The September 26 owner paper session is the first observed trade batch: one 12:00 UTC slot submitted three market buys and Alpaca reported eleven partial-fill activity rows. The initial post-entry account mark was $99,560.19 versus $100,000 opening equity. The quote/cost fields above were introduced after those orders, so the read-only report correctly has no matched trade rows for that historical slot. The approximately $439.81 immediate decline cannot be cleanly divided into fee, spread, and market movement from that older ledger alone. The same ledger records a later `alpaca_unavailable` pause; its specific failing operation was not recorded by that build.

Automated intraday and adapter tests use mocked Alpaca responses. The owner still needs to check that the connected paper key can read the Alpaca US crypto quote endpoint, observe a real intraday slot while Coqui is open, and match any submitted paper order and fill with Alpaca's dashboard. No real paper order was placed during this implementation.

Alpaca documents the [paper environment](https://docs.alpaca.markets/us/docs/paper-trading), [crypto orders](https://docs.alpaca.markets/us/docs/crypto-orders), and [account activities](https://docs.alpaca.markets/us/reference/getaccountactivities-2).

## September 26 execution reliability follow-up

See [the execution audit](studies/execution-audit-2026-09-26.md) and the
[prospective candidate registry](studies/execution-policy-v1.json). No signal
parameters were retuned. The ML worker and its storage remain intact but cannot
change paper targets, even if its historical gate becomes qualified.

The narrow Alpaca pass now precedes unrelated local portfolio work. Market
refresh start/finish and minute scheduler checks are durable events. Alpaca
requests have a 15-second abort deadline. Read outages retain the original pause
reason, so an outage while manually paused cannot accidentally enable automatic
resumption. Pending prior orders block new daily submissions as well as intraday
submissions. Cutoffs are checked again immediately before each order.

Every daily and intraday submission now has fresh pre-order Alpaca bid/ask,
quote/capture timestamps, unchanged target weights, client ID, quantity and
separate modeled half-spread, taker fee and slippage estimates. Daily plans also
record sizing prices and the preceding account snapshot. These estimates do not
change sizing or deduct another fee from external equity. The observation trail
captures all six daily/four-hour slots, including no-order slots, when the app
and data are available. Account marks are retained hourly and on new completed
slots; local valuations still use daily Coinbase closes and are not synchronized
venue execution marks.

Reconciliation queries FILL, CFEE and FEE, paginates, and deduplicates by activity
ID. Fee rows retain reported quantity, price and net amount separately; account
fees without an order link are not arbitrarily allocated to an order. No fee row
means unknown fees, not zero. A daily full-history audit catches delayed fees;
reads are capped at 2,000 rows and report a page-limit failure rather than silently
claiming completion. The activity panel shows fee rows; a scalar booked-USD fee
remains unavailable when denomination or attribution cannot be established.

After `pnpm build`, run:

```
node scripts/analyze-parallel-paper-execution.mjs /path/to/coqui.db
node scripts/replay-paper-execution.mjs /path/to/coqui.db
```

Both commands are read-only and omit credentials/account IDs. The first is a
narrow observed-order analysis. The second reports every registered execution
variant over chronological development folds, at base and doubled costs. It
never reads holdout observations into the evaluator. A missing required slot
invalidates a fold. Model output is not actual Alpaca fill evidence; depth,
quantity increments, latency, and missed market/limit fills remain unmeasured.
No limit-order policy is activated or claimed to have filled.

Final follow-up verification: `pnpm verify` passed with 212 files / 1,337 tests,
plus typecheck, lint and build. `git diff --check` passed. Both read-only reports
ran on the owner ledger: 3 orders / 11 fills; zero matched research slots, so
all prospective folds remain incomplete and the holdout unopened. The installed
older Paper Trading UI was inspected separately; deployment of these source
changes and connected-account verification remain owner checks.

## Wider-universe shadow research

The BTC/ETH/LTC paper experiment remains unchanged. A separate versioned universe
collector can discover Coinbase USD products supported by the connected Alpaca
paper account and record eligibility, data coverage and proposed targets in
shadow. It cannot submit orders or promote a strategy. See the
[wider-universe study and operating notes](studies/wider-universe-2026-09-26.md)
for the point-in-time rule, comparison design, report commands and owner checks.

## Hourly TrendVol execution candidate

The operational Alpaca paper schedule remains the 00:00 daily window and five
four-hour intraday windows. A separate `trendvol-hourly-execution-v1` shadow
candidate checks that **same stored completed-daily-bar target** every hour,
with a two-hour per-asset modeled-order cooldown. It stores immutable quote,
asset-rule, target-hash, virtual-intent, fill, and blocker evidence. Its virtual
orders are not Alpaca orders. Paper Trading labels the candidate and its
coverage separately from actual Alpaca activity.

The [frozen hourly study](studies/trendvol-hourly-execution-v1-2026-09-28.md)
starts on the next UTC day after registration and uses three 20-day development
blocks followed by an untouched 30-day holdout. Run `pnpm build` and then
`node scripts/research-hourly-execution.mjs /path/to/coqui.db` for the read-only
development report. It requires all 24 hourly observations per comparable day
and refuses an aggregate fold result when coverage is incomplete. The report
uses identical starting account snapshots and observations for the current
four-hour baseline and hourly candidate, including doubled modeled friction.
It reports observed Alpaca partial-order IDs separately; immediate virtual
fills are assumptions. The owner must check connected paper-account data and
prospective coverage before interpreting any result. No automatic promotion
to paper orders is available.

## September 30 remediation implementation

The [implementation record](studies/execution-remediation-implementation-2026-09-30.md) documents bounded readiness, lifecycle fencing, explicit study instances, fee denomination and observed execution measurement. Operational TrendVol retains legacy daily/intraday sizing and bands, with fresh safety checks that may block an unsafe legacy intent. ML target proposals remain shadow-only. Headless now supplies OS keyring wiring; connected unattended operation has not been verified.

The shared Decimal planner and A/B/C/D plus three controls are shadow capabilities only. They require an explicitly registered instance; deployment does not register or restart them. The [prospective registration proposal](studies/execution-remediation-registration-proposal-v1.json) fixes dates, common $100,000 cash openings, complete coverage, cost stress and selection/uncertainty rules. It is a proposal, not a registration. Read-only development reporting is available with `pnpm research:remediation-report /path/to/backup.sqlite profile-id study-instance-id`; use an isolated migrated backup. The report keeps holdout books sealed and never promotes a candidate.

Fee displays show observed cash fees, crypto quantities and reported-price values with partial coverage. Arrival/fill/latency measurements are journal evidence; neither modeled friction nor an immediate equity decline is charged again to broker equity or labeled automatically as slippage. Existing immutable activity and prior study failures remain intact.
