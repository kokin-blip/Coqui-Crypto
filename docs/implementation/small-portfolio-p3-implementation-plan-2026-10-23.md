# P3 implementation plan: profit assessment and reserve previews

October 23, 2026, America/Phoenix. **Planning only; no P3 application code written.** Based on P2 commit [aff6b603dbf354762ddde6bc50cc00eb3eebe098](https://github.com/kokin-blip/Coqui-Crypto/commit/aff6b603dbf354762ddde6bc50cc00eb3eebe098), pushed to `codex/operations-crew-journal`. P0/P1 remain in 0c3d36c; the accepted P2 specification remains unchanged.

The [complete original P0–P7 roadmap](small-portfolio-profit-policy-plan-2026-10-23.md) is the durable source of truth. This is its P3 implementation addendum, not a replacement. Reread its accounting, reserve policy, watermark/partial assessment, capital caps, lifecycle, architecture, settings/UX, P3/P6 boundaries, dependencies, evaluation and acceptance requirements before preparing this plan. [Phase tracker](small-portfolio-phase-tracker-2026-10-23.md). [Source and arithmetic evidence](evidence/p3-reserve-planning-2026-10-23/).

## 1. Delivery boundary and decisions

P3 delivers a pure assessment/transition engine, immutable **preview** policy/state/assessment evidence and a consequence view. It does not allocate actual account cash. The distinction is deliberate: the roadmap's P3 mode is Preview only; P6 implements optional reviewed paper reservation.

- Default goal: **Keep gains invested**. The only alternative is **Preview setting aside gains**. Neither grants financial authority. No scheduler action or automatic notification is installed.
- Initial eligibility is the roadmap's strict **net realized investment profit plus net economic profit** cap, funded hypothetically from already eligible USD cash. No economic-profit-only variant is substituted.
- All three triggers are included: dollar unassessed profit, percentage of a fixed assessment base, and an absolute active-balance milestone. Wins are an optional advisory review condition, never eligibility proof.
- A saved preview is not an assessment, reserve, sale or receipt. Modeled assessments and releases belong to a separately identified preview book. Actual P2 claim storage continues to reject profit/tax funding.
- No reserve commit/release command, order/cancel/transfer client, broker polling, credentials, deployment, study registration or strategy change is added. P2 production constructor injection stays off.
- Missing inputs remain metric-specific unavailable. A supported economic P&L may remain visible when realized-profit, cash capacity or the operating requirement is unavailable. Exact P1 returns do not need to be available to establish supported dollar profit; missing financial facts do block eligibility.
- Pre-personal-tax amounts remain labeled. The manual tax-hold input is a **hypothetical hold preference** in P3, not a tax estimate or actual claim. It cannot certify money available to spend.

No product input is required to begin these batches. Optional shares, thresholds, retained-capital preferences and tax amounts are explicitly entered preview assumptions. Do not silently select an enabled policy or an optimal percentage. A $500 illustrative book may show labeled example values; saved account settings require the user's entries.

## 2. Verified source findings and consequences

These are source findings, not observations about an installed account. The source inventory records committed and working hashes separately; unrelated execution/hourly edits remain unstaged and unmodified.

| Verified finding | Consequence for P3 |
|---|---|
| `capital-performance.ts` exposes economic P&L/contributions/outflows and exact availability, but always returns `unscoped_cost_basis` for realized/unrealized P&L | Reuse economic P&L from the original epoch. Add a separately versioned, scope-bound eligibility/basis projection. Do not change P1 calculation version or rewrite historical reports. |
| `paper-activity.ts` already consumes unknown opening inventory before known buys and flags unknown realized basis, but rounds display values and orders ties by fill ID | Reuse its cases and arithmetic principles. The new eligibility projection must retain exact amounts and proven economic ordering; display rounding or a lexicographic tie breaker cannot establish financial evidence. |
| `costbasis.ts` supports deterministic lot disposal, while `PortfolioTaxService` selects global/manual lots and does not bind them to the financial account | Reuse arithmetic only after scope/provenance/fee validation. Do not use current tax totals, analytical cheapest-method selection or manual disposal records as verified reserve profit. |
| `initializePaperBook` currently requires nonempty tracked holdings and exactly zero opening cash; the immutable opening has quantities/market values, not acquisition basis. Local fills/legs retain exact fees and execution links | Existing local books cannot be treated as verified cash-funded origins. A separately declared hypothetical cash book can support simulated FIFO; legacy opening assets remain unknown. Do not change that initializer or promote opening value into basis in P3. |
| P1 Coinbase/Alpaca envelopes retain useful raw references but do not establish complete basis, coherent cuts, all fee postings or exclusive account authority | Connected eligibility can remain unavailable. Reuse persisted evidence only; no additional acquisition/client is needed for this phase. |
| `account-budget-v1` has shared claim heads, per-ceiling reflection, active equity and revision checks; storage rejects funded profit/tax claims | Evaluate hypothetical claims with the existing pure projection in a separate preview book. Never relax `p2_funded_reserves_disabled` in P3. |
| P2's `operatingFloor` is explicitly `no_global_floor_certificate`; a feasible request is not a minimum-capital optimizer | Add a bounded retained-capital witness for an explicitly fixed request where it can be proved. Otherwise the final allocation consequence stays unavailable. A necessary scalar bound alone is insufficient. |
| P2 connected budgets currently have incomplete holds/ownership/fees, and production does not enable the new claim consumers | Preserve those blocks. An apparently complete balance or valid existing execution proof does not qualify profit for allocation. |
| Existing `proposal-preview.ts`/COQ-29 work binds modeled consequences to hashes and expiry; Research has governed read-only views | Reuse revision/expiry and evidence UI patterns, not its default cost assumptions as account facts. Research gets a link/read-only preview summary, never registration controls. |
| Existing account presentation settings explicitly reject cross-domain finance fields | Create a reserve-specific settings contract and immutable policy versions; do not add finance fields to `accounts.settings.set` or mutable `app_settings` financial truth. |

No repeated broad research is needed. The open gaps concern missing financial evidence and code contracts, not conflicting academic claims. Existing primary-source research and negative results remain preserved. Current account-specific basis, fees, identities and native observations cannot be supplied by a paper or a published fee example. Recheck official documentation only if implementation reveals a genuinely unsupported provider interpretation; otherwise return unavailable.

## 3. Canonical inputs and assurance

Create `profit-reserve-eligibility-v1` and `profit-reserve-preview-v1`, independent of `capital-flow-performance-v1`, `account-budget-v1` and `capital-feasibility-v1`.

A service-assembled input binds:

- Scope/account/environment, original economic tracking epoch and all predecessor limitations. Never use an arbitrary profitable subperiod to reset the account's loss history. Resolve predecessor epochs without editing P1: use an independently continuous original-boundary calculation, or mark lifetime eligibility unavailable when a gap prevents it. Never geometrically stitch or sum unsupported segments.
- P1 input manifest/report hash, event heads, valuation heads, current coverage and acquisition-failure state. Recompute from immutable facts; do not accept a renderer-supplied P&L.
- P2 source ID, current budget revision/generation, current claim heads, hold/reflection proof, quantities, native rules, quotes, fees and their observation/expiry times.
- Scope-bound lot/fill ordering, basis provenance, fee coverage, separately attributed USD investment income and unsupported activity reasons.
- Immutable policy version, prior state revision, cycle base/ceiling, previous allocations, tax-hold funding provenance and any pending/unknown operation.
- An optional fixed strategy/risk request and retained-capital witness. Absence is explicit, never replaced by the illustrative P2 policy.

Read this cut in one local database read transaction. Different valuation/source times require a supported common cut; do not combine a new cash balance with old positions or prices. The report expiry is the earliest bound evidence expiry, capped at 30 seconds from inspection. If a historic interval has no fresh current cut, keep the historical metric visible and mark the proposed current allocation unavailable. An unchanged evidence hash does not extend freshness.

Use available/unavailable objects with reason codes, missing references and restoration guidance for each input/output. Report evidence assurance (`observed` versus `scenario`) separately from **mode `preview_only`**. Every route returns `executionEligible: false` and `liveExecutionPermitted: false`.

### Scoped realized investment profit

Add a conservative derived financial projection, not another mutable balance ledger:

1. Load exact local opening, original opening legs, fills, fees, order/fill links and positions. The existing initializer produces zero-cash books with opening holdings, so a current account may have no fully supported reserve-profit history. Independent hypothetical cash books are explicit scenarios; they are not inserted through or substituted for the old initializer. Bound reads as existing services do; a limit hit is unavailable, not a truncated complete ledger.
2. Establish stable economic order from recorded/provider sequence where supported. Same-time dependent trades with no proven ordering are unavailable; simultaneous independent trades may be grouped. Do not infer sequence from acquisition receipt order.
3. For explicitly supported hypothetical cash origins (or later independently proven equivalent financial evidence), replay quantity/cost lots under a frozen FIFO **simulated investment accounting** convention. Buy USD costs enter basis once; sell fees reduce proceeds once; actual execution prices already include modeled spread/slippage. Retain exact disposal links and method version. This makes no tax election claim.
4. Unknown opening/in-kind basis stays unknown. A complete cap needs cumulative net realized investment profit including losses and supported standalone costs. Unknown realized losses cannot be ignored by summing only known winners. Unsupported currencies/fee valuation, manual adjustments and unclassified rewards block the affected aggregate.
5. Reconciled USD cash interest may be included once as separately attributed investment income, as specified in the roadmap. No current or hypothetical cash-yield setting creates an observed receipt. Non-trade account expenses reduce the eligible profit pool once under explicit attribution; they are not subtracted again from P1 economic P&L.
6. Reconcile opening, trades, flows, costs, final quantities and economic profit. For a full supported decomposition, realized plus unrealized plus separately declared income/expenses must explain P. Unknown basis can coexist with supported P; the stricter reserve allocation remains unavailable.
7. Connected evidence initially supports only what its immutable inputs prove. Do not turn the current unscoped tax-lot store into financial-account evidence or add a manual correction screen. Record unsupported connected cases and restoration requirements. Later basis evidence must be append-only and source-linked; no optimistic backfill in this phase.

Keep original P1 realized/unrealized unavailable values and report hashes unchanged. The new preview labels its independently supported **simulated/scoped investment** decomposition and basis limitations explicitly.

## 4. Policy, cycle and assessment rules

### Identity and transitions

Policy versions are immutable, account/book scoped and access checked. Content includes goal, strict eligibility variant, trigger/value, integer share basis points, retained-capital preference, minimum reserve batch, cadence/time convention, optional review-win count, optional hypothetical tax hold and predecessor policy ID. All monetary inputs are canonical decimal USD text; minimum batch and reserved amounts are cent-valued. Reject malformed/excessive precision, negative values and shares outside 0–10000 bps. Zero share is disabled, with no division or assessment.

Maintain exact H, the assessed-profit watermark, and a distinct total allocated-profit-cash history. Never derive H from reserve cash divided by the current share. In the P3 preview stream these are **modeled** values; actual account claims/H cannot be written by the preview engine. Distinguish a prospective eligibility baseline that excludes old gains from cash that was actually assessed/funded.

At initial preview-policy baseline or a version change, after resolving/cancelling uncommitted old proposals, set the modeled eligibility baseline to `max(prior H, current P, 0)`. Record the excluded gain separately; no reserve is created by this operation. If current P or predecessor continuity is unavailable, save a draft configuration in `awaiting_baseline`; do not substitute zero or establish a new loss-free epoch. Disabling stops proposals and retains all state. Reenabling is prospective. Pending/unknown funded operations in any future imported state block a policy transition until reconciled; do not time them out or rewrite their share.

Corrections append source/projection revisions and invalidate dependent previews. A negative correction or drawdown never decreases H automatically. If it undermines backing, expose underfunding and preserve obligations. Proven historical ledger errors require a separately audited correction chain; P3 adds no user-editable H or financial-correction command. No correction silently rewrites historical signed reports.

### Trigger definitions

Freeze B (active equity at the cycle's baseline) and P_base (economic profit then), with exact evidence references. Deposits/withdrawals never change B mid-cycle. Percentage triggers compare unassessed economic gain with `B * threshold_bps / 10000`; label both dollars and percentage. This is not TWR. A zero/unavailable B makes the percentage trigger unavailable.

- Dollar: `max(0, P - H)` reaches the declared dollar threshold.
- Percentage: the same fresh economic gain reaches the threshold calculated from the fixed B.
- Absolute balance: both current active equity and `B + (P - P_base)` reach the selected target, and fresh gain is positive. The second test strips the effect of external funding and reserve releases from a crossing. Full flow/claim continuity is required. A deposit alongside a small old gain cannot manufacture the crossing.

An absolute balance level is one milestone per policy version: show `already reached` when it is at/below its starting B; after its cycle is consumed, that level does not rearm on a dip/recovery. The user can preview a new target through an explicit policy revision, whose prospective exclusions are shown. Dollar/percentage cycles recur on new gain; this avoids inventing an unrequested balance-step size. Unassessed remainders stay recorded, and any policy-change exclusion is visible.

At a supported trigger, capture one U = floor-to-cents(P). Only one open cycle exists per preview stream. Later P increases cannot expand U. Skipped reviews do not create retroactive cycles; the next explicit inspection sees the current supported gain. A triggered cycle may remain deferred for cash/capital evidence. A price reversal requires recomputing current eligibility, not promising the old amount. No preview locks cash.

Wins: only a completed flat-to-open-to-flat position episode with all fills and fees can count once. Splitting an order into fills, partial exits, interest and unknown-basis episodes cannot produce verified wins. An optional count can set `would_request_review`; it cannot open an eligible reserve cycle or bypass any cap. If episodes cannot be reconstructed, that advisory count is unavailable. P3 does not schedule/send notifications.

### Caps and exact partial assessment

Let A be total equity, P the P1 contribution-adjusted economic profit over the preserved tracking lineage, L the complete cumulative net realized investment profit, K prior profit allocations plus other profit-backed claims, F the effective retained-capital requirement, and S the shared unencumbered cash capacity. All amounts require matching scope/time/evidence.

Compute separately labeled cap values:

- Economic backing: `max(0, P - K_economic)`.
- Realized backing: `max(0, L - K_realized)`.
- Cash: S after real obligations and the proposed hypothetical manual tax hold, without subtracting an already reflected hold again.
- Capital: `max(0, active_equity - F - additional_required_cost)` with full post-reserve risk/request validation. Cash-only reservation itself creates no execution cost.

K is sourced from unique assessment/funding-provenance IDs, not a sum of both an assessment and its corresponding claim. A claim/receipt/release transition does not count a profit slice twice. Tax holds identify whether they are profit-backed or principal-backed; unknown provenance blocks a definitive shared profit cap. The initial conservative cumulative allocation cap retains prior funded slices on ordinary release, in addition to monotone H; do not recycle them through a changed label. Future proven corrections are explicit, never ordinary releases.

C is the minimum of the complete supported caps. If any required cap is unknown, final allocation is unavailable while the other components remain visible. A known limiting zero is a deferral; do not claim a hypothetical positive allocation is safe while another input is unknown.

Use the roadmap's integer-cent algorithm unchanged:

```text
g = max(0, min(P, U) - H)
g_cents = floor(100*g)
c_cents = floor(100*max(0, C))
r_cents = min(floor(g_cents*b/10000), c_cents)
G_cents = ceil(r_cents*10000/b)
```

For positive b/r, assert G <= g and `floor(G_cents*b/10000) == r_cents`. Commit a **modeled** assessment only if the trigger, evidence, minimum batch, current snapshot, policy/state/budget revisions and post-reserve constraints remain valid. Store g/G/r/b, all caps, rounding residual and before/after H in one immutable assessment. Zero/below-batch produces no mutation. A modeled reserve decreases active/spendable equity once, leaves total A/P unchanged, and advances H by G. No P2 financial claim is created.

A partial assessment advances only its selected exact slice. If the remaining slice cannot produce a minimum batch even with adequate capacity, close the cycle as `small_deferred_remainder`, retain that unassessed gain, and freeze the next base from retained active equity. A temporary capacity shortage keeps the old U without a spendable promise. Cancellation of an unfunded proposal changes no H/cash. A modeled release frees modeled cash but never reduces H. Preview expiry does not release an actual pending claim.

### Retained-capital evidence: address the P2 gap without an optimizer

Add a pure `reserve-capital-witness-v1` for a **fixed, versioned next-request requirement**. It is conditional on its exact portfolio, prices, costs, native rules, strategy/risk policy and intent quantities; it does not claim a global minimum starting balance or a guaranteed floor through a crash.

For the supported fixed-quantity, fixed-cost P2 form, derive exact necessary retained-NAV inequalities for existing/post-request position and invested caps, entry fractions, fee-inclusive buy cash and the user's cash/operating preferences. Preserve stricter account-level constraints. Native/discretionary illegality or incompatible absolute turnover/order limits make that request infeasible at every retained level; they are not solved by increasing risk. Round a computed retained requirement upward to cents, retain each binding inequality, then verify the complete frozen request with `evaluateCapitalFeasibility(requireFullRequest: true)` against the hypothetical post-reserve budget. No clipping/reordered intent is a proof of the original request.

Only label the result a supported **requirement for that fixed plan** when the inequalities are sufficient for the supported form and the full witness agrees. For unmodeled constraints, variable/unknown costs, missing native rules, unsupported liabilities, no bound strategy request, or an unproved sufficiency condition, return `operating_requirement_unavailable`. P2's global `operatingFloor` result remains untouched. An empty order list is not evidence of capacity to execute a strategy; cash-only scenarios must declare that limited objective explicitly.

F = max(user preference, supported fixed-plan requirement). Validate current held weights immediately after the hypothetical reserve, as well as the next request. A necessary bound such as `held_value / max_weight` or `minimum / position_weight` can explain a shortfall but cannot alone approve a reserve. If a complete witness fails, defer (or use a separately proven lower cap); do not binary-search a clipped/unsupported planner and label its result exact. Store no inferred universal optimum.

Unknown opening basis in existing local books and incomplete connected financial evidence are additional legitimate blockers; a completely supported modeled scenario must remain available independently. The current legacy strategies lack an approved new-version fixed-plan binding, so account previews may correctly show this cap unavailable. Illustrative scenarios supply an explicit independent frozen requirement. This is an evidence gate, not a deletion of the capital-preservation requirement or permission to enable paper funding. Any wider optimizer is a proposed future scope change, not hidden P3 work.

## 5. Immutable storage, transactions and local interfaces

Append migration **98** after inspected v97, or the actual next unused version if another delivery intervenes. Do not edit 96/97. Empty additive structures; no historical normalization fabricates reserve state.

| Proposed table | Content and guard |
|---|---|
| `capital_reserve_policy_versions_v1` | Scope ID, immutable origin-profile provenance, predecessor, canonical settings/hash, creation time; only disabled/preview goals in P3 |
| `capital_reserve_eligibility_reports_v1` | Exact source/input manifest, scoped basis/fee/income completeness, independent metrics/reasons, superseded-report reference |
| `capital_reserve_state_revisions_v1` | Preview-stream identity/domain, policy/baseline/cycle U/B/P_base, H, modeled reserve/tax/pending buckets, operation identity, predecessor, content hash; explicitly not account cash |
| `capital_reserve_assessments_v1` | Preview-domain operation ID, state before/after, exact G/r/share/caps/rounding, source/budget/policy refs and cancellation/defer/closure provenance |
| `capital_reserve_preview_reports_v1` | Consequence inputs, component availability, proposed next state, capital witness, hypothetical sale/comparison, expiry, superseded report |
| `capital_reserve_preview_heads_v1` | Operational scope/stream pointers, policy/state revision and CAS generation; no financial balances; archive/continuity flag |

Use canonical decimal/integer-cent text (no SQLite REAL/JS money floats), SHA-256/canonical JSON, foreign keys, operation uniqueness, and immutable no-update/no-delete triggers for facts. Keep profile access in existing capital bindings; origin profile remains immutable provenance rather than adding a `profile_id` to every fact. No backup-manifest key contract change.

Modeled state is not promoted to financial state. At P6 acceptance, a newly authorized paper stream starts from verified current account facts and actual predecessor H/claims, not simulated preview allocations. Preserve the preview as historical evidence. Financial-domain commitment remains inaccessible in P3, including through a direct repository call; actual claim writer rejection is unchanged.

Implement a transactional append/CAS boundary for preview-state transitions and modeled assessments. Verify predecessor and operation ID first; exact retry returns the original result, conflicting reuse rejects. Re-read the source/policy/budget/state revisions inside the same transaction before appending the assessment and successor state/head. Crash injection before each write and before UI acknowledgement must leave either the original state or the entire committed modeled transition, never a half-updated watermark. It has no callback capable of writing actual orders/claims. Pure reducer transitions are reusable by P4 later; no replay/strategy runner is built in P3.

Public IPC, proposed names:

- `capital.reserve.view`: local read of accessible scope, saved configuration, state, balances, evidence/limitations and historical previews.
- `capital.reserve.preview`: local, nonpersisting evaluation of a draft configuration or saved policy. Observed inputs are resolved in Main; independent hypothetical books use a strict separate scenario schema. No renderer evidence becomes a fact.
- `capital.reserve.settings.save`: explicit local write, idempotent command ID plus expected policy/state revisions; saves an immutable preview configuration/baseline, never funds it. With missing baseline evidence, retain `awaiting_baseline` and disclose why.
- `capital.reserve.inspect`: explicit local evidence write for Inspect calculation. Capture or reuse one supported cycle ceiling, save a revision-bound immutable report/proposed successor, and return its identity. Reinspection without a new supported input does not create a second cycle or assess twice. It does **not apply** the proposed modeled assessment to the account or its preview head. The modeled transaction engine is exercised in isolated preview-book tests; later P4/P6 callers remain separately gated.

Register the last two as local writes in the existing dispatcher/command fingerprint policy; the first two remain reads. Read handlers receive DB/read dependencies and a clock, not adapter/order/registration clients. No change to write permissions grants order authority. A saved inspected report can be loaded after expiry as historical evidence, but must be freshly evaluated before a current consequence is shown. Stale/concurrent commands return a typed conflict and preserve the original report.

Policy changes resolve uncommitted preview proposals explicitly without advancing H. Unknown funded state cannot be silently cancelled. An inspection may record an open cycle but never advances the assessed watermark; only an explicitly isolated modeled transition can do that. This preserves the roadmap's one-cycle ceiling while avoiding the repeated-inspection fiction of cash having been set aside.

## 6. Exact file and reuse inventory

Paths are repository-relative. New files are proposals, not code already created. Add relevant package barrel exports; do not refactor adjacent modules.

| Layer | Add / change |
|---|---|
| Core portfolio | Add `packages/core/src/portfolio/profit-reserve.ts` (policy, caps, cent arithmetic), `profit-reserve-state.ts` (transition validation), `profit-reserve-eligibility.ts` (scoped investment projection) and `reserve-capital-witness.ts`; export in `portfolio/index.ts`. Reuse `capital-ledger.ts`, existing decimal/hash utilities and P2 pure budget/feasibility. Preserve P1 `capital-performance.ts`, legacy `performance.ts`, `paper-performance.ts`, `costbasis.ts` and frozen remediation arithmetic. |
| Storage | Add `packages/storage/src/migrations/v98.ts`, register in migrations/index; add `repositories/profit-reserve.ts`, export in repositories/index. Extend `profile-impact.ts` for durable fact counts once. Extend `profiles/duplication.ts` and its `duplication-transient-counts.ts` helper only to archive new operational preview heads; never rewrite immutable origins/H. Reuse existing capital binding access/backup/restore. |
| Services | Add `packages/services/src/portfolio/profit-reserve-eligibility.ts` (source assembly), `profit-reserve.ts` (local preview/settings/inspection) and `profit-reserve-state.ts` (isolated modeled transaction boundary); export in portfolio/index. Reuse `capitalPerformanceView`, `accessibleCapitalBudget`, immutable local origin/fill/ledger/valuation repositories. No changes to provider acquisitions, schedulers, order writers or existing execution proofs. |
| Contracts | Add `packages/contracts/src/schemas/profit-reserve.ts`; register/export through channels.ts/index.ts. Strict literal preview mode, discriminated observed/scenario inputs, decimal/bps units, typed availability, command/revision fields and forbidden financial operations. Extend existing registry and secret-leak tests. |
| Main | Add `apps/desktop/src/main/profit-reserve-handlers.ts`; compose with existing capital handlers using injected clock/profile/DB only. Local read plus explicit settings/evidence writes, no acquisition/financial adapters. Preserve scheduler/composition's unrelated current edits. |
| Renderer | Add `apps/desktop/src/renderer/app/ProfitReserves.tsx`; mount beside Capital feasibility in `Allocation.tsx`. Reuse `CapitalPerformance`, MetricInfo, ChannelNotice, form/query/command patterns and terminal styles. Add scoped rules in terminal.css and refetch/invalidation policy in query/refetch.ts. Add a read-only link/summary in Research.tsx, without changing governed study controls. |
| Verification | Add `tests/profit-reserve.test.ts`, `profit-reserve-state.test.ts`, `profit-reserve-eligibility.test.ts`, `reserve-capital-witness.test.ts`, `profit-reserve-storage.test.ts`, `profit-reserve-service.test.ts`, `profit-reserve-ui.test.ts`; extend migration/lifecycle/channel/safety cases. Add a disposable native `apps/desktop/scripts/profit-reserve-smoke.mjs`. |

### Compatibility and migration

Existing profiles get no policy/claim or enabled setting on migration. No backfill infers prior contributions, basis, fees or assessments. Missing policy/state is `not configured`, not financial zero; a verified empty Coqui claim ledger is labeled narrowly and does not assert absence of provider holds.

Same-profile restore preserves policy versions, state history, observation times and reports. Block current allocation consequences until predecessor/source/budget continuity is established; a backup is not fresh ownership. Because P3 does not execute, it cannot release or replace an actual pending claim after restore.

Duplication retains immutable original evidence/H as archived, clears active preview pointers, and grants no authority. A new simulation book/policy stream needs a new virtual identity and explicit initialization; copying does not continue the original account's spendable pool. Reconnect/credential rotation to the same verified account preserves economic identity and loss history. Removal archives access rather than deleting immutable facts. Update deletion-impact counts in existing categories without double counting.

Preserve original roadmap/evidence and P0–P2 plans, reports, source numerical versions, Coinbase schema-2 hashes, frozen registrations/results, negative findings and consumed holdout identities. Current dependency manifests may be regenerated only for the exact new source closure after archiving current bytes, with no migration of registered studies. Review/release checks remain independent.

## 7. UX and consequence semantics

Compact Profit reserves section beside allocation/capital information. Account/environment is explicit, with selection when ambiguous. No account is required to explore a clearly separate $500 hypothetical book. Loading, empty, disconnected/archived, stale, partial, error and unsupported states are intentional UI cases.

Controls: goal, trigger/value with units, integer-bps profit share rendered as a percentage, retained-capital preference, minimum reserve batch, review cadence, optional review-win count, optional hypothetical tax hold and funding provenance. Keep cadence advisory in P3: show when inspection would be due, using a stored UTC anchor; do not start a scheduler, invent missed observations or send notifications. Existing permission/kill/pause state remains visible and unchanged.

Save preview settings and Inspect calculation are the only new account actions. Editing fields invalidates the displayed result. Saving financial assumptions cannot mutate general presentation settings or silently apply an assessment. Focus returns to the changed field/error or result heading after a conflict/expiry. Repeated evaluation with identical inputs is possible without duplicated cycle/assessment IDs.

Display independently:

- Opening/tracking limits, contributions, current economic P&L, scoped realized/unrealized P&L and their basis/fee/income provenance. Link existing P1 return evidence; unavailable statistics do not become zero.
- Actual assessed/funded amounts where proven, prospective excluded gains, **modeled** H, fixed B, U and exact currently unassessed slice. Never label a hypothetical assessed amount as already allocated account cash.
- Economic, realized, cash and capital caps; supported candidate G/r with cent rounding; retained active equity and concentration after the proposed reserve; effective fixed-plan operating target or its unavailability.
- Account total equity, actual profit reserves/tax holds as subsets, active cash/free cash and pending cash/receivables with no double count. Modeled additional reserves/holds are a separate consequence column. Historical confirmed receipts retain P1's purpose limitations; unexplained principal outflows are not profit paid.
- If cash is insufficient: the supported cash shortfall and `would require a sale`. A selected, strictly hypothetical sale may reuse P2 native/cost/quantity arithmetic to show turnover, costs, realized gain and residual allocation; it cannot add its sale proceeds to eligible cash or issue an order. Unknown lot/rule/cost data make those sale details unavailable. Preserve the $500 basis/$550 value example: $12.50 sold realizes about $1.14; realizing $12.50 under proportional basis needs $137.50 before costs. Do not call all sale proceeds profit.
- A small deterministic scenario comparison against keeping gains invested, using the same contributions, explicit zero reserve yield, explicit hypothetical market moves and costs. Show total account plus labeled modeled receipts only once. Separately entered out-of-account fixed expenses affect a labeled user-net-outcome comparison once; they never rewrite observed account P or appear as an invented ledger debit. No probabilities, predicted income or best-policy ranking. Full historical/path-dependent replay remains P4; signal/parameter/0–25–50% contests remain P5.

Concrete reasons include no new profit after prior losses, unrealized profit, basis/fee/flow incomplete, cash committed to an order, retained-plan requirement unavailable, insufficient retained capital, below batch size, native minimum not met, ownership unresolved and preview expired. Show restoration guidance without implying another UI refresh can restore missing historical facts. USD reserve cash is not a stablecoin or a guaranteed payment.

## 8. Small reviewable implementation batches

| Batch | Work | Completion gate |
|---|---|---|
| P3-A Definitions/contracts/fixtures | Reread full saved phase; freeze policy/trigger/baseline/branch semantics, reason codes, financial-vs-modeled boundaries, source inventory and independent arithmetic fixtures | Every supported input/unknown has an explicit state; all three triggers and full P3 requirements mapped; no runtime behavior change |
| P3-B Scoped eligibility and capital witness | Exact local origin/fill/basis/fee projection; preserve connected evidence gaps; fixed-request retained-capital inequalities plus full P2 witness | Known-loss/unknown-basis/fee/sequence cases and no certificate from a clipped/empty request pass; P1/P2 numerical outputs unchanged |
| P3-C Pure evaluator/state machine | Strict caps, exact cents, cycles, baseline/excluded gain, partials, loss/recovery, release and policy changes | Hand-calculated and event-sequence invariants pass; no dependence on network, mutable account settings or personal tax estimates |
| P3-D Immutable persistence/lifecycle | Empty additive migration, policy/state/assessment/preview facts, CAS/idempotency, modeled atomic transaction and archive/restore handling | Rollback/crash/conflict/duplicate/backup/newer-schema/copy/restore tests pass; actual P2 profit/tax claim rejection remains intact |
| P3-E Main/service/preview UX | Local read projection and explicit save/inspect evidence commands; compact account/scenario UI, evidence links and hypothetical consequence comparison | Real service joins canonical P1/P2 evidence, expiry/revisions/access checked, no financial side effects; keyboard/themes/zoom/narrow layouts pass |
| P3-F Acceptance/preservation | Full integrated checks, native disposable smoke, protected hashes, exact commit-source isolation where dirty work overlaps, tracker/Linear records | All P3 acceptance met for capability; account-specific unavailable metrics documented separately; human review/owner/release/P6 gates remain open |

Dependencies: B before trustworthy observed eligibility; C and D before durable state; E uses B/C/D and existing capital channels; F cannot accept helper-only coverage. P1/P2 human review remains a dependency for adoption, even while pure P3 implementation proceeds. COQ-12/14/15/16 connected operational/evidence gates, COQ-29 consequence review, COQ-31 governed views, COQ-10 registration, COQ-17/18 qualification and COQ-13 release remain unchanged.

After every delivery batch update the tracker with completed/remaining requirements, checks, blockers and dependencies; update matching Linear issue with exact prompts and local/committed/merged/released status. Completion comments end **Completed by: kokin**. Do not close a later phase or operational gate because P3 tests pass.

## 9. Regression cases, tests and acceptance

Independent illustrative fixtures (supported realized gains/cash unless stated; not investment forecasts):

| Case | Required result |
|---|---|
| $500 opening, $200 deposit, flat prices | P stays $0; no gain trigger and no deposit-created balance crossing |
| B=$500, target=$550, $10 gain plus $200 deposit | Actual active $710, growth-only balance $510: target does not trigger |
| P=$50, H=$0, U=$50, share 25%, adequate caps | G=$50, r=$12.50, modeled H=$50; A/P unchanged, active cash/equity down once |
| P=$100, H=$0, U=$100, share 25%, C=$10 | G=$40, r=$10, modeled H=$40; exact retry unchanged |
| Same partial cycle, P drops to $30 then recovers to $40 | No additional assessable gain or cash; at P=$60, eligible residual $20 can reserve $5 |
| P=$100, H=$0, share 33%, C=$10 | G=$30.31, r=$10, H=$30.31; do not compute a repeating-decimal H |
| 100% share, g=$0.01, min batch=$0.01 | One cent assessed/reserved exactly once; 0% share performs no division/action |
| Realized +$50, open loss -$75, total P=-$25 | No eligible reserve, regardless of number of wins |
| P=$100 but realized pool=$4 and cash=$30, share25% | Allocation capped at $4 before other requirements; $30 sale proceeds are not $30 profit |
| Complete economic P but unknown opening tax basis/fees/order | Economic P stays visible; dependent realized/eligibility fields unavailable |
| Existing funded slice $10 released in modeled book | Cash freed; H and cumulative assessed slice unchanged; old gains cannot be reassessed |
| Fresh profitable subperiod after old loss | Original economic lineage governs eligibility; selecting dates cannot erase recovery requirement |
| Current $100 position, max 20%, active=$500 | Reserving even $0.01 breaches that active cap; a scalar bound explains it, full frozen-plan witness is still required |
| Fee included in exact execution price and separately posted attribution | Cost enters account/realized arithmetic once; attribution does not create a second debit |
| Connected ownership/hold/native/fee proof incomplete | Supported balances remain visible; no exact eligible reserve or invented operating floor |

Add cent-boundary fixtures one increment below/at/above every cap and minimum batch; shares 1/3300/10000 bps, fixed base/cycle ceiling, residual closure, partial capacities, pending/unknown claims, late fees and policy exclusions. Compare with an independent integer reference, not a reimplementation of the reducer.

Use fast-check event sequences for conservation, idempotency, monotone H, one open cycle, no gain from external funding, no duplicated fee/claim backing and bounded r. Domain boundaries distinguish preview books from observed financial facts. Property tests must include unknown evidence and corrections, not only successful paths.

Integration tests exercise the actual Main/service/repository paths: scoped origin/ledger/fill assembly, canonical event/claim heads, common cut, revision race between inspection and persistence, crash before/after each transaction write, replay after lost UI acknowledgement, conflicting command IDs, inaccessible/wrong environment/profile, copied/restored/disconnected scopes and stale input. Test every new public route with provider submit/cancel/transfer/poll/registration spies or deliberately absent capabilities. Assert no actual claim/order/ledger/schedule/execution-policy rows change; only declared preview/settings/evidence rows may change on explicit local writes. Pure read routes leave total_changes unchanged.

Run the nine balances $50/$100/$250/$500/$1,000/$2,500/$5,000/$10,000 and $100,000 control with the same stated policy and true per-book arithmetic, plus boundaries. Report blocked/unknown cells honestly; do not scale a large equity curve or change risk per balance. No market backtest or trial registration is needed to establish accounting mechanics.

For implementation run focused suites, repository typecheck/lint/full tests/root build and desktop build/native smoke as appropriate. Verify actual production IPC with disposable synthetic profiles. Check keyboard/focus/help/labels, light/dark/high contrast, narrow viewport, 200% zoom, stale/draft/retry and independent availability. Archive logs/screenshots/protected hashes. Isolate new source from mixed dirty work before committing; reproduce and document unrelated baseline failures.

P3 acceptance:

1. All three triggers, fixed base, bounded U, strict economic/realized/cash/capital caps, exact partial rounding and monotone state are implemented and independently tested.
2. Eligibility derives only from canonical scope/epoch/financial/budget evidence. Unknown loss/basis/fees/flows/ownership or an unsupported operating requirement cannot become an available funded consequence.
3. Immutable preview policy/state/assessment history reproduces old outputs; concurrency/crash/retry/settings/restore/copy cannot duplicate or reset an assessed slice.
4. Every visible amount identifies actual versus modeled status, source, period, calculation version, units, expiry and limitations. A reserve is never called money received.
5. Full consequence and hypothetical sale/comparison views are included where evidence supports them; missing details are unavailable, not guessed. No backtest/optimizer/personal-tax claim is implied.
6. Public routes have zero broker/transfer/study/execution side effects. Real P2 claim restrictions, production defaults, kill switches, permission/fencing/pause/manual Resume and research gates remain intact.
7. Required checks pass, protected evidence is unchanged, and tracker/Linear accurately distinguish code acceptance from human review, current-account evidence, P6 authorization and release.

P4–P7 remain pending **in full**, including the original nine-balance replay, finite strategy/execution/reserve experiments, strict negative/holdout/qualification constraints, optional separately reviewed internal/connected paper integration and future owner-approved prospective work. No live trading or external payout project is started by this plan.

Implementation issue: [COQ-37](https://linear.app/coqui-crypto/issue/COQ-37/implement-p3-profit-assessment-immutable-preview-state-and), Backlog. P3 planning is complete; implementation and all acceptance batches remain pending.

**Prompt used**

Commit and push P2, then lets move on to P3. Reread its full requirements in the saved roadmap, inspect the code, and prepare a concrete implementation plan before coding. Preserve P0–P2 and the full P0–P7 scope.
