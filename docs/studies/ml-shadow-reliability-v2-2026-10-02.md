# Beta.12 execution and ML shadow reliability repair — October 2, 2026

This is an engineering repair and candidate-definition record, not an owner study registration or performance assessment. No deployment, broker order, host-authority change, candidate promotion, or holdout evaluation was performed. Operational TrendVol inputs, targets, sizing formulas, costs, bands and permitted slots are unchanged.

## Observed diagnosis

The working tree was clean before editing. CLAUDE.md and the September 30 remediation research, implementation and evidence documents were read. The local main-profile database was opened read-only; credentials and raw broker responses were not queried.

The diagnostics Proxy replaced methods on the frozen Alpaca client. JavaScript prohibits returning a replacement for a nonwritable, nonconfigurable own property. A standalone Node reproduction threw TypeError before the account method ran. On October 1 at 18:32:24 UTC the journal recorded 288 ms of market preparation, credentials validation at 18:32:24.606, then `paper_execution_unknown` at 18:32:24.616 without broker-operation evidence. Later checks validated credentials and produced generic `reconciliation_unavailable`. This strongly supports a local wrapper failure; it does not establish contemporaneous broker API health or explain earlier outages.

The owner journal contains the October 1 04 UTC unavailable/stale ML target and later BTC fills. Its hourly ML cache ends at October 1 03 UTC, retrieved at 04:00:47.424 UTC. The old runtime refreshed asynchronously after preparation, while the execution path recorded its slot once; a prediction arriving afterward could not repair that record. Collection was also gated by active/recoverable paper state, so the generic wrapper pause stopped it.

The frozen `trendvol-ml-ridge-v1` result really records 293 development checks and 450 holdout checks, baseline and overlay returns both 11.42198576323754%, zero lift, zero stress lift, and interval endpoints of zero. Registration and result dataset hashes match. These are recorded outputs, not UI defaults. Exact equality is consistent with an overlay that made no differential changes. The stored summary alone does not establish all evaluated target paths, effective independent observations or statistical validity. This repair does not replay those holdout data to answer that question. Degenerate uncertainty is unavailable for interpretation, and the legacy diagnostic remains unqualified.

## Operating behavior

Broker account/open-order validation and deterministic attempted-intent reconciliation precede market preparation. A 30-second pass remains capped by the eligible 15-minute window. Preparation has at most ten seconds and cannot consume the fifteen seconds reserved for execution. When that reserve cannot be maintained, the pass records deadline exhaustion. An immediately-before-submit check requires at least five seconds remaining; it also checks pause, kill switch, lease/fencing and preparation.

Alpaca operations have a ten-second total read budget, with at most two five-second attempts. Response-body parsing shares the attempt deadline. Only transient GET failures may retry once; POST and DELETE have one attempt. Safe operation, HTTP status when received, attempt count, elapsed time, budget and remaining time are recorded; URLs, headers, credentials, response bodies and raw exception text are excluded. Pagination, append-only activities and daily delayed-fee audits retain their existing semantics. If a required audit cannot finish within budget, reconciliation stays unavailable rather than claiming completeness.

Transient pauses resume only after broker reconciliation and current preparation succeed with no open orders. Legacy `paper_execution_unknown` can recover only when every persisted submission attempt is conclusively filled and its fills are recorded, or there were no attempts. An unresolved/partial outcome remains blocked. Explicit user pauses, disconnected accounts, kill switch and stale host authority remain preserved. Optional marks and research observations run after authoritative work; their failures record research unavailability instead of pausing completed execution.

`trendvol-ml-ridge-shadow-v2` collects recent completed hourly bars before training-history gaps, including during user and broker pauses. It collects at most one historical 300-hour window per scheduler check. Each window needs exact coverage per asset, and authenticated incomplete windows may fall back to a whole public window within the shared research budget. Missing bars are never synthesized. Research has a shared ten-second cancellable budget; an execution pass preempts it, including terminating an active model worker. Completed per-asset cache windows survive restart and failures of later assets, so repeated ten-second budgets cannot starve the last product by repeatedly fetching the first two.

Current inference is separate from historical evaluation. Features require 169 consecutive prior completed hours; four-hour training labels are complete before the UTC Monday training cutoff. The fixed ridge fit uses the trailing 120-day window, at least 95% coverage of five daily slots, L2 strength 10, the existing five features, 0.5% per-side cost and ten-point target bounds. Labels cannot overlap a registered study instance's protected holdout interval or an unfinished legacy ML holdout. Those intervals are read as metadata only; their evaluation bodies are never opened. There is no random split, parameter search or performance-based selection.

A fresh proposal binds its slot, candidate/plan/behavior/input/model hashes, weekly training cutoff, training count, capture time and operational baseline decision identity. It must finish before the slot cutoff and pass provenance checks. Missing daily targets, feature/history gaps, canceled acquisition, mismatched inputs and late workers remain unavailable. A proposal is recorded independently of the earlier operational slot record, so a later in-window result can be audited without rewriting history. Restart reuses a matching immutable same-slot proposal. Every proposal remains shadow-only and unqualified; no historical gate enables ML execution.

The relevant dependency manifest changes when inference or its dependencies change. Existing owner study hashes are never rewritten to match this build. Existing studies may therefore remain blocked by their original provenance gate; this repair does not register replacements.

## Candidate and trial accounting

| Candidate | Declared variants | Financial evaluations in this repair | Evidence use |
|---|---:|---:|---|
| trendvol-ml-ridge-v1 | 1 legacy recorded candidate | 0 | Original frozen diagnostic, unchanged |
| trendvol-ml-ridge-shadow-v2 | 1 fixed inference candidate | 0 | Synthetic reliability tests and prospective shadow proposals only |

No matching ML record was found in the owner's trial registry during read-only inspection. That is an unresolved historical accounting gap, not permission to describe the registry as complete or derive significance from it. The table declares the repaired variant without inventing an observed financial trial. Before any future real-data candidate evaluation, append every evaluated alternative (including failures) to the validated trial registry, freeze the evaluation definition and protect untouched dates. Do not reuse the v1 historical holdout to select v2 parameters. No performance evaluator is called by the v2 scheduler.

## Connected verification still needed

On a separately approved supervised build, verify account identity, account/open-order/activity read health, actual HTTP status and deadline diagnostics, complete activity pagination and delayed-fee coverage. Reconcile all prior attempts by deterministic client ID before resuming a legacy generic pause. Observe fresh Coinbase hourly collection and one eligible shadow window; confirm the independent proposal, provenance and unchanged operational target. Verify OS keychain access, sleep/wake cancellation, restart and existing host fencing. Automated tests use synthetic bars and mocked transport and do not establish broker availability, unattended readiness or profitable alpha.

## Final verification

`pnpm verify` passed: typecheck, lint, all 225 test files / 1,438 tests, dependency-manifest generation and TypeScript build. `git diff --check` passed. Regression coverage includes the actual frozen adapter with mocked transport, body/deadline exhaustion, bounded retry and ambiguous submission behavior, pause preservation, partial acquisition progress, asynchronous shadow completion, restart, protected labels, provenance and unavailable/degenerate UI states. The compiled worker separately returned unavailable for missing features, honored cancellation, and produced an unqualified three-asset proposal from synthetic complete inputs with 600 training labels and no performance evidence. Those synthetic checks establish software behavior only.
