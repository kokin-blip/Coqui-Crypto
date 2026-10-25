# Small portfolio P0–P7 phase tracker

The [full saved roadmap](small-portfolio-profit-policy-plan-2026-10-23.md) remains the durable source of truth. [P0/P1 addendum](small-portfolio-capital-accounting-plan-2026-10-23.md). Reread a phase's complete roadmap requirements before beginning it. Propose scope changes explicitly. Never silently drop, simplify or complete a future phase.

| Phase | State | Completed | Remaining / blockers | Dependencies |
|---|---|---|---|---|
| P0 Definitions, scope, source inventory | Committed and pushed | Definitions, baseline, source inventory, exact-or-unavailable rules and independent fixtures | Review remains separate from implementation | Saved roadmap, source baseline |
| P1 Capital-flow accounting and corrected performance | Committed and pushed; in review | Storage, ingestion, calculations, read projections, displays, lifecycle and acceptance checks; isolated delivery 0c3d36c | Human review; actual connected evidence completeness, owner qualification and release remain separate open gates | P0 |
| P2 Shared budgets and small-portfolio feasibility | Committed and pushed; In Review | A–F capability; isolated commit aff6b60 passes 286 files/2,033 tests, typecheck/lint/builds/native checks; original combined-checkout 292-file/2,140-test evidence retained | Human review; account-specific rules/fees/holds/ownership and owner/release gates remain open | P1 review; P6 operational review before connected adoption |
| P3 Profit-reserve evaluation and previews | Committed and pushed; In Review | P3-A–F in 9c6b2fc; exact isolated closure 293 files/2,106 tests, typecheck/lint/builds and both native suites (24 P3 checks); combined 299-file/2,213-test evidence retained | Human review; actual basis/fees/common-cut/retained-plan proof, account ownership, owner/qualification/release gates remain open | P1/P2; COQ-29/31 patterns; P6 operational authorization remains separate |
| P4 Capital-aware simulation | Committed and pushed; In Review | P4-A–F in a015711; isolated 303 files/2,171 tests, typecheck/lint/root and desktop builds, ten CLI checks, standard native safety and 19 P4 native checks; original combined 309-file/2,278-test evidence retained | Human review; actual data/cost/account evidence and P5/P7 owner/qualification/release gates remain separate | P1–P3 review; full saved P4 plan; no operational authority |
| P5 Strategy and policy experiments | A–G committed and pushed; H evaluation pending; In Progress | A–G in 775950a; [delivery](small-portfolio-p5-delivery-2026-10-24.md) and isolated 317-file/2,215-test closure, typecheck/lint/builds/CLI/native checks; original combined evidence retained | Human review; P5-H permitted data, fixed objectives/registry/power/resources and complete development results; all retained hypotheses and later gates remain open | P4 review; full saved P5 plan; adequate permitted evidence before actual evaluation; no operational authority |
| P6 Optional reviewed paper integration | A–E implemented locally; F technical checks pass, human review pending; G/H pending | [Delivery](small-portfolio-p6-delivery-2026-10-24.md): funded internal cash claims, all-consumer budgets, immutable review/release, authority/lifecycle, observation-only cadence and UI; isolated 327 suites/2,258 tests plus all 43 focused cases; builds/typecheck/lint/native pass | Uncommitted, default off; human source/merge/release review and actual owner/strategy qualification; G sale and H connected slices retained in full; COQ-40 remains In Progress | P3/P4 review and applicable paper qualification; P5-H remains pending and is required before adopting a P5 hypothesis |
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

## P4 implementation started

- Reread full saved P4 requirements and applicable original roadmap. Captured dirty-file/protected hashes and exact current manifests. P4-A–F acceptance remains pending; no phase completion claimed. P0–P3 preserved; P5–P7 pending in full.
- COQ-38 In Progress. Offline development mechanics only; no financial action, registration, install, deployment or release.

**Prompt used**

Ok move onto building P4 using the saved plan. Preserve P0–P3 and the full P0–P7 scope, and keep the phase tracker updated.

### P4-A — definitions, identities and first integrated fixtures

- Strict spec/tape/result contracts, nine-capital/matched-control inventory, causal decision checks, exact cash/basis/fee conventions and separate replay version implemented locally. Legacy engines and P0–P3 numerical versions are unchanged.
- First **3 files / 14 tests** and repository typecheck pass: independent books, native/discretionary rejection, received-asset fees, flow neutrality, pending receipts, missing timing/daily samples, fee lags, linked redemption/funding, immutable storage roundtrip/retry and injected result-root rollback. An initial gap fixture still contained daily marks at both neighboring boundaries; it now removes the actual missing daily sample.
- B/C/D pure implementation and E persistence are in progress; full stress/lifecycle/UI/CLI/native acceptance remains pending. No P4 completion/market evidence or later-phase gate claimed. Local/uncommitted.

**Prompt used**

Ok move onto building P4 using the saved plan. Preserve P0–P3 and the full P0–P7 scope, and keep the phase tracker updated.

### P4-B/C/D — exact execution, flows, metrics and reserve replay

- Local pure implementation calls P2 for native execution and budget refreshes, P1 for total/sleeve return evidence, and P3's unchanged policy/cycle/assessment reducers. All nine independent books and cash/hold/passive controls are retained. Unknown fills hold cash, unfilled sales fund nothing, received-side fees preserve exact delivered units/basis, and modeled reserves remain cash subsets.
- **10 new suites / 54 tests passed** at this cut, including hand arithmetic and generated conservation, flows/receipts/fees, gap/zero-capital segments, all P3 triggers, H/loss/release/partial cycles, immutable storage/corrections/copy and strict IPC/UI states. Further friction/stress checks and final repository acceptance remain in progress.
- Real CLI passes **9 checks**: existing inactive profile, explicit source identity, all 36 cells, exact retry/report without tape reload, complete JSON/spec/CSV export, no financial/paper/registration rows and active-profile refusal. Runtime/semantic validation stays at core/service boundaries; contract schemas remain independent of core.
- E integration is implemented; native theme/zoom/keyboard checks found metric-label clipping and are being corrected before acceptance. F full suite/build/preservation checks remain open. No market performance or trading authority claimed. Local/uncommitted; P0–P3 and full P5–P7 requirements remain intact.
- Clarification: exposed development execution requires an explicit read-only original governance metadata DB in addition to the empty execution profile. The empty profile cannot establish known development/holdout boundaries. Missing metadata refuses before the tape loader; sealed final result bodies are never read.

**Prompt used**

Ok move onto building P4 using the saved plan. Preserve P0–P3 and the full P0–P7 scope, and keep the phase tracker updated.

### P4-E — durable offline runner and local result inspection

- Dedicated typed P4 integrity kinds retain immutable specs, attempts, input/result chunks, hashes, failure/interruption evidence and correction lineage. Empty-profile execution, physical development preflight, read-only governance metadata, lifecycle checks and exact retry are integrated. Schema stays 98; no observed capital/claim/order tables are used.
- Actual CLI passes **10 checks**, including documented argument separator, full 36-cell inventory, exact retry/report after removing the tape, exact spec/JSON/CSV export, no financial/paper/registration rows and active-profile refusal. Input/output bounds count UTF-8 bytes; unsupported inputs/fees/timing remain explicit.
- Two read-only Main routes and Research results support all cells, independent unavailable metrics, paged path/fill/journal evidence, assumptions, archived origins and failed/interrupted states. Reads through production preload preserve every database row. No Run/import/financial IPC command exists.
- **18 native P4 checks** and standard native safety smoke pass on disposable synthetic profiles. Keyboard selection/help, focus return, narrow light/dark/high-contrast 200% layouts and no financial controls are checked. One initial batched visual inspection plus one confirmation completed; clipping was fixed within P4 styles. Source mechanics are synthetic development evidence only.
- F final full-suite/typecheck/lint/build and preservation closure is in progress. Exact pre-build manifests and baseline stay saved; all 17 protected hashes match. Local/uncommitted; human review and all account/owner/qualification/release gates remain open. P5–P7 remain pending in full.

**Prompt used**

Ok move onto building P4 using the saved plan. Preserve P0–P3 and the full P0–P7 scope, and keep the phase tracker updated.


### P4-F — local mechanics acceptance; human review remains open

- All P4-A–F implementation and local capability checks are complete. [Delivery](small-portfolio-p4-delivery-2026-10-23.md), [summary](evidence/p4-replay-2026-10-23/summary.json), source hashes, exact pre-build manifests, command logs, preservation audit and synthetic production screenshots are saved. This is the combined dirty checkout, **not an isolated commit, merge or release**.
- Final full closure: **309 files / 2,278 tests passed**. Ten new P4 suites contain **65 cases**, including generated friction/conservation, every capital/control, flows/unknown receipts/return segments, exact P3 caps/H/cycles, native exit minima ± one increment, correlated decline/rebound/outage/delisting/fees/underfunding, immutable retries/corrections/copy/restore and no financial/registration effects. Final typechecks, lint and root/production desktop builds pass; the existing large-chunk warning remains advisory. A subsequent final period/funding-label-only change passes the focused eight UI cases, final typechecks/build and native checks.
- Real CLI passes **10 checks** with Node 24; final production preload/native replay passes **19 checks**, including explicit period/funding scope labels and unchanged database rows on reads. Standard native safety smoke passes. One initial visual batch and one confirmation covered dark desktop, narrow light and high-contrast 200%; final functional checks used checks-only mode without another screenshot/visual refinement pass. The detector ran once and reported no findings.
- Source preservation: **487/495** existing dirty entries remain byte-identical, six mixed files have exact inverse-verifiable P4-only additions, and two generated manifests have exact archived pre-build bytes. All **17** protected roadmap/evidence/accepted-plan/P0–P3/frozen numerical hashes match. Git index remains untouched. No old report, negative finding, registration or consumed holdout is rewritten; changed current dependency hashes do not make old data fresh.
- Earlier failed/intermediate runs remain in evidence. Corrected issues include unavailable-mark diagnostics, contract/core build coupling, clipping, explicit doubled quote spread, incomplete receipt claims, stale terminal balances after failed funding and UTF-8 resource sizing. Earlier full runs overlapping edits loaded prior module code with newly added tests; the final closure is separate and passes. No unrelated baseline failure is attributed to P4.
- COQ-38 is In Review for **local, uncommitted capability**. Existing P1/P2/P3 review, account ownership/evidence, owner/prospective/qualification and release gates remain open. No provider acquisition, financial reserve claim, live/paper order/cancel, payout/withdrawal, scheduler/policy activation, strategy selection, registration, installation, deployment or release. Exact source/commit isolation must be verified if a later commit is requested.
- P0–P3 and the complete P0–P7 saved architecture, accounting, hypotheses, dependencies and acceptance requirements are preserved. **P5–P7 remain not started in full.** Reread the next phase's complete saved requirements before beginning; no future phase is reduced, silently completed or started by this delivery.

**Prompt used**

Ok move onto building P4 using the saved plan. Preserve P0–P3 and the full P0–P7 scope, and keep the phase tracker updated.


## Delivery: push P4 and prepare P5

- P4 committed and pushed as [a015711c29a10d768f0d0b40d467a75c1bd0adac](https://github.com/kokin-blip/Coqui-Crypto/commit/a015711c29a10d768f0d0b40d467a75c1bd0adac) on `codex/operations-crew-journal`. Exact isolated closure: **303 files / 2,171 tests**, typecheck/lint/root and desktop builds, **10 CLI checks**, **19 P4 native checks** and standard native safety smoke pass. [Isolated evidence](evidence/p4-replay-2026-10-23/commit-isolation/summary.json) is separate from the unchanged combined-checkout 309-file/2,278-test evidence. Six mixed files exclude unrelated hourly/execution edits. Root adoption preserved all working-file bytes; existing unrelated changes remain uncommitted. P4 stays In Review, not merged/released/qualified.
- Reread the complete saved roadmap, P4 boundary and P5 strategy/data/cost/accounting/evaluation/UX/dependency/acceptance requirements. Saved the [P5 implementation plan](small-portfolio-p5-implementation-plan-2026-10-23.md) and [planning evidence](evidence/p5-strategy-planning-2026-10-23/). New source adapters must guard dated alignment, missing metrics, causal decision-time book state, two-asset buffer degeneracy and full trial history; existing legacy helpers remain unchanged. Six synthetic complete-result hashes freeze v1 compatibility before a proposed kernel extraction.
- P5-A–G are reviewable capability batches: strict manifest and v1 compatibility; causal signals/controls; separate execution/mechanism comparisons; reserve experiments; joint-path inference/inventory/choice-or-none; immutable offline CLI/read-only UX; integrated acceptance. P5-H is the actual permitted development evaluation, separately pending adequate inputs, concrete objectives and complete evidence. Neither tooling nor synthetic fixtures complete H. Finite capital/cost/funding/trial inventories, negative outcomes and resource/precision failures stay visible.
- No P5 application code or market evaluation, account acquisition, study registration, holdout access, shadow collector, financial action, policy/default activation, installation, deployment or release. This planning addendum/tracker/evidence is saved locally and uncommitted. No decision blocks synthetic P5-A–G; permitted sources/universe, assurance/risk controls, primary capital region, objective and compute/power choices must be explicit before H. They are not assumed user trading preferences.
- [COQ-38](https://linear.app/coqui-crypto/issue/COQ-38/implement-p4-capital-aware-replay-and-reserve-policy-simulation) remains In Review, pushed. [COQ-39](https://linear.app/coqui-crypto/issue/COQ-39/implement-p5-small-portfolio-strategy-contest-and-separate-policy) tracks pending P5 implementation in Backlog, dependent on P4. Issue descriptions/completion comments and the milestone progress comment are synchronized; [sync record](evidence/p5-strategy-planning-2026-10-23/delivery.json). Existing milestone exits, relationships, assignees, owner/account/review/qualification/release gates are preserved. P0–P4 and every original P0–P7 requirement remain intact; P6/P7 are pending in full.

**Prompt used**

Commit and push P4, then lets move on to P5. Reread its full requirements in the saved roadmap, inspect the code, and prepare a concrete implementation plan before coding. Preserve P0–P4 and the full P0–P7 scope.


## P5 implementation started — October 24, 2026

- Reread the complete saved P5 plan and applicable full roadmap requirements; captured [baseline](evidence/p5-contest-2026-10-24/baseline.json), 507 existing dirty entries, 29 protected hashes, index hash and exact pre-build manifests. P0–P4/full P0–P7 are retained.
- P5-A causal kernel extraction and strict experiment contracts are in progress. P5-A–G acceptance remains pending; P5-H actual permitted evaluation requires concrete adequate data/objectives/resources and is not claimed. COQ-39 In Progress; local/uncommitted.
- No financial action, registration, holdout access, activation or release.

**Prompt used**

Ok move onto building P5 using the saved plan. Preserve P0–P4 and the full P0–P7 scope, and keep the phase tracker updated.

### P5-A/B/C — first compatibility and causal mechanics batch

- Extracted an internal decision-time kernel while retaining a frozen P4 wrapper. All six saved complete-result hashes reproduce exactly; P0–P3 financial modules and P4 helper semantics are unchanged. Added strict finite manifests/contracts, nine-capital inventory/chronological/resource checks and source-bound input types.
- Added trend/cash, buffered rotation, concrete allocator, hold/passive/cash and prior-training exposure adapters; decision-time actual holdings, down-only caps/cash residual, daily defensive/risk checks and matched reference targets. A/C-style intent adjustment is separate from modeled partial fills. Initial **6 suites / 21 tests** pass, including six full P4 goldens, independent signal/execution/inference cases and real transaction rollback/resume/read isolation. This is an intermediate cut, not P5 acceptance.
- P5-D/E/F work is in progress: separately versioned simulation-only economic cash-cap comparison, full joint-path inference, immutable offline journal/CLI and read-only Research results. Operational P3 rejects the counterfactual preview identity. Broad stress/lifecycle/cost/calibration/native/full verification remains pending.
- Capability A–G is not accepted or complete; P5-H real development evaluation remains evidence-gated. No financial action, default/strategy activation, registration, final/holdout read, deployment or release. Local/uncommitted; COQ-39 In Progress; all P0–P7 requirements and dependencies remain retained.

**Prompt used**

Ok move onto building P5 using the saved plan. Preserve P0–P4 and the full P0–P7 scope, and keep the phase tracker updated.

### P5-D/E/F — offline implementation delivered locally; acceptance running

- Added separately versioned economic-cash counterfactual with unchanged actual realized/basis evidence and all other P3 caps; an independent $500 fixture shows strict backing reserves $0 versus $5 simulated economic-cash reserve, H=$20 and realized gain=$0. Operational P3 rejects the counterfactual preview. Full-exit native/cost/basis consequences are diagnostic only and fund no claim or order. Explicit future operating requests per balance preserve P3 sufficient-capital proof; cash-only is never substituted for a held book.
- Added joint stationary decimal path reconstruction, full in-path policy/actual-book/fees/funding/reserve evaluation, bounded metric vectors/full-result hashes and exact read-only path reconstruction. Six v1 hashes remain unchanged. Basic paired Bonferroni intervals require the full declared replication inventory and tail resolution; DSR/PBO, per-capital/fold/rolling/cost gates and candidate-or-none remain strict. Original non-synthetic registry metadata must substantiate global trial assurance.
- The complete S/E/R recipe validates at **1,053 cells**, split into single-scenario financial batches within unchanged P4 limits. Added declared workload/payload limits, append-only inventory/attempt/chunk/result/choice/failure records, resume, typed local reads, actual CLI and Research inspection. Explicit observed publication evidence is required when that assurance is claimed. No provider or registration/financial command is accepted.
- Latest focused closure: **24 suites / 126 tests pass**, including 65 original P4 tests, 40 P5 cases and contract checks; actual CLI **9 checks pass**. Further integrated acceptance, final full tests/typecheck/lint/builds, native UI/safety and final preservation/issue synchronization are running. These intermediate counts do not substitute for the final source closure.
- P5-A–G capability acceptance is still pending. P5-H actual permitted development evaluation has not run and remains pending adequate source/data/universe/cost/rules/registry/objectives/power/resources. Human review, owner/account/qualification/release and all P6/P7 gates remain open. P0–P4/full P0–P7 are preserved; local and uncommitted.

**Prompt used**

Ok move onto building P5 using the saved plan. Preserve P0–P4 and the full P0–P7 scope, and keep the phase tracker updated.

### P5-G — local capability acceptance; P5-H development evaluation pending

- **P5-A–G capability complete locally.** [Delivery record](small-portfolio-p5-delivery-2026-10-24.md), [acceptance summary](evidence/p5-contest-2026-10-24/summary.json), [preservation audit](evidence/p5-contest-2026-10-24/preservation.json), raw logs, CLI evidence and production screenshots retained. The full saved P5 design remains unchanged; no future requirement was removed.
- Strict finite inventory validates **1,053 S/E/R cells** before separately declared V/sensitivity/cap-review additions. Nine balances share history. Prior-only controls, down-only target caps, actual causal book cuts, matched execution/reserve targets and daily required exits are implemented. Missing evidence/underpowered inference yields unavailable or none. Full joint paths rerun signals/calibration/books/costs/funding/reserves; stored hashes support exact reconstruction.
- Final repository run: **323 files / 2,321 tests pass** before the final display-only correction. Final P5 closure after correction: **14 suites / 44 tests pass**, including independent arithmetic, property sequences, positive selection oracle, missing-evidence gates and six unchanged full P4 hashes. Final typecheck/lint and production desktop build pass; root build, actual CLI (9), existing native safety and final production P5 native checks (22) pass. All twelve final dark/narrow-light/high-contrast200% captures were inspected. Reviewer scored annual-rate labeling and intact numbers resolved; the ship verdict covers those two fixes only. Existing PRODUCT/DESIGN and pre-existing documentation drift are preserved.
- Preservation audit passes: **498/507** pre-existing dirty entries byte-identical; nine intentional overlaps have exact inverse/archive proof. **28** protected files are byte-identical; the permitted P4 extraction has original-source archive and six full-result compatibility hashes. P0–P3 accounting/budget/reserve semantics, old reports, negative research, consumed holdouts, original roadmap/companion evidence and accepted plans remain intact. HEAD and index are unchanged. Generated current dependency manifests do not rewrite historical studies.
- **P5-H has not run and remains pending**, not complete: freeze adequate permitted provider/source/universe/rights and point-in-time history; cost/native-rule assurance/scenarios; development/warmup boundaries; allocator/risk policy; primary capital region/weights; funding/expenses; sacrifice/downside objective; original global trial metadata; statistical power and resource budget. Then retain all declared outcomes and candidate-or-none evidence. Synthetic jobs cannot satisfy this gate. Breakout/range/blend/ML/allocation/features remain retained, unevaluated hypotheses under their original failure criteria.
- Delivery is **local/uncommitted/unpushed**, based on P4 a015711. Human review and exact source-isolated checks before a requested commit remain open. COQ-39 stays **In Progress** because H acceptance is unmet. This delivers no study registration, prospective collector, financial command, default activation, account access, installed upgrade, deployment, qualification or release.
- Linear synchronized: COQ-39 remains In Progress, delivery comment `00826f1e-b4e9-43e2-bb14-d612e60ea4bb` and milestone progress `d9d6c20b-8024-42bf-976d-23974c163221`; exact prompt and open gates retained. [Receipts](evidence/p5-contest-2026-10-24/linear-sync.json).
- **P0–P4 and full P0–P7 preserved. P6/P7 remain not started in full.** Before another phase, reread its full requirements. P6 default-off operational/ownership/OMS/fencing/kill/pause/manual Resume/unknown-outcome review and P7 owner/fresh-registration/coverage/actions/statistics/final-claim-once gates remain mandatory. External payouts/live authority are absent.

**Prompt used**

Ok move onto building P5 using the saved plan. Preserve P0–P4 and the full P0–P7 scope, and keep the phase tracker updated.

### P5-A–G isolated commit closure verified

- P5-only source passes **317 files / 2,215 tests**, typecheck/lint, root/desktop builds, nine actual CLI checks, 22 P5 production-native checks and standard native safety ALL PASS. [Exact closure evidence](evidence/p5-contest-2026-10-24/commit-isolation/summary.json). Original combined-checkout evidence is retained. Six mixed files exclude unrelated edits; current manifests are regenerated using the isolated source closure.
- Commit/push follows this record. P5-H remains pending in full; capability/review/actual research are separate. No P6 application code, activation, financial action, registration or release. P0–P4/full P0–P7 preserved.

**Prompt used**

Commit and push P5-A–G, then lets move on to planning P6. Reread its full requirements in the saved roadmap and inspect the code before coding. Keep P5-H pending and preserve P0–P4 and the full P0–P7 scope.

## Delivery: push P5-A–G and prepare P6

- P5-A–G committed and pushed as [775950a0f3c539755a626a1fe058b55ef8f5787f](https://github.com/kokin-blip/Coqui-Crypto/commit/775950a0f3c539755a626a1fe058b55ef8f5787f) on `codex/operations-crew-journal`. Exact isolated closure: **317 files / 2,215 tests**, typecheck/lint, root/desktop builds, nine CLI, 22 P5 native checks and standard native safety pass. All 52 committed source fingerprints match the verified closure. Six mixed-file unrelated edits and all existing working-source bytes remain intact; only this tracker changed during commit preparation. Original combined evidence remains retained. No merge, release or qualification is claimed.
- **P5-H remains pending in full**: actual permitted development data/rights/universe/cost/native/registry/objectives/power/resources and complete outcome evidence. COQ-39 remains In Progress. A–G delivery does not mark P5 complete or authorize a candidate.
- Reread the complete relevant roadmap requirements before the [P6 plan](small-portfolio-p6-implementation-plan-2026-10-24.md). Inspected existing accounting/reserve/budget/OMS/authority/scheduler/profile and connected boundaries; [55-file inventory](evidence/p6-paper-planning-2026-10-24/source-inventory.json) distinguishes five uncommitted sources from committed code. Source inventory counts are verified in evidence; they are not installed-account findings.
- Six synthetic assertions expose legacy cash-book initializer refusal, disabled funded claims and the unsafe double subtraction from directly reusing modeled P3 state with an already-reserved P2 budget. P6 needs an additive explicit cash-book origin, operational domain/atomic claim+assessment transaction and all-consumer port propagation. Existing preview/legacy numerical behavior stays frozen.
- P6-A–F plan covers types/storage, cash origin/evidence, exact funded-budget arithmetic, authority/consumer integration, reviewed local commands/UX/cadence and integrated acceptance. P6-G optional sale and P6-H connected verification remain retained, separately gated by accepted cash behavior, policy trade-off/eligibility and COQ-12/14/ownership/account evidence. No P6 application code written, book created, policy enabled, order/withdrawal submitted, registration or collector started.
- P6 planning artifacts remain local/uncommitted; implementation remains not started. P0–P4 and full P0–P7 are preserved. P7 owner/freshness/coverage/statistical/final-claim-once gates and all review/release requirements remain unchanged.

**Prompt used**

Commit and push P5-A–G, then lets move on to planning P6. Reread its full requirements in the saved roadmap and inspect the code before coding. Keep P5-H pending and preserve P0–P4 and the full P0–P7 scope.

- Linear synchronized: COQ-39 In Progress (H pending), COQ-40 Backlog (P6 planning only), corresponding progress/completion and both affected milestone comments. [Receipts](evidence/p6-paper-planning-2026-10-24/linear-sync.json). No dependency/exit gate was closed.

### P6 implementation start — October 24, 2026

- Reread the full saved P6 addendum and preserved the P0–P7 roadmap. Baseline records HEAD 775950a, 508 pre-existing dirty entries and 82 protected hashes in `evidence/p6-paper-2026-10-24/baseline.json`.
- P6-A/B/C are being implemented: separate operational domain, explicit cash origin, immutable migration and funded-budget arithmetic. Checks remain in progress; no batch or capability acceptance claimed.
- Remaining: all saved A–F requirements and integrated acceptance; separately gated G sale/H connected remain pending. P5-H remains pending in full. No actual policy authorization, qualification, broker action, registration, deployment or release.
- Prompt used: Ok move onto building P6 using the saved plan. Preserve P0–P4 and P5-A–G, keep P5-H pending and the full P0–P7 scope intact, and keep the phase tracker updated.


### P6-A–C foundation batch — local, acceptance in progress

- Implemented the separate `paper-reserve-cash-v1` domain/contracts, additive migration 99 and immutable facts/CAS, explicit simulated USD opening in the existing ledger, P1/P2 capture and funded claim semantics. No existing book is enrolled.
- Reviewed reserve/release commands append linked claims/state/assessment/receipts in one transaction; H/lifetime assessed allocation survive release. Real purpose-bound qualification/host/lease checks refuse absent evidence. P2 public funded-purpose refusal remains.
- Focused verification: eight files / 63 tests passed (arithmetic, storage, service, authority, actual OMS spending, channel registries and canary sweep). Includes fault injection at claim/assessment/head/receipt writes. Further tests/checks remain before batch/capability acceptance.
- Main/runtime/UX, lifecycle, cadence, exact active-sleeve attribution, full checks/native and isolated closure remain in progress. G sale/H connected, P5-H and all owner/review/qualification/release gates remain pending.
- Technical addition within the existing observation scope: explicit `paper.reserve.observe` refreshes local acquired evidence under a write command, so manual cadence does not require a policy change and read channels stay free of writes/provider calls. No cash commitment is implied.

### P6-D/E integration batch — local, acceptance in progress

- Added the P6-bound shared port to new-book manual/OMS immediate, pending and settlement paths; missing coverage refuses. Legacy run dispatch cannot initialize a new cash book. Connected routing for P6 remains explicitly unavailable under H.
- Added new active-NAV strategy/decision and consequence identities, Main commands/local read projections, observation-only UTC cadence, ephemeral authority and suspend/dispose disarming. Risk stages other than normal currently refuse with an explicit exposure-reconciliation reason; no existing risk gate is weakened.
- Added incumbent Allocation controls for explicit $500 simulated setup, disarmed settings, independent authorization/review/release/Resume and exact-or-unavailable separate active-sleeve return attribution. No actual book was created outside disposable fixtures.
- Nine focused suites / 34 tests passed before the latest extended checks; current full run/acceptance is ongoing. Root/desktop builds pass. Migration expectations are being updated from 98 to 99.
- Build-generated **current** dependency manifests necessarily reflect new code and the dirty combined checkout. Their prior bytes are retained in the implementation baseline. This updates current identity and invalidates old eligibility; it does not rewrite frozen reports, consumed holdouts or their source identities. The isolated P6 closure must regenerate its own current manifests.
- Remaining: full regression/lint/typecheck, source-isolated closure, expanded transactions/authority/lifecycle cases, production native/keyboard/theme evidence, UX review and final acceptance. G/H, P5-H, human/owner/qualification/release gates remain pending.

### P6-A–F delivery — local technical capability, human review pending

- A–E implementation is complete under the [unchanged full P6 plan](small-portfolio-p6-implementation-plan-2026-10-24.md). [Delivery](small-portfolio-p6-delivery-2026-10-24.md) records architecture, exact backing/fee/mark semantics, authority, consumers, lifecycle, compatibility and retained slices. F technical checks pass; no human approval, merge, release or actual operational enablement is claimed.
- Exact new-book claims protect real simulated OMS spending, including a 30-second reviewed consequence, actual pending next-open submission/settlement and a stable scheduled decision replay. Concurrent order/reserve and two-reserve reviews consume one revision once. Faults at claim, assessment, head and receipt writes roll back. Release retains H/lifetime backing; tax principal/profit remain distinct. Refused commands retain their original response even if qualification later changes.
- Core cases include all nine balances, no double deduction, cent slices, generated profit/loss/recovery/release sequences and an independent hand-calculated sequence. Missing contemporaneous allocation marks make only dependent active-sleeve returns unavailable; managed account performance remains intact. Unknown funding, source corrections or conflicting lineage cannot silently continue.
- Existing execution approval, profitability binding, host/fence/lease, kill/hard stop, strategy pause, profile operation gate and manual Resume boundaries are retained. Non-normal risk stages conservatively refuse. No installed book/policy was created or authorized; positive fixtures are disposable synthetic mechanics through the existing binder, never economic qualification or fresh research evidence.
- Final combined checkout: **333 suites / 2,365 tests**. Exact P5-plus-P6 source: **327 suites / 2,258 tests**. Both include **10 focused P6 suites / 43 tests**. Both source trees pass typecheck/lint/root and desktop builds. Isolated production P6 native and existing standard safety gate pass. Native keyboard setup/refusal focus, labels, clipping, narrow light/dark/high-contrast/200% zoom and zero live permission checks pass. Existing Vite chunk-size advisory remains.
- The finish reviewer requested action/disabled styling and readable cap/recovery wording; its verdict scored both resolved. The documentation handoff confirms an ordinary extension and preserves PRODUCT/DESIGN files and absent sidecars. This does not substitute for financial/source review. [Validation and logs](evidence/p6-paper-2026-10-24/validation.json), [review](evidence/p6-paper-2026-10-24/ui/finish-review.md), [verdict](evidence/p6-paper-2026-10-24/ui/finish-verdict.md), [documentation](evidence/p6-paper-2026-10-24/ui/documentation-check.md).
- Preservation: all **508** baseline dirty entries retain unrelated content/deletion state; nine mixed files reconstruct their original hashes exactly; Git index is unchanged. Of 82 protected paths, 71 are byte-unchanged and 11 are deliberate integration/channel/current-manifest updates enumerated in [preservation.json](evidence/p6-paper-2026-10-24/preservation.json). Original roadmap/P6 plan, frozen results, negative findings and consumed identities remain unchanged. Current dependency manifests reflect current code independently per tree; their original bytes are retained. No commit/push performed.
- Remaining in full: F human source/merge/release review; actual owner-approved opening/configuration/consequence and exact strategy qualification; **P6-G** cash-only acceptance plus realized-cap/exposure/objective and order/OMS recovery review; **P6-H** COQ-12/14 intended-host authorization, exclusive account-wide ownership/fencing and current financial/provider evidence. No sale, broker mutation, payment, study registration, holdout claim, promotion or deployment was introduced. P5-H and every P7 requirement remain pending; no future phase is complete. Reread its full requirements before starting another phase/slice.
- Prompt used: Ok move onto building P6 using the saved plan. Preserve P0–P4 and P5-A–G, keep P5-H pending and the full P0–P7 scope intact, and keep the phase tracker updated.

- Linear delivery synchronized: COQ-40 remains In Progress; issue description/progress comment and affected milestone progress updated without closing any dependency or exit gate. [Receipts](evidence/p6-paper-2026-10-24/linear-sync.json). Local/uncommitted status and all retained G/H/P5-H/P7 requirements are explicit.
