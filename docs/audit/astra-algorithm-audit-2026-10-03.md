# Algorithm audit and corrections — October 3, 2026

This audit examines the current working tree, including the existing uncommitted
research-integrity and overlay work. It is a software and research-method review,
not a new performance study. No owner database, historical result, consumed
holdout, or strategy registration was changed. Tests use synthetic data and
temporary or in-memory databases.

## Confirmed defects and corrections

### 1. Paper execution could use an opening that preceded submission

Both standard and exploratory paper loops bound an order to
`latestCompletedStartMs + one day`. A decision made after the latest daily bar
was published therefore selected an opening that had already happened. The OMS
accepted this context and later priced the fill at that old open. Settlement also
trusted `isComplete` without checking the clock against the bar's publication
time.

Correction: `firstAttainableDailyOpen` chooses an opening strictly after the
decision, preserving the daily bar grid. The OMS independently refuses new
submissions at or after the bound opening, so a delayed human approval cannot
recover a missed price. Existing submissions remain idempotent. Legacy pending
orders recorded after their bound opening expire with
`execution_open_not_attainable`; their original records remain intact. Settlement
requires completion plus the source-specific publication delay. A missing bar is
not declared missing merely because a supplied future bar is marked complete.

Example: a signal read at 00:10 after yesterday's daily candle becomes available
can target the following day's 00:00 open, not the 00:00 price ten minutes ago.
This agrees with the corrected historical engine's conservative daily-open
timing convention. It does not model intraday fills.

### 2. The standard paper planner excluded ledger cash from its sizing base

`runPaperDecision` passed non-cash holdings to `planAutoRebalance`, which computes
portfolio value from those holdings alone. TrendVol's weights are fractions of
total capital, including cash. The mismatch could retain unintended cash when
exposure rises or sell repeatedly when the intended defensive allocation is
already satisfied.

Reproduction: two positions worth $1,100 each plus $220 of cash, with 50/50
targets. The old path returned `no_intents`; the correct target is $1,210 per
position, requiring a $110 buy for each.

Correction: both paper loops use the existing cash-inclusive planner, now named
`planPaperRebalance`. The standard executable identity becomes
`trendvol-paper-v2-unvalidated`, with a distinct campaign code hash. The old v1
type remains readable for historical plans. Profitability and risk gates still
apply to every proposal; this change does not confer validation or permission.

### 3. History completeness omitted configured windows

`trendVolMinimumHistory` omitted the asset-level momentum volatility window.
Target composition also inferred completeness from the mix length even when an
individual asset had less history. Separately, corrected research accepted a
short configured warmup once any volatility estimate and momentum statistic
existed, even if the full volatility window or trend gate was unavailable.

Correction: shared minimum-history functions cover all active momentum horizons,
asset volatility, portfolio volatility, and the trend gate. Current and indexed
TrendVol reads account for the shortest required asset series. Corrected research
stays in cash until both the plan's history requirement and the strategy's actual
requirements are met. Standard paper decisions explicitly stand down on partial
history. Legacy backtest numerical behavior is retained.

Reproduction: a three-day momentum horizon with an eight-return volatility
window needs nine closes; a twelve-close trend gate needs twelve. The old
research path traded earlier. Tests now enforce the exact boundaries.

### 4. Overlay replay performed weaker provenance checks than shadow/final use

The public replay entry checked artifact envelope dates and several hashes but
did not validate the model's training endpoint or source-manifest identity. A
model trained after its stated calibration period was accepted, as was an
artifact identifying different source code. Final evaluation and shadow use
already had fuller validation; this finding does not establish that their stored
results were contaminated.

Correction: replay invokes the same full artifact validator, retains the
first-decision availability check, and checks the registered universe order.
Regression tests reject future-trained and wrong-source artifacts and compare
replay/shadow outputs for unavailable, accepted, and rejected model cases.

## What explains the legacy zero-lift ML result?

The frozen summary described in `ml-shadow-reliability-v2-2026-10-02.md` reports
identical baseline/overlay returns. Its underlying evaluated paths were not
replayed in this audit, so the exact historical cause remains unproven.

The current legacy proposal function provides a concrete mechanism to test:
`proposeMlTarget` accepts a deviation only when its predicted incremental benefit
exceeds twice `ML_SIDE_COST` times turnover. With its frozen 0.5% one-way cost,
a uniform predicted four-hour return of 1% or less does not justify increasing
exposure. A uniform 1.1% probe does produce a bounded change. New tests establish
that this threshold works and that the proposal path can change targets. They
do not establish that historical predictions crossed it. Fees were not reduced.

Missing artifacts also intentionally reproduce baseline behavior in the newer
overlay. Those paths expose fallback counts, and final qualification requires
usable model evidence. Fresh studies should examine eligible decisions,
predictions, proposed changes, actual differential fills, fallback reasons, and
net excess returns together. A prediction count alone is not evidence of a
working trading overlay.

## Implementation equivalence and remaining limits

- Standard paper, parallel paper, and research share the TrendVol target
  formulas, but their complete trading policies differ. The parallel sleeve
  freezes a mix anchor; standard paper derives the mix from supplied history.
  Rebalance bands, scheduling, sizing constraints, and fill paths also differ.
  Research returns cannot be assigned to a different runtime merely because
  both are called TrendVol.
- The original forward study remains incompatible with the current executable
  identity. Its bound edge remains unavailable; no evidence gate was promoted.
- The corrected book's cost-conservation tests and the legacy golden backtest
  remain part of verification. No cost coefficient or fitted strategy parameter
  was optimized during this audit.
- Model/schema labels alone do not identify source changes. Existing immutable
  registrations must retain their source hashes; a new experiment must bind the
  current source and lockfile identities.

## Bounded next experiment — proposal only

Use the existing integrity-study lifecycle to register four development
candidates: `rebalanceEveryDays` in `[14, 28]` and `defensiveScale` in `[0.2, 0.35]`,
with every other formula and parameter fixed. These are two explicit hypotheses:
less frequent rebalancing may reduce turnover costs; less severe asset-level
defense may reduce redundant exposure cuts when the portfolio trend gate is
already active. Neither hypothesis is established here.

Count all four trials, including the interaction, before running. Keep hold,
fixed-cadence passive, and cash controls; keep the same account, conservative,
and stress cost assumptions. Report every candidate, fold, cost scenario,
turnover, drawdown, and benchmark-relative uncertainty. Treat already inspected
historical intervals as development only. Freeze one candidate or none before
new final observations begin, and evaluate final data once through the existing
durable claim. Missing account costs or inadequate evidence means no adoption.

This proposal has not been registered or run. An owner study needs an explicit
verified development dataset, its interval/consumption history, account cost
evidence, and prospective final dates. First establish a full replay of the
specific runtime policy that the study is intended to qualify.

## Verification

Focused regression runs reproduced the defects before correction and passed
afterward. Final `pnpm verify` passed on October 3, 2026 (America/Phoenix):

- Both TypeScript checks passed.
- ESLint passed.
- All 241 test files / 1,544 tests passed, including the unchanged legacy golden
  backtest, cost conservation, paper reconciliation, replay/shadow agreement,
  late submission, legacy expiration, and publication-bound settlement checks.
- Behavior-manifest generation and the TypeScript build passed. Generated
  current source hashes changed; stored historical registrations were untouched.
- `git diff --check` passed.

These checks establish software behavior on fixtures. No new market-performance
study, owner-host paper run, live broker validation, or profitability claim was
made. The repository's pre-existing uncommitted work was preserved.
