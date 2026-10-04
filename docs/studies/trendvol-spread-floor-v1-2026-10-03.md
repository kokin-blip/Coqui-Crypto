# TrendVol relative-momentum spread floor

Status: implementation complete; market comparison blocked before registration.

## Change

`MomentumConfig.relativeScoreSpreadFloor` is an optional nonnegative finite number.
Omission or zero retains the original min–max formula exactly. With a positive
floor and a score spread below that floor, the relative multiplier is:

```
1 + maxRelativeTilt * 2 * ((score - minimumScore) - spread / 2) / floor
```

At or above the floor, the original arithmetic is used. Equal scores retain a
neutral multiplier. Both current and indexed evaluations use the same function.
Defensive scaling, asset volatility scaling, cash normalization, existing paper
campaigns, and shipped default objects are unchanged. The integrity research
runner includes explicit floor values in candidate identity and validation;
historical research runners are unchanged.

The research value 0.25 is a declared hypothesis in existing return/annualized-
volatility score units, not a fitted value. Synthetic near-tie checks establish
continuity of this relative tilt, not continuity of the separate absolute-
momentum cutoff or improved returns.

## Data preflight: blocked

Both immutable Kraken archives passed manifest, Parquet content, schema, row
count, and semantic dataset-hash verification. The requested development window
is 2016-01-01 inclusive to 2026-07-01 exclusive: 3,834 daily observations per asset.

| Canonical asset | Observations | Missing interval |
|---|---:|---|
| kraken\|spot\|XBTUSD | 3,834 | None |
| kraken\|spot\|ETHUSD | 3,833 | 2018-01-12 UTC |

All supplied bars have reported OHLC quality. The authoritative `reject-on-gap`
alignment policy reports the missing ETH interval and retains zero aligned days.
No observations were synthesized, no date boundary was shortened, and no venue
was substituted. No study was registered, research database created, candidate
market backtest run, or holdout consumed. Therefore there are no turnover,
cost, return, drawdown, Sharpe, fold, or market signal-movement results to report.
The isolated in-memory synthetic governance tests are not market evidence.

Full hashes and machine-readable diagnostics are in
[the data check](trendvol-spread-floor-v1-data-check.json).
Reproduce from the repository root after building:

```sh
pnpm build
node scripts/check-trendvol-spread-data.mjs
```

Exit code 1 with `blocked_data_validation` is the expected result for these
immutable archives. This script is read-only and cannot register or run a study.
An eligible source archive containing the missing observed interval is required
before the planned comparison can run; these archived files must not be edited.

## Frozen comparison specification — not registered

- Label: **Kraken-price proxy research with Coinbase costs**.
- Exactly two configurations: `relativeScoreSpreadFloor` 0 and 0.25.
- Equal Kraken XBT/USD and ETH/USD weights; fixed development window above.
- Momentum: lookback 120 days, volatility 30 days, maximum relative tilt 0.35,
  defensive scale 0.2, asset volatility target 55 percent; no horizon ensemble.
- Portfolio volatility: target 40 percent, lookback 30 days, exposure minimum
  0.1 and maximum 1, trend gate 100 days, below-trend maximum exposure 0.7.
- Rebalance and passive benchmark cadence 14 days; warmup 121 bars; cash interest
  zero; external exposure scale 1. Authoritative integrity engine and next-open
  fills; existing optimistic, conservative, and stress Coinbase cost scenarios.
- Five chronological folds, 120-day embargo, eight CSCV partitions, bootstrap
  1,000 resamples, mean block length seven days, confidence 95 percent, seed 86;
  existing integrity adoption thresholds and primary after-cost excess return
  versus hold metric.
- At execution, register two trials in a fresh isolated research database before
  evaluation and pin dataset, archive, source-manifest, revision, and lockfile
  identities. The required prospective holdout begins at UTC midnight seven
  calendar days after actual registration and lasts 365 days. Do not backdate
  registration. This work does not run the holdout or activate a candidate.
- Report both candidates and their differences under every cost scenario: actual
  turnover, costs, net return, drawdown, annualized Sharpe, and each validation
  fold. Report daily and scheduled target movement separately as half the L1
  change across asset weights plus cash, starting only when history is complete.
  These are target changes, not realized turnover. No post-result floor tuning.

No market performance or adoption conclusion can be drawn from this delivery.

## Verification

Focused coverage includes the near-tie reversal, convergence to neutral, equal
scores, single and three assets, unequal base weights, exact floor boundaries,
invalid values, missing history, accounting, unchanged zero/omitted behavior,
indexed/current parity, future-bar isolation, research-runner propagation,
candidate identity, and registration of two synthetic trials. The golden backtest
fixture is unchanged. `pnpm verify` passed: typecheck, lint, 242 test files /
1,557 tests, and build. `git diff --check` also passed. The focused final run
passed 25 tests across the spread-floor, integrity-governance, and golden-backtest
suites. Data preflight exited 1 as documented above; this is a research input
blocker, not a passing market comparison.
