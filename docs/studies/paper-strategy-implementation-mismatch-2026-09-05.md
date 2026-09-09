# Legacy paper strategy implementation mismatch — 2026-09-05

Status: **negative operational finding; prior campaign retired for strategy evidence**.

## Finding

The scheduled paper loop stored the strategy version
`trendvol-legacy-unvalidated`, but its executable path loaded a saved
`AllocationPolicy` and called `planAutoRebalance`. It did not call the shared
Momentum or VolTarget implementations used by research and backtesting.

Existing decision, campaign, scheduler, recovery, and reconciliation records
remain immutable. They continue to provide operational evidence about cadence,
stand-downs, persistence, and restart behavior. They do not provide evidence
about the behavior or edge of TrendVol.

## Disposition

- Subsequent runs of the unchanged loop use
  `allocation-policy-rebalancer-v1`.
- A campaign receiving a run whose strategy identity differs from its
  registered plan receives an append-only `failed` event with reason
  `strategy_implementation_mismatch`.
- No new forward observation is recorded under the incompatible plan.
- Historical rows are not rewritten or deleted.
- The replacement `trendvol-paper-v1-unvalidated` path now invokes the shared
  Momentum + VolTarget implementation and binds its configuration, code,
  dataset, rule, portfolio, and cost identities.
- Its v2 campaign begins prospectively at the first complete post-cutover
  decision. No historical allocation-rebalancer observation is eligible for it.
- Orders submitted from completed bar N remain pending until the exact N+1 bar
  is complete, then settle at that recorded open; a missing exact bar expires.

This finding does not adopt a strategy, validate profitability, or enable live
execution.

## Compatibility disposition

Schema 75 retains the v1 paper-campaign reader for one compatibility release so
the retired campaign remains inspectable. This is presentation compatibility,
not evidence eligibility: no legacy allocation-rebalancer observation is counted
for `trendvol-paper-v1-unvalidated`, and no row is reset, reseeded, deleted, or
reinterpreted. Removal of the compatibility reader requires a separate release
decision; preservation of the immutable evidence does not.
