# Trend-vol replacement v1 — 2026-08-09

## Pre-registered design

Status: **executed once; negative; candidate not adopted**.

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

The plan was registered at `2026-08-10T00:36:24.100Z`, before candidate
evaluation, against Git revision
`037927e6b876a86b53f6a9977d35fd0df1a37873`. Its immutable identities are:

- Plan hash: `7aeec117f27df08d51820778f44ae4dd9cf5ff322e903961fb53f9d245c58d3a`
- Cost-profile hash: `1ff9978f4a7c97501b1b2115d1f8d82742a91426ed227000796dd9dffe854c5e`
- Run hash: `1c19605cb28c1c418ae57393a9e520e6b47f74f4e0c8585259facf626ea62120`
- Completed at: `2026-08-10T00:36:53.988Z`

## Selected development candidate

Nested development validation selected:

| Parameter | Value |
|---|---:|
| `lookbackDays` | 180 |
| `targetVolPct` | 50 |
| `trendGateDays` | 100 |
| `rebalanceEveryDays` | 30 |
| `volatilityDays` / `volLookbackDays` | 30 / 30 |
| `targetVolatilityPct` | 55 |
| `minExposure` / `maxExposure` | 0.1 / 1.0 |
| `belowTrendMaxExposure` | 0.7 |
| `defensiveScale` / `maxRelativeTilt` | 0.2 / 0.35 |

The five-segment development score returned 146.14% after costs but trailed hold
by 626.42 percentage points and passive by 734.79 percentage points. Of the four
outer validation folds, one produced positive excess and three produced
negative excess against both benchmarks. Development selection was therefore
unstable before the final holdout was opened.

## Final holdout result

| Measure | Result | Frozen requirement | Pass |
|---|---:|---:|:---:|
| Strategy after-cost return | 17.22% | — | — |
| Cumulative excess vs hold | +43.18 pp | > 0 | Yes |
| Cumulative excess vs passive | +47.31 pp | > 0 | Yes |
| Annualized return | 3.05% | — | — |
| Maximum drawdown | -35.84% | no worse than -35% | **No** |
| Sharpe | 0.252 | — | — |
| PSR | 0.706 | — | — |
| PBO | 28.60% | <= 5% | **No** |
| OOS-loss probability | 1.54% | — | — |
| DSR | unavailable | >= 0.95 and available | **No** |

The paired stationary bootstrap found no reliable daily benchmark edge:

| Benchmark | Annualized arithmetic excess | 95% mean-daily CI | One-sided p |
|---|---:|---:|---:|
| Hold | -1.20% | [-0.0851%, +0.0863%] | 0.508 |
| Passive | -1.44% | [-0.0931%, +0.0907%] | 0.526 |

The cumulative comparison is positive while mean daily excess is slightly
negative because compounded paths and volatility differ. The pre-registered
decision correctly follows the paired confidence bounds rather than the more
flattering endpoint comparison. Both lower bounds fail the required `> 0` gate.

## Decision

The selected candidate is **not adopted**. It failed benchmark confidence, PBO,
drawdown, and significance gates. The trial registry now contains 194 known
trials across 14 records, but remains `known-lower-bound`; DSR and a citable
evidence snapshot are therefore deliberately unavailable.

The predecessor's current tuned defaults also do not survive as validated
defaults. They remain operational legacy values only. This run does not justify
replacing them with the selected candidate—or any other member of the inspected
grid—because doing so after seeing the holdout would be another unregistered
selection. A future default change requires independent pre-registration and
new untouched evidence.
