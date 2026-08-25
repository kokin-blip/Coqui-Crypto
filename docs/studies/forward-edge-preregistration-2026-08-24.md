# Forward Edge Confirmatory Study — Immutable Pre-registration

Status: **registered; collecting prospectively; execution estimate remains zero**.

The canonical plan is compiled into the application and hashed before it is inserted into migration 49 storage. Its checkpoint revision is `cd5fb48`, its conservative Coinbase venue-cost profile hash is `de6f0bba3537f25c0c63e7ad81bc567a271f6feb0ac43ce9821506ecfcbf65ce`, and its registered search upper bound is 215 trials.

## Locked design

- Candidate: the currently shipped `trendvol-legacy-unvalidated` candidate. There is no parameter search, reselection, or tuning during this study.
- Universe: BTC-USD, ETH-USD, and LTC-USD Coinbase spot.
- Observation: completed UTC daily observations beginning 2026-08-26T00:00:00Z. Earlier records cannot count and missing days remain missing.
- Minimum sample: at least 365 completed daily observations and 30 cost-bearing rebalance events, whichever occurs later.
- Counterfactual: each rebalance event replays the next interval from the identical pre-trade state, once with the recorded rebalance and once with no trade.
- Event gross edge: actual ending equity plus recorded execution cost, less the no-trade ending equity, divided by turnover.
- Event net edge: gross edge less the recorded venue fees, spread, slippage, and impact exactly once.
- Confidence: deterministic block bootstrap with source-hashed inputs; deflated Sharpe uses the registered 215-trial upper bound.

## Adoption rule

All conditions are required: the 95% lower confidence bound on net edge is above zero; excess return versus hold and passive is positive; deflated-Sharpe probability is at least 0.95; maximum drawdown is no worse than 35%; and every required valuation and provenance hash is complete.

Only an immutable, integrity-verified passing result may append a profile profitability activation. The renderer setting formerly named `paper.net_edge_estimate_pct` is not read by execution and cannot confer authority. A failure appends a negative finding and leaves the execution gross-edge lower bound at zero. The earlier negative TrendVol result is permanent regardless of this study’s eventual outcome.

No result is recorded by this commit. The 365-day minimum and the future seven-day operational campaign are elapsed-time gates and cannot be completed with fixtures, backfill, or documentation.
