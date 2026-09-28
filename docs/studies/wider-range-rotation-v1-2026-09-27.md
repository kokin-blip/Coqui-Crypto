# Wider-universe range rotation v1 — September 27, 2026

## Frozen shadow rule

`wider-range-rotation-v1` is a distinct long-only **shadow** portfolio. It has
no credentials or order client, cannot submit an Alpaca order, and cannot
change the operating BTC/ETH/LTC TrendVol target. It uses the versioned,
prior-day Coinbase/Alpaca universe catalog and current point-in-time venue,
quote, book, rule, and 180-completed-daily-bar checks. Each coin also needs 720
consecutive completed Coinbase hourly bars stored with first retrieval time;
four-hour bars aggregate exactly four hours without gap filling.

At 04:00, 08:00, 12:00, 16:00, and 20:00 UTC, BTC and ETH must each have a
preceding seven-day four-hour range no wider than 12% of its midpoint, a latest
close inside that range, and an absolute seven-day return no greater than 4%.
Both must be currently eligible. Otherwise the target is cash. A candidate
coin's preceding range must be 4–18% wide, with its latest close in the lower
half and its completed 24-hour return positive. Its score is 50% distance below
the range midpoint and 50% its rank by 24-hour return among qualifying coins;
canonical asset ID breaks ties. Half of the hypothetical move from close to
midpoint must exceed the modeled round-trip fee, slippage, and current Alpaca
spread. This half-move is a **research benefit proxy**, not a measured forecast.

At most three coins receive a 10% target each; the rest stays in cash. New
entries need two consecutive qualified slots. A held coin exits at the
midpoint, outside its range, on eligibility loss, or when the BTC/ETH gate
fails. A discretionary replacement also needs a score advantage of at least
0.25 for two slots. Exits precede entries; no same-slot re-entry. Separate
virtual holdings, qualified IDs, replacement candidates, target weights,
input/eligibility/hourly hashes, and blocked-exit reasons are append-only and
recoverable after restart. Missing bars prevent a new entry and request an
exit for a held coin; missing execution evidence may block that virtual exit.

The virtual planner enforces at most six modeled orders and 35% turnover per
slot plus 60% per UTC day, measured against virtual equity at the day's first
04:00 slot. Targets never exceed 10% per coin or 30% in total. Planner checks
allow 0.5 percentage point per-position and 1.5 points total headroom for
fee/spread-adjusted notional; this does not increase target weights. Buys and
discretionary rotation are blocked when the turnover budget is spent; sells
are planned first and can be recorded as blocked if execution or turnover
constraints prevent them. Assumed cost is 25 bp taker fee and 15 bp adverse
slippage per side plus observed spread, with a separate doubled-friction
stress. These are modeled costs, not observed broker fills.

## Prospective comparison

The first deployed registration binds source and data-definition hashes,
universe policy, fixed rule and cost model, guardrails, and $100,000 opening
cash. Its own 60-day development and untouched 90-day holdout begin the next
UTC day; neither the breakout nor wider-universe holdout is reused. The
read-only comparison replays unchanged TrendVol, the frozen breakout rule,
and range rotation on the same six-slot daily calendar, point-in-time frames,
as-of hourly bars, starting cash, and base/2× fee-spread-slippage assumptions.
It reports net return, drawdown, turnover, fees, spread, slippage, order and
blocked-order count, maximum concentration, minimum cash exposure, per-coin
modeled P&L, and monthly results. Missing point-in-time evidence yields an
unavailable comparison rather than a backfill. No result promotes an order.

After deployment, use the read-only command:

```sh
pnpm research:range-rotation-report --database=/absolute/path/to/coqui.db --profile=main
pnpm research:range-rotation-report --database=/absolute/path/to/coqui.db --profile=main --phase=holdout
```

The current repository has **no prospective range-rotation performance
result**. Historical Coinbase candles do not prove historical Alpaca paper
tradability. Coqui collects only while the desktop app is open.

## Verification and owner checks

`pnpm verify` passed on September 27: 216 test files, 1,365 tests, typecheck,
lint, and build. `git diff --check` passed. The read-only report smoke test
returned `not_registered` on an empty database and `collecting` with a fresh
registered study, both with execution disabled. Focused tests
cover range and cost boundaries, exact-hour gaps and
future-known bars, venue freshness, two-slot confirmation, rank instability,
eligibility and market-gate exits, turnover exhaustion, immutable profile
records, matched replay, and restart idempotency without submission. Coinbase
and Alpaca responses in automated tests are mocks.

Owner checks: deploy the verified build; confirm a prior-day universe catalog,
connected-key hourly collection, the first range shadow records and their
virtual book; then monitor complete prospective slot coverage. Any future
proposal to give this candidate paper execution authority requires a separate
owner decision and an actual Alpaca paper order/dashboard reconciliation.
