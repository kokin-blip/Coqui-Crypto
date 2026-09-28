# TrendVol execution audit — September 26, 2026

Scope: existing TrendVol v4.2 → Alpaca paper only. Preserve the in-progress ML,
Coinbase ingestion, migrations and execution diagnostic work. No changes to
TrendVol parameters, no live orders, and no new paper policy adopted.

## Observations

Read the Coqui Obsidian notes 00, 04 and 53, `docs/parallel-paper.md`, the negative
TrendVol replacement study, current source and dirty working tree. The owner
SQLite ledger was read without opening credentials or modifying the account.

- Three BTC/ETH/LTC buy intents, three submission attempts, eleven fill activity
  rows; gross purchases $78,461.96375077899. Six order-state events represent
  updates, not six orders.
- Credential-access pause: 2026-09-25 23:53:58 UTC, repeated at 23:54:26. Next
  recorded resume: September 26 05:04:42 UTC. More credential/data pauses follow.
- First September 25 completed-bar decision: September 26 09:01:15 UTC.
  Missed-window event: 09:01:20; execution-window pause: 09:01:35.
- Intraday pass complete: 12:07:34 UTC. Post-entry equity $99,560.19 against
  $100,000 opening equity, a $439.81 decline. Later pause at 12:56:32 reports only
  `alpaca_unavailable`, without operation or HTTP status.
- The old trade batch has no retained pre-order quotes or booked fee activity.
  No retrospective fee/spread/slippage decomposition is identifiable.
- Installed `/Applications/Coqui.app` Paper Trading was inspected: paused,
  `alpaca unavailable`, 3 orders / 11 fills, $99,560.19 equity, booked fees not
  reported separately. This is the installed older build, not proof that the
  new source is deployed. The global UI also shows a safety stop; it was not
  disabled during inspection.

## Inferences

The recorded credential pause spans the intended 00:00–00:15 UTC window and
is a supported contributor to the missed entry. The ledger cannot distinguish
all time spent asleep, offline, non-authoritative, or blocked in preparation.
Serial local preparation before the parallel pass was an avoidable source of
possible delay, not a proven sole cause of this incident.

The immediate equity difference is not a signal-quality estimate. Fees, spread,
fill timing and subsequent mark movement could all contribute. Even a fill
premium against a retained pre-order midpoint combines spread, latency and
slippage; it is not a clean causal decomposition without execution-time quotes.

## Implemented

- Alpaca pass precedes unrelated local preparation; durable refresh and scheduler
  events plus a 15-second Alpaca request deadline make stalls diagnosable.
- Temporary reads recover via existing reconciliation; failures while paused
  retain operator/ambiguous-outcome pauses. Tick reentry is blocked. Daily orders
  also wait for prior unresolved/open orders. Recheck daily/intraday cutoffs
  immediately before submission and persist intent before attempting submission.
- Fresh per-submission bid/ask and timestamps, target, sizing evidence, assumed
  fee/spread/slippage components, client/order IDs and partial-fill evidence.
- CFEE/FEE plus FILL activity, daily delayed-fee audits, hourly later marks.
  No raw response body, headers, credentials or arbitrary activity description
  enter the new trail.
- ML training/gates/storage retained; all proposals are shadow only and no ML
  wait can hold up a paper slot.
- Offline execution replay with eight declared policies/baselines, identical
  completed-day targets, matched quotes and starting cash, fees charged in the
  received asset/cash, observed spreads, 15 bp modeled slippage, 2× cost stress,
  turnover, orders, skipped orders, sampled drawdown, net return, and a separately
  labeled next-slot missed-favorable-move opportunity measure. Missing fills
  remain unknown without a liquidity/queue model. This opportunity measure is
  gross diagnostic opportunity, can overlap across slots, and is not portfolio P&L.

## Untested hypotheses and research status

Wider intraday bands, daily-only execution, and a buy-entry cost screen may
reduce turnover/costs but also miss favorable moves. None has earned a paper
order change. The September 26 observation cannot rank them.

The prospective registry starts September 27, uses three chronological 20-day
walk-forward evaluation blocks, and seals November 26–December 25 as the untouched
holdout. No fitting or signal tuning occurs in this execution comparison. All
five TrendVol execution variants plus equal-weight hold, BTC hold and cash must
be reported, including failures; no valid market-data variant has been evaluated
at registration. Synthetic tests verify mechanics only. The runner refuses
incomplete folds and excludes holdout rows. Missing future slots will require
reporting an incomplete study, not moving dates after viewing outcomes.

Limit-order candidates are deferred pending executable quote/depth evidence and
a registered expiry, queue and partial-fill model. A hypothetical bid/ask limit
price is not evidence that an order would have filled.

## QuantConnect admission gate

QuantConnect remains an optional second engine, not an active execution route.
No QuantConnect experiment or parity result is claimed in this change. Before
using its output:

1. Freeze and hash the exact completed Coinbase BTC-USD/ETH-USD/LTC-USD daily
   OHLCV bars, UTC start/end times, data source/retrieval provenance, Coqui code,
   configuration and persistent `parallelAnchor`. Use at least 121 aligned
   completed bars; do not replace the fixed anchor with rolling normalization.
2. Export Coqui `parallelDecision` targets for each decision day. In LEAN use the
   same custom Coinbase bars with `EndTime` at next UTC midnight. Assert matching
   decision days, execution eligibility timestamps, cash/exposure, trend state
   and all asset weights to 1e-10. Any mismatch blocks performance evaluation.
3. Override zero slippage with explicit observed bid/ask plus 15 bp adverse
   slippage per side and stress 2×; configure crypto taker/maker fees explicitly,
   with buy fees reducing received crypto. Reject stale quotes. Model market
   participation/partial fills and limit queue/expiry/missed fills explicitly;
   daily high/low touching a limit is not a guaranteed fill.
4. Register model/candidate hashes before evaluation, then use the same frozen
   chronological folds and unopened holdout. Report every attempted setting
   against unchanged TrendVol execution and passive baselines. Do not tune on
   the already-opened replacement study holdout.

Alpaca documents delayed CFEE/FEE activity and fee denomination in
[Crypto fees](https://docs.alpaca.markets/us/docs/crypto-fees).
QuantConnect documents zero default Alpaca slippage in
[Alpaca models](https://www.quantconnect.com/docs/v2/cloud-platform/live-trading/brokerages/alpaca).
These defaults are research assumptions to override, not observations of this
paper account's actual costs.

## Verification and owner checks

Final `pnpm verify` passed: typecheck, lint, **212 test files / 1,337 tests**,
and build. `git diff --check` passed. New tests cover user-pause retention across
read failures, fresh daily quote evidence, fee deduplication and secret-safe
projection, later marks, stale-quote recovery, interrupted-plan recovery,
Alpaca-first scheduler ordering, unchanged ML-shadow targets, invalid/missing
replay slots, modeled costs and future-quote isolation.

Both read-only reports ran against the owner database. The observed report
returned 3 orders, 11 fill rows, no retained fee rows, and no matched cost
comparisons. The prospective coverage report returned zero collected slots and
three incomplete folds; holdout remains sealed. Registry hash:
`1347b25d1b1dea3abfabd747340d2d89911deaa4f37fd5ff38a652acb7b12b7c`.
See `execution-policy-v1-coverage-2026-09-26.json`. No market-data policy winner,
actual fee decomposition, limit-fill result or QuantConnect parity is claimed.

Owner checks remaining: deploy the verified source into the intended desktop
build; confirm host authority and leave it awake during 00:00–00:15 UTC and a
four-hour slot. Inspect recovery without bypassing a real safety stop. Match
fresh quote timestamps, client/order IDs, partial fills and delayed CFEE/FEE
rows against the Alpaca paper dashboard. Confirm account-level fee attribution
and denomination before presenting an aggregate booked-USD amount. Check
hourly later marks, collected-slot coverage and research hashes. No authenticated
owner API smoke order was submitted during this work.
