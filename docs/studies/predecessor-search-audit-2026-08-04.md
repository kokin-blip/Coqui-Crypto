# Predecessor search audit — 2026-08-04

## Outcome

The P3 historical search count is now a persisted, honest lower bound: **178
unique code-visible candidate strategy traces**. It is not represented as the
true lifetime count. The predecessor source mentions an earlier rotation round
and private vault notes that are not present in Git, so the registry remains
`known-lower-bound` and Coqui withholds deflated Sharpe entirely.

The audited source is branch `pivot/kokintrader`, final commit
`80b5a1bb6f5b655c10f1ca3ebdecd1b3f5a0385d`. The relevant history begins at
`23da510264334c1a7ba56f1a39d346044b2747f6` and culminates in the negative
trend-ensemble study at `4f33bb86d6475f2ee207b2cc2c71682497d7fca8`.

Sources:

- [research-deep.mts](https://github.com/kokin-blip/kokin-trading-framework/blob/pivot/kokintrader/scripts/research-deep.mts)
- [predecessor momentum defaults](https://github.com/kokin-blip/kokin-trading-framework/blob/pivot/kokintrader/src/core/execution/momentum.ts)
- [predecessor significance boundary](https://github.com/kokin-blip/kokin-trading-framework/blob/pivot/kokintrader/src/core/execution/strategy-backtest.ts)

## Count derivation

The original loops form Cartesian products containing parameters irrelevant to
some individual tracks. Counting every loop row three times would treat
identical repeated equity traces as distinct trials. The registry instead counts
unique parameter combinations capable of changing each family:

| Search | Momentum | Vol-target | Trend+vol | Rotation |
|---|---:|---:|---:|---:|
| Primary cadence/lookback/target-vol/trend-gate grid | 12 | 18 | 72 | 0 |
| Defensive-scale/relative-tilt/below-trend grid | 9 | 3 | 27 | 0 |
| Visible rotation grid | 0 | 0 | 0 | 27 |
| Fear-and-Greed feature variants, excluding repeated baseline | 0 | 0 | 3 | 0 |
| New combined finalist | 0 | 0 | 1 | 0 |
| Volume-confirmation feature | 0 | 0 | 1 | 0 |
| Profit-protect feature | 0 | 0 | 1 | 0 |
| Two new trend ensembles, excluding repeated incumbent | 2 | 0 | 2 | 0 |
| **Known total** | **23** | **21** | **107** | **27** |

The combined known lower bound is 178. Holdout, robustness, and Monte Carlo
passes did not choose parameters and therefore do not add trials. Baseline rows
repeated inside later studies are not counted again.

## Why the old results are unresolved

The sweep repeatedly passes `commissionPct: 0.1`, meaning 0.1 percent or 10
basis points. Coqui's shared conservative profile is 60bps fee + 10bps spread +
15bps slippage = 85bps before optional guard-only market impact. The old runs
also lack preserved input bytes and an immutable dataset hash. Recording a hash
of the script or this study as though it were the dataset would be false
provenance.

Every seeded record is therefore `legacy-unresolved`, with null dataset and
cost-profile hashes. These records preserve the multiple-testing history but
cannot validate the defaults they influenced.

Seed a local database idempotently with:

```text
pnpm research:seed-trials -- --database=data/coqui.sqlite
```

## Enforcement added

- TrialRegistry schema v2 distinguishes verified from unresolved evidence and
  complete registries from known lower bounds.
- A lower-bound registry supplies no trial count to the significance engine, so
  DSR remains unavailable rather than being calculated from 178 as though it
  were exact.
- Migration 35 stores trial records behind update/delete rejection triggers.
- Immutable evidence snapshots require a complete registry plus dataset,
  cost-profile, registry, and code-revision hashes.
- The service seeds all 13 audit records idempotently. SQLite and core both
  revalidate records and hashes when loading.

## Next evidence action

Recover and enumerate any private vault iterations if possible. Otherwise,
pre-register a conservative replacement search budget before opening results,
run it with the shared 85bps venue profile on a verified N7 dataset, and keep the
historical audit unresolved. Missing history is not permission to declare a
smaller number exact.
