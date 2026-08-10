# Trend-vol replacement v1 — 2026-08-09

## Pre-registered design

Status: **frozen, not yet registered or executed**.

The study uses equal base weights in Coinbase `BTC-USD`, `ETH-USD`, and
`LTC-USD`. The immutable decision-dataset hash is
`d56276d736716bc8796be1c6a1c13a458933f5f5b52de262a0943b83890543f5`.

- Development: 2016-08-21 through 2021-12-31, 1,959 daily bars.
- Untouched final holdout: 2022-01-01 through 2026-08-08, 1,681 daily bars.
- Five nested chronological folds and a ten-day embargo.
- Sixteen candidates from the grid documented in
  `docs/studies/cost-correct-preregistration-2026-08-09.md`.
- Conservative Coinbase cost profile, next-bar-open execution, and 200 warmup
  bars.
- Primary metric: after-cost excess return versus hold.
- Required secondary comparison: after-cost excess return versus passive.
- Maximum drawdown: 35%; maximum PBO: 0.05; minimum DSR probability: 0.95.
- Paired stationary bootstrap: 5,000 resamples, 20-day mean block, 95%
  confidence, seed `20260809`.

The holdout must not be opened until a Git revision and canonical plan timestamp
are frozen in the SQLite pre-registration. The result will replace this status
section after the one authorized execution, whether positive or negative.
