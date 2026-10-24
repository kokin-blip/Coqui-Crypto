# Small portfolio P0–P7 phase tracker

The [full saved roadmap](small-portfolio-profit-policy-plan-2026-10-23.md) remains the durable source of truth. [P0/P1 addendum](small-portfolio-capital-accounting-plan-2026-10-23.md). Reread a phase's complete roadmap requirements before beginning it. Propose scope changes explicitly. Never silently drop, simplify or complete a future phase.

| Phase | State | Completed | Remaining / blockers | Dependencies |
|---|---|---|---|---|
| P0 Definitions, scope, source inventory | Committed and pushed | Definitions, baseline, source inventory, exact-or-unavailable rules and independent fixtures | Review remains separate from implementation | Saved roadmap, source baseline |
| P1 Capital-flow accounting and corrected performance | Committed and pushed; in review | Storage, ingestion, calculations, read projections, displays, lifecycle and acceptance checks; isolated delivery 0c3d36c | Human review; actual connected evidence completeness, owner qualification and release remain separate open gates | P0 |
| P2 Shared budgets and small-portfolio feasibility | Committed and pushed; In Review | A–F capability; isolated commit aff6b60 passes 286 files/2,033 tests, typecheck/lint/builds/native checks; original combined-checkout 292-file/2,140-test evidence retained | Human review; account-specific rules/fees/holds/ownership and owner/release gates remain open | P1 review; P6 operational review before connected adoption |
| P3 Profit-reserve evaluation and previews | Committed and pushed; In Review | P3-A–F in 9c6b2fc; exact isolated closure 293 files/2,106 tests, typecheck/lint/builds and both native suites (24 P3 checks); combined 299-file/2,213-test evidence retained | Human review; actual basis/fees/common-cut/retained-plan proof, account ownership, owner/qualification/release gates remain open | P1/P2; COQ-29/31 patterns; P6 operational authorization remains separate |
| P4 Capital-aware simulation | Planning ready; implementation not started | Full roadmap reread; 55-file source inventory, synthetic probes and concrete P4-A–F addendum saved; COQ-38 Backlog | All implementation/acceptance remains pending; no market result, registration, account verification or qualification claimed | P1–P3 review and corrected engine compatibility; full saved P4 plan |
| P5 Strategy and policy experiments | Not started | None | All hypotheses, finite trials, negative findings and evidence gates retained | P4 and adequate development data |
| P6 Optional reviewed paper integration | Not started | None | Default off; all operational/authority/review gates retained | P3/P4 and applicable paper qualification |
| P7 Prospective evaluation and qualification | Not started | None | Fresh registration, evidence, coverage, qualification and promotion gates retained | Owner registration, valid identities, readiness and fresh data |

## Delivery batches

### P0-A — baseline and durable specification

- Recorded original roadmap/evidence hashes, branch/commit and all pre-existing modified/untracked file hashes in `evidence/capital-accounting-2026-10-23/baseline.json`.
- Added P0/P1 specification and this complete phase tracker without rewriting the original roadmap.
- Remaining: source fixtures and all implementation acceptance checks. No connected account observations, financial action, study registration or release evidence claimed.

### P0-B — definitions and source fixtures

- Completed financial account/environment boundaries, explicit funding classifications, date precision, fee/receipt separation, coverage/revision rules and metric-specific restoration guidance.
- Froze hand-calculated regressions in `tests/capital-performance.test.ts`, with small-balance and property-based sequences. Supported and unsupported source cases are recorded in [implementation evidence](evidence/capital-accounting-2026-10-23/implementation-evidence.md).
- No unresolved product decision. Actual provider completeness remains an evidence requirement, never an assumption. Dependencies: original roadmap and accepted evidence-only/exact-or-unavailable decisions.

### P1-A — contracts and storage

- Added migration 96, seven additive tables, immutable financial rows, exact retry/conflict detection, explicit correction lineage, scoped access bindings and strict read contracts.
- Migration/lifecycle checks cover backup-before-migration, rollback, newer-schema rejection, archive-on-copy and unchanged manifest categories. Populated capital facts/reports survive copy and same-profile restore without new observation times.
- Dependencies: P0 definitions. No schema predecessors or legacy financial records rewritten. Human review remains pending.

### P1-B — local paper ingestion

- Reused immutable origin, explicit ledger funding, fills and existing quote reads. Actual common-time quote evidence can establish new marks; rounded legacy rows are not promoted to exact historical prices.
- Deterministic/idempotent import, missing quote times, unexplained reconciliation, immutable original hashes and no additional provider reads are tested.
- Remaining evidence: affected historical marks cannot be reconstructed without their original timing/prices. Dependencies: P1-A and valid book origin. A copied local book cannot silently continue the original scope.

### P1-C — connected evidence ingestion

- Added separate Coinbase capital envelope and durable Alpaca financial acquisition using the existing reads. Account identity, membership, stable event IDs, duplicate representation links, status transitions and sanitized financial payloads are retained.
- Tests include actual Coinbase connection-handler integration, credential rotation, foreign account/portfolio rejection, duplicate transitions, ambiguous JNLC/date-only flows and re-verification of copied connected access.
- Remaining evidence: Coinbase coherent financial cut/effective-time history; Alpaca current cut and ambiguous journal/receipt details; Robinhood adequate funding history. Unsupported metrics remain unavailable. No request bounds, polling schedules or financial write capabilities added.
- Dependencies: P1-A, existing acquisition/identity checks. Fresh re-verification changes access metadata only.

### P1-D — corrected calculations

- Implemented `capital-flow-performance-v1`: economic P&L, exact event-valued units, complete daily NAV statistics, annualized TWR after 365 days and certified conventional dated IRR.
- Independent fixtures cover four demonstrated accounting failures, nine starting balances, debit/receipt/fee separation, duplicate costs, unknown basis, missing marks/boundaries, zero NAV/redemption and late corrections. Property sequences check conservation/idempotency/neutrality.
- Legacy numerical helpers remain unchanged. Reports retain exact input manifests and linked immutable predecessors. Dependencies: P1-A and supported source evidence; unavailable states are intentional output, not task failures.

### P1-E — local reads and current displays

- Registered `capital.scopes` and `capital.performance`; both read local evidence and perform no writes/provider calls. Ingestion/backfill stays outside read handlers.
- Updated local, terminal and broker current accounting displays. Account selection, observation times, independent availability, restoration help and evidence hashes remain visible; original campaign/ledger comparisons retain their exploratory interpretation.
- SSR states and native production IPC checks supplement the standard desktop smoke gate. The native audit found and corrected scoped help-button clipping and off-viewport help at 200% zoom. Final desktop, narrow/light and high-contrast 200% zoom checks and keyboard activation pass; screenshots were visually inspected. Test setup explicitly waits for saved appearance after full reloads.
- Dependencies: P1-B/C/D. No provider history is approximated and legacy percentages do not fill missing verified metrics.

### P1-F — compatibility and acceptance

- Full repository run: 287 files / 2,074 tests passed. An additional populated same-profile restore regression passes in the final 28-test ingestion/UI run. Typecheck, lint, root build, desktop build and the existing native smoke gate pass.
- First full run's timeout passed unchanged on isolated retry; the new channel registry expectation was fixed by exercising both channels in the actual secret sweep. Failed logs are retained alongside passing evidence.
- Preservation audit: 506 of 517 pre-existing dirty/untracked files remain byte-identical; 11 overlap intentionally. Generated current dependency manifests have exact pre-build archives. Original roadmap/evidence and frozen research remain unchanged.
- Native accounting UI checks pass, including production preload round-trip, non-mutating reads and disabled live authority. Verification logs, screenshots and preservation manifests are saved under the evidence directory.
- Remaining: human review. Actual connected completeness, owner qualification and release are separate open gates, not claims made by this delivery. No installed account's historic returns are asserted.
- No new phase started. No strategy, reserve execution, broker order, withdrawal, study registration, deployment or release work performed.

## Prompt, evidence and issue state

**Prompt used:** [exact initiating implementation prompt](evidence/capital-accounting-2026-10-23/prompt-used.md). No product scope reduction or follow-up decision is inferred. [COQ-35](https://linear.app/coqui-crypto/issue/COQ-35/implement-p0p1-capital-flow-accounting-and-versioned-performance) tracks local implementation; COQ-34 remains the completed research record. Linear comments include the exact prompt and credit **Completed by: kokin**.

Before starting P2 or any later phase, reread that phase's full architecture, requirements, hypotheses, settings/UX, dependencies, tests, acceptance criteria and safety gates from the unchanged saved roadmap. All P2–P7 requirements remain pending in full.

## Delivery: commit/push P0/P1 and prepare P2

- P0/P1 committed and pushed as [0c3d36c](https://github.com/kokin-blip/Coqui-Crypto/commit/0c3d36c10d2ea0b69a010c828ba903acca2f0c5c) on `codex/operations-crew-journal`. Focused staging retained unrelated work, including mixed-file execution/hourly-study edits. Required existing read-only broker prerequisites were included; no working file was changed by staging/commit.
- The exact isolated source closure passed 281 files / 1,968 tests, 117 focused tests, typecheck/lint, root/desktop builds and both disposable native smoke suites. [Isolated evidence](evidence/capital-accounting-2026-10-23/commit-isolation/summary.json) is separate from the earlier combined checkout's 287-file/2,074-test run. These establish mechanics, not strategy efficacy or a release.
- Reread P2 and all applicable architecture/accounting/UX/evaluation/dependency/test requirements from the full saved roadmap before preparing the [P2 implementation plan](small-portfolio-p2-implementation-plan-2026-10-23.md). Inspected 19 source files and 17 synthetic sizing rows; checked only current official rule, cash/hold, buying-power and fee semantics that blocked the design.
- P2 is planning only. Six batches cover contracts/fixtures, native evidence/storage, shared budget revisions, joint feasibility, actual consumer integration and read-only UX/compatibility. Native and discretionary floors remain distinct; no risk expansion to meet minimums. New shared reservation assurance is blocked while an active legacy connected writer or unproven account-wide ownership exists.
- No P2 application code, active campaign migration, strategy change, profit reserve funding, order/cancellation, withdrawal, deployment or study registration. P0/P1 and the original roadmap/evidence hashes are preserved. P3–P7 remain pending in full; P2 implementation/acceptance is not marked complete.
- [COQ-35](https://linear.app/coqui-crypto/issue/COQ-35/implement-p0p1-capital-flow-accounting-and-versioned-performance) remains In Review; [COQ-36](https://linear.app/coqui-crypto/issue/COQ-36/implement-p2-shared-budgets-and-small-portfolio-feasibility) tracks pending implementation. Owner, connected-evidence and release gates remain open.

**Prompt used**

Push and commit that then Lets move on to P2. Reread its full requirements in the saved roadmap, inspect the current code, and prepare a concrete implementation plan before writing code. Preserve P0/P1 and the complete P0–P7 scope.

## P2 implementation batches (local, in progress)

**Prompt used:** Ok move onto building P2.

- Reread the complete saved P2 design and applicable roadmap requirements. [Implementation baseline](evidence/p2-budget-feasibility-2026-10-23/baseline.json) records HEAD, protected source hashes and 495 pre-existing changed files. Original roadmap and companion evidence remain unchanged.
- P2-A: strict quantity-market native constraints, account scope/claim/reflection definitions and hand-calculated regression fixtures implemented. Missing values remain unknown rather than unbounded. No automatic risk-tier change.
- P2-B/C: empty additive v97 tables, immutable revisions, identity checks, atomic local CAS and read-side acquisition hooks implemented locally. Twenty core/property cases and seven storage cases pass, including $55 deduplicated free cash, underfunding, two competing $70 commitments against $100, crash rollback and append-only history. Provider/lifecycle and full verification remain pending.
- P2-D: joint fee-inclusive arithmetic, nine-balance grid, post-cost risk checks, native/discretionary separation and exit dust implemented locally. This proves mechanics, not a minimum starting balance, strategy efficacy or authority.
- P2-E in progress: explicit new-version local OMS/preview/routing integration and consumer tests. Default construction and active/frozen campaigns retain legacy behavior. Connected legacy writers/unproven ownership continue to block reservation assurance.
- P2-F pending: evidence UX, integrated lifecycle/security/native smoke and full verification. P2 is not accepted or complete; P1 human review, account-specific evidence and release gates remain open. P3–P7 remain pending in full.
- COQ-36 is In Progress. All changes in this batch are local and uncommitted.

### P2-A–D — local mechanics delivered; integration/acceptance still in progress

- A: native values retain known / authoritatively inapplicable / unknown states, exact decimal units, field provenance and source precision. Contracts distinguish account evidence from hypothetical inputs. Opening scope definitions and P1 performance are unchanged.
- B: v97 adds empty append-only rule/source/claim/report tables and an operational checkpoint. An additional immutable route-to-budget binding records the revision across service restarts; this implements the planned routing requirement without modifying legacy route identities. Existing lifecycle suites, populated P2 copy/restore, retry/conflict and source identity checks pass. Native sanitized payloads and exact feasibility inputs are retained independently of schema-2 Coinbase hashes.
- C: reflection deduplication, unknown commitments, deficits, linked terminal revisions and atomic CAS pass. Underfunding retains obligations and records a blocking reconciliation incident at ingestion; read IPC does not write incidents or facts. No funded profit/tax reserve is enabled.
- D: 31 arithmetic/property fixtures pass, including all nine balances, values either side of old tier/native boundaries, post-cost caps, fee currencies, fixed costs, no sale-funded earlier buys, hypothetical reserve concentration and exit dust. The algorithm uses the declared order within sell-before-buy stages. No universal minimum or operating-floor certificate is claimed.
- E: eight actual consumer fixtures pass across the existing local OMS immediate/pending, preview/review and venue-neutral routing boundaries, including a pricing-to-commit race, failed-fill rollback, terminal release and persisted route revisions. Explicit constructor injection and authority checks isolate this version; production construction does not activate it. The new virtual-book preview is independent of registered arms. Connected acquisition adapters consume GET evidence and retain legacy-writer/ownership blocks; no submit capability is accepted by evidence ingestion.
- F in progress: local channels and Allocation feasibility/scenario panel implemented. Current UI unit states pass. The first complete repository run found only stale schema-version expectations (96 versus 97); these are corrected and all 236 affected/focused cases now pass. Build initially hit disk exhaustion; disposable verification artifacts were removed and the root build passed on retry. No unrelated repository artifact was deleted. Native UI confirmation and the final complete run remain pending.
- Remaining: final checks, preservation manifest, final evidence/Linear synchronization and human review. This is local implementation, not a commit, merge, installed upgrade, release, connected verification or study qualification. P3–P7 remain pending in full.

**Prompt used:** Ok move onto building P2.

### P2-F — local capability acceptance; review remains open

- P2-A–F implementation and local verification are complete. [Delivery record](small-portfolio-p2-delivery-2026-10-23.md), [acceptance summary](evidence/p2-budget-feasibility-2026-10-23/summary.json), [preservation audit](evidence/p2-budget-feasibility-2026-10-23/preservation.json), final logs and production screenshots are saved.
- Final complete run: **292 test files / 2,140 tests passed**. The five new suites contain 65 cases (33 core, 7 storage, 7 source/access/lifecycle, 9 actual consumers and 9 renderer states). Repository typecheck/lint, root build, production desktop build, standard native safety smoke and 13 feasibility desktop checks pass. Dark desktop, narrow light and high-contrast 200% captures were visually inspected; keyboard help and input/expiry fixes are confirmed.
- Current local evidence now also refuses unexplained manual cash/funding rows, checks original opening/fill links, and uses current claim heads rather than old revisions. Unmatched provider holds cannot establish exact deficits. These safeguards pass alongside the original P1 ingestion and historical calculation regressions.
- Preservation: **486 of 495** pre-existing changed files remain byte-identical; nine overlap intentionally (composition/query/styles/contracts/exports/read-account type and generated current dependency manifests). Exact pre-build generated manifests are archived. Original full roadmap, companion research evidence, accepted P2 plan, P1 calculation and frozen legacy remediation planner hashes match. Unrelated modified/untracked work and the existing Git index remain intact.
- This delivery is **local and uncommitted**, based on 94b4f45. It is not pushed, merged, installed, deployed, released or qualified. COQ-36 moves to In Review; P1 review/dependency and account-specific native/fee/hold/ownership evidence, owner and release gates remain open.
- P2's app mode is read-only feasibility. No production injection enables the isolated claim consumers. No strategy change, funded profit/tax reserve, provider order/cancellation, withdrawal or study registration occurred. Generated current dependency hashes are not a migration of historical registrations/results.
- P0/P1 remain preserved. **P3–P7 remain pending in full**, with every original architecture, data, hypothesis, UX, dependency, test, acceptance and safety requirement retained. Before beginning P3 or another phase, reread its full requirements in the unchanged saved roadmap. No future phase is marked complete.

**Prompt used:** Ok move onto building P2.

### P2 commit isolation verified

- Exact P2-only source closure: 286 files / 2,033 tests, typecheck/lint, root/desktop builds and both disposable native smoke suites pass. [Evidence](evidence/p2-budget-feasibility-2026-10-23/commit-isolation/summary.json). Original combined-checkout evidence remains retained.
- Focused staging excludes mixed-file unrelated hourly/execution work and regenerates current dependency manifests using the committed generator. All 2,533 pre-existing working files were byte-identical before staging. P0/P1, frozen studies and original roadmap/evidence remain preserved.
- Commit/push pending at this record; human review, account-specific evidence, owner and release gates remain open. P3 planning follows; P3–P7 implementation remains pending in full.

**Prompt used**

Commit and push P2, then lets move on to P3. Reread its full requirements in the saved roadmap, inspect the code, and prepare a concrete implementation plan before coding. Preserve P0–P2 and the full P0–P7 scope.

## Delivery: push P2 and prepare P3

- P2 committed and pushed as [aff6b603dbf354762ddde6bc50cc00eb3eebe098](https://github.com/kokin-blip/Coqui-Crypto/commit/aff6b603dbf354762ddde6bc50cc00eb3eebe098) on `codex/operations-crew-journal`. The exact isolated P2 closure passes 286 files / 2,033 tests, typecheck/lint, root/desktop builds and both disposable native smoke suites (13 P2 UI checks). Mixed-file unrelated execution/hourly edits remain outside the commit. Current manifests were generated from that closure; historical registrations/results were not migrated. [Commit evidence](evidence/p2-budget-feasibility-2026-10-23/commit-isolation/summary.json).
- Reread the complete original roadmap, including the full P3 accounting, cycle/watermark, caps, lifecycle, architecture, UX, dependencies and acceptance requirements, before preparing the [P3 implementation plan](small-portfolio-p3-implementation-plan-2026-10-23.md). Saved a 43-file source inventory and independent arithmetic probes. No P3 application code written.
- The plan preserves all three triggers, strict realized/economic/cash/capital caps, exact partial assessments, immutable preview state, policy exclusions, pending-claim and loss/recovery behavior, full consequence UX and safety gates. Six reviewable batches include additive v98 (or the next unused migration), local-only interfaces and focused/full/native acceptance.
- Verified gaps: P1 scoped realized/unrealized P&L remains unavailable; existing local opening initialization requires nonempty tracked holdings and zero cash, so it cannot be invented into a cash-funded history; P2 has no global floor certificate. P3 uses a separate eligibility projection and a bounded fixed-plan retained-capital proof or explicit unavailable state. Unknown account evidence is not replaced by a hypothetical scenario.
- P3's durable modeled state/assessments are separate from account cash. Save/inspect writes only local preview configuration/evidence. Actual funded profit/tax claims remain disabled; no scheduler, financial order/cancel/withdrawal, strategy adoption, study registration, deployment or release is introduced. P4–P7 remain pending in full; P6 retains optional, separately reviewed paper funding/sale integration.
- [COQ-36](https://linear.app/coqui-crypto/issue/COQ-36/implement-p2-shared-budgets-and-small-portfolio-feasibility) remains In Review, now pushed. [COQ-37](https://linear.app/coqui-crypto/issue/COQ-37/implement-p3-profit-assessment-immutable-preview-state-and) is Backlog for P3 implementation. Planning completion does not close P1/P2 review, connected evidence, owner, qualification or release gates. No further product input is required to start P3-A.

**Prompt used**

Commit and push P2, then lets move on to P3. Reread its full requirements in the saved roadmap, inspect the code, and prepare a concrete implementation plan before coding. Preserve P0–P2 and the full P0–P7 scope.

## P3 implementation — P3-A started

- Reread the full saved P3 plan and applicable original roadmap reserve/accounting/capital/UX/acceptance requirements. Recorded current commit, dirty-file hashes, protected P0–P2/roadmap/P3-plan hashes and exact current dependency manifests in `evidence/p3-reserve-2026-10-23/`.
- Scope remains P3 preview capability only; modeled state is distinct from financial claims. All P3-A–F implementation and acceptance gates remain pending. P0–P2 are preserved; P4–P7 remain pending in full. No account financial action, strategy change, scheduler, registration, deployment or release.
- Dependencies: saved P3 design, canonical P1/P2 evidence and original review gates. Current account basis/fees/ownership and retained-plan proof remain evidence requirements. COQ-37 In Progress; local implementation only.

**Prompt used**

Ok move onto building P3 using the saved plan. Preserve P0–P2 and the full P0–P7 scope, and keep the phase tracker updated.

### P3-A — definitions, contracts and independent fixtures delivered locally

- Strict preview-only settings/results, all three trigger definitions, separate modeled state, immutable identities and hand-calculated fixtures are implemented. Public schemas reject financial-domain modes and renderer-provided account facts. Default remains keep invested; actual P2 funded-claim rejection is unchanged.
- First 38 core/transition/eligibility/fixed-plan tests and repository typecheck pass. Independent fixtures cover 33% partial cents, losses/recovery, deposit-only crossings, fee/basis gaps and full-request capital proof. A forged-preview regression now checks the content hash before modeled mutation.
- P3-B/C pure components are implemented but source-service assembly and integrated acceptance remain in progress. P3-D storage and P3-E/F integration/UI/full acceptance remain pending. All P0–P2 protected numerical files and original roadmap remain unchanged; P4–P7 remain pending in full. Local and uncommitted; no financial side effects or review/release claim.

**Prompt used:** Ok move onto building P3 using the saved plan. Preserve P0–P2 and the full P0–P7 scope, and keep the phase tracker updated.

### P3-B/C/D — scoped mechanics and immutable preview persistence delivered locally

- Added scope-bound FIFO investment evidence, common-cut/source revision checks and exact retained-capital witnesses for fixed requests. Unknown legacy opening basis, provider history/fee gaps and unsupported operating requirements remain unavailable; P1/P2 numerical versions are untouched. All three triggers, bounded cycles, policy exclusions, partial assessments, loss/recovery, modeled release and no-repeated-gain invariants are tested.
- Empty v98 migration, immutable preview policies/state/eligibility/assessments/reports, operational CAS heads and lifecycle archiving are implemented. A seventh table, `capital_reserve_commands_v1`, preserves immutable local command receipts across later writes; this is the required exact-retry mechanism, not another financial ledger or a product scope change.
- Actual modeled transaction tests inject failure at state/assessment/head boundaries; rollback, duplicate retry after lost acknowledgement, stale sources and populated backup/restore/copy pass. Canonical input serialization ensures a stored preview reproduces unchanged. Actual P2 funded profit/tax claims remain rejected.
- P3-E preview service/UI implemented locally with account/scenario separation, explicit save/inspect evidence writes, shared profile-operation gate, fixed-base/caps/provenance, cost-bearing hypothetical sales and labeled up/down comparisons. First UI states pass; production native confirmation remains pending.
- Focused run: 11 files / 122 tests pass, including original P1/P2 integration and migration/registry checks. Typecheck and lint pass. P3-F full/native/preservation checks and final issue state remain pending. Local/uncommitted; human review, account-specific evidence, owner and release gates stay open. P4–P7 retain full scope and remain pending.

**Prompt used:** Ok move onto building P3 using the saved plan. Preserve P0–P2 and the full P0–P7 scope, and keep the phase tracker updated.

### P3-E/F — local preview capability acceptance; review remains open

- P3-A–F implementation and local acceptance are complete. [Delivery record](small-portfolio-p3-delivery-2026-10-23.md), [summary](evidence/p3-reserve-2026-10-23/summary.json), source hashes, exact pre-build manifests, [preservation audit](evidence/p3-reserve-2026-10-23/preservation.json), command logs and production screenshots are saved.
- Final repository checks: **299 test files / 2,213 tests passed**. Seven new suites contain **73 cases** across exact assessment/property sequences, state/loss/policy behavior, scoped investment evidence, fixed-plan requirements, real storage/lifecycle/rollback and service/IPC/UI. Typecheck, lint, root build and production desktop build pass. Standard native safety smoke and **24 P3 native checks** pass.
- Native checks use production preload and disposable synthetic profiles: current cash remains visible alongside incomplete P&L, 25% of $50 yields a modeled $12.50 reserve/$537.50 retained capital, input edits invalidate old results, keyboard help fits/returns focus, read routes preserve durable capital/financial rows, save/inspect change only local preview evidence, retries preserve original identities and live authority stays disabled. Dark desktop, narrow light and high-contrast 200% images were inspected in one initial batch and one final confirmation.
- Cash capacity expires on screen independently of recorded balances; dates remain visible. An added regression confirms this. Initial failures were corrected and retained in logs: canonical input serialization/content validation, wrapper/report retry identity, stale expected schema/channel lists and an intermediate script lint issue. An older full run was interrupted after the final freshness change; final acceptance above applies to the current source.
- Preservation: **487/495** pre-existing changed files remain byte-identical. Six mixed source/test files contain only exact P3 insertions whose removal restores original hashes; two current generated dependency manifests have exact archived pre-build bytes. Original roadmap/evidence, accepted P3 plan and protected P1/P2/frozen remediation numerical hashes match. Git index and unrelated work remain intact. No historical report, negative result or consumed holdout was rewritten.
- [COQ-37](https://linear.app/coqui-crypto/issue/COQ-37/implement-p3-profit-assessment-immutable-preview-state-and) is verified In Review; its description/completion comment and milestone progress comment are synchronized, preserving dependencies. This is **local and uncommitted**, not a merge, installed upgrade, deployment, release or qualification. Current account-specific basis/fees/coverage/common-cut/native rules/ownership and retained-plan proof remain legitimate unavailable states; P1/P2 review, owner and release gates remain open.
- Mode after completion remains **Preview only**. No actual profit/tax reserve claim, sale/order/cancel, external receipt/withdrawal, polling/scheduler activation, strategy adoption or study registration. P6's optional reviewed paper funding/sale capability remains separate. P4–P7 are pending in full. Reread the next phase's complete saved requirements before beginning it; no next phase is started or silently simplified.

**Prompt used**

Ok move onto building P3 using the saved plan. Preserve P0–P2 and the full P0–P7 scope, and keep the phase tracker updated.

## Delivery: push P3 and prepare P4

- P3 committed and pushed as [9c6b2fccebc9e809ba2800fc538e831bab0c5c66](https://github.com/kokin-blip/Coqui-Crypto/commit/9c6b2fccebc9e809ba2800fc538e831bab0c5c66). Exact isolated closure: **293 files / 2,106 tests**, typecheck/lint, root/desktop builds, standard native safety smoke and **24 P3 native checks** pass. Original combined-checkout 299-file/2,213-test evidence remains archived. Six mixed files exclude unrelated hourly/execution work; exact worktree hashes were preserved while adopting the commit. Current dependency manifests reflect the isolated committed generator; frozen reports/negative findings/consumed holdouts are unchanged.
- Reread P4's full original roadmap requirements, including accounting/metrics, native constraints, reserve lifecycle, data/timing/cost/capital evaluation, path dependence, UX, compatibility, dependencies and acceptance. Saved [P4 implementation plan](small-portfolio-p4-implementation-plan-2026-10-23.md) and [55-file source inventory/probes](evidence/p4-capital-replay-planning-2026-10-23/). **No P4 application code written.**
- Verified fixed $10,000 corrected-engine and $100,000 matched-book/evaluator origins, legacy unconstrained $2.50 fill versus P2 rejection, fee-currency/basis representation, P3/P2 double-subtraction boundary and full-archive verification reads. The addendum defines separately versioned offline replay, nine independent books, exact cash/asset fees, matched controls and total/sleeve returns, pure P3 reserve replay, immutable research-only evidence, physical development boundaries and bounded read-only results.
- P4-A–F implementation/acceptance remains pending. The runner uses a separate empty offline research profile through existing profile management; the app reads its completed results without a new run/import channel. No financial action, scheduler, strategy adoption, registration, holdout access, installation, deployment or release. No additional product decision is required to start P4-A.
- [COQ-37](https://linear.app/coqui-crypto/issue/COQ-37/implement-p3-profit-assessment-immutable-preview-state-and) remains In Review, now pushed. [COQ-38](https://linear.app/coqui-crypto/issue/COQ-38/implement-p4-capital-aware-replay-and-reserve-policy-simulation) is Backlog. P0–P3 and the complete original P0–P7 architecture, requirements, hypotheses and gates are preserved. P5–P7 remain pending in full; no owner/account/review/prospective/release gate is closed.

**Prompt used**

Commit and push P3, then lets move on to P4. Reread its full requirements in the saved roadmap, inspect the code, and prepare a concrete implementation plan before coding. Preserve P0–P3 and the full P0–P7 scope.
