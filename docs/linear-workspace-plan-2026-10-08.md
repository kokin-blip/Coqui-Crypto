# Coqui Crypto — Linear organization, October 8, 2026

**Applied to Linear on October 8, 2026.** The connected workspace was inspected and its existing Coqui-Crypto project reused: https://linear.app/coqui-crypto/project/coqui-crypto-3f1cf27441a3. Seven existing development issues were updated, seven missing issues created, and four onboarding issues moved to low-priority Backlog. Existing assignees were preserved. The project is In Progress, with three Todo issues and two In Review.

## Applied roadmap and tracking

1. **01 · Beta hardening and next release:** COQ-5 frontend review, COQ-6 actual live-data lag traces, COQ-7 cold-start/retention follow-up, COQ-8 current-status/agent handoff, COQ-9 existing CI/protection verification, COQ-12 paper-recovery review and COQ-13 release verification.
2. **02 · Connected paper operations verified:** COQ-14 connected paper observations and COQ-15 owner-deferred Coinbase View-only verification.
3. **03 · Prospective studies and data integrity:** COQ-10 registration/identity decision, COQ-16 Coinbase archive provenance and COQ-17 valid prospective coverage.
4. **04 · Candidate evaluation and promotion decision:** COQ-18 frozen development/untouched holdout/governance and COQ-11 lightweight research handoff.

COQ-13 is blocked by COQ-5, COQ-6 and COQ-12; COQ-14 by COQ-12; COQ-17 by COQ-10; COQ-18 by COQ-10 and COQ-17. `Waiting: owner` and `Waiting: evidence` labels expose explicit unblock conditions. No delivery dates were invented. Saved-view creation is not exposed by the plugin; the project description documents using status/priority, milestone and waiting-label filters.

**Corrections to the original draft below:** the August forward-edge registration is retired for implementation identity mismatch, so an active 365-day collector must not be inferred. A valid replacement must explicitly adopt any such requirements. The legacy seven-day campaign is a research record, not a parallel-experiment permission gate. The remediation October 15–December 13 development and December 14–March 13 holdout schedule remains a proposal pending an explicit owner registration decision. CI already exists; COQ-9 checks actual runs and branch protections rather than rebuilding the pipeline.

Standing instruction from kokin: update the matching Linear issue whenever repository work finishes, with result, verification, appropriate status and evidence links; leave a completion/progress comment ending with **Completed by: kokin**. This is also recorded in `AGENTS.md` and the Linear project description.

## Original planning draft — historical, superseded by the applied tracking above

## Structure

Use one Coqui Crypto delivery project with four milestones. Keep historical completed work in Done and out of the active view. Use the team's existing workflow states; the state names below describe intent, not confirmed Linear IDs. Prefer project milestones to separate projects for small workstreams.

| Milestone | Role | Exit criterion |
| --- | --- | --- |
| Beta hardening and next release | Current delivery focus | Reviewed working-tree changes; all verification gates green; supported release artifacts and packaged checks verified; release notes match the shipped revision. Version and target date remain unset until established. |
| Connected paper operations verified | Next operational gate | Owner-authorized read-only Coinbase and dedicated Alpaca paper checks recorded; freshness, recovery, manual resume, fees, order outcomes and restart behavior observed end to end. |
| Prospective research evidence complete | Evidence collection | Registered studies meet their own frozen duration, coverage, trade-count and integrity requirements. Seven-day operational campaign and long-term prospective evidence are distinct criteria. |
| Candidate evaluation and promotion decision | Future, dependency-gated | Frozen final/holdout results independently reviewed against registered cost-bearing criteria; approved candidates have explicit governance decisions. Completion does not imply profitability or live-trading authorization. |

No arbitrary deadlines. Elapsed evidence milestones depend on actual registered starts and accumulated valid observations; confirm these before setting target dates. Live trading is outside the active roadmap and remains disabled.

## Existing progress to reconcile

- Latest documented release: experimental beta.15, with unified Figma terminal, account management, chart/activity/allocation improvements and research-integrity tools. Confirm actual release state before closing release issues.
- Frontend optimization: implemented and locally verified in this chat; not yet committed/released. Renderer JavaScript decreased 37%; entry JS decreased 40%; Figma CSS is unchanged. Typecheck, lint, 252 test files / 1,642 tests, builds, Electron smoke and performance gates passed.
- Paper reliability: additional broker-evidence, delayed-fee, manual-resume/minor-exception and pass-deadline work exists in the uncommitted working tree. Treat it as implementation/review work, not shipped behavior or connected-account validation.
- Research foundations and collectors exist. The negative TrendVol replacement study remains negative; defaults remain unvalidated. Implementation completion does not close prospective evidence gates.
- `docs/PLAN.md` contains historical phase descriptions and older verification counts/UI descriptions. Preserve its history while refreshing the current-status section.

## Lean issue queue

Map these to existing issues first. Create only missing actionable work. Priorities use Linear's usual intent: P1 high, P2 normal, P3 low; confirm the actual workspace schema.

| Priority | Issue | Intended state | Milestone and acceptance |
| --- | --- | --- | --- |
| P1 | Capture the reported frontend lag with live-data traces | Ready / Todo | Beta hardening. Record renderer and Electron-main profiles during actual scrolling, clicks and chart stutter; correlate IPC latency, book depth, scheduler overlap and provider delays. The deterministic fixture did not reproduce severe lag. Preserve algorithms, every event and freshness cadence. |
| P1 | Review and integrate the paper recovery/evidence changes | In Review if ownership confirms; otherwise In Progress | Beta hardening. Review the current uncommitted broker-evidence, fee, minor-exception and deadline changes; verify ambiguous writes are reconciled, resume stays manual, and all safety/contract tests pass. Record the reviewed commit. |
| P2 | Review and ship the measured frontend optimizations | In Review | Beta hardening. Existing implementation is complete; review diff and before/after evidence, then package/release it. Keep algorithm, query-policy and CSS behavior intact. Do not mark a release complete on local test evidence alone. |
| P2 | Verify next-release artifacts and publish accurate release notes | Todo; depends on both review issues | Beta hardening. Build supported platforms, run packaged smoke on matching hosts, verify checksums/migrations and record GUI/owner checks that remain open. Do not assume uncommitted changes are in beta.15. |
| P2 | Refresh the authoritative current-status and roadmap summary | Todo | Beta hardening. Update `docs/PLAN.md` current status from confirmed source/release evidence; link current Figma terminal, reliability and performance work; retain historical phase records. |
| P1 | Observe connected paper execution and recovery end to end | Blocked on owner-authorized account checks | Connected paper operations. Dedicated paper account only; record order/partial-fill/fee/cancel outcomes, freshness and restart/reconciliation behavior. Existing mock tests are supporting evidence, not venue verification. |
| P2 | Complete real Coinbase view-only verification | Deferred / Blocked on owner | Connected paper operations. The historical real-key check was owner-deferred; retain that distinction until confirmed. Reject trade/transfer permissions and preserve secret isolation. |
| P2 | Complete the elapsed seven-day campaign evidence | Waiting / Blocked on valid elapsed observations | Prospective research evidence. Confirm consecutive actual campaign events, safety-stop exercise/acknowledgment and reconciliation criteria against the registered campaign. No synthetic closure or backfilled days. |
| P2 | Accumulate the long-term prospective profitability evidence | Waiting / In Progress only if collector is confirmed active | Prospective research evidence. Confirm the registered requirements, including 365 complete prospective days and 30 cost-bearing rebalances; record coverage and integrity without presenting implementation as proof of edge. |
| P2 | Finish registered candidate development and holdout evaluations | Backlog / dependency-gated | Candidate evaluation. Preserve each study's frozen design. Wider-universe studies use their documented 60-day development and 90-day holdout; the hourly TrendVol candidate has separate folds/holdout requirements. Record valid coverage and cost-bearing final outcomes before any promotion decision. |

## Views and maintenance

Use three saved views if the plugin exposes them: **Now** (Coqui active issues, grouped by status and sorted by priority), **Roadmap** (milestones with dependency-gated future issues), and **Waiting for evidence / owner** (blocked or deferred issues with a clear unblock condition). Otherwise use the existing project views and milestone filters.

Keep the active queue to a few owned issues. Add a short repository evidence link and acceptance criteria to each issue. Preserve existing assignees, cycles and dates unless evidence requires a change; do not assign ownership or promise deadlines by inference. Merge duplicate tracking only after comparing their scope; preserve history and links. Do not close unknown issues simply because a nearby feature exists.

The current project update should separate: shipped baseline; implemented but unshipped changes; verification; active risks; next milestone; evidence/owner dependencies. No recurring automation is requested by this task.

Sources: `docs/RELEASE-NOTES-beta.15.md`, `docs/parallel-paper.md`, `docs/studies/frontend-performance-2026-10-08.md`, `docs/studies/research-integrity.md`, `docs/studies/selective-participation.md`, `docs/PLAN.md`, current Git status and the verification results in this chat.
