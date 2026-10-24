# P4 implementation plan: capital-aware replay and reserve simulation

October 23, 2026, America/Phoenix. **Planning complete; no P4 application code written.** P3 is committed and pushed as [9c6b2fccebc9e809ba2800fc538e831bab0c5c66](https://github.com/kokin-blip/Coqui-Crypto/commit/9c6b2fccebc9e809ba2800fc538e831bab0c5c66) on `codex/operations-crew-journal`. P0/P1 remain in 0c3d36c and P2 in aff6b60. P3's exact isolated closure passes 293 files / 2,106 tests, typecheck/lint, root/desktop builds, native safety smoke and 24 P3 native checks. Its earlier combined-checkout evidence is retained separately.

The [original P0–P7 roadmap](small-portfolio-profit-policy-plan-2026-10-23.md) remains the durable source of truth. This addendum makes **P4 only** implementation-ready. The complete accounting, reserve policy, small-portfolio execution, architecture, UX, evaluation, dependency and acceptance requirements were reread, including requirements outside the P4 table row. [Tracker](small-portfolio-phase-tracker-2026-10-23.md). [Inspection/probe evidence](evidence/p4-capital-replay-planning-2026-10-23/).

## 1. Boundary and settled decisions

P4 delivers **offline development research mechanics**, not a strategy contest, a new registration or an operational reserve. It replays one explicitly frozen desired-decision tape independently at **$50, $100, $250, $500, $1,000, $2,500, $5,000, $10,000 and $100,000**. The final amount is a diagnostic control. Every book, order, fee, flow, reserve and denominator is calculated at that size; an equity curve is never scaled from another book.

- Introduce `capital-aware-replay-v1` separately from `attainable-decimal-v1`. Do not modify the numerical behavior, study shapes, registration hashes or default opening amounts of existing engines, collectors or registered studies.
- Reuse P1's exact economic P&L/unit-NAV/dated-IRR calculation, P2's shared budget/native legality/feasibility, and P3's pure policy/cycle/assessment/release reducers. Use scenario adapters with their own identities. Do not populate observed capital tables or call P3's database mutation service to simulate history.
- Default reserve share is zero/keep invested, cash and reserve yield are explicitly zero, and automatic sale funding remains absent. A declared nonzero reserve setting models the existing strict economic **and** net-realized-profit cap, from already eligible cash. All three P3 triggers remain supported. Wins remain advisory.
- A fixed decision tape freezes desired weights/actions, causal availability and risk-exit reasons, not executable quantities or fills. Quantities change with each book's actual path. Do not increase risk or choose a different policy per balance to make a trade work.
- Run only synthetic fixtures and explicitly exposed development inputs. No historical market run is necessary for this planning task. P4 has no register/freeze/final/promote/adopt command and cannot open sealed performance bodies or consume a final claim. P5 selects finite signal/execution/reserve variants; P7 owns fresh prospective qualification.
- Use a dedicated offline research profile/database and explicit output directory for execution. The desktop may read already recorded local results through new read-only channels. It cannot launch a run, register a study, save an enabled paper policy or import financial facts.

Local source and synthetic probes resolved the phase-specific questions; no broad literature repeat or new current venue-rate assertion was needed. No product decision is needed to begin P4-A. Actual account terms, historical rules, signal choice and future study choices remain evidence/configuration requirements, never defaults inferred from a large account.

## 2. Verified code findings

These are source and synthetic-probe facts, not installed-account findings or market backtests.

| Component / finding | Reuse or required treatment |
|---|---|
| `backtest/execution-timing.ts` validates complete aligned daily bars, content hashes and the first attainable open strictly after publication | Reuse timing and prefix invariance. Keep assumed publication delay distinct from historical observed availability. A newly versioned envelope retains original decimal market strings for execution/accounting. |
| `backtest/integrity-engine.ts` initializes each family with $10,000 and reports cost percent using that denominator; no external-flow/reserve path exists | Preserve this engine. The new replay must carry opening capital and flows through the full book, benchmarks and metric pipeline. |
| `backtest/integrity-book.ts` is decimal/self-financing, with sell-first modeled fills and cash-fee affordability, but does not enforce P2 native minima, increments or discretionary floors | Reuse cases and cost principles, not its unconstrained fill loop. The synthetic probe buys $2.50 at $50/5% despite a configured $25 useful-trade threshold; P2 rejects that same request under an explicit $25 floor. |
| `execution/remediation-book.ts` opens at $100,000; `research/remediation-evaluation.ts` repeats that opening in P&L, drawdown and daily-return denominators | Preserve frozen remediation numerics. Do not fix one constructor and call the full path parameterized. |
| `research/execution-replay.ts` accepts an opening amount but uses number arithmetic and its own $25/fee convention | Retain historical outputs; do not make it the new canonical capital replay. |
| `research/study-instance.ts` requires `common_cash_100000`; registered family runners bind engine/data/cost/source identities and final-claim gates | Do not widen this identity or silently restart instances. A development replay specification is a different artifact, not a replacement registration. |
| P2 feasibility returns exact quantities/debits/delivery, native/risk residuals and scenario provenance; proposed sales do not fund buys in the same projection | Use it at every execution step. Apply a supported modeled sell fill, then produce a new budget before a buy can use its proceeds. No spending an intention. |
| P2 freshness is tied to an injected clock and native observations, with 30-second budget/rule bounds | Replay uses a logical event clock. Static historical-rule scenarios need an explicit materialization adapter retaining original provenance; never rewrite an old observation into a fresh observed rule. |
| P3's evaluator subtracts its modeled reserve/tax state; P2 can also subtract claim subsets | Define separate evaluation and executable budget projections below. A modeled dollar must not be subtracted in both projections twice. |
| P3 investment fills use gross quantity, execution price and USD fee; P2 can charge buy fees in received crypto | Add a replay lot/fee adapter with exact cash debit and delivered units. Do not divide cash cost by net units into a repeating synthetic execution price, or treat missing acquisition basis as opening market value. |
| P1 exposes exact total economic performance but intentionally leaves account-scoped lot P&L unavailable | Keep P1 unchanged. Use the replay's exact scoped investment projection for simulated realized/unrealized metrics and P3 eligibility. |
| Archive preparation converts price text to numbers; archive verification reads the entire archive before filtering | Check manifest bounds **before** calling verification/query. Require physically separate allowed development partitions; filtering a mixed development/final archive afterward is insufficient. Preserve raw decimal execution prices alongside numerical signal arrays. |
| `ResearchWorkerPool` accepts a percentage-return envelope, not a capital/order tape | Do not feed it a scaled return series or change its protocol. Reuse bounded work/abort principles; initial replay is a bounded offline service/CLI, without an app background worker. |
| `accounts/profiles.ts` has an in-process operation gate, not a cross-process CLI/account lock | Do not claim that gate proves CLI exclusivity. Bind CLI writes to an explicit inactive offline profile and manifest revision, use short SQLite transactions and stop on lifecycle changes. No financial authority is needed or granted. |
| `research_integrity_events` is append-only and hash-checked; it has unrestricted kind names and namespace uniqueness | Reuse it through a typed, bounded P4 repository. New P4 kinds must never be named `plan`, `freeze`, `final_claim`, `final_result` or shadow/authority kinds. No migration is presently needed. |

The evidence inventory includes committed and working hashes separately. Unrelated execution/hourly changes are still present; implementations must inspect the dirty baseline and isolate overlaps before committing. A similarly named historical `docs/p4-completion-audit.md` belongs to a different roadmap and cannot establish this P4's completion.

## 3. Input contracts and immutable identities

Add strict `CapitalReplaySpecV1`, `CapitalReplayTapeV1`, `CapitalReplayEventV1`, `CapitalReplayResultV1` and unavailable-reason schemas. Amounts, quantities, prices, costs and outputs use canonical decimal text; timestamps and proven event sequence use safe integers. Numeric indicators may retain the existing signal convention, but do not become monetary balances. Round only at declared venue/currency boundaries; display rounding never feeds state.

The specification binds:

| Input | Required material |
|---|---|
| Purpose and identity | `mode: offline_development`, `confirmatoryEligible: false`, `liveExecutionPermitted: false`, origin/workspace identity, spec hash, engine/metric/lot versions, code revision, exact dependency/lockfile hashes |
| Data boundary | Allowed development interval and warmup interval, declared exposure classification, exact instruments/provider, archive/partition hashes, raw decimal tape hash, numerical decision-data hash, publication/timing model, coverage report |
| Frozen decisions | Policy/source/parameter identity, decision tape hash, unique decision IDs, decision/available/observed-through times, desired weights, per-asset reason and priority, independent review/risk schedules, deliberate abstention versus not scheduled versus missing history |
| Capital cells | All nine balances, explicit cash and opening holdings/basis for each cell, opening valuation/time, no leverage or negative holdings; no implicit $100,000 origin |
| Flow schedule | Dated USD contributions/outflows, amount rule per cell, account debit, fees, net receipt/purpose/status, optional synthetic internal movements and correction lineage; no-flow, fixed periodic and interrupted schedules separately identified |
| Native rules | Exact market-quantity form/increments/minima/maxima/status/time-in-force, source and timestamp/coverage; observed-at-the-time evidence or explicitly static scenario; unknown fields remain unknown |
| Costs | Venue/product/role, fee currency and basis, proportional/fixed fees, spread source, adverse slippage/impact convention, posting lag, cash/reserve yield, in-account versus external expenses, source assurance and valid interval |
| Risk and execution | Original strategy and stricter account caps, turnover/reset window and already-used amount, order priority/count/size, discretionary floor and independently declared risk-exit exception, immediate/delayed/partial/unknown fill convention |
| Reserve policy | P3 version/settings/activation boundary, review calendar, fixed-base semantics, operating objective/request, baseline H/cycle lineage, manual tax-hold backing, predetermined modeled release/outflow schedule |
| Run limits and variants | Enumerated cells/scenarios and stable IDs, path/seed, resource bounds, full variant inventory and prior attempts. No implicit Cartesian optimizer or dropped failed cell |

Run hash = hash of canonical spec + complete tape/input manifest + component/source versions. Cell hash adds its exact opening, flow schedule, cost/policy/path ID and balance. State/event IDs additionally bind the parent state and economic sequence. Identical retry returns the existing artifact; changed input requires a new identity. Observation/log wall time is metadata, not a financial effective timestamp or a hidden parameter.

Start with one explicit input tape, plus cash, constrained buy-and-hold and declared-cadence constrained passive controls. All receive matching initial holdings, funding, instrument universe, rule/cost assumptions and applicable risk caps. Cash is deliberately inactive; a requested order blocked by constraints is reported as blocked, not successful abstention. No target normalization may invest a permitted cash remainder or raise top-one concentration. Reserve comparisons pair the same signal with keep-invested; the full 0/25/50% contest remains P5.

Initial bounded service limits: at most 256 explicitly declared cells, 10 instruments, 5,000 daily observations, 100,000 normalized events per cell and 64 MiB aggregate detailed trace output. Reject oversized work before execution; do not truncate a result or select a convenient date range. Cell execution checks AbortSignal/deadline at event boundaries. Larger work needs an explicit reviewed bound change or separate linked batches whose full inventory is retained.

## 4. Event loop, book and costs

### Causal ordering

Validate the entire permitted input envelope before running. Freeze one target tape before examining cell outcomes. Its targets may come from an existing policy's exposed development decision trace; the import must verify signal/source/timing identity. State-dependent targets such as holding-buffer rotation cannot be reconstructed independently at each balance and still called the same-decision experiment. P4 evaluates the frozen tape conditionally. P5 may add a separately identified closed-loop policy comparison, using the same policy rules but honestly reporting changed decisions.

Use `(effectiveAtMs, explicitSequence)` and a versioned phase order. At a timestamp: resolve previously scheduled modeled settlements/corrections; value the book before/after supported external flows; apply the current attainable decision; finish declared modeled sell fills; rebuild budget and evaluate buys; record post-fill/fee valuation; perform a scheduled reserve review against that completed cut; record the closing mark. Each phase uses only information available at that time. A review cannot use an unposted future fee or a later close. Sequence is a simulation convention recorded in the spec, not a claim about provider ordering.

Keep decision time, earliest attainable execution, execution-model time, fee posting, observation and recording times distinct. With an immediate-fill model, a buy may use cash only after the simulated sell has actually settled and a new budget revision exists; the assumption is labeled. A delayed/partial/unknown sell cannot fund a buy. There is no broker API, OMS submission or runtime ledger mutation.

### Exact replay book

Maintain one total managed book: cash, positions, supported receivables/liabilities, lots, cost/fee obligations and append-only events. Cash reserves/tax holds/pending subsets reference that book, not duplicate cash balances. Each event reconciles quantity/currency debits and credits. Corrections create revisions and a new result linked to its predecessor; old output reproduces unchanged.

- Opening economic value, opening cash and known/unknown acquisition cost remain separate. Cash-funded synthetic fixtures explicitly prove their origin. Never call the legacy tracked-holdings initializer to manufacture a cash book.
- Compute quantities from desired exposures against **current active NAV** after existing modeled reserves. Net blended intentions before orders; retain attribution. Apply P2 legality and hard caps at the actual capital and execution cost. Expose target/requested/rounded/delivered quantities, partials, rejected intentions and residual dust.
- Track one-way turnover using the declared notional and reset window. Requested versus executed turnover are separate. Required exits may bypass only the explicitly enabled discretionary screen; native rules, quantity ownership, freshness, hard stops and residual risk still apply.
- Buy fees in received asset reduce delivered holdings; acquisition cash cost is exact. USD sell fees reduce proceeds once. Preserve actual fee-asset quantity and its supported USD attribution separately. Unsupported third-asset valuation makes dependent metrics unavailable. Do not approximate net-unit basis by dividing and later multiplying a repeating execution price. Lot allocation preserves exact remaining cost, with the final disposal consuming the exact residual.
- Unknown opening basis can coexist with available economic P&L/TWR; it blocks affected realized eligibility. Late fee evidence changes the current cost/eligibility projection once and blocks new assessments while incomplete. Do not use known future fees to make an earlier review look reconciled.

### Cost models and native-rule scenarios

Use a separately versioned replay cost envelope, rather than relabeling the Coinbase-only legacy `VersionedCostScenario` as universal. Support USD and received-side fee conventions, fixed in-account fees and external overhead. Fee basis is explicit: execution notional, reference notional or received quantity are different models and cannot be silently converted. Existing `modeledFill` can be reused only for its exact USD/reference-notional convention.

For the first shared P2 execution adapter, use execution-notional fees, actual or declared bid/ask, fixed adverse slippage and an explicitly declared impact allowance. Where a scenario uses square-root impact, compute a conservative per-frame price-friction bound from the maximum requested notional, run P2 under that bound, and retain the bound as the charged model. Label it `bounded_request_impact_v1`; it is not a reimplementation of the legacy quantity-specific impact result. Expose the bound and actual sized notional. Invalid/nonpositive bounds or unsupported fee bases return unavailable; they do not drop impact, substitute zero cost or fall back to the legacy fill. Compatibility fixtures compare overlapping supported conventions only.

Apply spread/slippage/impact in execution price; separate attribution is not a second debit. No OHLC-derived queue position, liquidity, spread history, favorable limit fill or market capacity is invented. Taker immediate fills are an explicit model. Breakout/stop touches in one bar require a frozen conservative rule or exclusion; no favorable inferred sequence. Initial P4 does not add a breakout signal adapter.

Base/conservative/doubled-variable-friction cases are named assumptions, not current account prices. Double proportional fees and declared price friction consistently; keep fixed external expenses separate unless a fixed-cost stress is explicitly declared. Missing account terms cannot yield an account-verified cell. Dynamic tiers require declared starting tier/history, supported qualification rules and causal turnover; otherwise unavailable, never a large trader's tier.

Historical observed native rules retain original times. A static-rule scenario stores both its acquisition provenance and its **assumed replay interval**. A pure adapter materializes a short-lived scenario rule at the logical execution timestamp, references the immutable assumption and retains the original observation in provenance. This satisfies P2's injected-clock contract without claiming a current observation in the past. All derived reports remain scenario assurance. Missing or out-of-interval rules defer orders with reasons; no guessed fractional minimum.

## 5. Reserve accounting and performance

### Reuse without double subtraction

At each scheduled review create two explicit projections from the same virtual source/cut:

1. **Executable budget:** P2 includes the virtual profit/tax claims matching modeled reserve state. Strategy purchases cannot spend that cash; active NAV excludes it once.
2. **P3 assessment input:** omit only those same modeled reserve/tax subsets from the financial budget supplied to P3, because its existing evaluator subtracts `state.reservedUsd`/`taxHoldUsd` itself. Keep all order/fee/operational obligations. Bind its floor witness to this projection's revision. Set actual-account reserve/backing metrics to zero for this isolated book; cumulative modeled allocation stays in P3 state.

Assert the two projections reconcile before and after every event. Never pass an already reduced budget to P3 and subtract its state again. Do not move cash out of total equity when a virtual reserve is recorded.

Use P3's prospective baseline, frozen B, bounded U, exact cents/G/r, minimum batch, partial cycle, residual closure, loss recovery and monotone H unchanged. Apply only eligible assessments to the in-memory replay state; store their events in the replay artifact. Manual cadence requires explicit review instants in the spec. Daily/weekly/every-30-days calendars are frozen at activation and evaluated on supported cuts; missing cuts defer, not backdate. Win counts generate only an advisory result. No OS/app scheduler is added.

Operating proof remains P3's bounded fixed-request witness. The request uses currently known policy intentions and marks, not a future price/target. An empty or clipped request does not certify future strategy capital. Cash-only proof is allowed only for an explicitly cash-only objective, not because all intended trades failed or the signal is temporarily waiting. If no suitable proof exists, retain balances and metrics but report reserve allocation unavailable. Check current and post-reserve concentration under active and total-account denominators; the stricter bound wins. The floor is checked at allocation, not advertised as protection from later crashes.

No automatic reserve-funded sale is added. Show unmet cash/realized caps and an optional separately labeled P3 hypothetical sale consequence; do not apply its proceeds. Compare the strict realized cap with any alternative only as a separately specified P5 variant. No personal tax election or tax liability estimator is introduced.

### Flows, receipts, yields and outcome measures

Support explicitly scheduled simulated contributions and manual principal withdrawals; basis changes, trades and internal reserve movement are not contributions. Pure flows leave economic P&L and total-account unit NAV unchanged before actual costs. A simulated payout can consume an existing modeled reserve through a linked release/outflow event; H and cumulative allocated profit never decrease. Release alone does not prove payment or create fresh eligible profit.

Keep debit, fee, net external delivery and user receipt separate. Pending outcomes remain pending: supported in-transit receivable is counted once instead of debited cash; confirmation removes the receivable and records net outflow; failure/reversal has explicit linked legs. Unsupported unknown outcomes block dependent calculations. A pending claim is neither additional wealth nor a confirmed receipt. All these are simulation events with no transfer capability.

Use P1's pure performance function over scenario-tagged canonical-shaped events, valuations and complete simulated coverage. Required marks before/after flows and valid same-time sequence come from the declared model; absent timing or price yields unavailable. Maintain two named series: total managed account (reserve movement internal) and active sleeve (reserve movement an external flow to that sleeve). Sleeve zero/redemption segments remain linked; do not stitch across invalid denominators or reset reserve H. Preserve daily gaps and distinguish endpoint return from unavailable daily risk metrics. Annualization remains unavailable before a full year; certified unique dated IRR only. No unavailable metric becomes zero.

Add replay-specific realized/unrealized projection with exact asset/cash fee legs and provenance; cross-check overlapping USD-fee cases against P3's FIFO projection. Keep raw equity change separate. Record total fees, spread/slippage/impact attribution and explicit source precision. The chosen FIFO investment convention is not a broker tax election.

Report total managed equity, active equity/cash, reserved cash, tax holds, pending subsets/receivables, cumulative contributions/outflows, separately modeled user receipts, economic P&L, realized/unrealized P&L, unit returns, drawdown/time underwater and supported rolling outcomes. Account-plus-net-receipts is a dollar outcome, not personal wealth or CAGR. Personal tax payments have explicit outflow purpose and are excluded from user cash received; user-net outcome counts them once. A manual tax hold is not a paid tax. External fixed-expense schedules are deducted once from the separately labeled user-net outcome, not again from account equity or its return.

Zero yield is baseline. Optional explicitly modeled USD cash/reserve interest uses a declared decimal accrual schedule; credit each cash subset once, with separate income attribution. Hypothetical interest never becomes an observed posting or trading alpha.

## 6. Data boundaries, controls and stress

P4 consumes permitted data; it does not acquire markets or connect providers. Read manifest metadata and declared development/exposure boundaries first. Reject an archive/partition containing sealed/future observations before content verification can read it. Do not call the existing full-archive verifier and then filter. Require separate exposed development archives; the new adapter performs bounded decimal extraction and preserves provider identity. The existing Coinbase preparation restriction stays intact; Alpaca-labeled inputs need their own compatible explicit tape, not renamed Coinbase bars.

Read only registration/claim metadata needed to reject overlap. Protected final bodies and prospective collectors are absent capabilities. Consumed/exposed history cannot become a fresh holdout through a new book ID, seed, profile copy or data-lineage alias. P4's mechanics fixtures use synthetic data. A later market run records exposed-development status and every attempt/variant before results are calculated. The trial inventory distinguishes repeated capital cells sharing a path from independent alpha tests; it never asserts global trial-history completeness or supplies a fabricated DSR.

Controls share capital, flows, universe, applicable caps and costs. Record end equity plus modeled net receipts, contribution recovery, costs, floor breaches, reserve shortfalls and forgone upside against paired reinvestment. Report desired/executable orders, drift, idle cash, risk exits, blocked actions, concentration and residual positions. Conditional feasibility at one size is not a universal minimum account. No winner, promotion flag, recommended share or promised crash protection is generated.

Provide deterministic fixture/stress paths for: flat prices with flows; persistent decline; sharp rebound; correlation spike; missing bar/quote and delisting; venue outage; delayed/changed fees; interrupted contributions/outflows; reserve underfunding; full loss/redemption and later funding. An underfunded claim raises a modeled incident and blocks new allocations; it is not silently released. Missing marks do not liquidate a holding at zero or carry forward a fabricated price.

The single-path replay API must be callable independently inside each future resampled joint path. P4 supplies deterministic seed/path identities and fixture-based path adapters. P5 chooses/freezes any block method, uncertainty objective and allowed sacrifice before comparison. Path-dependent orders/reserves must be replayed inside each joint serial/cross-asset path with causal policy decisions for that path; shuffling an already withdrawn return series and appending payouts is explicitly forbidden. No confidence interval or robustness claim is produced from P4's mechanics fixtures.

## 7. Storage, services, files and UX

| Area | Concrete changes |
|---|---|
| Core replay | Add `packages/core/src/research/capital-replay-types.ts`, `capital-replay-tape.ts`, `capital-replay-book.ts`, `capital-replay-execution.ts`, `capital-replay-accounting.ts`, `capital-replay-reserves.ts`, `capital-replay.ts` and `capital-replay-report.ts`; export via `research/index.ts`. Keep legacy backtest/research functions and P0–P3 versions intact. |
| Contracts | Add `packages/contracts/src/schemas/capital-replay.ts` for specs, events, bounded summaries and detail pages; export and register two **read-only** channels: `research.capital-replay.runs` and `research.capital-replay.detail`. Requests accept stored IDs/pagination, never arbitrary paths, financial facts or authority. |
| Persistence | Add `packages/storage/src/repositories/capital-replay.ts`, wrapping existing immutable integrity events under `capital-replay:<specHash>`. Kinds: `capital_replay_spec`, `capital_replay_attempt`, `capital_replay_input`, `capital_replay_chunk`, `capital_replay_result`, `capital_replay_failure`, `capital_replay_interrupted`. Keys bind attempt/cell/chunk. Validate canonical hash, parent and origin on read. No migration or legacy schema rewrite is currently required. |
| Lifecycle | Extend `repositories/profile-impact.ts` to count only new P4 event kinds in the existing research category, once. Preserve manifest keys. Copies/restores retain immutable origin/exposure/history; copied evidence is archived, grants no new run/coverage/authority and cannot overwrite a source run. Validate through existing backup/restore checks. |
| Service/data | Add `packages/services/src/research/capital-replay.ts` and `capital-replay-data.ts`: validate bounded specs, preflight development archives, materialize explicit scenarios, journal attempts, execute cells, retain all failures and create immutable results. Dependency injection supplies logical clock, cancellation and permitted data only. No credentials/provider/runtime/order/study-registration client. |
| CLI | Add `scripts/research-capital-replay.mjs` and one package script. Commands: `validate`, `replay`, `report`. Require explicit offline profile manifest/ID, DB/spec/development input/output. Use an existing separately created empty research profile through the normal profile manager; validate manifest-to-DB binding/revision, inactive status and no connections/financial activity before writing. Recheck lifecycle revision at batch boundaries and before publishing; stop as interrupted if it changes. Use bounded SQLite writer transactions; refuse a connected/financial/active/busy profile. The in-process operation gate is not a CLI lock. No default active-profile path, account reset, network acquisition or register/freeze/final command. Record attempts before data/result inspection; terminal retry returns an existing exact result or records a new linked attempt after explicit retry. |
| Main/read model | Add a small `apps/desktop/src/main/capital-replay-handlers.ts`, wire into existing research handlers/composition with DB/clock/profile only. Reads are bounded/local, do not migrate/poll/run/import, and leave `total_changes` unchanged. Existing WRITE_CHANNELS remains unchanged. |
| Renderer | Add `CapitalReplayResults.tsx` inside the incumbent Research view, plus query policies and scoped incumbent styles only as needed. Show recorded offline runs and nine-balance tables with unavailable/infeasible rows, cost/flow/reserve assumptions, active/total return scopes, source identities, failures and archived status. Show loading/stale/empty/error states, narrow/zoom/themes/keyboard help. No Run, Adopt, Enable, Withdraw or trading command. |

The CLI writes P4 evidence into that separate offline profile database. To inspect it in the app, the user opens that profile through the existing profile-switch flow after the CLI closes it. Concurrent lifecycle changes invalidate publication; any already-appended attempt/chunk remains incomplete evidence, never money or authority. Main reads the same profile DB; it does not attach an arbitrary external database, auto-import artifacts or switch profiles. Copies are viewable as archived evidence. This resolves the runner-to-Research integration without an additional import/run/write IPC channel.

The event journal stores canonical input/results in bounded chunks with a root manifest over exact chunk hashes. The local CLI exports the same self-contained JSON/CSV report using temporary files and atomic rename; no symlink/path traversal or overwrite of a different artifact. SQLite remains the durable copy, so unsupplied external files do not become a hidden backup requirement. Results include all declared cells, even those that fail before a metric can be computed. A crash leaves the attempt recorded as interrupted; an incomplete chunk set is never a complete report. Reruns do not erase prior attempts or mutate old results. There is no new operational cash store.

Compatibility is additive: old profiles have no replay events and show an empty view; defaults and P3 saved settings stay unchanged. The existing schema version remains 98 unless an independently necessary implementation change is explicitly reviewed. A copied profile may inspect archived results under their original identity, but a new replay needs a new workspace/run identity. Current generated source manifests may change after adding exports; archive their exact previous bytes, record the new dependency closure and let existing provenance gates block mismatched studies. Never migrate a registration/holdout to the new hash or count source changes as fresh data.

## 8. Reviewable implementation batches

| Batch | Work | Completion gate / remaining dependency |
|---|---|---|
| P4-A Definitions and independent fixtures | Reread full phase; capture dirty/protected/source identities; strict specs, clock/order/cost/flow/availability contracts; hand-calculated nine-balance fixtures | Every required input has a supported convention or explicit unavailable reason; legacy identity fixtures unchanged. No market or financial operation. |
| P4-B Exact book and shared execution | Decimal opening/lot/fee legs; scoped raw market tape; per-size desired orders; P2 budget/legality/caps; settlement/partial/unknown replay | Actual integrated event loop calls P2 on every relevant step; received-asset fees, fixed costs, sell-then-new-budget and dust/concentration boundaries pass. |
| P4-C Flows, metrics and controls | P1-shaped simulated coverage/valuations, total/sleeve unit NAV, unique IRR, matched cash/passive/hold controls, explicit expenses/yield | Nine independent books and every benchmark use exact opening/flow identities; deposit/withdrawal neutrality, metric-specific gaps and total-loss segments pass. |
| P4-D Reserve policy replay | P3 reducer integration, two-budget reconciliation, baseline/U/H/partials/releases, frozen review calendar, operating witness, modeled receipts/pending incidents | No repeated profit or double claim/cash subtraction; identical market/flow tape changes policy outcomes only through declared allocation effects; no automatic sale funding. |
| P4-E Durable offline runner and result views | Typed integrity journal, bounded CLI/data preflight/export, failure/cancel/retry, read-only Main/Research summaries | Physical final-data exclusion proven before reads; all variants/attempts retained; backup/copy/restore and no-write read handlers pass; no hidden app execution channel. |
| P4-F Mechanics acceptance and preservation | Deterministic stress grid, compatibility/gate/side-effect tests, full checks and disposable native UI smoke, exact commit isolation and tracker/Linear | Full P4 capability accepted separately from strategy effectiveness, account evidence, review, qualification and release. P5–P7 still pending in full. |

Dependencies: B uses A; C uses B; D uses B/C and P3; E integrates A–D; F covers the actual services and views, not helpers alone. After every batch update completed/remaining requirements, evidence, blockers and dependencies in the tracker and matching Linear issue. Include exact prompts and local/committed/pushed/merged status; completion comments end **Completed by: kokin**.

## 9. Regression cases and acceptance

| Independent case | Expected behavior |
|---|---|
| $50, 5% target, $25 discretionary floor, zero friction | Desired $2.50; no executable entry. Record blocked demand and idle cash. The legacy unconstrained fill remains reproducible under its old identity. |
| $500, 5% maximum entry, $25 floor, USD fee | Zero-cost boundary can admit $25; positive USD fee can lower legal notional below the floor. Do not round risk upward to force admission. |
| Every grid balance, flat marks plus $20 contribution | Economic profit and total-account TWR remain zero; raw equity rises $20. Opening/benchmark denominators match each cell. |
| $100 cash, buy 10 units at $1 with 0.25% received-asset fee | Cash $90, delivered 9.975 units, acquisition cost $10, marked equity $99.975; $0.025 fee attribution is not another debit. |
| Known-basis asset bought for $50 and sold for $55, $1 fixed fee on each side | Net realized gain $3, account economic gain $3 before any other events; each fee enters once. |
| $102 debit, $100 modeled confirmed user receipt, $2 account fee | Investment P&L falls $2; receipt $100. No $102 profit-paid label. |
| P3 fixture: $500 opening, realized gain $50, 25% share, supported cash/floor | Modeled reserve $12.50; active $537.50, total $550, H $50. Executable free cash excludes $12.50 once, total-account return unchanged by reserve movement. |
| Same cycle, deposit $200, lose $50, recover $50 | Deposit creates no profit or trigger; loss/recovery produces no reassessment until P exceeds prior H/cycle requirements. |
| 33% share, $100 gain, capacity $10 | Assess $30.31, reserve $10, retain explicit rounding residue. Retries/releases/restores cannot reuse that slice. |
| Realized +$50, open loss −$75 | Economic P −$25: no reserve, regardless of wins. |
| Payout pending after a supported debit | Cash or receivable counted once; user receipt unavailable until confirmation; no new spend from an unknown result. |
| Late fee, missing basis, unknown third-asset fee value, gap or wrong provider | Only supported metrics remain available; reserve eligibility and affected daily risk/lot metrics carry typed reasons. No fake mark, zero fee or provider substitution. |
| Native minimum ± one increment; forced exit leaves dust | Exact legal quantity/residual recorded; discretionary exception never overrides native minimum. |
| Zero capital, total loss, full redemption and later funding | Typed return segments; no division by zero or stitched fake recovery; H remains monotone. |
| Future bars or arbitrary final-data directory supplied | Refuse before data bodies/verifier are read; spies prove no hidden load, registration, freeze or final claim. |
| Crash after attempt/chunk and before result commit | Incomplete/interrupt evidence retained; exact retry cannot duplicate a fill, flow, assessment or completed result. |

Test suites planned under `tests/`: `capital-replay-book`, `capital-replay-execution`, `capital-replay-flows`, `capital-replay-reserves`, `capital-replay-metrics`, `capital-replay-service`, `capital-replay-governance`, `capital-replay-ui`, plus deterministic helpers. Use fast-check sequences for conservation, flow neutrality, idempotency, monotone H, bounded reserves/caps, one cycle and nonnegative spendable quantities. Back properties with independent exact arithmetic, not reducers copied into tests. Include one increment below/at/above all native, batch and capital boundaries.

Integration cases must run the real data-preflight/service/repository/CLI/Main paths. Assert original P1/P2/P3 values and frozen studies unchanged. Test no provider submit/cancel/transfer/acquisition, runtime policy change, scheduler, study registration/final-claim or deployment capability. Reads leave all database rows unchanged; offline writes affect only declared P4 development evidence. No live/connected scope or actual capital binding is created.

P4 acceptance requires:

1. All nine balances execute separate full paths, with capital/flows carried through books, budgets, benchmarks, policy and every denominator.
2. Costs, fee currencies, timing, rules, holdings, flow purposes, yield, overhead and source precision are explicit and charged once. Unsupported assumptions remain unavailable.
3. Shared P2 constraints and P3 assessments are demonstrated in the actual replay loop; no double cash/reserve subtraction or spending unfilled proceeds.
4. Correct total-account and active-sleeve performance, unavailable daily/IRR cases, pending receipts and linked zero-capital segments preserve P1 semantics.
5. Complete requested cells, rejected intentions, drift/cash/concentration/turnover/exit residuals, costs and distribution-versus-reinvestment outcomes are reported. Blocked inactivity cannot be called successful risk control.
6. Development-only physical data boundaries, immutable attempts/results, hashes, reproducible rerun and preserved registrations/negative findings/consumed holdouts are proven. Mechanics does not imply alpha or qualification.
7. Lifecycle, malformed input, size/deadline/cancel, crash/retry, query isolation and no-financial-side-effect checks pass; old profiles/defaults remain safe.
8. Focused tests, repository typecheck/lint/full tests/root and desktop builds, native safety/result-view smoke and appropriate keyboard/theme/zoom/narrow checks pass using disposable profiles. Exact commit-source isolation is verified before a later requested commit. No packaging/install/release is inferred.
9. Tracker and Linear distinguish capability acceptance from human review, actual account evidence, owner decisions, P5 trials and P6/P7 gates.

## 10. Requirements retained beyond this pass

P5 retains the narrow trend/cash and buffered-rotation hypotheses, current allocator/passive/cash controls, separate execution and reserve ablations, at most two initial structural hypotheses, finite trials including failed attempts and none, causal fitting/calibration, paired uncertainty, predeclared distribution sacrifice, joint-path replay and all negative findings. Breakout/range/blend/ML ideas remain hypotheses with their original failure criteria, not additional P4 strategy defaults. Two-asset buffer degeneracy and top-one concentration constraints remain explicit.

P6 retains optional **default-off, separately reviewed** internal paper reservation, its distinct sale preparation slice and strict realized-cap/exposure review, OMS/authority/fencing/pause/manual Resume/kill/reconciliation boundaries and exclusive connected-account prerequisites. P4 simulator success cannot close COQ-12/14 or establish broker ownership.

P7 retains owner-approved fresh identities/dates, real coverage/minimum decisions, account costs, complete trial history/DSR, original stricter PBO (including 5% where frozen), 365-observation/30-action gates where applicable, untouched final claimed once, candidate-or-none freeze and explicit review/promotion. Consumed TrendVol history stays consumed, including its negative decision/PBO 28.60%; a copied database or small balance is not fresh evidence. COQ-10/15/16/17/18 and COQ-13 release requirements remain open as applicable. No live trading or external payout project is introduced.

The next implementation task can begin with P4-A after rereading this addendum and the full original requirements. No additional product input is required. A real study's policy/universe/cost/funding choices are deliberately not selected by this planning pass.

Implementation issue: [COQ-38](https://linear.app/coqui-crypto/issue/COQ-38/implement-p4-capital-aware-replay-and-reserve-policy-simulation), Backlog. Planning does not complete P4 acceptance.

**Prompt used**

Commit and push P3, then lets move on to P4. Reread its full requirements in the saved roadmap, inspect the code, and prepare a concrete implementation plan before coding. Preserve P0–P3 and the full P0–P7 scope.
