# P2 delivery: shared budgets and small-portfolio feasibility

Local implementation of the [accepted P2 design](small-portfolio-p2-implementation-plan-2026-10-23.md). The [original P0–P7 roadmap](small-portfolio-profit-policy-plan-2026-10-23.md), its companion evidence, P1 calculation and legacy remediation planner remain byte-identical to the recorded baseline. The [phase tracker](small-portfolio-phase-tracker-2026-10-23.md) governs completion and open gates. P3–P7 retain their complete requirements and remain pending.

## What is available

- `account-budget-v1` projects immutable cash/eligibility/position observations and claim heads. A hold is deducted only from ceilings that do not already reflect it. Pending and unknown outcomes retain their obligations. Exact deficits require complete hold/reflection evidence; ambiguous provider holds make capacity unavailable rather than manufacturing an exact shortfall. Supported underfunding records an idempotent blocking reconciliation incident without releasing claims.
- `native-execution-rules-v1` distinguishes minima, increments, maxima, tradability and applicability. Missing values remain unknown. Sanitized native payloads and provenance are retained separately from historical Coinbase datasets. Numeric transport fields never become falsely precise decimal strings.
- `capital-feasibility-v1` nets exposures, processes reductions before additions while retaining the declared priority within each stage, includes fee currency/fixed expense/bid-ask/slippage, floors quantities and checks post-cost risk/cash/turnover constraints. Unfilled sales cannot fund earlier buys. Risk exits may bypass only an explicitly declared discretionary floor; native limits and hard controls remain binding. Partial exits expose residuals/dust. This is a request-specific witness, not an optimizer, a minimum starting balance or a return claim.
- The Allocation screen adds **Capital feasibility**. Observed cash remains visible when capacity is unavailable. Observation/expiry times include seconds. Hypothetical scenarios run only after explicit evaluation, keep a fixed policy across portfolio sizes, clear old results when inputs change and can be reevaluated with identical inputs. They grant no order or reserve authority.

## Storage and sources

Migration **97** creates empty additive structures. Five immutable native/source/claim/budget/feasibility tables are joined by `capital_route_budget_bindings_v1`, which durably binds existing local route identities to their budget revision across service restarts. This additional immutable fact implements the planned routing requirement. A separate operational checkpoint supports transactional CAS. Financial facts use canonical decimal text, content hashes, foreign keys and no-update/no-delete triggers. Existing migration backup/rollback/newer-schema checks are retained.

Local evidence reuses the immutable opening, original opening ledger legs, actual fill/order links, balances and fresh P1 valuations. Unexplained manual cash or reconciliation rows do not establish supported buying capacity. A legacy pending intent without a bounded, current claim remains unavailable. Cost basis and reconciliation notes create no funding.

Coinbase's existing authorized sync optionally acquires up to 100 Advanced Trade products inside its existing acquisition deadline. Its separate capital envelope retains sanitized native fields; failures degrade new evidence without discarding the original dataset. Schema-2 account/fill/transaction hashes are unchanged. Product metadata alone never proves account entitlement, aggregate hold matching or exclusive ownership.

Alpaca's existing financial acquisition now retains `non_marginable_buying_power`; margin buying power is never substituted. The common evidence adapter also accepts bounded, already-acquired native asset metadata. The existing performance refresh does not add asset polling; absent current native evidence remains explicit. Current position/order-cut and aggregate-hold proof, account fee terms and cross-host ownership remain unverified, so connected shared capacity remains unavailable. The adapter accepts acquired financial evidence, not submit/cancel/transfer capabilities.

## Actual consumer boundaries and compatibility

The new local version is available through **explicit constructor injection**, with a required authority callback and original-book/scope/access checks. Production composition does not inject it. No setting or upgrade automatically activates it.

- Existing `PaperOmsService` immediate pricing binds a revision and rechecks it inside the actual persistence transaction. Pending admission commits a cost-inclusive USD bound (or a conservative owned-quantity bound for sells). Settlement uses its own claim once, and release requires the real terminal order record. A failed fill rolls back the claim, order, ledger and checkpoint together. The original OMS arithmetic/event serialization is retained in extracted helpers.
- Existing `PaperExecutionService` has a new model-bound preview. It stores exact inputs, native rules and proposal identity; review/preflight binds budget, model and expiry. A clipped or unnetted request requires a revised proposal rather than silently authorizing a different request. Legacy previews and default execution remain unchanged.
- Existing venue-neutral routing accepts canonical candidate context, checks shared cash including modeled costs and shared owned quantities, persists route budget bindings, and rejects stale placement before its existing simulated adapter. An accepted pending route retains its commitment; no timeout releases it.
- `previewCapitalSimulation` uses each explicitly supplied virtual book's own budget. It has no broker, registration or order port. It does not run, mutate or register the frozen remediation arms or collectors. New capital-aware replay remains P4.

`capital.budget` and `capital.feasibility` are access-checked **local read channels**. They do not refresh providers, ingest evidence, create claims or register studies. Stored-proposal results require matching identity/revision/expiry. Independent scenarios use a separate hypothetical scope when no account exists; renderer-supplied facts cannot become observed ledger evidence.

Profile copies retain immutable financial origins and facts with archived access. Same-profile restore retains original observation times and obligations; it supplies no fresh connected ownership. Backup manifest categories and the 111 profile-scoped-table contract are unchanged. Deletion-impact counts include the new durable facts once. P1 historical reports, negative findings, consumed holdouts, manual Resume, kill switches, permission/fencing checks and live-disabled defaults remain intact.

## Verification and evidence

[Evidence directory](evidence/p2-budget-feasibility-2026-10-23/) contains the dirty-tree baseline, protected hashes, pre-build dependency-manifest archives, preservation audit, final command logs and production desktop screenshots. The [final acceptance summary](evidence/p2-budget-feasibility-2026-10-23/summary.json) records 292 test files / 2,140 passing tests, 65 new focused cases, passing typecheck/lint/root and desktop builds, the standard native gate and 13 feasibility UI checks. It distinguishes combined working-tree verification from isolated consumer fixtures; none establishes connected account verification, strategy efficacy, owner approval or release.

Failed intermediate logs are retained. A build/backup run encountered disk exhaustion; only disposable verification artifacts from the prior P0/P1 isolation run were removed, and affected checks were repeated. An initial full run exposed schema-version expectations still set to 96; they now expect 97 without changing financial fixtures. Native UI confirmation covers dark desktop, narrow light, high-contrast 200% zoom, keyboard help, input affordances, non-mutating IPC and disabled live authority. Expected Chromium CSP notices are separated from component errors.

Generated **current dependency manifests** change with the source closure. Their exact pre-build bytes are archived and hashed; no existing study registration, historical report/result, negative finding or consumed holdout identity is rewritten or automatically migrated. Any later deployment/registration/adoption retains its existing review and qualification gates.

## Open gates

Human review, P1 review dependencies, current account-specific rules/fees/hold reconciliation, cross-host ownership, prospective evidence and release remain open. P2 is a local read-only feasibility capability with isolated consumer integration tests. No strategy change, funded profit/tax reserve, provider order/cancellation, withdrawal, installed upgrade, deployment or study registration is part of this delivery.

**Prompt used**

Ok move onto building P2.

Relevant preceding scope:

Push and commit that then Lets move on to P2. Reread its full requirements in the saved roadmap, inspect the current code, and prepare a concrete implementation plan before writing code. Preserve P0/P1 and the complete P0–P7 scope.

## Isolated commit verification

The exact P2-only candidate based on 94b4f45 passed **286 files / 2,033 tests**, typecheck/lint, root/desktop builds and both disposable native smoke suites (13 P2 UI checks). [Commit isolation evidence](evidence/p2-budget-feasibility-2026-10-23/commit-isolation/summary.json) distinguishes it from the combined dirty checkout. Workspace imports resolve to isolated packages. Mixed-file unrelated execution/hourly changes are excluded; generated current dependency manifests use the committed generator and this exact source closure. All 2,533 existing working-file hashes were unchanged by candidate preparation. No P3 application behavior is included. Commit/push identity is recorded in the phase tracker after delivery.

**Prompt used**

Commit and push P2, then lets move on to P3. Reread its full requirements in the saved roadmap, inspect the code, and prepare a concrete implementation plan before coding. Preserve P0–P2 and the full P0–P7 scope.
