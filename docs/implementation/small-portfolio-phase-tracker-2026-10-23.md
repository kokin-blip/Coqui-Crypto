# Small portfolio P0–P7 phase tracker

The [full saved roadmap](small-portfolio-profit-policy-plan-2026-10-23.md) remains the durable source of truth. [P0/P1 addendum](small-portfolio-capital-accounting-plan-2026-10-23.md). Reread a phase's complete roadmap requirements before beginning it. Propose scope changes explicitly. Never silently drop, simplify or complete a future phase.

| Phase | State | Completed | Remaining / blockers | Dependencies |
|---|---|---|---|---|
| P0 Definitions, scope, source inventory | Committed and pushed | Definitions, baseline, source inventory, exact-or-unavailable rules and independent fixtures | Review remains separate from implementation | Saved roadmap, source baseline |
| P1 Capital-flow accounting and corrected performance | Committed and pushed; in review | Storage, ingestion, calculations, read projections, displays, lifecycle and acceptance checks; isolated delivery 0c3d36c | Human review; actual connected evidence completeness, owner qualification and release remain separate open gates | P0 |
| P2 Shared budgets and small-portfolio feasibility | Planning complete; implementation pending | Full roadmap reread; current code/official blocking semantics inspected; concrete P2-A–F implementation plan saved | All P2 implementation, integration and acceptance requirements remain open; COQ-36 backlog | P1; existing operational review for connected adoption |
| P3 Profit-reserve evaluation and previews | Not started | None | All requirements in saved roadmap retained | P1/P2 |
| P4 Capital-aware simulation | Not started | None | All requirements in saved roadmap retained | P1–P3 and corrected engine compatibility |
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
