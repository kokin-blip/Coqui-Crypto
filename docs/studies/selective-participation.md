# Selective participation and bounded ML challengers

Implementation identity: `participation-tilt-v1`, registration schema V3. This is
research infrastructure, not evidence that a strategy works. Existing V1/V2 and
four-hour ridge identities remain unchanged. No real holdout or owner study was
read, registered, or evaluated during implementation.

## Finding → defect → change → test → acceptance

| Finding | Existing gap | Implemented change | Verification | Acceptance |
|---|---|---|---|---|
| Abstention must have a counterfactual and a book | No joint daily/14-day overlay registration | Frozen TrendVol formulas, fixed UTC anchors, V3 grids, separate Decimal replay books | `overlay-replay`, golden fixture | Future append/scramble preserves earlier targets, fills and books; legacy golden unchanged |
| Participation can duplicate existing trend logic | No separately attributed rule treatments | 30-day mix volatility at 1.5×/2× target, 100-day SMA and combined gates; skip and cash-target treatments | `overlay-replay`, `overlay-development` | Missing inputs reject; coverage and baseline-interval attribution remain distinct from treatment returns |
| Model sophistication does not establish edge | Four-hour ridge did not supply a daily challenger contract | Daily normalized ridge L2 1/10 and deterministic depth-two tree leaf 20/40; causal horizon labels; matured-label purging | `overlay-models`, `overlay-development` | At least 120 training, 60 separate calibration and 30 validation opportunities; sparse fourteen-day fits unavailable |
| Confidence needs independent calibration | No daily action-counterfactual calibration | Regularized deterministic sigmoid on cloned shared Decimal books with intermediate risk-stop exits; Brier/log loss, reliability, slope/intercept and risk–coverage diagnostics | `overlay-models`, `overlay-shadow` | Ten outcomes per class; failed fits unavailable; finite gross benefit strictly exceeds twice modeled friction |
| ML must remain bounded | No registered redistribution envelope | Positive baseline assets only; 2.5/5-point transfers; preserved gross and covariance risk; additional L1 ≤10%; position/turnover/trade/verified USD volume limits | `overlay-models`, `overlay-replay` | Missing liquidity disables tilts; attainable-open order caps are rechecked before modeled fills; no leverage; diagnostic 2.5-point variants cannot be selected |
| Search and holdout access are irreversible research events | No joint comparison-family claim | All 470 candidates reserved before evaluation; development-only selection; immutable freeze; joint atomic final claim; simultaneous paired bootstrap | `overlay-governance` | Failed trials survive; interrupted claims cannot reopen; ≥20 adjusted-tail draws; blocks ≥horizon plus publication lag |
| Models must not update invisibly | No versioned daily artifacts | Model/calibration windows, data/liquidity/cost/risk/source/lock/seed identities and evaluation linkage; integrity-checked explicit imports | `overlay-development`, `overlay-shadow` | Corrupt/incompatible artifacts refused; final artifacts never refitted; imports cannot rewrite pending actions |
| A shadow must not become execution | No isolated daily observer | Default-off profile setting, append-only separate arm books, pending decisions and observed-open settlements; status view | `overlay-shadow`, contracts | Restart-idempotent; no missed-fill backfill; zero orders/intents/evidence writes; disabling preserves records |

## Registration and evaluation

`overlayCandidates()` is the frozen grid: 235 configurations per cadence, 470 total,
including baseline and diagnostic variants. The parameter-space declaration is
`{ "rebalanceEveryDays": [1, 14] }`; the version fixes the remaining enumerated grid.
The registered baseline is the existing default momentum and volatility-target
configuration. Base allocations, both calendar anchors, execution/cash assumptions,
cost scenarios, development data and liquidity hashes, universe, source manifest,
lockfile, random seeds and acceptance policy are bound by the plan hash.

No new accounting engine exists. Replay, counterfactuals and shadow settlements use
`rebalanceResearchBook` and the shared modeled-fill costs. Rule and ML treatments
retain independent books. Counterfactual holding horizons include intermediate
causally triggered hard stops and liquidation costs, rather than assuming that
positions survive every intervening drawdown. Skipping retains holdings; a cash-exit candidate asks for
zero risky weights and pays modeled exit/re-entry costs. Discretionary turnover
limits can constrain liquidation; the trace reports the risk cap. Hard safety
liquidation takes precedence. New overlay baselines enforce the same registered
risk limits as treatments; their opening allocation can ramp under the turnover
limit. Existing legacy numerical artifacts are not relabeled as these baselines.

Outer validation observations do not select their own fold winner. An inner
chronological development prefix selects that winner before the outer window;
all candidates are then reported out of sample. Fold scores and variability are
retained; final development selection uses development OOS results only. An
insufficient inner prefix freezes none. Model fitting and chronological calibration
exclude labels not matured before their respective boundaries. Labels use the
attainable execution opens, and conservatively await completion/publication of
the ending open's bar. No fitting occurs on final observations.

Final comparisons require baseline-relative positive adjusted lower bounds,
DSR ≥0.95, PBO ≤0.10, drawdown controls, account and conservative cost evidence,
365 scored daily observations and 30 cost-bearing eligible actions. ML additionally
compares with the development-selected simple control (baseline when no rule
improves it); tree compares with ridge in the same capability. Missing comparators,
statistics or account-cost evidence cannot qualify a candidate. Hold, passive and
cash remain permanent controls. A frozen comparison count binds the baseline,
hold/passive, ML/simple and tree/ridge family across the two qualification cost
scenarios. Bonferroni intervals use at least twenty draws per adjusted tail.

Baseline interval attribution follows eligible opportunities and their declared
horizons. Partial intervals are marked incomplete with unavailable full-horizon
returns; validation diagnostics exclude outcomes published beyond their window. It is not treatment-book performance or per-turnover profitability
proof. Calibration diagnostics use action-counterfactual equity-normalized
outcomes. They never replace verified profitability evidence or activate a strategy.

## Explicit workflow

Build first, then use `pnpm research:overlay --help` (or the script directly after
build). Commands: `identity`, `register`, `development`, `freeze`, `final` and
`shadow-export` and `shadow-import`. An explicit database is required. Use an isolated research database
for study execution. Development archives must be physically separate from final
observations; final archive access occurs only after the durable claim. Liquidity
observations must declare verified USD units, source hash and publication timing;
development liquidity is hashed at registration and unchanged at freeze/final.

`freeze` emits the selected configurations or none and their immutable artifacts.
`shadow-export` requires explicit daily and fourteen-day candidate IDs (or `baseline`)
and emits the integrity envelope for `shadow-import`. Import into the database
containing the matching frozen study; the observer never copies qualification.
A shadow import file contains `{ binding, contentHash }`, where `binding` contains
the V3 plan, `scenarioHash`, and the two arms' candidate IDs, nullable artifacts and
artifact hashes. Model artifacts must match a stored frozen result in that database;
baseline-only configurations may omit artifacts. Import is explicit and cannot
replace a pending simulation. Imports and research results do not enable the
observer. The settings checkbox controls only the current profile's shadow.

Every model artifact binds its training/calibration windows, features, horizon
labels, data/liquidity lineage, cost/risk identities, source/lock hashes, seed and
linked development result. Its update policy is `explicit`; the provenance contract
reserves `registered-schedule-separate-qualification` for a future rolling-refit
policy. There is no automatic fitting, update, resumption or default activation.

## Shadow assumptions and limitations

The observer has no broker or active-portfolio dependency. Its initial research
capital is USD 10,000 per arm. It records predictions, permission/fallback reasons,
allocations, pending actions, modeled fills, costs and net equity. Cash accrual uses
the registered rate. Hard drawdown stops persist in each book; the active global
kill switch also forces the shadow safety path. Settings and bindings are excluded
from profile duplication; global consumed-holdout records remain retained.

The public-open capture model accepts only a current UTC daily open observed within
sixty seconds of its boundary. It records retrieval time and source hash. This is
an explicit research execution assumption, not proof of executable market prices
or contemporaneous historical vintages. Missing that window records a missed fill;
it never settles later at an old open. New decisions await the latest daily publication and refuse data older than the
registered two-hour freshness allowance. Stale/invalid observations refuse new work.
Public candle volume is not implicitly converted into verified USD liquidity.
Absent explicit liquidity evidence therefore disables tilts in the observer. If
a price gap makes an accepted tilt exceed its frozen USD order cap at the
attainable open, execution falls back to the baseline and records the discrepancy.

Fixed-universe results are conditional on their declared assets. Dynamic membership,
delisting coverage and survivorship-free market-wide claims remain unsupported.
Sparse fourteen-day opportunities can remain insufficient for many years. No
historical performance improvement establishes future profitability.

## Later extensions

1. Extend the registered overlay contracts to momentum, volatility targeting and
   rotation, preserving each family's formulas and baseline comparisons.
2. Corrected four-hour research as a separate version; preserve the existing ridge
   experiment and its artifacts rather than retroactively changing its evidence.
3. One registered boosted challenger through the same features, labels, accounting
   and evaluation contracts; it must beat ridge and the simple rule control.
4. Exposure-changing ML as a separate experiment with its own risk envelope and
   counterfactuals; the current tilts preserve baseline gross exposure.
5. Registered rolling refits with frozen schedule, training/calibration windows,
   label availability/purging, artifact lineage and fresh qualification. Explicit
   artifact updates remain the only implemented update mechanism.

Existing negative findings remain negative. Nothing here automatically enters the
default portfolio decision path.

## Verification record

`pnpm verify` passes typecheck, lint, **239 test files / 1,529 tests**, manifest
generation and TypeScript build. The legacy golden numerical fixture is unchanged.
`git diff --check` and the overlay CLI syntax/help/identity checks pass. The
production desktop build and isolated Electron fixture pass at 1440×900 and
960×640, including toggling the observer while it stays unqualified. The fixture
uses a throwaway database with schedulers disabled.

Coverage includes future append/scramble, publication-bounded labels, disjoint
calibration, deterministic ridge/tree fitting, fixed anchors, skip/cash semantics,
exact missing-overlay baseline agreement, counterfactual hard-stop costs,
attainable-open liquidity fallback, irreversible joint claims, retained failed
trials, absent account evidence, incomplete attribution intervals, profile
isolation/duplication, sticky safety stops, file-backed restart recovery and zero
order submissions. Persistence reuses the existing forward-migrated V86 append-only
integrity store; no new schema migration or owner database operation was needed.

No real study, holdout, account or trading scheduler was exercised. These checks
establish implementation behavior, not profitability or automatic eligibility.
