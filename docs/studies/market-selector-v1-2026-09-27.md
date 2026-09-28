# Paper market-state selector v1

Registered candidate: `paper-market-selector-v1`. This is a research portfolio, not an Alpaca order source. The installed main process reads recorded point-in-time universe frames and completed Coinbase hourly bars after the authoritative TrendVol paper pass. It writes profile-scoped append-only study, slot, and failure records. It has no credentials or broker submission client. TrendVol remains the only operational Alpaca target.

## Frozen decision

At 04:00, 08:00, 12:00, 16:00, and 20:00 UTC, BTC and ETH must both be eligible for the sustained-trend test. Each must have a same-sign seven-day return of at least 4%, a 24-hour return of that sign, and a latest completed four-hour close beyond the preceding seven-day high/low midpoint in that direction. The four-hour bars contain exactly four consecutive completed hourly bars. The classifier then checks for a cost-qualified `entry_selected` from frozen `wider-breakout-v1`, then the BTC/ETH market gate from frozen `wider-range-rotation-v1`. Precedence is sustained trend, new breakout, stable range, uncertain. Trend selects the unchanged BTC/ETH/LTC TrendVol target; breakout and range select their own targets; a valid stable range can select cash. Uncertain selects valid TrendVol, otherwise cash. Recent returns never enter the choice.

The selector evaluates both intraday strategies against its own virtual holdings. A different selected strategy requires the new state at two consecutive intraday slots. An unavailable incumbent immediately falls back to valid TrendVol or cash. At 00:00 UTC it records the new daily TrendVol baseline and observed state, but carries an eligible intraday target until 04:00. Midnight neither confirms nor resets the next expected intraday slot; current eligibility is checked on carried target assets. A newly listed coin without 30 days of hourly bars is ineligible for its own signal and does not disable other coins. Missing BTC/ETH history makes their market-state evidence unavailable.

Every slot record contains classified state and streak, all candidate targets and decision reasons, rejected alternatives, selected strategy, final target, input/frame/policy hashes, virtual holdings, and any planner rejections. The virtual planner sells before buys and applies venue increments, current quotes, fee, spread, slippage, order count and turnover limits. Range selection retains its frozen 35% slot / 60% daily turnover and six-order caps. A recorded pending virtual order blocks another modeled plan; cumulative partial virtual fills are applied idempotently before resumption. The ordinary shadow path assumes immediate fills and labels that assumption. Real Alpaca pending orders have no input to this separate book.

## Prospective evidence

Registration binds candidate versions, thresholds, precedence, hysteresis, source hash, data definition, universe policy, starting cash and modeled costs. Development starts the next UTC day after registration and lasts 60 days; the following 90 days are untouched holdout. Source changes invalidate the registered candidate's future shadow writes until a new version is registered. The read-only report compares selector, unchanged TrendVol, standalone breakout, and standalone range rotation on identical six-slot frames and equal cash at base and doubled friction. It includes switching turnover/costs, total fees, spread, slippage, turnover, orders, blocked orders/exits, sampled drawdown, concentration, cash exposure, per-coin modeled P&L and monthly returns. Missing slots, point-in-time universe evidence, or BTC/ETH hourly market-state history make the comparison unavailable; they are never favorable backfill. Modeled fills and costs are research assumptions.

After `pnpm build`, inspect without database writes:

```sh
node scripts/research-market-selector.mjs --database=/path/to/coqui.db --profile=main --phase=development
```

The result can be `not_registered`, `collecting`, `incomplete`, `invalid_evidence`, `source_changed`, or `modeled_only`. A holdout phase is not read before its end. No report status enables paper orders.

## Verification and owner checks

The selector and runtime tests cover positive/negative trend precedence, breakout versus range, confirmation, midnight carry, missing and stale history, newly eligible coins, removed holdings, cash fallback, partial virtual fills, pending-order blocking, immutable restart records and matched replay. `pnpm verify` passed on September 27 (217 test files / 1,372 tests, typecheck, lint and build); `git diff --check` passed. The read-only CLI returned `not_registered` on an empty database. The collector now requests completed hourly bars before timestamping a new universe frame whenever a prior-day catalog exists, so first-retrieval time can be checked against the frame. Automated Coinbase and Alpaca tests use mocks. The owner still needs to run the app with connected Coinbase and Alpaca paper credentials, observe six-slot collection and selector shadow records, compare a modeled slot with the Alpaca dashboard, and wait for completed prospective development and holdout periods before considering any new order authority. Separate explicit authorization would be required to enable the selector for Alpaca paper orders.
