# P6 plan: reviewed internal paper profit reserves

October 24, 2026, America/Phoenix. **Planning ready; no P6 application implementation or activation.** P5-A–G is committed and pushed as [775950a0f3c539755a626a1fe058b55ef8f5787f](https://github.com/kokin-blip/Coqui-Crypto/commit/775950a0f3c539755a626a1fe058b55ef8f5787f) on `codex/operations-crew-journal`. Its isolated closure passes 317 files / 2,215 tests, typecheck/lint, root/desktop builds, nine CLI checks, 22 P5 production-native checks and standard native safety. [Commit evidence](evidence/p5-contest-2026-10-24/commit-isolation/summary.json). Combined-checkout evidence remains retained.

The unchanged [P0–P7 roadmap](small-portfolio-profit-policy-plan-2026-10-23.md) is authoritative. This addendum follows a reread of its full accounting, policy, budget, lifecycle, architecture, UX, dependency and acceptance requirements, including the separate sale/connected review slices. [Tracker](small-portfolio-phase-tracker-2026-10-23.md); [source inventory and synthetic probes](evidence/p6-paper-planning-2026-10-24/README.md).

[COQ-40](https://linear.app/coqui-crypto/issue/COQ-40/implement-p6-reviewed-internal-paper-profit-reserves) tracks implementation in Backlog; these planning artifacts are local and uncommitted.

**P5-H remains pending in full.** Planning or implementing P6 mechanics neither completes H nor admits a P5 candidate. P0–P4, negative research, frozen identities, consumed holdouts, and all P0–P7 architecture, tests and gates remain preserved. P6 capability acceptance, actual internal-paper authorization, optional sale acceptance, connected verification and P7 qualification must have separate tracker states.

## 1. Scope and safe sequencing

Implement a separately versioned, default-off internal paper cash-reserve capability. Start in a dedicated newly created simulation profile/book with explicit simulated opening USD. Reuse existing paper balance/fill/ledger tables, capital accounting, budget/feasibility, Main authority and OMS; do not create a second mutable cash balance or order writer. Never enroll an existing active/frozen campaign or broker account during an upgrade.

Every funded allocation and release initially uses an explicit revision-bound review. Cadence creates an observation/proposal; it does not authorize commitment. Manual policy authorization is separate from preview settings, and manual Resume is separate from resolving an incident. The host must remain eligible at commitment. No scheduled automatic commitment is implied by a saved cadence. This implements the roadmap's reviewed paper lifecycle; a different automatic-commit mode would need an explicit later design/review rather than being inferred from `auto` trading settings.

Retain the full optional paper-sale and connected-paper requirements as later slices of P6. Cash-only acceptance comes first. Do not silently convert P5's hypothetical full-exit diagnostic into a sale plan, adopt its economic-cash counterfactual, or connect it to an adapter. While sale-policy evidence or ownership is inadequate, those paths remain unavailable with named blockers. No transfer endpoint, credentials for transfers, external withdrawal, live order, deployment, registration, prospective collector or promotion belongs in P6.

No product choice blocks foundational implementation with synthetic fixtures. Operational choices and gates in section 10 must be satisfied before actual authorization. The current failed/unqualified strategy evidence remains a refusal, not a reason to lower an existing gate or automatically use exploratory admission.

## 2. Verified source findings

These observations describe source and disposable synthetic probes, not an installed account or broker health. The inventory records committed versus uncommitted bytes; connected recovery files currently contain unrelated work that must be reviewed through COQ-12 before reuse in a connected slice.

| Current component / finding | P6 treatment |
|---|---|
| P3 `profit-reserve.ts` settings/views are explicitly `preview_only`; state/assessment domain is `preview`; v98 SQL enforces it | Preserve schemas, rows, IDs and numerical behavior. Add operational types and tables; a preview never becomes permission through a widened enum or cast. |
| `commitIsolatedReservePreview` persists modeled state/assessment only, requires scenario evidence and writes no actual cash claim | Keep it isolated. Build an operational commit transaction with its own identity and immutable claim links. |
| P2 `saveCashClaim` rejects profit/tax purposes; `withBudgetClaim` permits only local order commitments | Preserve those public refusals. Add a narrow verified internal-paper mutation path; never remove the rejection globally. |
| P2 projection already deducts funded profit/tax claims from spendable cash and active equity; P3 preview math separately subtracts modeled reserves | Directly passing a funded budget plus the same modeled reserve double-counts it. Use new operational semantics; preserve P3 math. Probe: equity/cash $700, existing reserve $20 yields actual active/spendable $680. Unsafe modeled reuse gives $660 cash capacity and $630 retained after a $30 allocation; correct retained active is $650. |
| P3 assembler withholds an operating witness and returns `actual_profit_backing_unverified` once backed claims exist | Build a P6-specific assembler that proves owned assessment/claim lineage and binds the actual strategy requirements. Do not replace unknown backing with zero. |
| `initializePaperBook` requires nonempty priced holdings and zero cash; P1 local ingestion and P2 source guards read that legacy origin | Add an explicit cash-book origin path. Do not manufacture a sale, a token holding, cost basis or a legacy origin to seed $500. Existing initializer/readers retain their old behavior. |
| Legacy `openingSnapshot`/run-loop and modeled `proposalPreview` assume marked holdings; the latter refuses an intent with an empty holdings list | New-book decision and consequence adapters must use explicit cash/active NAV and actual positions. Do not create a fictitious holding or bypass preview review to make a first buy possible. |
| `PaperOmsService` and `PaperExecutionService` have an optional `PaperCapitalBudgetPort` and capital-preview seams | Reuse the interfaces and transaction boundaries. Production composition/run-loop construction currently omits them. Integration must cover every writer/settler for the new book, not just manual review. |
| Scheduler and run-loop construct execution services separately; routing is another consumer | Explicitly bind all P6 constructors to the same revision-aware port and model. Refuse P6 enrollment while any legacy/unbounded writer can use its balances. |
| Existing host authority, profile execution leases, kill switch, profile-operation gate, recovery and manual Resume exist | Revalidate inside each authoritative mutation; scheduler lease is not execution authority. Profile leases do not prove broker-account ownership across profiles/hosts. |
| Existing paper origin balances and OMS persistence are profile-scoped | One P6 book per dedicated simulation profile. Do not introduce multiple purported independent books over those same rows. |
| P2 connected sources remain legacy/unproven; Alpaca financial cuts/holds/ownership are incomplete | Connected reservation stays blocked. A local simulation or paper execution-safe position proof does not establish reserve eligibility or account-wide ownership. |
| P5 reports are literal unqualified development evidence; H has not run | No P5 selection becomes an operational binding or fresh registration. Keep negative TrendVol/PBO and consumed holdout intact. |

No new venue fee, minimum, settlement, tax or current-account claim is needed to settle the internal design. Thus this pass adds no broad literature repeat or provider request. The future connected slice must recheck current official API/terms against actual account evidence before fixing its broker contract; today's source comments are not that verification.

## 3. Identities, storage and migration

Use `paper-reserve-cash-v1` for operational state/assessment/calculation, separate from `profit-reserve-preview-v1`, `capital-aware-replay-v1`, `capital-contest-v1`, legacy strategies and study records. One operational stream per verified simulation capital scope; policy changes continue that stream and its H. A simulation identity includes immutable origin/book UUID, originating profile and USD/environment. Current profile access metadata cannot redefine it.

Add migration **v99** after inspected schema 98; if another accepted delivery uses 99, append at the actual next version. Do not edit predecessors. Empty additive structures only; no backfill that enrolls a book or activates settings. Reuse pre-migration backup, transaction rollback, newer-schema rejection and restore verification.

| Addition | Required facts and constraints |
|---|---|
| `paper_capital_book_origins_v1` | Immutable book/origin/profile, `simulation`/USD, explicit opening cash, source `explicit_simulated_funding`, opening time and funding operation ID/hash. First version starts USD cash only; no implicit tax basis. Unique book and originating profile. |
| `paper_reserve_policy_versions_v1` | Immutable operational parameters, prior policy, scope/stream, strategy/version/requirements hash, native/fee/risk assumptions, review mode, creation provenance. P3 preview policy is a reference only. |
| `paper_reserve_requirements_v1` | Immutable strategy-derived fixed/netted operating requests, rules/cost/policy/source identities, allowed instrument scope and assumption assurance. Not a renderer-supplied arbitrary witness. |
| `paper_reserve_state_revisions_v1` | Immutable operational domain, predecessor, H, cycle ceiling/base, cumulative allocations/backed tax, current claim totals, event and operation identity; unique `(stream, operation)`. |
| `paper_reserve_proposals_v1` | Immutable current financial/common cut, budget/claim/state/policy/requirement hashes, modeled consequence, expiry and review identity. No proposal locks funds. |
| `paper_reserve_assessments_v1` | Immutable exact G/r/share/rounding, H before/after, proposal, before/after state, funded claim revision IDs and authority proof references. Unique stream/operation; claim backing cannot be reused. |
| `paper_reserve_events_v1` | Append-only lifecycle, authorization, review, release, incident/recovery and optional sale linkage. Deterministic identities, predecessor/revision links, safe reasons and provenance. |
| `paper_reserve_commands_v1` | Command UUID + scope + exact request hash and durable typed response. Identical retries return the original result; conflicting reuse refuses. |
| `paper_reserve_runtime_bindings_v1` | Mutable access/head/CAS metadata only: current profile/book/scope/stream/policy/state/requirements, generation, archived/disabled state. Unique active book/scope. Persisted intent to use a mode does not constitute a current runtime permit. |

Amounts/quantities remain canonical decimal text; hashes use existing canonical JSON/SHA-256. Financial tables have FK/uniqueness and no-update/no-delete triggers. Facts retain original profile identity; only operational bindings are rewritten/archived by profile lifecycle. Reuse **P2 cash claims** for actual reserve/tax/order encumbrances; new tables are evidence, not another spendable balance.

Create the new cash book only through an explicit command on a fresh empty simulation profile: no existing balances/orders/ledger/origin, active/frozen campaign, active connection or competing writer. Use existing `bootstrapPaperBalances` with explicit funding provenance and the additive origin; atomically record origin, opening ledger, canonical P1 scope/opening valuation/epoch and disabled P6 binding. Never reset a broker or convert an existing origin. Add a version-dispatched origin/capture adapter only for an exact P6 binding; legacy `getPaperBookOrigin` and `initializePaperBook` remain unchanged.

Opening capital appears once as economic opening value. Later explicit simulated funding, if supported by a separately reviewed existing funding workflow, is an external flow; it is never inferred from a balance. P6 adds no deposit/withdrawal command. Manual unexplained edits block reconciliation.

## 4. Operational accounting and commit protocol

Reuse P3's strict profit, milestone, cycle, integer-cent G/r, share and loss-recovery rules, with a new operational evaluator/reducer. Extract only narrowly shared arithmetic if necessary, guarded by exact existing P3/P4/P5 fixtures and IDs. Do not relabel preview state as operational or use P5's economic-cash evaluator.

For a funded P6 budget:

```text
total managed equity = cash + supported assets/receivables − liabilities (reserve cash once)
active equity = P2 budget active equity (existing profit/tax claims already removed)
cash cap = max(0, P2 spendable cash − additional tax hold)
capital cap = max(0, active equity − additional tax hold − effective floor)
economic/realized caps = reconciled profit − unique prior profit-backed allocations
retained active = active equity − new reserve − additional tax hold
```

The evaluator must also validate the new post-reserve P2 feasibility witness and stricter account risk constraints, including costs. Existing claimed dollars are not subtracted again. Economic/realized backing is counted once by its assessment identity: current-stream cumulative profit allocations/backed tax are not added again as generic foreign claims. Unexplained/foreign backed claims block. Releases remove current cash encumbrance but retain H and cumulative assessed allocation; the same gain cannot be funded again. Principal-backed tax holds consume cash/capital without masquerading as assessed profit. Unknown tax backing is unavailable; no automated tax liability or tax election is introduced.

A P6-specific financial assembler reads P1 economic flows/performance and current immutable opening/fills/fees/lot proof, reconciles current balances and P2 claim heads at the same cut, proves every reserve/tax claim against operational assessments, and derives current operating requirements. Cash-only witness is valid only for a truly cash-only supported objective; a held or intended trading book needs its exact netted strategy request. Expiry and the source revision are rechecked. Existing incomplete history/basis/fees/unknown activity remains unavailable.

At first operational authorization or policy change, resolve pending operations and set baseline H to `max(prior operational H, current P, 0)`; record excluded gains. A preview/simulator assessment does not become operational history. For the same operational book, disable/re-enable/settings/restart never create a fresh stream that erases H or losses. One open cycle U and fixed percentage base continue exactly as specified in the roadmap.

The new authority check reads current paper execution policy (`off` refuses), `resolveKillSwitch`, resolved hard-stop/exposure state, strategy pause and a current, identity-bound evidence/profitability record for the exact strategy/code/cost/horizon/normalization. Reuse `readBoundProfitabilityEvidence`; a profile-wide conversation flag alone is insufficient. `paperGrossEdgeLowerBoundPct` explicitly withholds evidence for the retired shipped-plan/current-strategy mismatch; leave that refusal unchanged. No existing study proof is silently inherited by the new book/policy behavior. Cash segregation gets a dedicated purpose-bound mutation permit, not a forged `ApprovedExecution` or fake order passed to `runExecutionGates`; actual orders still traverse that full existing gate chain. Missing applicable evidence blocks operational authorization even when synthetic arithmetic passes.

Commit flow, inside one synchronous SQLite transaction:

1. Verify command hash/idempotency, active P6 binding, exact profile/book/scope/environment and current policy/state/proposal/requirements. Require explicit review and fresh runtime permit; check host authority/generation, execution lease/fence, profile-operation gate, stop/pause status and applicable paper eligibility. No renderer boolean grants authority.
2. Refresh/reconcile local facts and recompute current P1/P2/P6 cuts from immutable evidence. Compare budget, claims, source, quotes/marks/rules/costs, policy and expiry; a stale proposal refuses, with no partial commitment.
3. Evaluate current strict caps and fixed-request feasibility against active NAV, with account checks still applied. Apply exact G/r rounding; require positive minimum batch. No sale, larger risk or unobserved income fills a deficit.
4. Append reserve/tax claim revisions, assessment, new state/H, accepted review/command response, advance both head generations and record budget projection atomically. The narrow storage mutation must revalidate scope, expected revision and authority and permit only these linked P6 claims. Generic `saveCashClaim` continues to reject funded purposes.
5. Verify post-claim budget/current obligations and conservation before commit. No network, await or broker call inside this transaction. Any failure rolls everything back. Crash after commit/before acknowledgement is recovered by the same command ID, not another allocation.

Release is its own explicit reviewed CAS command. It releases only known, unpledged cash claims and updates current reserved/tax totals; H, prior assessed slices and allocation history do not fall. Disable, pause or kill never implicitly releases a claim. Budget deficit/unknown claim/fee revision retains obligations, appends a blocking incident, prevents new reserve/trade spending and requires reconciliation plus manual Resume. No silent forgiveness or automatic loss reset.

For total-account performance a reserve/release is internal and changes no external-capital units. Keep canonical P1 reports unchanged. Active-sleeve return needs a separately labeled derived series with reserve/release flows at supported contemporaneous marks, using existing unit-NAV arithmetic; missing marks make only dependent sleeve metrics unavailable. Its derived flows never enter the account's external ledger. No user receipt is created by a reserve, release or sale.

## 5. All-consumer integration and lifecycle

P6 cannot be authorized until each writer/settler for its book is certified through one shared `PaperCapitalBudgetPort` and capital model. Add an explicitly bound P6 port/factory with version-aware origin proof and actual local evidence; preserve existing default constructors and frozen studies. Do not merely pass `compatibleWriter=true` to silence the legacy-writer check.

The source closure must cover manual `PaperExecutionService` proposal/review, immediate `PaperOmsService` execution, pending submission and settlement/terminal release, `runPaperDecision`, scheduler-created services and any allowed venue-neutral routing path. Same book/revision in preview, pricing, final gate and claim commit; no unfilled sale proceeds fund an earlier buy. The existing immutable approval/gate chain remains necessary for orders. New-construction omissions must refuse enrollment, not fall back to the legacy budget. Exploratory/parallel campaign books and registered/frozen study paths are initially excluded; silently binding them is forbidden.

Strategy targets use active capital excluding reserves, with a versioned new-book denominator. Account-level caps remain based on full account evidence and cannot be loosened. Preserve old `runIdFor`, strategy identities, defaults, fixed-study arms and historical reports. Bind the P6 book/policy/requirements into new decision/route identities and report desired versus executable quantities, fees, turnover, cash and residual risks at all nine balances.

Use a P6-only decision adapter for the cash-origin book, with explicit active USD, real position quantities, known instrument metadata and completed available prices; the legacy holdings-based opening/denominator path is not the initializer for this book. Likewise add a P6 capital-aware proposal consequence adapter that represents cash and entry into a previously unheld asset, then binds the same P2 feasibility result to review and submission. The old `proposalPreview` remains unchanged for legacy callers. Test the first legal buy from a cash-only opening, the all-cash/no-action state and a missing price; no fabricated position or forced $25 trade is acceptable.

Main owns construction, clock, profile gate, host/lease validation, immutable review and command dispatch. Scheduler work takes injected dependencies, is bounded/single-flight and uses stable UTC cadence/slot keys. A due tick refreshes current evidence and produces at most one proposal/observation. Do not batch missed historical reservations after sleep/restart. A win-count threshold requests review only; count reconciled completed episodes after fees, not fills.

On restart, profile switch, import, restore, duplicate, suspend or lost authority, clear the ephemeral permit and pause/disarm mutation. Existing claims/H remain durable. A local committed transaction can be reconciled/read while disarmed; it must not repeat or release. An archived copied book cannot resume the original scope. A new simulation copy needs a new explicit book origin; it is new simulated capital, not fresh market evidence. Restore validates claim/state/assessment integrity and current continuity before manual Resume; connected restore additionally requires account-wide ownership/reconciliation.

## 6. Interfaces and exact file inventory

All paths below are repository-relative. Existing source hashes and dirty status are in the evidence inventory. Names are concrete targets for implementation; no files in this table have been implemented by this planning pass.

| Area | Add / extend |
|---|---|
| Core | Add `portfolio/paper-profit-reserve.ts`, `paper-profit-reserve-state.ts`, `paper-profit-reserve-types.ts`; export through portfolio index. Reuse P3 integer slice/trigger/witness and P1 math with versioned operational inputs, preserving preview/replay/contest results. |
| Contracts | Add `schemas/paper-profit-reserve.ts`, exports/channel registry and write-channel/secret-canary registries. Strict literal `simulation`/USD/internal-cash mode and false live/withdrawal/qualification flags; no credential or arbitrary financial-evidence fields. |
| Storage | Add `repositories/paper-capital-book.ts`, `paper-profit-reserve.ts`, migration `v99.ts`/registry. Extend `capital-budget.ts` with a guarded transaction path and private shared append logic while preserving public funded-claim refusal. Extend `profile-impact.ts`, `profiles/duplication-transient-counts.ts`/`duplication.ts` and restore lifecycle checks; keep backup-manifest category contracts. Count new financial facts once in existing portfolio/paper categories. |
| Financial services | Add `portfolio/paper-capital-evidence.ts`, `paper-profit-reserve-eligibility.ts`, `paper-profit-reserve.ts`; reuse `ingestCapitalEvidence` and P1 canonical facts, budget/claim heads, exact lot/fee evidence. Extend capture dispatch at the bound new-book boundary; legacy local/connected acquisition remains unchanged. |
| Paper services | Add `paper/paper-reserve-runtime.ts`, `paper-reserve-authority.ts`, `paper-capital-decision.ts` and `paper-capital-proposal-preview.ts`; bind P2 port/model in `capital-budget-port.ts`, `execution-service.ts`, `oms.ts`, `runtime-model.ts`, `run-loop.ts`, `paper-scheduler-task.ts`, `routing.ts`/`capital-preview.ts` only under the new explicit book version. Reuse bound-profitability/permission primitives; preserve legacy `proposal-preview.ts`/opening behavior. Audit/export all constructor sites; forbid uncovered writers. |
| Main | Add `paper-reserve-handlers.ts`/`paper-reserve-runtime.ts`; wire `composition.ts`, `scheduler-runtime.ts`, profile lifecycle and `paper-performance-evidence.ts` with no default enrollment. Reuse existing review refresh, kill, host, lease and operation-gate boundaries. |
| Renderer | Add `PaperProfitReserves.tsx` beside capital/allocation information and reuse existing ProfitReserves/MetricInfo/provenance/command patterns. Extend query/refetch/command registries. Distinguish paper-book setup, policy review, proposal review, status/reconciliation and release; no research-setting adoption or withdrawal action. |
| Optional sale slice | Add `paper/paper-reserve-sale.ts`, sale-specific schemas/events/consequences/tests only after section 8 gates. Route orders through existing reviewed `PaperExecutionService`/OMS; never reserve service-to-adapter submission. |
| Connected slice | Separately review actual `ParallelPaperService`, `parallel-execution-safety.ts`, reconciliation/fee/deadline modules and account-wide budget ownership. Current unrelated changes are COQ-12 work, not part of this plan's implementation. No connected factory is injected before its gates. |

Proposed local channels:

- Read-only `paper.reserve.books`, `paper.reserve.view`, `paper.reserve.preview`, `paper.reserve.operations`: scoped local facts and independent assurance states; no polling providers or writing during reads.
- Explicit commands `paper.reserve.book.create`, `.policy.save`, `.authorize`, `.pause`, `.resume`, `.review`, `.release`: bounded UUIDs and expected scope/book/policy/state/budget/proposal/authority-generation hashes. New policy save remains disarmed. Review uses the exact consequence/expiry. No caller-supplied amount can exceed the recomputed proposal.
- `.resume` rechecks all financial/authority/qualification gates and records manual intent; resolving an incident alone does not resume. Pause/disable retain claims. A command result distinguishes accepted, refused, stale and unknown acknowledgement; no unavailable metric becomes zero.
- Sale commands, if admitted later, get distinct prepare/review/reconcile contracts and order IDs. No transfer/payout/cancel-via-new-adapter channel is introduced. Existing order cancellation remains at its original reviewed boundary.

## 7. Settings and UX

Default state is Off/Preview only. Keep preview settings and operational authorization visibly separate. Create a dedicated simulated book with the entered opening USD and provenance, default example $500 rather than $100,000. Creation itself grants no trading or reserve permission. Reusing a P3 parameter set requires an explicit operational consequence review; old enabled-looking preview values do not migrate into enabled paper mode.

Show book/environment, tracking start, policy/stream/requirements versions, observations/expiry, current economic/realized/unrealized P&L, H/unassessed slice, fixed percentage base, strict cap bottleneck, proposed exact G/r, active/free/reserved/tax/pending subsets and effective floor/constraint. A reserve remains cash inside account equity; receipts stay zero/unavailable unless separately evidenced. Explain released cash and unchanged H. Present comparison scenarios as hypothetical with no probability/income guarantee.

Review shows excluded preactivation gains, policy changes, unresolved operations, competing claims, native minima/costs and post-allocation concentration. Concrete unavailable/deferred reasons include unknown fees/basis/history, stale common cut, expired preview, ownership/uncovered writer, insufficient capital, stop/pause, qualification missing and reserve underfunding. Blocked order demand is not successful risk management. A cash floor is not crash/custody protection.

Cadence and optional completed-win review thresholds do not bypass caps. Tax hold has principal/profit/unknown backing and a separate review/release. No automated personal-tax estimate/election or external receipt promise. Release/Resume are distinct reviewed actions; preserve manual pause intent.

Use incumbent terminal controls and themes. Test keyboard labels/units, submit/refusal/expiry/unknown states, focus return, narrow scrolling, 200% zoom, light/dark/high contrast and non-color explanations. No redesigned visual identity or unrelated UI formatting.

## 8. Retained optional sale and connected gates

**Paper sale preparation** starts only after cash-only acceptance/review and an explicit policy decision on the realized-cap/exposure trade-off. Strict realized-profit backing stays the operational default. P5 economic-cash counterfactual and full-exit diagnostics are not approval. With H still pending, no favorable evaluation or sale-share preference is assumed.

Prepare the minimum justified modeled sale for a declared reserve objective under supported lot/cost/native assumptions, not an arbitrary full exit. First supported solver is bounded single-asset FIFO piecewise-linear known-price/fee quantity sale: derive cash and realized-gain requirements across lot/native boundaries, round the sale quantity to the legal increment and re-evaluate all caps/risk/floor/turnover. Evaluate only a declared eligible candidate set and report objective, unsupported cases and residuals; do not claim a multi-asset global optimum. Nonmonotone/unsupported fee rules, unknown basis, stale marks or no supported solution yield unavailable. P5's $500 basis/$550 value illustration must expose that $12.50 realized gain may need about $137.50 sale before costs, not $12.50 proceeds.

The consequence alone authorizes nothing and funds no reserve. After a separate order review, use existing paper proposal/approval/OMS intent journaling, deterministic purpose/client/order identity, quantity claims and native constraints. Do not bypass current profitability/risk/evidence gates because the purpose is a reserve. If the current gate cannot admit it, remain blocked; any changed admission policy needs separate explicit review. Partial fills count actual reconciled legs only. Unknown submit/cancel outcomes require deterministic lookup/reconciliation, no blind retry. Existing expiry/fencing/kill/manual Resume controls remain. Reassess economic/realized profit, fees, cash and floor after final supported settlement before proposing a reserve; sale submission or estimated proceeds cannot pre-fund it.

**Connected paper** additionally requires COQ-12 review of exact recovery/fee/deadline source, COQ-14 owner-authorized intended-host dedicated Alpaca observation, verified account/environment identity and exclusive account-wide cash ownership across profiles/hosts. Current profile leases cannot certify that last requirement. A future durable account-ownership protocol must prevent concurrent writers, fence takeovers and reconcile prior claims; do not simulate it by changing a source flag to `isolated_book`.

Retain manual account-wide activity and fee completeness, open-order/hold reflection, budget consumers, stale-restore/reconnect, ambiguous IDs, partial fills, fee postings, pause/restart/Resume, deadline and credential checks. Read evidence acquisition and write authority remain distinct. No broker reset or reuse of a shared comparison account is permitted. A local binding cannot claim the full broker equity. Current official API/fee/native terms and account evidence must be verified at that slice; unsupported ownership or financial history leaves it unavailable. Live/external payments remain excluded even after connected-paper acceptance.

## 9. Reviewable implementation batches and acceptance

| Batch | Work | Gate / remaining work |
|---|---|---|
| P6-A definitions/compatibility | Baseline, strict operational contracts, book/policy/authority identity, reviewed parameters, independent arithmetic fixtures and protected source goldens | No application mutation enabled; P3/P4/P5 IDs/outputs unchanged; origin/claim/source gaps explicit. |
| P6-B origin/storage | Add empty migration, cash-book initializer/evidence, immutable operational facts/CAS and profile copy/restore/deletion impact | Backup/rollback/newer-schema, explicit cash funding, no existing-book enrollment, all facts/claims preserve provenance. |
| P6-C evaluator/transactions | Funded-budget semantics, bound operating witness, exact caps/G/r/H, linked claims/assessments, review/release/idempotency | Conservation/no double deduction, strict backing, concurrency/fault injection, expired or unknown facts refuse atomically. |
| P6-D all consumers/runtime | Explicit port/model propagation through manual, immediate/pending/settlement/scheduler/routing constructors; new active-NAV identity; authority/lifecycle guards | No uncovered writer; actual order/reserve races and settlement bounds pass. Default construction and frozen campaigns remain legacy. |
| P6-E Main/UX/cadence | Read views and bounded reviewed commands, disarmed policy save, manual Resume, due proposal observations, separate release/reconciliation | No implicit authorization/catch-up/auto-commit. Typed refusal/unknown/stale and accessibility checks; zero provider/transfer/registration effects. |
| P6-F internal capability acceptance | Integrated all-nine-capital/service/IPC/UI/native/lifecycle checks, exact source-isolated closure, tracker/Linear and human review | Internal capability accepted separately from real enablement, strategy eligibility and optional sale/connected acceptance. Failed gates remain visible and blocking. |
| P6-G optional sale preparation/execution | Only after accepted cash-only slice and policy/evidence review: bounded consequences, explicit order review, existing OMS/unknown recovery and post-fill reassessment | No pre-funding or direct adapter path; cost/exposure objective and every operational gate required. Otherwise pending/unavailable, not silently omitted. |
| P6-H optional connected verification | Exact source/ownership/current-doc/account/host review, all-consumer budget proof and owner-authorized connected observations | COQ-12/14 and account-wide ownership/financial evidence open; mocks/internal simulation cannot close them. No live or payout authority. |

A precedes B/C; D must complete before E can offer operational authorization; F verifies A–E as one closure. G follows reviewed F and its own objective/qualification review. H follows reviewed applicable G/F plus exclusive account ownership and connected evidence. Implementation can build default-off mechanics without completing P5-H; adopting a P5 candidate remains blocked by H and its later qualification. Update every batch's tracker/issue with completed/remaining requirements, exact prompts, checks, blockers, dependency and local/committed/review state. Before any later phase, reread its full saved requirements. No batch marks P7 complete.

Required focused suites: `paper-profit-reserve-{contracts,storage,accounting,service,authority,consumers,scheduler,lifecycle,ui}.test.ts`, then sale/connected suites only at their slices. Back `fast-check` event sequences with independently calculated fixtures and real transaction/OMS boundaries, not copied evaluator logic.

- All nine balances and native/discretionary boundaries; deposits/withdrawals/basis-only changes cannot produce reserves or returns. Sell-to-retained-cash is internal. Missing history/basis/fees/marks, supported interest versus unsupported credits and fee corrections remain explicit.
- $700 cash/equity with $20 current reserve yields $680 spendable/active, then $30 allocation yields $650 active/$50 reserved; no $660/$630 double subtraction. Account equity/P1 return unchanged. $102 debit/$100 receipt/$2 fee remains a $2 economic cost in existing P1 regression; P6 adds no real payment.
- Strict economic/realized/cash/floor minima, 33% cent slice, small remainder, fixed base/U, repeated/released gains, loss/recovery, tax principal/profit provenance, policy change/disable/re-enable and zero capital preserve monotone H. A winning count or deposit-only balance crossing cannot fund.
- Simultaneous order/reserve and two reserve reviews against one revision permit only funded capacity once. Order partial/final/cancel/unknown claims stay correct; no unfilled proceeds or stale price funds a buy. Underfunding raises incident and retains claims.
- Fault before/after origin funding, claim/assessment/H/head/response writes and acknowledgement; same command replay is exact, conflicting request refuses, no half-funded state. Restart/copy/restore/source correction cannot reset loss, grant authority or double-assess.
- Wrong profile/book/environment, expired/lost lease/fence, host takeover, kill/hard stop/manual pause/qualification missing, malformed IPC and worker/renderer mutation attempts refuse. Resolving an incident never performs Resume. Every P6 execution constructor must use its bound port; omit injection and enrollment fails.
- Preview/save/copy/upgrade/import never arms; due/missed cadence does not commit or invent past observations. Reads do not mutate or call providers. No transfer, broker reset, registration/final/holdout/promotion/deployment port or side effect.
- Legacy P0–P5 numerical suites, old report/source hashes and negative/consumed evidence remain unchanged. Root typecheck/lint/tests/build, production desktop/native safety, focused P6 keyboard/theme/zoom checks, migration/backup lifecycle and isolated commit closure pass for implementation. Planning probes are not acceptance of P6 code or strategy performance.

Internal cash capability acceptance requires an end-to-end claim protecting real simulated order spending, exact linked state/backing, all-consumer coverage, atomic recovery, default-off lifecycle and unchanged legacy behavior. Merely incrementing a modeled reserve number fails acceptance. Operational enablement additionally requires current explicit owner review/permit and all existing eligibility gates. Optional sale and connected status remain separate; P6 is not described as fully operational while their applicable gates are unmet.

## 10. Decisions and evidence needed before use

No answer is required to implement the default-off types/storage/fixtures. Before an actual paper book/policy is authorized, obtain its explicit simulated opening amount, strategy/config/requirements and qualification evidence, share/milestone/base/floor/batch/cadence/tax preferences and consequence approval. These are not inferred from the P5 research shares or a user's general desire for payouts. New strategy parameters/hypotheses require finite trial identity; P5-H remains pending.

Before G, decide the allowed sacrifice/turnover/exposure objective and review the strict-cap sale trade-off with adequate evidence. Without that decision/evidence, retain cash-only funding and mark sale capability unavailable. Before H, resolve intended host/dedicated account permissions, current account fees/rules/history and account-wide ownership protocol; these require real evidence and separate owner authorization, not a guessed current account state.

P7 retains owner-approved future registration/identities/rights, actual valid observations/actions/coverage, existing stricter statistical/risk/cost gates, candidate-or-none freeze and untouched final claim once. Existing applicable 5% PBO and 365-observation/30-action requirements are not weakened or indiscriminately assigned to a different study; identity/design review establishes applicability. COQ-10/13/15/16/17/18 and P0–P5 human/release gates stay open. Copies, internal simulations and changed source cannot create fresh evidence. External payments/live trading need their independent future project.

**Prompt used**

Commit and push P5-A–G, then lets move on to planning P6. Reread its full requirements in the saved roadmap and inspect the code before coding. Keep P5-H pending and preserve P0–P4 and the full P0–P7 scope.
