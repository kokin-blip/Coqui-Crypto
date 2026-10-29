# P6-G push and recovery acceptance continuation

[Full roadmap](small-portfolio-profit-policy-plan-2026-10-23.md), [full P6 plan](small-portfolio-p6-implementation-plan-2026-10-24.md), [phase tracker](small-portfolio-phase-tracker-2026-10-23.md), [app delivery](small-portfolio-p6-g-app-delivery-2026-10-28.md).

The app integration, solver/backend, purpose-bound OMS/storage checks and required independent-deadline helper are pushed as [02b8171](https://github.com/kokin-blip/Coqui-Crypto/commit/02b8171e74f079c68dbd9da8a3d8f9d4359cd306). Exact isolated source passed 333 suites/2,297 tests, typecheck/lint/root and desktop builds,18 sale-native checks and standard native safety. All38 source hashes and189 staged paths were verified. P7, hourly-study and broker-recovery application changes were excluded and preserved. [Commit/preservation evidence](evidence/p6-g-commit-2026-10-28/commit-receipt.json). Earlier combined354/2,454 evidence remains historical and distinct. Original plans and prior working application bytes remain unchanged.

After the push, added test-only `tests/paper-reserve-sale-recovery.test.ts` (10 cases) and `tests/paper-reserve-sale-deadlines.test.ts` (3 cases). These cover inconsistent pending-index/nonterminal order cuts, claim retention, unknown-after-fill, supported terminal claim release without new cash, stop/fence/restart refusal, incomplete late-fee accounting and independent read deadlines. They exercise real local proposal/OMS/claim/repository boundaries with explicitly synthetic records. They do not simulate a successful actual broker partial-fill, cancellation, ownership or fee-completeness observation. No provider or installed database was accessed.

All13 new cases pass both on isolated G source and the combined checkout. The combined focused run passes6 suites/34 cases; root typecheck and focused lint pass. [Recovery validation/logs](evidence/p6-g-recovery-2026-10-28/validation.json). No application/UI code changes or full verification rerun for this test-only increment. An initial test referenced the wrong research-deadline helper name; corrected to the actual API with the original failure retained. These new tests and post-push tracker/evidence remain local/uncommitted.

The remaining requirements are evidence/review gates, not declarations this software may supply:

| Slice | Still required | Status |
|---|---|---|
| P5-H | Adequate permitted development panel, original trial/consumption custody, membership/native/cost evidence, frozen objectives/resources and full results | Pending; captured78 dates cannot supply120-day seed warmup. No consumed window reused. |
| P6-G operation | Actual reviewed cash-only acceptance, source/objective-policy evidence and exact qualified strategy/native/cost admission, applicable full operational review | Pending; code, tests and source identity do not grant approval. |
| P6-H | COQ-12/14 exact-source/current intended-host account evidence, rights and reviewed exclusive account-wide fencing/claim protocol | Pending; sole display account/profile lease does not prove identity or ownership. |
| P7-H | Independent owner/reviewer, approved supported design/rights/registry/power/resources and genuine future windows | Pending; existing broker/algorithm data selection did not supply these approvals. |
| P7-I/J | Actual elapsed unchanged observations, timely candidate-or-none freeze, untouched final once and independent exact paper-configuration decision | Pending; no fabricated elapsed time, collector, final access or qualification. |

All P0–P7 scope is retained. No original research/negative findings/frozen reports/consumed identity changed; no live trading, broker order/cancellation, withdrawal, Resume, deployment, actual registration/collector/final or promotion. Human review, merge/release and actual gates stay separate from the pushed capability. No broad research repeat or new venue claim was needed.

**Prompt used**

Commit and push P6-G’s app integration, then continue the remaining unblocked work. Preserve unrelated work and the full P0–P7 scope, keep unmet evidence gates pending, and update the phase tracker.
