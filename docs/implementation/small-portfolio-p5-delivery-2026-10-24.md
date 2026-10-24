# P5 offline strategy and policy experiment capability

October 24, 2026, America/Phoenix. **P5-A–G capability implemented and verified locally; P5-H development evaluation pending.** Based on pushed P4 commit [a015711c29a10d768f0d0b40d467a75c1bd0adac](https://github.com/kokin-blip/Coqui-Crypto/commit/a015711c29a10d768f0d0b40d467a75c1bd0adac), branch `codex/operations-crew-journal`. P5 is uncommitted and unpushed. Human review and an exact source-isolated closure before a requested commit remain separate from these combined-checkout checks.

The unchanged [P0–P7 roadmap](small-portfolio-profit-policy-plan-2026-10-23.md) remains authoritative. The unchanged [accepted P5 design](small-portfolio-p5-implementation-plan-2026-10-23.md) retains every requirement, dependency, hypothesis and gate. The [phase tracker](small-portfolio-phase-tracker-2026-10-23.md), [acceptance evidence](evidence/p5-contest-2026-10-24/README.md) and [COQ-39](https://linear.app/coqui-crypto/issue/COQ-39/implement-p5-small-portfolio-strategy-contest-and-separate-policy) distinguish tooling from actual research completion. P6/P7 are not started.

## What is delivered

`capital-contest-v1` is an explicit offline development engine. It compares finite, declared policy configurations using independent capital-aware books at $50, $100, $250, $500, $1,000, $2,500, $5,000, $10,000 and the diagnostic $100,000 control. A run cannot select a different hindsight winner for each balance. Its outputs always carry `confirmatoryEligible: false` and `liveExecutionPermitted: false`.

| Batch | Local delivery and evidence |
|---|---|
| P5-A | Strict contracts, complete trial inventory, source identities, bounds and causal kernel extraction. Six archived complete P4 result hashes reproduce exactly; original P4 suites remain unchanged. |
| P5-B | Simple absolute trend/cash, buffered rotation, one explicit allocator configuration, hold/passive/cash and prior-training exposure controls. Dated history/membership, actual decision-time book, deterministic ties/dust, down-only risk caps and cash residuals. |
| P5-C | Explicit legacy-shaped and band-edge intent rules through the same P2 constraints. Reference target streams are matched; mandatory exits remain independent. Volatility, buffer and weighting alternatives are diagnostic enumerated variants. Partial adjustment is an intention, not a fabricated partial fill. |
| P5-D | Separate 0/25/50% distribution experiments, explicit floor/batch sensitivities, strict P3 backing and a separately versioned economic-cash counterfactual. Hypothetical full-exit cost/basis/native consequences never fund eligibility or modify a book. |
| P5-E | Joint-row stationary resampling with full in-path signals, calibration, books, fees, funding and reserves. Paired Bonferroni basic intervals, tail-resolution checks, DSR/PBO adapters and global candidate-or-none gates. Fold, rolling, capital and cost safeguards remain mandatory. |
| P5-F | Append-only journal, bounded chunks, explicit resume, original-governance preflight, dedicated physical input panel, real CLI/export/reconstruction, read-only IPC and Research inspection. Backup/copy/restore preserves origin and grants no authority. |
| P5-G | Focused/full/CLI/production-preload/lifecycle/safety/UI checks, compatibility and dirty-file preservation evidence. Review remains open; isolated commit verification is required before committing. |
| P5-H | **Not run; pending evidence and owner manifest choices.** No empirical winner, strategy efficacy, reserve share recommendation, fresh holdout or qualification is claimed. |

The full seed S/E/R inventory validates at **1,053 cells**. Separate `scenarios` enumerate cost/funding cases while each financial batch stays within unchanged P4 bounds; V, sensitivities and cap-review variants add their own visible inventory positions. No grid is silently reduced to satisfy resource limits. Synthetic smoke jobs use smaller explicitly declared inventories and are not the full market evaluation.

## Architecture and compatibility

- Core: `packages/core/src/research/capital-contest-{types,manifest,signals,execution,reserves,sales,paths,evaluation,report}.ts` and `capital-contest.ts`. A narrow internal `capital-replay-kernel.ts` exposes causal hooks. The public `capital-replay.ts` wrapper stays on the frozen v1 path and accepts no new runtime hooks. Its exact original source is archived; six full-output golden hashes and original regressions guard identity and numerical compatibility.
- Contracts: `packages/contracts/src/schemas/capital-contest.ts`, exports and two read routes, `research.capital-contest.runs` and `.detail`. Strict bounded input/output contracts have no core runtime dependency and introduce no write-channel entry.
- Storage: `packages/storage/src/repositories/capital-contest.ts` uses the existing immutable `research_integrity_events` journal under `capital-contest:<manifestHash>`. Dedicated spec/inventory/attempt/input/cell/path/chunk/result/choice/failure/interrupted kinds preserve all attempts. Schema remains **98**; no migration or existing financial table rewrite. Profile impact uses the existing research category.
- Services: `packages/services/src/research/capital-contest.ts` and `capital-contest-data.ts` bind runtime, original profile, source and registry identities; validate governance before invoking the loader; persist inventory before performance data; enforce lifecycle/deadline/cancellation and encoded-output quotas; resume deterministically and reconstruct saved path hashes read-only.
- Desktop: `capital-contest-handlers.ts` only reads local evidence. `CapitalContestResults.tsx` joins existing Research; it pages cells/decisions/paths, explains none/unavailable/archived/interrupted states, shows assumptions and uses existing metric help. New queries do not poll. Selected labels distinguish managed/active equity, simulated receipts, period TWR and annual ACT/365 IRR. Display truncation/ellipsis never changes canonical stored numbers.

Financial calculations reuse P1/P2/P3 and P4 book mechanics. P0–P3 source and protected financial semantics are unchanged. Current generated dependency manifests change as dependency closures change; exact pre-build copies are retained. Historical registrations, frozen results, consumed holdouts, negative findings and old source identities are not migrated.

The counterfactual economic-cash evaluator has a separate simulation-only identity. An independent $500 fixture has economic gain H=$20 and actual realized gain=$0: strict backing reserves $0; the counterfactual reserves $5. Actual realized/basis fields stay unchanged and the operational P3 reducer rejects that preview identity. This demonstrates mechanics, not a reason to relax operational backing. Fixed operating requests are explicit for every capital; held assets never become a cash-only feasibility witness.

## Evidence and numerical limits

Decisions use the earlier causal book cut and completed, available history. Later closes, deposits, fills or membership changes cannot repair an earlier unavailable decision. Initial state is the declared planned opening book, not an invented observed pre-origin account. Target caps leave residual cash; no minimum-size rounding increases risk.

Execution prices, quantities, fees, capital and NAV arithmetic use decimal text/arithmetic. Signal/statistical helpers retain their separately identified numerical convention; reconstructed scenarios use a declared 20-significant-digit convention. Missing rows, timing, prices or evidence produce typed unavailable results. Publication assurance cannot be called observed without matching availability evidence.

Each conditional path regenerates the reference stream before matched execution/reserve comparisons. It reruns funding, fills, costs, reserve decisions and NAV inside the path. Replicas and nine balances share history; they are not independent alpha discoveries. Only contiguous supported fixed-universe panels receive stationary resampling. Gaps/status/delisting changes retain original-calendar stress and block dependent uncertainty. Stationarity and join assumptions remain limitations.

Intervals use the full declared primary family and replication inventory, with at least 20 nominal tail draws at used quantiles. Insufficient history, blocks, trial assurance, daily NAV or numerical support withholds dependent statistics/selection. Non-synthetic claims of complete or conservatively bounded search history require the original read-only registry hash and count. A local inventory cannot repair a global search gap. DSR/CSCV diagnostics grant no qualification.

Memory is bounded for detailed values and compact summaries; complete base evidence and saved conditional indices/metrics/book hashes support exact offline reconstruction. Quotas apply to encoded journal/output bytes, not a claim about filesystem free space or SQLite page overhead. Default invocation has a deadline; an impractical full evaluation must be budgeted/checkpointed explicitly, not reduced after seeing outcomes.

## Offline use

Use the repository's Node 24 toolchain and build first. `pnpm research:capital-contest -- identity` prints the current code/source/lock identities. Commands are `identity`, `validate`, `run`, explicit `resume`, and `report`.

`validate` requires explicit `--manifest`, `--profile-manifest`, `--profile-id` and `--database` paths. The profile must already exist, be inactive and empty, and its database must already have the current schema; the command creates/switches no profile and applies no migration. Validation reports declared work without reading performance data bodies.

`run`/`resume` additionally require `--input-manifest` and an existing `--output-root`. Non-synthetic exposed development requires `--governance-database` pointing at original read-only governance metadata. The dedicated input-file manifest binds version/kind, provider/exposure, warmup/evaluation interval, contained relative panel path, exact byte count and SHA-256; its hash must be in the experiment source references. The panel contains raw warmup/market frames, dated membership and, where claimed, observed availability. Symlinks, escaping paths, mismatched partitions and changed/oversized content are refused.

`report` exports a completed immutable manifest/result pair. With `--path-index` and optional `--cell-id`, it can reconstruct stored conditional evidence using the exact runtime and verify every saved book hash. Exact retry/report uses durable evidence even if the input panel is subsequently absent. Changed assumptions need a new linked manifest. Interrupted/failed attempts remain visible.

The app provides inspection only. There is no Run, Adopt, Enable, reserve-execution or withdrawal control. No provider acquisition, credentials, new scheduler, registration/final-claim, collector, financial action, strategy activation or release occurred.

## Verification

| Check | Result and scope |
|---|---|
| Repository tests | **323 files / 2,321 tests pass** before the final display-only correction. The first full run exposed missing route entries in the secret-canary registry; both routes are now actually exercised by that suite. Failed/intermediate logs are retained. |
| Final P5 suite | **14 files / 44 tests pass**, including the additional annual-rate/display regression after correction. Independent arithmetic, property sequences, positive selection oracle and negative/unavailable gates validate machinery, not empirical success. |
| Final display/compatibility check | **2 files / 14 tests pass**, including all six unchanged full P4 hashes. |
| Typecheck/lint | Repository checks pass after display correction; final native-harness lint also passes. |
| Builds | Root build and final production desktop build pass. Existing bundle-size advisory remains. |
| Actual disposable CLI | **9 checks pass**: real run/retry/export/read, active-profile refusal, zero financial/paper/registration rows. |
| Production desktop | **22 checks pass** through real dispatch/preload: bounded reads, database read isolation, none/interruption, keyboard selection/help/focus return, rate labels/intact numeric spans and disabled live authority. Dark desktop, narrow light and high-contrast 200% evidence saved. |
| Existing native safety | Standard Stage 2.4 smoke reports **ALL PASS**. |
| UI handoff | Reviewer scored both named material fixes **resolved**; `ship` covers those two fixes only. Incumbent design documentation is preserved. Detector ran once with `[]`. |
| Preservation | **498/507** pre-existing dirty entries byte-identical; nine intentional overlaps have exact inverse/archive proof. **28** protected files unchanged; only the permitted P4 kernel extraction has archived-source plus six-golden compatibility proof. Index and HEAD unchanged. |

Default sandbox Electron aborted before application startup; the same disposable synthetic checks passed with approved native execution. They disable scheduler/provider access and use temporary profiles. They do not inspect the installed financial profile. All raw logs, including earlier failures, are retained under [evidence/logs](evidence/p5-contest-2026-10-24/logs/).

## Remaining P5-H and later requirements

Before actual evaluation, freeze the permitted provider/source and universe, rights and point-in-time eligibility/availability coverage, exact development/warmup boundaries, cost/rule assurance and scenarios, current allocator/risk policy, primary feasible capital region/weights, funding/expense schedule, distribution sacrifice/downside objective, original global trial metadata and sample/power/resource budget. Those inputs have not been established here. Do not infer them from synthetic fixtures or choose them after outcomes.

Run all declared cells/paths only when readiness is established; retain every unavailable, infeasible, failed, negative and none result, and package the resulting conditional shadow proposal. Capability completion is not actual research completion. No positive-return acceptance target is required. A lack of adequate evidence can require a revised prospective design, not a relaxed threshold.

Breakout, bounded mean reversion, fixed blends/selectors, calibrated ridge/shallow-tree filters, allocation components and audited news/on-chain/attention remain retained but unevaluated hypotheses with original failure criteria. The negative TrendVol/PBO finding and consumed holdout remain intact. P6 retains default-off operational review/ownership/OMS/fencing/kill/pause/manual Resume/unknown-outcome gates. P7 retains owner-approved fresh registration, future observations, original coverage/action/statistical/risk gates and final-claim-once controls. External payouts/live trading remain outside this roadmap's enabled capabilities.

**Prompt used**

Ok move onto building P5 using the saved plan. Preserve P0–P4 and the full P0–P7 scope, and keep the phase tracker updated.
