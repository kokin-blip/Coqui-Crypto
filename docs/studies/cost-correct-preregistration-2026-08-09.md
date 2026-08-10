# Cost-correct research pre-registration — 2026-08-09

## Decision

Coqui now has an immutable pre-registration boundary for the P3 replacement
study. No replacement study has been registered or run yet: registration needs
the final verified N7 dataset hash, and inventing that value would defeat the
control.

The boundary freezes, before results are inspected:

- one hypothesis and strategy family;
- every parameter value and the exact Cartesian candidate count;
- the immutable dataset, shared cost profile, and code revision hashes;
- canonical base-portfolio weights, warmup bars, and cash return assumption;
- UTC-day-aligned development and untouched holdout windows;
- nested-fold count, embargo, and minimum bar counts;
- one primary metric and non-optional hold/passive/significance gates; and
- the maximum acceptable drawdown.

Migration 36 stores the canonical plan JSON and SHA-256 hash in an append-only
table. Research evidence must reference an existing plan hash, cannot predate
the declaration, and must exactly match the registered dataset, cost profile,
and code revision. Updates and deletes are rejected by SQLite triggers.

## First executable study

After the Coinbase/Binance/Kraken archive selected for the study has been
verified, create one JSON plan for `trendvol-replacement-v1`. Use a deliberately
small 16-candidate grid:

| Parameter | Frozen values |
|---|---|
| `lookbackDays` | 90, 180 |
| `volatilityDays` | 30 |
| `targetVolatilityPct` | 55 |
| `targetVolPct` | 40, 50 |
| `volLookbackDays` | 30 |
| `minExposure` | 0.1 |
| `maxExposure` | 1 |
| `trendGateDays` | 100, 200 |
| `rebalanceEveryDays` | 14, 30 |
| `defensiveScale` | 0.2 |
| `maxRelativeTilt` | 0.35 |
| `belowTrendMaxExposure` | 0.7 |

The development and final holdout dates must be selected from actual verified
coverage, not filled speculatively in this document. The holdout must begin on
or after the development end, remain unopened during selection, and declare at
least 300 daily bars. Use five nested chronological folds with a ten-day
embargo. The primary metric is after-cost excess return versus hold. Adoption
also requires positive after-cost excess return versus passive, DSR probability
of at least 0.95, available significance, and maximum drawdown no worse than
35%. Freeze 16 CSCV partitions and a maximum PBO of 0.05.
Also freeze 5,000 paired stationary-bootstrap resamples, a 20-day mean block,
95% confidence, and seed `20260809`; both benchmark lower bounds must exceed
zero.

Register the completed JSON exactly once:

```text
pnpm research:register-plan -- --plan=data/research-plans/trendvol-replacement-v1.json
```

The resulting plan hash becomes an input to the runner and the immutable
evidence snapshot. A duplicate ID, changed plan, mismatched hash, duplicate
candidate value, overlapping split, or disabled benchmark gate is rejected.

## Honest limitation

This does not resolve the predecessor registry's `known-lower-bound` status.
The app continues to withhold citable evidence and DSR until that historical
count is complete. Pre-registration prevents new search debt; it does not erase
old unknown search debt.

## Runner implementation

The plan-driven TypeScript runner now:

1. verifies the persisted plan, dataset, shared costs, and code revision;
2. deterministically expands exactly the declared Cartesian grid;
3. selects candidates using inner chronological validation inside every outer
   development fold;
4. applies the declared embargo before each outer selection boundary;
5. completes all development selection before evaluating only the selected
   candidate on the final holdout; and
6. appends the complete candidate budget to TrialRegistry even when the result
   is negative or significance remains unavailable.

A future holdout perturbation test proves that changing only holdout prices does
not change the candidates, development scores, outer-fold selections, or final
selected parameters. The holdout outcome changes, as it should. Re-running the
same registered plan is rejected before the holdout is opened again.

CSCV/PBO, benchmark-relative confidence, and the verified Coinbase
archive-to-decision-dataset preparation command are now implemented. The next
step requires an owner decision on the exact Coinbase asset mix and actual
archive coverage. Only then can the immutable plan be registered and its
holdout opened exactly once.
