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
- A future TrendVol campaign must begin prospectively after the scheduled path
  invokes the shared Momentum + VolTarget implementation and binds its exact
  configuration and code identity.

This finding does not adopt a strategy, validate profitability, or enable live
execution.
