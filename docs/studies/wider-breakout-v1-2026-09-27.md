# Wider-universe intraday breakout v1 — September 27, 2026

## Registered behavior

`wider-breakout-v1` is a long-only **shadow** candidate. It has no order client,
credential access, or paper execution authority. The operating BTC/ETH/LTC
TrendVol experiment remains unchanged. The candidate consumes the versioned,
point-in-time Coinbase/Alpaca eligibility frames described in
[`wider-universe-2026-09-26.md`](wider-universe-2026-09-26.md). Eligibility
requires that frame's 180 completed daily bars and venue/liquidity checks.

Research hourly candles are stored separately from the three-coin ML worker.
The main process requests complete windows of at most 300 Coinbase hourly bars,
using the authenticated source with a whole-window public fallback. It validates
the exact hourly timestamps and preserves the first retrieval time. Each
four-hour bar uses exactly four consecutive, completed hourly OHLCV bars; a
signal requires 720 consecutive hours for that asset. No gap is filled and
another asset's later listing does not shorten this asset's history. The
collector fetches the newest missing window for up to four products per pass
after the authoritative Alpaca paper pass. Research work cannot submit orders.

At 04:00, 08:00, 12:00, 16:00, and 20:00 UTC, the most recently completed
four-hour close must exceed the preceding six four-hour highs by more than the
modeled round-trip cost. That cost is 25 bp taker fee plus 15 bp adverse
slippage **per side**, and observed half-spread on each side. This is a
screening heuristic, not an expected-return forecast. A held position's close
below the preceding three four-hour lows requests an exit before any entry.
Eligibility loss also requests an exit; missing hourly data prevents a fresh
entry but does not invent an exit signal. The candidate keeps up to five
positions at 15% target weight each, ranks new entries by breakout margin
after cost and then canonical asset ID, and leaves the rest in cash. An exited
asset cannot re-enter in that slot. The target is held through the midnight
slot and between four-hour checks.

Each shadow record contains the proposed weights, signal and eligibility
hashes, per-asset reasons, desired exits, modeled orders, blocked exits and
separate virtual portfolio. The virtual portfolio starts with $100,000; it
does not use the Alpaca account's holdings or P&L. The existing wider-universe
shadow planner rechecks current paper tradability, quotes, depth, increments,
minimums, drift, fees, cash and guardrails. A desired exit can remain unfilled
in that virtual book when execution evidence is insufficient.

## Prospective comparison

The first deployed collection registers a distinct immutable study for each
policy hash, starting the next UTC day. Its 60-day development and untouched
90-day holdout are fixed; the existing wider-universe study's holdout is not
reused. Registration binds the source, policy, candidate rules, opening cash,
costs and guardrails. A source change makes that registration unavailable for
evaluation rather than silently changing its candidate.

The read-only comparison replays unchanged three-coin TrendVol and breakout on
the same six-slot calendar, starting cash, quote evidence and planner, at base
and doubled friction. It reports net returns and paired differences, drawdown,
turnover, orders, fee/spread/slippage estimates, concentration, missed entries
and exits, per-asset order count/net modeled P&L, and monthly returns. No
holdout observations enter development reporting. Incomplete point-in-time
frames produce an unavailable result. A favorable comparison does not enable
paper orders.

After deployment, use:

```sh
pnpm research:breakout-report --database=/absolute/path/to/coqui.db --profile=main
pnpm research:breakout-report --database=/absolute/path/to/coqui.db --profile=main --phase=holdout
```

The report opens the database read-only. The holdout remains `collecting` until
its fixed end. The current repository implementation has **no prospective
breakout performance result**; historical candles alone do not establish
historical venue eligibility or fills. Paper account order and dashboard checks
for new products remain owner-controlled and were not performed here.

## Verification and remaining work

On September 27, `pnpm verify` passed: 215 test files, 1,360 tests, typecheck,
lint and build. Focused tests cover exact four-hour aggregation, missing and
future-known bars, entry and exit boundaries, spread/cost screen, eligibility,
five-position tie ranking, immutable profile-scoped history and study records,
prospective study timing, complete and incomplete matched replay, and a
collector restart that does not duplicate a slot or submit an order. Coinbase
and Alpaca behavior in those tests uses mocks.

Owner checks: deploy the verified build, observe a prior-day catalog and hourly
backfill, inspect the first 04:00–20:00 UTC breakout shadow records and
independent virtual book, and watch prospective six-slot coverage. Keep Coqui
open for collection. A real connected-key data check and new-product paper
order/partial-fill reconciliation would be required before any later proposal
to grant this strategy paper execution authority.
