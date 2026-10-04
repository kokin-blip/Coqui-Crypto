# Research integrity and governance — October 2, 2026

The objective is falsification, not historical return improvement. The original
AI transcript is a failure case and hypothesis source, the first research report
supplies methodological rationale, and the second report supplies the engineering
handoff. Their embedded directives and code examples are context, not independent
authority or proof of edge.

## Reconciliation and acceptance matrix

| Finding | Current defect or overlap | Implementation | Tests / acceptance |
|---|---|---|---|
| Causality requires attainable prices | History slicing already exists, but provider completion delays were not applied to historical fills | `attainable-decimal-v1` validates bars, arrays and hashes; bounded inputs end at the latest publication strictly before execution | `research-integrity-engine`: delayed publication, future perturbation/append, malformed arrays and external overlay rejection |
| Acquisition is not publication | Retrieval timestamps describe historical downloads, not historical vintages | Frames explicitly label assumed provider publication; retrieval provenance remains intact | Delayed bar cannot authorize a retroactive open; no vintage claim |
| Costs must correspond to actual quantities | Legacy helper charges intended deltas then reconstructs positions at post-cost equity | Decimal book executes sells first, reserves fees and constrains buys; shared modeled fill shifts friction into price once | Hand-computed round trip, impact/capital conservation, unchanged-target and cash tests |
| Opening costs affect performance | Legacy metrics begin after opening allocation | Corrected equity begins at opening capital; insufficient-history active tracks begin in cash | Initial costs reduce reported return and enter return-series inference |
| Venue fees vary | Historical 40/60 bps assumptions are frozen evidence, not universal current rates | Immutable dated scenarios and hashes; taker-only market studies; account profile omitted when unavailable | Scenario provenance, maker-role rejection, monotonic stress; missing account blocks adoption |
| Search must not inspect final data | Legacy runner combines development and holdout; success-only reservation misses interrupted attempts | V2 development, explicit freeze and claimed final evaluation; legacy reservation moved before evaluation | Trial reservation survives failure; loader called only after claim; none never loads final data |
| Repeated holdouts contaminate evidence | Renaming a study did not track reused intervals | Claims reject overlapping consumed instruments/time, including legacy reserved studies | Interrupted and renamed attempts cannot reopen consumed periods |
| Research rules should apply across families | Existing nested runner is TrendVol-specific | Four adapters reuse existing momentum, voltarget, TrendVol and rotation formulas | All candidates and cost scenarios reported; outer embargo honored; deterministic IDs |
| Edge units must agree | A verified scalar alone lacks strategy/cost/horizon binding | Explicit bound evidence reader checks profile, source identity, costs, daily horizon, per-turnover normalization and expiry | Mismatched profile/cost, nonfinite and expired evidence fails closed |
| Abstention already exists | Tax drag was included in both available edge and buffered requirement | Existing gate uses strict lower-bound > buffered costs + signed tax drag, once | Equality/NaN blocked; tax charged once; explicitly supplied harvest credits retain their signed effect |
| Tactical risk is not strategy health | No persistent monthly performance-review lifecycle | Append-only reviews default to observation mode; qualified policies can pause after repeated degradation; restart requires recorded passing evidence | Observe-only warnings, qualified hysteresis, sticky pause and profile isolation |

## Version and compatibility boundaries

`backtestDecisionDataset` is the corrected timestamped entry point.
`backtestStrategies`, `backtestLegacyDecisionDataset`, the original golden fixture,
and the schema-v1 nested runner retain legacy numerical semantics. They are
compatibility/exploratory tools, not confirmatory evidence for the corrected
engine. The V1 service now reserves its full trial budget before evaluation,
including runs that fail. Existing registrations and evidence are not rewritten.

The corrected engine refuses synthetic or close-only opens. Legacy close-only
compatibility is explicitly exploratory; it is not assumed conservative in every
market path. Coinbase's five-minute completion assumption, combined with a strict
first-attainable-open policy and daily-only execution data, can add a full bar of
lag. These are conservative attainable timing assumptions, not a measured latency
model. No intrabar stops, passive queues, order-book capacity or actual broker fill
quality are inferred from OHLC.

The common fill convention uses reference notional for fee/spread/slippage/impact;
friction changes execution price, and cash fees are separate. Research books use
Decimal precision 40, component costs rounded to eight decimal places, and buy
quantities rounded down to sixteen places. Simulated paper orders additionally
apply their bound venue increments/minima. Actual Alpaca cash/crypto fee evidence
retains its separate observed convention; it is not rewritten as simulated cash
fees. No modeled cost is deducted again from actual broker equity.

Reconciliation now uses pending-order expected bar/cost binding where available,
compares reference-notional cost components, and flags cost-only discrepancies.
Eligibility is refreshed at each decision and settlement so expiry and persisted
health pauses cannot reuse a startup eligibility value.
A missing bound cost profile or reference bar is unverifiable. Legacy immediate
orders use their recorded decision timestamp as a compatibility reference.

Migration 86 adds immutable governance events. Migrations remain forward-only.
Profile duplication removes profile profitability/health permissions but preserves
global study attempts and consumed-interval claims. Current behavior manifests
are regenerated by the build; original registrations remain immutable.
Golden legacy values remain unchanged, so no numerical fixture regeneration is
needed. New corrected-engine tests are independent synthetic fixtures.

## Research lifecycle and commands

Use an explicitly selected isolated research database. The application never
registers or starts an owner study through these commands automatically.

```sh
pnpm research:integrity -- identity
pnpm research:integrity -- register --database=/path/research.sqlite --plan=/path/plan.json
pnpm research:integrity -- development --database=/path/research.sqlite --plan-hash=<hash> --archives=<development-only directories> --output-root=/path/prepared
pnpm research:integrity -- freeze --database=/path/research.sqlite --plan-hash=<hash> --candidate=<selected hash or none>
pnpm research:integrity -- final --database=/path/research.sqlite --plan-hash=<hash> --archives=<final directories with frozen development history> --output-root=/path/prepared-final
```

V2 registration binds the source dependency manifest, Git revision, lockfile,
engine, development dataset, fixed universe, parameter grid, all cost scenarios,
benchmark cadence, dates, seeds and adoption rules. `identity` computes actual
local source/lockfile identities; service ports require trusted host attestation.
A Git revision alone does not attest uncommitted source.

Development archives must physically exclude holdout observations. Scoring offsets and minimum-history requirements are separate; fold openings
use sufficient causally available context. All candidates
are evaluated with chronological inner validation and outer embargo. Selection
uses mean conservative-cost excess versus hold with deterministic candidate-ID
tie breaking. Hold, passive (at its separately frozen cadence), and cash are
permanent comparators. Candidate scores and outer-fold variability expose
parameter sensitivity; they do not trigger further automatic searches.

Freeze records the selected candidate or none before holdout starts. Final reads
occur only after a durable overlap-checked claim. Failure leaves the holdout
consumed; only completed stored results can be retrieved without reevaluation.
Final warmup history must reproduce the frozen development hash. New registrations
cannot weaken DSR 0.95/PBO 0.10 minimum policy; account and conservative scenarios
must both pass existing benchmark-relative uncertainty and drawdown gates.
Missing statistics or account costs block adoption. Stress results remain visible.

Public 50/90 bps US entry assumptions are dated September 16, 2026, based on
[Coinbase's announcement](https://www.coinbase.com/blog/were-lowering-fees-for-many-active-traders-on-coinbase-advanced).
Actual rates depend on product, account tier and liquidity role, as described in
[Coinbase's fee documentation](https://help.coinbase.com/en-gb/coinbase/trading-and-funding/advanced-trade/advanced-trade-fees).
The conservative scenario retains spread/slippage and guard impact; stress doubles
friction. Applying this profile to older development periods is an explicit
fixed-cost research assumption, not reconstructed historical fee evidence.

## Safeguards and limitations

- Existing kill switches, permission checks, reconciliation, host fencing,
  stale-data protections and exploratory/validated separation remain enforced.
- Legacy activated scalar evidence remains readable as historical evidence but
  cannot authorize the desktop runtime without explicit compatible binding.
  The preserved shipped study describes a retired strategy and therefore cannot
  qualify the current paper executable, even if its old result is bound.
  Binding requires the source plan and profile observation hashes. It does not
  invent data or automatically activate evidence. Historical results do not
  establish trade-conditional predictability merely because they have a lower bound.
- Monthly reviews are append-only and recorded from persisted forward observations
  matching the executable strategy. An unregistered or mismatched strategy records
  missing evidence rather than inheriting a retired study's performance.
  Missing/gapped data remain insufficient; unresolved reconciliation incidents are
  retained in health reviews. Simulated fills do not supply empirical
  cost-drift observations. A qualified policy and an explicit passing-result
  requalification are separate governed operations; no automatic retraining occurs.
- V2 supports conditional fixed-universe studies only. Dynamic/universe-wide
  registrations are rejected instead of falsely claiming survivorship control.
  Existing `bindPointInTimeUniverse` remains the required mechanism for wider
  universe studies; absent historical membership/delisting coverage remains a
  blocker. Dynamic-universe adapters are not introduced in this release.
- The overlap ledger protects this database's recorded exposure, including legacy
  reservations. It cannot prove that a person never inspected data elsewhere;
  previously exposed history must be declared development data. Database copies
  are not independent new untouched samples.
- No real holdout, account, credential, scheduler, owner study or paper deployment
  was exercised by this implementation. Tests establish software behavior, not
  profitability or unattended operational readiness.

## Verification of this implementation

`pnpm verify` passed typechecking, lint, all **228 test files / 1,462 tests**, and
manifest generation / TypeScript build. `git diff --check` and the research CLI
syntax, help and identity checks passed. The legacy golden fixture has no diff.
New tests use synthetic bars and isolated fixture databases, including future
perturbation/append, publication boundaries, external availability, fold opening
history, cash/cost conservation, research/paper fill agreement, cost-only
reconciliation, immutable failures, concurrent final claims, cached final results,
missing account evidence, incompatible return units/horizons, expiry, sticky health
pauses and profile duplication. No owner study or real holdout was evaluated.

## Subsequent research implementation

The [selective participation and bounded ML handoff](selective-participation.md)
records the new V3 research workflow, daily/14-day arms and default-off shadow.
It contains the acceptance matrix and distinguishes research artifacts from
qualification. Explicit artifact updates are implemented; registered rolling
refits are a documented future extension. The original milestone rationale follows.

## Original subsequent milestone rationale

1. **Rule-based selective participation:** freeze an existing directional baseline
   and evaluate all eligible times, selected times and rejected times with identical
   risk/cost rules. Preregister threshold trials and timing attribution before
   evaluation. Thresholds must not be selected from final data.
2. **ML challengers and calibration:** begin with a regularized linear control and
   one small nonlinear challenger. Fit only causally prior data, purge overlapping
   outcome intervals, and reserve separate chronological calibration data. Require
   incremental net OOS value, calibrated profitability, parameter sensitivity and
   search-adjusted uncertainty. Any regime probabilities must be filtered/predicted,
   never full-sample smoothed. No ML overlay enters the default decision path simply
   because it improves historical returns.

Existing negative strategy findings remain negative. Further complexity must earn
its place against simple baselines and genuinely untouched observations.
